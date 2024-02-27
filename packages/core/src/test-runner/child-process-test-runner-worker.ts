import { InstrumenterContextWrapper, StrykerOptions } from '@stryker-mutator/api/core';
import { commonTokens, PluginKind, tokens } from '@stryker-mutator/api/plugin';
import {
  TestRunner,
  DryRunOptions,
  MutantRunOptions,
  MutantRunResult,
  DryRunResult,
  DryRunStatus,
  MutantRunStatus,
  TestRunnerCapabilities,
  SimultaneousMutantRunOptions,
  SimultaneousMutantRunResult,
  SimultaneousMutantRunStatus,
  PartialSimultaneousMutantRunResult,
  PendingMutantRunResult,
  LiveTestRunReporter,
  TestResult,
  TestStatus,
  determineHitLimitReached,
  toMutantRunResult,
} from '@stryker-mutator/api/test-runner';
import { errorToString } from '@stryker-mutator/util';

import { Logger } from '@stryker-mutator/api/logging';

import log4js from 'log4js';

import { coreTokens, PluginCreator } from '../di/index.js';
import { ChildProcessProxyWorker } from '../child-proxy/child-process-proxy-worker.js';

export class ChildProcessTestRunnerWorker implements TestRunner {
  private readonly underlyingTestRunner: TestRunner;
  // set by ChildProcessProxyWorker, very ugly but works ;)
  private readonly parentWorker: ChildProcessProxyWorker | undefined;

  public static inject = tokens(commonTokens.options, coreTokens.pluginCreator);
  constructor({ testRunner }: StrykerOptions, pluginCreator: PluginCreator) {
    this.underlyingTestRunner = pluginCreator.create(PluginKind.TestRunner, testRunner);
  }

  public async capabilities(): Promise<TestRunnerCapabilities> {
    return this.underlyingTestRunner.capabilities();
  }

  public async init(): Promise<void> {
    if (this.underlyingTestRunner.init) {
      await this.underlyingTestRunner.init();
    }
  }

  public async dispose(): Promise<void> {
    if (this.underlyingTestRunner.dispose) {
      await this.underlyingTestRunner.dispose();
    }
  }

  public async dryRun(options: DryRunOptions): Promise<DryRunResult> {
    const dryRunResult = await this.underlyingTestRunner.dryRun(options);
    if (dryRunResult.status === DryRunStatus.Complete && !dryRunResult.mutantCoverage && options.coverageAnalysis !== 'off') {
      // @ts-expect-error
      dryRunResult.mutantCoverage = global.__mutantCoverage__;
    }
    if (dryRunResult.status === DryRunStatus.Error) {
      dryRunResult.errorMessage = errorToString(dryRunResult.errorMessage);
    }
    return dryRunResult;
  }
  public async mutantRun(options: MutantRunOptions): Promise<MutantRunResult> {
    const result = await this.underlyingTestRunner.mutantRun(options);
    ChildProcessTestRunnerWorker.properErrorMessage(result);
    return result;
  }

  private static properErrorMessage(result: MutantRunResult | PendingMutantRunResult): void {
    if (result.status === MutantRunStatus.Error) {
      result.errorMessage = errorToString(result.errorMessage);
    }
  }

  public async simultaneousMutantRun(options: SimultaneousMutantRunOptions): Promise<SimultaneousMutantRunResult> {
    const result = await this.underlyingTestRunner.simultaneousMutantRun(options);
    if (result.status === SimultaneousMutantRunStatus.Complete) {
      result.results.map(ChildProcessTestRunnerWorker.properErrorMessage);
    } else if (result.status === SimultaneousMutantRunStatus.Partial) {
      result.partialResults.map(ChildProcessTestRunnerWorker.properErrorMessage);
    }
    return result;
  }

  public async formulateEarlyResults(
    mutantRunOptions: MutantRunOptions[],
  ): Promise<PartialSimultaneousMutantRunResult | SimultaneousMutantRunResult | undefined> {
    return this.underlyingTestRunner.formulateEarlyResults?.(mutantRunOptions);
  }

  public async strykerLiveMutantRun(options: SimultaneousMutantRunOptions): Promise<undefined> {
    // better to not await this call such that the proxies get a quick response
    void this.underlyingTestRunner.liveMutantRun!(options, new ChildProcessLiveTestReporter(options, this.parentWorker!));
    return undefined;
  }
}

