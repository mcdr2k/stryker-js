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
  decomposeSimultaneousMutantRunOptions,
} from '@stryker-mutator/api/test-runner';
import log4js from 'log4js';
import { ExpirableTask } from '@stryker-mutator/util';

import { TestRunnerDecorator } from './test-runner-decorator.js';

/**
 * Wraps a test runner and implements the timeout functionality.
 */
export class TimeoutDecorator extends TestRunnerDecorator {
  private readonly log = log4js.getLogger(TimeoutDecorator.name);

  public async dryRun(options: DryRunOptions): Promise<DryRunResult> {
    const result = await this.run(options, () => super.dryRun(options));
    if (result === ExpirableTask.TimeoutExpired) {
      return {
        status: DryRunStatus.Timeout,
      };
    } else {
      return result;
    }
  }

  public async mutantRun(options: MutantRunOptions): Promise<MutantRunResult> {
    const result = await this.run(options, () => super.mutantRun(options));
    if (result === ExpirableTask.TimeoutExpired) {
      return {
        status: MutantRunStatus.Timeout,
      };
    } else {
      return result;
    }
  }

  private async run<TOptions extends { timeout: number }, TResult>(
    options: TOptions,
    actRun: () => Promise<TResult>,
  ): Promise<TResult | typeof ExpirableTask.TimeoutExpired> {
    this.log.debug('Starting timeout timer (%s ms) for a test run', options.timeout);
    const result = await ExpirableTask.timeout(actRun(), options.timeout);
    if (result === ExpirableTask.TimeoutExpired) {
      await this.handleTimeout();
      return result;
    } else {
      return result;
    }
  }

  public async simultaneousMutantRun(options: SimultaneousMutantRunOptions): Promise<SimultaneousMutantRunResult> {
    const result = await this.run(options, () => super.simultaneousMutantRun(options));
    if (result === ExpirableTask.TimeoutExpired) {
      if (options.mutantRunOptions.length === 1) {
        return {
          status: SimultaneousMutantRunStatus.Valid,
          results: [{ status: MutantRunStatus.Timeout }],
        };
      }
      const group = options.mutantRunOptions.map((o) => o.activeMutant.id);
      this.log.info(`Mutant group (${group}) timed out, attempting to rerun the simultaneous mutants individually`);
      //return this.decomposedSimultaneousMutantRun(options);
      return this.simpleDecomposedSimultaneousMutantRun(options, group);
    } else {
      return result;
    }
  }

  private async simpleDecomposedSimultaneousMutantRun(options: SimultaneousMutantRunOptions, group: string[]): Promise<SimultaneousMutantRunResult> {
    const decomposed = decomposeSimultaneousMutantRunOptions(options);
    const results = [];
    // todo: verify
    // does this work when one of the decomposed runs fail?
    for (const mutant of decomposed) {
      if (mutant.mutantRunOptions.length !== 1) throw new Error('Decomposed run had an order other than 1');
      const result = await this.simultaneousMutantRun(mutant);
      if (result.status === SimultaneousMutantRunStatus.Valid) {
        results.push(result.results[0]);
      } else {
        results.push(result.invalidResult);
      }
    }
    this.log.info(`Decomposed mutant group (${group}) was able to evaluate the simultaneous mutants appropriately`);
    return {
      status: SimultaneousMutantRunStatus.Valid,
      results,
    };
  }

  private async handleTimeout(): Promise<void> {
    this.log.debug('Timeout expired, restarting the process and reporting timeout');
    await this.recover();
  }
}
