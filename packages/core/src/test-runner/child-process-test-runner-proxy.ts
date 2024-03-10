import { URL } from 'url';

import { FileDescriptions, StrykerOptions } from '@stryker-mutator/api/core';
import { Logger } from '@stryker-mutator/api/logging';
import {
  DryRunOptions,
  MutantRunOptions,
  MutantRunResult,
  DryRunResult,
  TestRunnerCapabilities,
  TestRunner,
  SimultaneousMutantRunOptions,
  SimultaneousMutantRunResult,
  SimultaneousMutantRunStatus,
  MutantRunStatus,
  PendingMutantRunResult,
  TimeoutMutantRunResult,
} from '@stryker-mutator/api/test-runner';
import { ExpirableTask } from '@stryker-mutator/util';

import { Subject, TimeoutError, catchError, lastValueFrom, of, timeout, toArray } from 'rxjs';

import { Metrics } from '@stryker-mutator/api/metrics';

import { ChildProcessCrashedError } from '../child-proxy/child-process-crashed-error.js';
import { ChildProcessProxy } from '../child-proxy/child-process-proxy.js';
import { LoggingClientContext } from '../logging/index.js';

import { IdGenerator } from '../child-proxy/id-generator.js';

import {
  CustomMessage,
  TestUpdate,
  TestUpdateMessage,
  TestUpdateType,
  isMutantResultUpdate,
  isTestResultUpdate,
  isTestRunStartedUpdate,
  isTestStartedUpdate,
} from '../child-proxy/message-protocol.js';

import { LiverunTimeoutError } from '../errors.js';

import { ChildProcessTestRunnerWorker } from './child-process-test-runner-worker.js';

const MAX_WAIT_FOR_DISPOSE = 2000;

/**
 * Runs the given test runner in a child process and forwards reports about test results
 */
export class ChildProcessTestRunnerProxy implements TestRunner {
  private readonly worker: ChildProcessProxy<ChildProcessTestRunnerWorker>;

  constructor(
    options: StrykerOptions,
    fileDescriptions: FileDescriptions,
    sandboxWorkingDirectory: string,
    loggingContext: LoggingClientContext,
    pluginModulePaths: readonly string[],
    private readonly log: Logger,
    idGenerator: IdGenerator,
  ) {
    this.worker = ChildProcessProxy.create(
      new URL('./child-process-test-runner-worker.js', import.meta.url).toString(),
      loggingContext,
      options,
      fileDescriptions,
      pluginModulePaths,
      sandboxWorkingDirectory,
      ChildProcessTestRunnerWorker,
      options.testRunnerNodeArgs,
      idGenerator,
    );
  }

  public capabilities(): Promise<TestRunnerCapabilities> {
    return this.worker.proxy.capabilities();
  }

  public init(): Promise<void> {
    return this.worker.proxy.init();
  }

  public dryRun(options: DryRunOptions): Promise<DryRunResult> {
    return this.worker.proxy.dryRun(options);
  }
  public mutantRun(options: MutantRunOptions): Promise<MutantRunResult> {
    return this.worker.proxy.mutantRun(options);
  }

  // Stryker disable all
  /**
   * Start a live mutant run that provides test results as a stream. A timeout must be handled explicitly
   * after subscribing to the observable. You should catch rxjs' 'TimeoutError' if you wish to handle timeouts.
   */
  public async strykerLiveMutantRun(options: SimultaneousMutantRunOptions): Promise<SimultaneousMutantRunResult> {
    const subject = new Subject<TestUpdate>();
    let subjectCompleted = false;
    const listener = (message: CustomMessage) => {
      const testUpdateMessage = message as TestUpdateMessage;
      if (testUpdateMessage.update) {
        const testUpdate = testUpdateMessage.update;
        subject.next(testUpdate);
        if (testUpdate.type === TestUpdateType.Finished) {
          subjectCompleted = true;
          subject.complete();
        }
      }
    };
    try {
      this.worker.on('custom-message', listener);
      // todo: dumping this return value would also mean we lose the errors that are thrown by this call
      void this.worker.proxy.strykerLiveMutantRun(options);

      let timedOut = false;
      /*
      setTimeout(() => {
        if (!subjectCompleted) {
          subjectCompleted = true;
          timedOut = true;
          if (this.log.isInfoEnabled()) {
            this.log.info(`Mutant group '[${options.groupId}]' timed out early (enforced).`);
          }
          subject.complete();
        }
      }, options.timeout);
      */
      // todo: this timeout will come with different behavior.
      // it times out after the provided amount of time when no updates were received.
      // this is different from the timeout decorator because that sets a limit on the total time the tests may run
      // inherently will take longer

      const reports = await lastValueFrom(
        subject.pipe(
          timeout({ each: options.timeout }),
          catchError((err) => {
            if (err instanceof TimeoutError) {
              timedOut = true;
              if (this.log.isTraceEnabled()) {
                this.log.trace(`Mutant group ${options.groupId}'s pipe timed out.`);
              }
              return of();
            } else {
              this.log.error(`Unidentified error occurred in pipe for group ${options.groupId}: ${JSON.stringify(err)}.`);
              throw err;
            }
          }),
          toArray(),
        ),
      );

      if (this.log.isTraceEnabled()) {
        this.log.trace(`Reports for group ${options.groupId} have completed: ${JSON.stringify(reports)}`);
      }
      const startFormulateResult = Metrics.now();
      const result = Metrics.metricsFor(options.groupId).timeFunction(
        () => this.formulateLiveResult(reports, options, timedOut),
        ChildProcessTestRunnerProxy.name,
        this.formulateLiveResult.name,
      );
      const testSession = Metrics.metricsFor(options.groupId).getRunningTestSession();
      testSession.setStartFormulateResult(startFormulateResult);
      testSession.setEndFormulateResult(Metrics.now());
      if (timedOut) {
        throw new LiverunTimeoutError(result, `Group ${options.groupId} timed out.`);
      } else {
        return result;
      }
    } catch (e) {
      if (!(e instanceof LiverunTimeoutError)) this.log.error(`Error occurred during live mutant run:${JSON.stringify(e)}.`);
      throw e;
    } finally {
      this.worker.off('custom-message', listener);
    }
  }

