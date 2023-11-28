import {
  TestRunner,
  DryRunOptions,
  MutantRunOptions,
  MutantRunResult,
  DryRunResult,
  TestRunnerCapabilities,
  SimultaneousMutantRunOptions,
  SimultaneousMutantRunResult,
} from '@stryker-mutator/api/test-runner';

import { ResourceDecorator } from '../concurrent/index.js';

export class TestRunnerDecorator extends ResourceDecorator<TestRunner> {
  public async capabilities(): Promise<TestRunnerCapabilities> {
    return this.innerResource.capabilities();
  }
  public dryRun(options: DryRunOptions): Promise<DryRunResult> {
    return this.innerResource.dryRun(options);
  }
  public mutantRun(options: MutantRunOptions): Promise<MutantRunResult> {
    return this.innerResource.mutantRun(options);
  }
  public simultaneousMutantRun(options: SimultaneousMutantRunOptions): Promise<SimultaneousMutantRunResult> {
    return this.innerResource.simultaneousMutantRun(options);
  }
}
