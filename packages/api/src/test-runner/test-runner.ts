import { InstrumenterContextWrapper } from '../core/instrument.js';

import { DryRunOptions, MutantRunOptions, SimultaneousMutantRunOptions } from './run-options.js';
import { DryRunResult } from './dry-run-result.js';
import { MutantRunResult, SimultaneousMutantRunResult } from './mutant-run-result.js';
import { TestRunnerCapabilities } from './test-runner-capabilities.js';
import { TestResult } from './test-result.js';

export interface TestRunner {
  capabilities(): Promise<TestRunnerCapabilities> | TestRunnerCapabilities;
  init?(): Promise<void>;
  dryRun(options: DryRunOptions): Promise<DryRunResult>;
  mutantRun(options: MutantRunOptions): Promise<MutantRunResult>;
  strykerLiveMutantRun?(options: SimultaneousMutantRunOptions): Promise<SimultaneousMutantRunResult | undefined>;
  liveMutantRun?(options: SimultaneousMutantRunOptions, reporter: LiveTestRunReporter): Promise<void>;
  dispose?(): Promise<void>;
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