  private formulateLiveResult(reports: TestUpdate[], options: SimultaneousMutantRunOptions, timedOut: boolean): SimultaneousMutantRunResult {
    const metrics = Metrics.metricsFor(options.groupId);
    const startUpdate = reports.find(isTestRunStartedUpdate);
    if (startUpdate) {
      metrics.getRunningTestSession().setTestRunBeginMs(startUpdate.testRunStartedMs);
    }

    const completeResults = reports.filter(isMutantResultUpdate);

    let timedoutMutantId: string | undefined = undefined;
    const lastPendingTest = timedOut ? this.findLast(reports, isTestStartedUpdate) : undefined;
    const lastTestResult = timedOut ? this.findLast(reports, isTestResultUpdate) : undefined;
    const lastPendingTestResult = lastPendingTest
      ? reports.find((report) => report.type === TestUpdateType.TestResult && report.testResult.id === lastPendingTest.test)
      : undefined;

    if (timedOut && lastPendingTestResult) {
      this.log.error(`Last pending test had a result: ${JSON.stringify(lastPendingTestResult, null, 2)}, this should not happen.`);
    }

    if (timedOut && lastPendingTest && !lastPendingTestResult && lastTestResult?.testResult.id !== lastPendingTest.test) {
      // very expensive to look for the culprit test, a whole bunch of string comparisons must be made
      timedoutMutantId = options.mutantRunOptions.find((m) => m.testFilter?.find((t) => t === lastPendingTest.test))?.activeMutant.id;
      if (timedoutMutantId) {
        this.log.info(`Found timed out mutant ${timedoutMutantId} for group ${options.groupId}.`);
        const timedOutMutantRunOptions = options.mutantRunOptions.find((m) => m.activeMutant.id === timedoutMutantId)!;
        this.log.info(`Timed out mutant's testFilter: [${timedOutMutantRunOptions.testFilter}]`);
        options.mutantRunOptions
          .filter((m) => m.activeMutant.id !== timedoutMutantId)
          .forEach((m) => {
            this.log.info(`Other mutant's testFilter from the same group (${m.activeMutant.id}): [${m.testFilter}]`);
          });
        this.log.info(`Pending test: ${JSON.stringify(lastPendingTest)}, Last test result: ${JSON.stringify(lastTestResult)}`);
      }
    }

    //this.log.warn(`Group ${options.groupId} could not finish all mutants, possibly due to a timeout.`);
    let complete = true;
    const matchedResults = options.mutantRunOptions.map((mutant) => {
      // first, check the timeout as that will not be reported back by the live reporter but we do want to make it show up as a timeout
      if (mutant.activeMutant.id === timedoutMutantId) {
        const timeoutResult: TimeoutMutantRunResult = { status: MutantRunStatus.Timeout, reason: `Test '${lastPendingTest?.test}' timed out.` };
        return timeoutResult;
      }

      const matchedResult = completeResults.find((x) => mutant.activeMutant.id === x.mutantId);
      if (matchedResult) {
        //this.log.debug(`Found a matching result for mutant ${mutant.activeMutant.id} in group ${options.groupId}: ${JSON.stringify(matchedResult)}`);
        return matchedResult.mutantResult;
      } else {
        complete = false;
        //this.log.info(`Mutant ${mutant.activeMutant.id} requires a rerun.`);
        const pending: PendingMutantRunResult = { status: MutantRunStatus.Pending };
        return pending;
      }
    });

    if (complete) {
      return {
        status: SimultaneousMutantRunStatus.Complete,
        results: matchedResults as MutantRunResult[],
      };
    } else {
      return {
        status: SimultaneousMutantRunStatus.Partial,
        partialResults: matchedResults,
      };
    }
  }

  private findLast<S extends T, T>(input: T[], predicate: (value: T, index: number, obj: T[]) => value is S): S | undefined {
    const index = this.findLastIndexOf(input, predicate);
    if (index >= 0) {
      return input[index] as S;
    }
    return undefined;
  }

  private findLastIndexOf<S extends T, T>(input: T[], predicate: (value: T, index: number, obj: T[]) => value is S): number {
    for (let i = input.length - 1; i >= 0; i--) {
      if (predicate(input[i], i, input)) {
        return i;
      }
    }
    return -1;
  }
  // Stryker restore all

  public async dispose(): Promise<void> {
    await ExpirableTask.timeout(
      // First let the inner test runner dispose
      this.worker.proxy.dispose().catch((error) => {
        // It's OK if the child process is already down.
        if (!(error instanceof ChildProcessCrashedError)) {
          // Handle error by logging it. We still want to kill the child process.
          this.log.warn(
            'An unexpected error occurred during test runner disposal. This might be worth looking into. Stryker will ignore this error.',
            error,
          );
        }
      }),

      // ... but don't wait forever on that
      MAX_WAIT_FOR_DISPOSE,
    );

    // After that, dispose the child process itself
    await this.worker.dispose();
  }
}
