import {
  DryRunStatus,
  DryRunResult,
  DryRunOptions,
  MutantRunResult,
  MutantRunOptions,
  MutantRunStatus,
  SimultaneousMutantRunOptions,
  SimultaneousMutantRunResult,
  SimultaneousMutantRunStatus,
} from '@stryker-mutator/api/test-runner';
import { errorToString } from '@stryker-mutator/util';
import log4js from 'log4js';

import { Metrics } from '@stryker-mutator/api/metrics';

import { OutOfMemoryError } from '../child-proxy/out-of-memory-error.js';

import { TestRunnerDecorator } from './test-runner-decorator.js';

const ERROR_MESSAGE = 'Test runner crashed. Tried twice to restart it without any luck. Last time the error message was: ';
export const MAX_RETRIES = 2;

/**
 * Implements the retry functionality whenever an internal test runner rejects a promise.
 */
export class RetryRejectedDecorator extends TestRunnerDecorator {
  private readonly log = log4js.getLogger(RetryRejectedDecorator.name);

  public async dryRun(options: DryRunOptions): Promise<DryRunResult> {
    const result = await this.run(() => super.dryRun(options));
    if (typeof result === 'string') {
      return {
        status: DryRunStatus.Error,
        errorMessage: result,
      };
    } else {
      return result;
    }
  }

  public async mutantRun(options: MutantRunOptions): Promise<MutantRunResult> {
    const result = await Metrics.metricsFor(options.activeMutant.id).timeAwaitedFunction(
      () => this.run(() => super.mutantRun(options)),
      RetryRejectedDecorator.name,
      this.mutantRun.name,
    );

    if (typeof result === 'string') {
      return {
        status: MutantRunStatus.Error,
        errorMessage: result,
      };
    } else {
      return result;
    }
  }

  public async strykerLiveMutantRun(options: SimultaneousMutantRunOptions): Promise<SimultaneousMutantRunResult | undefined> {
    const result = await Metrics.metricsFor(options.groupId).timeAwaitedFunction(
      () => this.run(() => super.strykerLiveMutantRun(options)),
      RetryRejectedDecorator.name,
      this.strykerLiveMutantRun.name,
    );

    if (typeof result === 'string') {
      return {
        status: SimultaneousMutantRunStatus.Error,
        errorMessage: result,
      };
    } else {
      return result;
    }
  }

  private async run<T>(actRun: () => Promise<T>, attemptsLeft = MAX_RETRIES, lastError?: unknown): Promise<T | string> {
    if (attemptsLeft > 0) {
      try {
        return await actRun();
      } catch (error) {
        if (error instanceof OutOfMemoryError) {
          this.log.info(
            "Test runner process [%s] ran out of memory. You probably have a memory leak in your tests. Don't worry, Stryker will restart the process, but you might want to investigate this later, because this decreases performance.",
            error.pid,
          );
        }
        await this.recover();
        return this.run(actRun, attemptsLeft - 1, error);
      }
    } else {
      await this.recover();
      return `${ERROR_MESSAGE}${errorToString(lastError)}`;
    }
  }
}