// Stryker disable all
class ChildProcessLiveTestReporter implements LiveTestRunReporter {
  private readonly testTitleToMutantId = new Map<string, string>();
  private readonly mutantIdToStatus = new Map<string, MutantRunStatus>();
  private readonly mutantIdToTestResults = new Map<string, TestResult[]>();
  //private readonly isSimultaneousRun;
  private readonly log: Logger;
  private context!: InstrumenterContextWrapper;

  constructor(
    private readonly options: SimultaneousMutantRunOptions,
    private readonly worker: ChildProcessProxyWorker,
  ) {
    this.log = log4js.getLogger(ChildProcessLiveTestReporter.name);
    //this.isSimultaneousRun = options.mutantRunOptions.length > 1;
    for (const mutant of options.mutantRunOptions) {
      // assume testFilter exists, if it did not then this is an invalid simultaneous mutant anyway
      mutant.testFilter!.map((t) => {
        if (this.testTitleToMutantId.get(mutant.activeMutant.id))
          this.log.error(`Test '${t}' is already assigned to mutant '${mutant.activeMutant.id}'`);
        this.testTitleToMutantId.set(t, mutant.activeMutant.id);
      });
      this.mutantIdToStatus.set(mutant.activeMutant.id, MutantRunStatus.Pending);
      this.mutantIdToTestResults.set(mutant.activeMutant.id, []);
    }
  }

  public shouldSkipTest(testId: string): boolean {
    const relatedMutant = this.testTitleToMutantId.get(testId);
    if (!relatedMutant) {
      // for Mocha, you can only bail a test before execution has started
      // this function is called for all tests in the suite, not just the ones that are related to a mutant
      // for now, we say not to skip mutants that do not relate to tests
      return false;
    }
    // only skip tests if status of mutant is already determined
    return this.mutantIdToStatus.get(relatedMutant) !== MutantRunStatus.Pending;
  }

  public testRunStarted(context: InstrumenterContextWrapper): void {
    this.worker.testRunStarted();
    this.context = context;
  }

  public startTest(testId: string): void {
    this.worker.startTest(testId);
  }

  // todo: we can also send 'Survived' updates from this method, after the last test was executed (compare testFilter length)
  public reportTestResult(testResult: TestResult): boolean {
    // should have no need to check this as simultaneous testing should not be used anyway if bail is disabled
    if (this.options.disableBail) {
      this.log.error('Live reporting simultaneous mutant while bail is disabled');
    }

    const relatedMutant = this.testTitleToMutantId.get(testResult.id)!;
    if (!relatedMutant) {
      this.log.error(`Related mutant could not be determined for group ${this.options.groupId} in test '${testResult.id}'`);
      return false;
    }
    this.worker.reportTestResult(testResult);
    this.mutantIdToTestResults.get(relatedMutant)!.push(testResult);

    if (this.mutantIdToStatus.get(relatedMutant) !== MutantRunStatus.Pending) {
      // do not change the current status if more tests related to this mutant have finished
      return true;
    }

    const timeout = determineHitLimitReached(this.context.getHitCount(relatedMutant), this.context.getHitLimit(relatedMutant));
    if (timeout) {
      this.mutantIdToStatus.set(relatedMutant, MutantRunStatus.Timeout);
      this.worker.reportMutantResult(relatedMutant, toMutantRunResult(timeout));
      this.log.info(`Hit limit reached for mutant ${relatedMutant}`);
      return true;
    }

    if (testResult.status === TestStatus.Failed) {
      this.mutantIdToStatus.set(relatedMutant, MutantRunStatus.Killed);
      this.worker.reportMutantResult(
        relatedMutant,
        toMutantRunResult({ status: DryRunStatus.Complete, tests: this.mutantIdToTestResults.get(relatedMutant)! }),
      );
      return true;
    }

    return false;
  }
  public testRunFinished(): void {
    // we ran all tests, let's first send the mutant results of all surviving mutants
    for (const mutant of this.options.activeMutantIds) {
      if (this.mutantIdToStatus.get(mutant) === MutantRunStatus.Pending) {
        if (this.log.isTraceEnabled()) {
          this.log.trace(`Sending result that mutant ${mutant} survived from group ${this.options.groupId}.`);
        }
        this.worker.reportMutantResult(mutant, {
          status: MutantRunStatus.Survived,
          nrOfTests: this.mutantIdToTestResults.get(mutant)!.length,
        });
      }
    }
    // then send that we are done
    this.worker.testRunFinished();
  }
}
// Stryker restore all
