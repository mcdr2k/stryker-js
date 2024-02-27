import { InstrumenterContextWrapper } from '../core/instrument.js';

import { DryRunOptions, MutantRunOptions, SimultaneousMutantRunOptions, regularToSimultaneousMutantRunOptions } from './run-options.js';
import { DryRunResult } from './dry-run-result.js';
import {
  MutantRunResult,
  MutantRunStatus,
  PartialSimultaneousMutantRunResult,
  SimultaneousMutantRunResult,
  SimultaneousMutantRunStatus,
} from './mutant-run-result.js';
import { TestRunnerCapabilities } from './test-runner-capabilities.js';
import { TestResult } from './test-result.js';

export interface TestRunner {
  capabilities(): Promise<TestRunnerCapabilities> | TestRunnerCapabilities;
  init?(): Promise<void>;
  dryRun(options: DryRunOptions): Promise<DryRunResult>;
  mutantRun(options: MutantRunOptions): Promise<MutantRunResult>;
  simultaneousMutantRun(options: SimultaneousMutantRunOptions): Promise<SimultaneousMutantRunResult>;
  formulateEarlyResults?(mutantRunOptions: MutantRunOptions[]): Promise<PartialSimultaneousMutantRunResult | SimultaneousMutantRunResult | undefined>;
  strykerLiveMutantRun?(options: SimultaneousMutantRunOptions): Promise<SimultaneousMutantRunResult | undefined>;
  liveMutantRun?(options: SimultaneousMutantRunOptions, reporter: LiveTestRunReporter): Promise<void>;
  dispose?(): Promise<void>;
}

abstract class AbstractTestRunner implements TestRunner {
  public abstract capabilities(): Promise<TestRunnerCapabilities> | TestRunnerCapabilities;
  public abstract dryRun(options: DryRunOptions): Promise<DryRunResult>;
  public abstract mutantRun(options: MutantRunOptions): Promise<MutantRunResult>;
  public abstract simultaneousMutantRun(options: SimultaneousMutantRunOptions): Promise<SimultaneousMutantRunResult>;
}

/**
 * Abstract class that implements {@link TestRunner} with a default implementation for {@link TestRunner.simultaneousMutantRun}.
 * This default implementation makes use of {@link mutantRun} and will throw an error if the provided options contains a group
 * of an order other than 1. If one needs to override this default implementation, then it is more suitable to implement the
 * {@link TestRunner} interface directly. See also {@link SimultaneousTestRunner}.
 */
export abstract class SingularTestRunner extends AbstractTestRunner {
  public override async simultaneousMutantRun(options: SimultaneousMutantRunOptions): Promise<SimultaneousMutantRunResult> {
    if (options.mutantRunOptions.length !== 1) {
      throw new Error(
        `Test runner does not support simultaneous mutation testing but was provided a group of order ${options.mutantRunOptions.length}`,
      );
    }
    // todo
    // enforce reload environment of the individual mutant to be the same as in options (due to reload-environment-decorator)
    // might want to enforce it within the decorator instead
    const [singleMutantOptions] = options.mutantRunOptions;
    singleMutantOptions.reloadEnvironment = options.reloadEnvironment;
    const result = await this.mutantRun(singleMutantOptions);
    return { status: SimultaneousMutantRunStatus.Complete, results: [result] };
  }
}

/**
 * Abstract class that implements {@link TestRunner} with a default implementation for {@link TestRunner.mutantRun}.
 * This default implementation makes use of {@link mutantRun}. If one needs to override this default implementation,
 * then it is more suitable to implement the {@link TestRunner} interface directly. See also {@link SingularTestRunner}.
 */
export abstract class SimultaneousTestRunner extends AbstractTestRunner {
  public override async mutantRun(options: MutantRunOptions): Promise<MutantRunResult> {
    const simultaneousResults = await this.simultaneousMutantRun(regularToSimultaneousMutantRunOptions(options));
    if (simultaneousResults.status === SimultaneousMutantRunStatus.Complete) {
      return simultaneousResults.results[0];
    } else if (simultaneousResults.status === SimultaneousMutantRunStatus.Error) {
      return { status: MutantRunStatus.Error, errorMessage: simultaneousResults.errorMessage };
    } else {
      const [partialResult] = simultaneousResults.partialResults;
      if (partialResult.status === MutantRunStatus.Pending) {
        // assume survivor? Or error? This should not ever happen though...
        throw new Error('Cannot work with partial result');
      }
      return partialResult;
    }
  }
}

export abstract class LiveReporterTestRunner extends AbstractTestRunner {
  public mutantRun(_options: MutantRunOptions): Promise<MutantRunResult> {
    throw new Error('Not available');
  }
  public simultaneousMutantRun(_options: SimultaneousMutantRunOptions): Promise<SimultaneousMutantRunResult> {
    throw new Error('Not available');
  }
  public abstract liveMutantRun(options: SimultaneousMutantRunOptions, reporter: LiveTestRunReporter): void;
}

export interface LiveTestRunReporter {
  /**
   * Report that the test run started (all setup completed).
   */
  testRunStarted(context: InstrumenterContextWrapper): void;
  /**
   * Report back the result of a single test.
   * @returns True if any subsequent tests, that relate to the same mutant from the reported test, may be skipped.
   * False othwerise.
   */
  reportTestResult(testResult: TestResult): void;
  /**
   * Report that the test run finished completely (all tests executed accordingly).
   */
  testRunFinished(): void;
  /**
   * Indicates whether some test should be skipped, based on the results reported so far.
   * @param testId The id of the test to possibly skip.
   * @returns True if the test should be skipped, false otherwise.
   */
  shouldSkipTest(testId: string): boolean;

  startTest(testId: string): void;
}
