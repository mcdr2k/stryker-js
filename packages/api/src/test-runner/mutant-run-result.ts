export enum MutantRunStatus {
  Killed = 'killed',
  Survived = 'survived',
  Timeout = 'timeout',
  Error = 'error',
  Pending = 'pending',
}

export type MutantRunResult = ErrorMutantRunResult | KilledMutantRunResult | SurvivedMutantRunResult | TimeoutMutantRunResult;

export interface TimeoutMutantRunResult {
  status: MutantRunStatus.Timeout;
  /**
   * An optional reason for the timeout
   */
  reason?: string;
}

export interface KilledMutantRunResult {
  status: MutantRunStatus.Killed;
  /**
   * An array with the ids of the tests that killed this mutant
   */
  killedBy: string[];
  /**
   * The failure message that was reported by first the test
   */
  failureMessage: string;
  /**
   * The number of total tests ran in this test run.
   */
  nrOfTests: number;
}

export interface SurvivedMutantRunResult {
  status: MutantRunStatus.Survived;
  /**
   * The number of total tests ran in this test run.
   */
  nrOfTests: number;
}

export interface ErrorMutantRunResult {
  status: MutantRunStatus.Error;
  errorMessage: string;
}

/**
 * Indicates that the result of the mutant could not be determined because the test-runner was not done yet.
 */
export interface PendingMutantRunResult {
  status: MutantRunStatus.Pending;
}

export enum SimultaneousMutantRunStatus {
  Valid = 'valid',
  Invalid = 'invalid',
  Partial = 'partial',
}

export type SimultaneousMutantRunResult = InvalidSimultaneousMutantRunResult | ValidSimultaneousMutantRunResult;

export interface ValidSimultaneousMutantRunResult {
  status: SimultaneousMutantRunStatus.Valid;
  results: MutantRunResult[];
}

export interface InvalidSimultaneousMutantRunResult {
  status: SimultaneousMutantRunStatus.Invalid;
  invalidResult: ErrorMutantRunResult | TimeoutMutantRunResult;
}

export interface PartialSimultaneousMutantRunResult {
  status: SimultaneousMutantRunStatus.Partial;
  partialResults: Array<MutantRunResult | PendingMutantRunResult>;
}
