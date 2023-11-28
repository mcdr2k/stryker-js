import { DryRunOptions, MutantRunOptions, SimultaneousMutantRunOptions } from './run-options.js';
import { DryRunResult } from './dry-run-result.js';
import { MutantRunResult } from './mutant-run-result.js';
import { TestRunnerCapabilities } from './test-runner-capabilities.js';

export interface TestRunner {
  capabilities(): Promise<TestRunnerCapabilities> | TestRunnerCapabilities;
  init?(): Promise<void>;
  dryRun(options: DryRunOptions): Promise<DryRunResult>;
  mutantRun(options: MutantRunOptions): Promise<MutantRunResult>;
  simultaneousMutantRun(options: SimultaneousMutantRunOptions): Promise<MutantRunResult>;
  dispose?(): Promise<void>;
}
