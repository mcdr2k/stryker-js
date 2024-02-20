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
  Complete = 'complete',
  Error = 'error',
  Partial = 'partial',
}

export type SimultaneousMutantRunResult = CompleteSimultaneousMutantRunResult | ErrorSimultaneousMutantRunResult | PartialSimultaneousMutantRunResult;

export interface CompleteSimultaneousMutantRunResult {
  status: SimultaneousMutantRunStatus.Complete;
  results: MutantRunResult[];
}

export interface ErrorSimultaneousMutantRunResult {
  status: SimultaneousMutantRunStatus.Error;
  errorMessage: string;
}

export interface PartialSimultaneousMutantRunResult {
  status: SimultaneousMutantRunStatus.Partial;
  partialResults: Array<MutantRunResult | PendingMutantRunResult>;
}
export function isCompleteSimultaneousMutantRunResult(result: SimultaneousMutantRunResult): result is CompleteSimultaneousMutantRunResult {
  return result.status === SimultaneousMutantRunStatus.Complete;
}
export function isErrorSimultaneousMutantRunResult(result: SimultaneousMutantRunResult): result is ErrorSimultaneousMutantRunResult {
  return result.status === SimultaneousMutantRunStatus.Error;
}
export function isPartialSimultaneousMutantRunResult(result: SimultaneousMutantRunResult): result is PartialSimultaneousMutantRunResult {
  return result.status === SimultaneousMutantRunStatus.Partial;
}
