import {
  MutantRunOptions,
  MutantRunResult,
  SimultaneousMutantRunOptions,
  SimultaneousMutantRunResult,
  TestRunner,
} from '@stryker-mutator/api/test-runner';

import { StrykerOptions } from '@stryker-mutator/api/core';

import { TestRunnerDecorator } from './test-runner-decorator.js';

/**
 * Wraps a test runner and implements the retry functionality.
 */
export class MaxTestRunnerReuseDecorator extends TestRunnerDecorator {
  public runs = 0;
  private readonly restartAfter;

  constructor(testRunnerProducer: () => TestRunner, options: Pick<StrykerOptions, 'maxTestRunnerReuse'>) {
    super(testRunnerProducer);

    this.restartAfter = options.maxTestRunnerReuse || 0;
  }

  public async mutantRun(options: MutantRunOptions): Promise<MutantRunResult> {
    this.runs++;
    if (this.restartAfter > 0 && this.runs > this.restartAfter) {
      await this.recover();
      this.runs = 1;
    }

    return super.mutantRun(options);
  }

  public async strykerLiveMutantRun(options: SimultaneousMutantRunOptions): Promise<SimultaneousMutantRunResult | undefined> {
    this.runs++;
    if (this.restartAfter > 0 && this.runs > this.restartAfter) {
      await this.recover();
      this.runs = 1;
    }

    return super.strykerLiveMutantRun(options);
  }

  public dispose(): Promise<any> {
    this.runs = 0;
    return super.dispose();
  }
}
