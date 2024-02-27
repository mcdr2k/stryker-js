import { SimultaneousMutantRunResult } from '@stryker-mutator/api/test-runner';
import { StrykerError } from '@stryker-mutator/util';
import { InjectionError } from 'typed-inject';

export class ConfigError extends StrykerError {}

export class LiverunTimeoutError extends StrykerError {
  constructor(
    public readonly result: SimultaneousMutantRunResult,
    message: string,
    innerError?: unknown,
  ) {
    super(message, innerError);
  }
}

export function retrieveCause(error: unknown): unknown {
  if (error instanceof InjectionError) {
    return error.cause;
  } else {
    return error;
  }
}
