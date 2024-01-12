import { StrykerOptions } from '@stryker-mutator/api/core';
import { commonTokens, PluginKind, tokens } from '@stryker-mutator/api/plugin';
import {
  TestRunner,
  DryRunOptions,
  MutantRunOptions,
  MutantRunResult,
  DryRunResult,
  DryRunStatus,
  MutantRunStatus,
  TestRunnerCapabilities,
  SimultaneousMutantRunOptions,
  SimultaneousMutantRunResult,
  SimultaneousMutantRunStatus,
  InvalidSimultaneousMutantRunResult,
} from '@stryker-mutator/api/test-runner';
import { errorToString } from '@stryker-mutator/util';

import { coreTokens, PluginCreator } from '../di/index.js';

export class ChildProcessTestRunnerWorker implements TestRunner {
  private readonly underlyingTestRunner: TestRunner;

  public static inject = tokens(commonTokens.options, coreTokens.pluginCreator);
  constructor({ testRunner }: StrykerOptions, pluginCreator: PluginCreator) {
    this.underlyingTestRunner = pluginCreator.create(PluginKind.TestRunner, testRunner);
  }

  public async capabilities(): Promise<TestRunnerCapabilities> {
    return this.underlyingTestRunner.capabilities();
  }

  public async init(): Promise<void> {
    if (this.underlyingTestRunner.init) {
      await this.underlyingTestRunner.init();
    }
  }

  public async dispose(): Promise<void> {
    if (this.underlyingTestRunner.dispose) {
      await this.underlyingTestRunner.dispose();
    }
  }

  public async dryRun(options: DryRunOptions): Promise<DryRunResult> {
    const dryRunResult = await this.underlyingTestRunner.dryRun(options);
    if (dryRunResult.status === DryRunStatus.Complete && !dryRunResult.mutantCoverage && options.coverageAnalysis !== 'off') {
      // @ts-expect-error
      dryRunResult.mutantCoverage = global.__mutantCoverage__;
    }
    if (dryRunResult.status === DryRunStatus.Error) {
      dryRunResult.errorMessage = errorToString(dryRunResult.errorMessage);
    }
    return dryRunResult;
  }
  public async mutantRun(options: MutantRunOptions): Promise<MutantRunResult> {
    const result = await this.underlyingTestRunner.mutantRun(options);
    if (result.status === MutantRunStatus.Error) {
      result.errorMessage = errorToString(result.errorMessage);
    }
    return result;
  }

  public async simultaneousMutantRun(options: SimultaneousMutantRunOptions): Promise<SimultaneousMutantRunResult> {
    const result = await this.underlyingTestRunner.simultaneousMutantRun(options);
    if (result.status === SimultaneousMutantRunStatus.Invalid) {
      const invalid = result.invalidResult;
      if (invalid.status === MutantRunStatus.Error) {
        invalid.errorMessage = errorToString(invalid.errorMessage);
      }
    } else if (result.status === SimultaneousMutantRunStatus.Valid) {
      for (const mutantResult of result.results) {
        if (mutantResult.status === MutantRunStatus.Error) {
          mutantResult.errorMessage = errorToString(mutantResult.errorMessage);
        }
      }
    }
    return result;
  }
}
