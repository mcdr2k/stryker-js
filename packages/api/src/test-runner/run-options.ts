import { Mutant, CoverageAnalysis } from '../core/index.js';

export interface RunOptions {
  /**
   * The amount of time (in milliseconds) the TestRunner has to complete the test run before a timeout occurs.
   */
  timeout: number;
  /**
   * Filled from disableBail in config
   */
  disableBail: boolean;
}

export interface DryRunOptions extends RunOptions {
  /**
   * Indicates whether or not mutant coverage should be collected.
   */
  coverageAnalysis: CoverageAnalysis;
  /**
   * Files to run tests for.
   */
  files?: string[];
}

export type MutantActivation = 'runtime' | 'static';

export interface MutantRunOptions extends RunOptions {
  testFilter?: string[];
  hitLimit?: number;
  activeMutant: Mutant;
  sandboxFileName: string;
  /**
   * Determine when to active the mutant.
   * - 'runtime'. The test environment should first load all tests and sut files before activating the mutant. Mutant is only active during runtime.
   * - 'static'. The test environment should load _while the mutant is active_. Mutant may be active during the entire lifetime of the process.
   * See https://github.com/stryker-mutator/stryker-js/issues/3442 for more details
   */
  mutantActivation: MutantActivation;
  /**
   * Determines whether or not the test environment should be reloaded.
   * This is necessary when testing static mutants, where the mutant is only executed when the test environment is loaded.
   * A test runner might be unable to reload the test environment, i.e. when the files were loaded via `import` in nodejs.
   * In which case the test runner should report `reloadEnvironment: false` in it's capabilities.
   */
  reloadEnvironment: boolean;
}

export interface SimultaneousMutantRunOptions extends RunOptions {
  /**
   * The mutant run options of the individual mutants from which this simultaneous mutant group was formed.
   */
  mutantRunOptions: MutantRunOptions[];

  /**
   * Similar to {@link MutantRunOptions.mutantActivation}. This value is derived from the the values in {@link mutantRunOptions}.
   */
  mutantActivation: MutantActivation;
  /**
   * Similar to {@link MutantRunOptions.reloadEnvironment}. This value is derived from the values in {@link mutantRunOptions}
   * in the following way:
   * - true, when at least one of the options in {@link mutantRunOptions} has true for {@link MutantRunOptions.reloadEnvironment};
   * - false, when all of the options in {@link mutantRunOptions} have false for {@link MutantRunOptions.reloadEnvironment};
   */
  reloadEnvironment: boolean;
}

export function simultaneousToRegularMutantRunOptions(options: SimultaneousMutantRunOptions): MutantRunOptions {
  if (options.mutantRunOptions.length !== 1) throw new Error('Invalid size');
  return options.mutantRunOptions[0];
}

export function regularToSimultaneousMutantRunOptions(options: MutantRunOptions): SimultaneousMutantRunOptions {
  return createSimultaneousMutantRunOptions(options);
}

export function createSimultaneousMutantRunOptions(...options: MutantRunOptions[]): SimultaneousMutantRunOptions {
  if (options.length === 0) throw new Error('Need at least 1 option');
  return {
    mutantRunOptions: options,
    mutantActivation: determineMutantActivation(...options),
    reloadEnvironment: determineReloadEnvironment(...options),
    timeout: options[0].timeout,
    disableBail: options[0].disableBail,
  };
}

function determineMutantActivation(...options: MutantRunOptions[]): MutantActivation {
  const activation = options[0].mutantActivation;
  for (let i = 1; i < options.length; i++)
    if (options[i].mutantActivation !== activation) throw new Error('Mutant activation must be the same for all mutants');
  return activation;
}

function determineReloadEnvironment(...options: MutantRunOptions[]): boolean {
  for (const option of options) if (option.reloadEnvironment) return true;
  return false;
}
