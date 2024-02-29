import {
  DryRunStatus,
  DryRunResult,
  DryRunOptions,
  MutantRunOptions,
  MutantRunResult,
  MutantRunStatus,
  SimultaneousMutantRunOptions,
  SimultaneousMutantRunResult,
  SimultaneousMutantRunStatus,
} from '@stryker-mutator/api/test-runner';
import log4js from 'log4js';
import { ExpirableTask } from '@stryker-mutator/util';

import { Metrics, MutantMetrics } from '@stryker-mutator/api/metrics';

import { LiverunTimeoutError } from '../errors.js';

import { TestRunnerDecorator } from './test-runner-decorator.js';

/**
 * Wraps a test runner and implements the timeout functionality.
 */
export class TimeoutDecorator extends TestRunnerDecorator {
  private readonly log = log4js.getLogger(TimeoutDecorator.name);

  public async dryRun(options: DryRunOptions): Promise<DryRunResult> {
    const result = await this.run(options, undefined, () => super.dryRun(options));
    if (result === ExpirableTask.TimeoutExpired) {
      return {
        status: DryRunStatus.Timeout,
      };
    } else {
      return result;
    }
  }

  public async mutantRun(options: MutantRunOptions): Promise<MutantRunResult> {
    const result = await this.run(options, options.activeMutant.id, () => super.mutantRun(options));
    const metrics = Metrics.metricsFor(options.activeMutant.id);
    if (result === ExpirableTask.TimeoutExpired) {
      return captureTestSessionMetrics(
        {
          status: MutantRunStatus.Timeout,
        },
        metrics,
      );
    } else {
      return captureTestSessionMetrics(result, metrics);
    }
  }

  private async run<TOptions extends { timeout: number }, TResult>(
    options: TOptions,
    activeMutantId: string | undefined,
    actRun: () => Promise<TResult>,
    handleTimeout = true,
  ): Promise<TResult | typeof ExpirableTask.TimeoutExpired> {
    this.log.debug('Starting timeout timer (%s ms) for a test run', options.timeout);
    const result = await ExpirableTask.timeout(actRun(), options.timeout);
    if (result === ExpirableTask.TimeoutExpired) {
      if (handleTimeout) await this.handleTimeout(activeMutantId);
      return result;
    } else {
      return result;
    }
  }

  public async simultaneousMutantRun(options: SimultaneousMutantRunOptions): Promise<SimultaneousMutantRunResult> {
    const result = await this.run(options, options.groupId, () => super.simultaneousMutantRun(options), false);
    const metrics = Metrics.metricsFor(options.groupId);
    if (result === ExpirableTask.TimeoutExpired) {
      if (options.mutantRunOptions.length === 1) {
        await this.handleTimeout(options.groupId);
        return captureTestSessionMetrics(
          {
            status: SimultaneousMutantRunStatus.Complete,
            results: [{ status: MutantRunStatus.Timeout }],
          },
          metrics,
        );
      }

      if (this.log.isTraceEnabled()) {
        this.log.trace(`Mutant group (${options.groupId}) timed out.`);
      }
      // todo: will get stuck if the child process is in an infinite loop... (js is singlethreaded...)
      let partialResults: SimultaneousMutantRunResult | undefined;
      if (this.formulateEarlyResults) {
        const maybePartialResults = await ExpirableTask.timeout(this.formulateEarlyResults(options.mutantRunOptions), 5000);
        if (maybePartialResults === ExpirableTask.TimeoutExpired) {
          this.log.info(`Retrieving partial results failed for group ${options.groupId}. Assumed actual timeout.`);
        } else {
          partialResults = maybePartialResults;
          this.log.info(`Retrieved partial results successfully for group ${options.groupId}.`);
        }
      }
      await this.handleTimeout(options.groupId);
      if (partialResults) {
        //return this.simpleDecomposedSimultaneousMutantRun(options, group, partialResults);
        return captureTestSessionMetrics(partialResults, metrics);
      }
      // simultaneous testing is essentially useless if the test-runner is unable to formulate an early result
      // we have no clue here which test timed out and which tests had already been run, this is terrible for performance
      // as it requires us to rerun all mutants individually, including the timed out one (yielding double timeouts)
      return {
        status: SimultaneousMutantRunStatus.Partial,
        partialResults: options.mutantRunOptions.map((_) => {
          return { status: MutantRunStatus.Pending };
        }),
      };
    } else {
      return captureTestSessionMetrics(result, metrics);
    }
  }

  public async strykerLiveMutantRun(options: SimultaneousMutantRunOptions): Promise<SimultaneousMutantRunResult | undefined> {
    try {
      return await Metrics.metricsFor(options.groupId).timeAwaitedFunction(
        () => super.strykerLiveMutantRun(options),
        TimeoutDecorator.name,
        this.strykerLiveMutantRun.name,
      );
    } catch (e) {
      if (e instanceof LiverunTimeoutError) {
        await this.handleTimeout(options.groupId);
        return e.result;
      }
      this.log.error(`Unidentified error occurred in pipe for group ${options.groupId}: ${JSON.stringify(e)}.`);
      throw e;
    }
  }

  private async handleTimeout(id: string | undefined): Promise<void> {
    this.log.debug(`Timeout expired (${id}), restarting the process and reporting timeout`);
    await this.measuredRecovery(id);
  }

  private measuredRecovery(id: string | undefined): Promise<void> {
    if (id) {
      return Metrics.metricsFor(id).timeAwaitedFunction(() => this.recover(), TimeoutDecorator.name, this.measuredRecovery.name);
    } else {
      return this.recover();
    }
  }
}

// Stryker disable all
function captureTestSessionMetrics<T extends object>(from: T, metrics: MutantMetrics) {
  const testSession = metrics.getRunningTestSession();
  if (typeof from === 'object') {
    if ('testRunBeginMs' in from && from.testRunBeginMs) {
      testSession.setTestRunBeginMs(from.testRunBeginMs as number);
    }
    if ('startToMutantRunResult' in from) {
      testSession.setStartFormulateResult(from.startToMutantRunResult as number);
    }
    if ('endToMutantRunResult' in from) {
      testSession.setEndFormulateResult(from.endToMutantRunResult as number);
    }
  }
  return from;
}
// Stryker restore all
