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
  PartialSimultaneousMutantRunResult,
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
    handleTimeout = true,
  ): Promise<TResult | typeof ExpirableTask.TimeoutExpired> {
    this.log.debug('Starting timeout timer (%s ms) for a test run', options.timeout);
    const result = await ExpirableTask.timeout(actRun(), options.timeout);
    if (result === ExpirableTask.TimeoutExpired) {
      if (handleTimeout) await this.handleTimeout();
      return result;
    } else {
      return result;
    }
  }

  public async simultaneousMutantRun(options: SimultaneousMutantRunOptions): Promise<SimultaneousMutantRunResult> {
    const result = await this.run(options, () => super.simultaneousMutantRun(options), false);
    if (result === ExpirableTask.TimeoutExpired) {
      if (options.mutantRunOptions.length === 1) {
        await this.handleTimeout();
        return {
          status: SimultaneousMutantRunStatus.Valid,
          results: [{ status: MutantRunStatus.Timeout }],
        };
      }
      const group = options.mutantRunOptions.map((o) => o.activeMutant.id);
      if (this.log.isTraceEnabled()) {
        this.log.trace(`Mutant group (${group}) timed out.`);
      }
      const partialResults = await this.formulateEarlyResults?.(options.mutantRunOptions);
      await this.handleTimeout();
      if (partialResults) {
        if (this.log.isTraceEnabled()) {
          this.log.trace(`Partial results recovered for mutant group (${group}): ${JSON.stringify(partialResults, null, 2)}`);
        }
        return this.simpleDecomposedSimultaneousMutantRun(options, group, partialResults);
        //return partialResults;
      }
      // simultaneous testing is essentially useless if the test-runner is unable to formulate an early result
      // we have no clue here which test timed out and which tests had already been run, this is terrible for performance
      // as it requires us to rerun all mutants individually, including the timed out one (yielding double timeouts)
      return {
        status: SimultaneousMutantRunStatus.Partial,
        partialResults: options.mutantRunOptions.map((_) => {
          return { status: MutantRunStatus.Pending };
        }),
      };
    } else {
      return result;
    }
  }

  private async simpleDecomposedSimultaneousMutantRun(
    options: SimultaneousMutantRunOptions,
    group: string[],
    partialResults: PartialSimultaneousMutantRunResult | SimultaneousMutantRunResult | undefined,
  ): Promise<SimultaneousMutantRunResult> {
    const decomposed = decomposeSimultaneousMutantRunOptions(options);
    const results = [];
    //const partialResults = await this.formulateEarlyResults?.(options.mutantRunOptions);
    if (partialResults && partialResults.status !== SimultaneousMutantRunStatus.Partial) return partialResults;
    // todo: verify
    // does this work when one of the decomposed runs fail?
    let index = -1;
    for (const mutant of decomposed) {
      index++;
      if (partialResults) {
        const partialResult = partialResults.partialResults[index];
        if (partialResult.status !== MutantRunStatus.Pending) {
          results.push(partialResult);
          this.log.info(`Partial result contained complete results for mutant ${mutant.mutantRunOptions[0].activeMutant.id}`);
          this.log.info(JSON.stringify(partialResult, null, 2));
        } else {
          const result = await this.simultaneousMutantRun(mutant);
          if (result.status === SimultaneousMutantRunStatus.Valid) {
            results.push(result.results[0]);
          } else if (result.status === SimultaneousMutantRunStatus.Invalid) {
            results.push(result.invalidResult);
          } else {
            throw new Error('invalid state');
          }
        }
      } else {
        const result = await this.simultaneousMutantRun(mutant);
        if (result.status === SimultaneousMutantRunStatus.Valid) {
          results.push(result.results[0]);
        } else if (result.status === SimultaneousMutantRunStatus.Invalid) {
          results.push(result.invalidResult);
        } else {
          throw new Error('invalid state');
        }
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
