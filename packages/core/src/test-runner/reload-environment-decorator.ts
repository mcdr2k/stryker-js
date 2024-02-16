import {
  DryRunOptions,
  DryRunResult,
  MutantRunOptions,
  MutantRunResult,
  SimultaneousMutantRunOptions,
  SimultaneousMutantRunResult,
  TestRunnerCapabilities,
} from '@stryker-mutator/api/test-runner';

import { Metrics, SessionType } from '@stryker-mutator/api/metrics';

import { TestRunnerDecorator } from './test-runner-decorator.js';

enum TestEnvironmentState {
  Pristine,
  Loaded,
  LoadedStaticMutant,
}

export class ReloadEnvironmentDecorator extends TestRunnerDecorator {
  private _capabilities?: TestRunnerCapabilities;
  private testEnvironment = TestEnvironmentState.Pristine;

  public override async capabilities(): Promise<TestRunnerCapabilities> {
    if (!this._capabilities) {
      this._capabilities = await super.capabilities();
    }
    return this._capabilities;
  }

  public override async dryRun(options: DryRunOptions): Promise<DryRunResult> {
    this.testEnvironment = TestEnvironmentState.Loaded;
    return super.dryRun(options);
  }

  public override async mutantRun(options: MutantRunOptions): Promise<MutantRunResult> {
    let newState: TestEnvironmentState;
    if (options.reloadEnvironment) {
      newState = TestEnvironmentState.LoadedStaticMutant;

      // If env is still pristine (first run), no reload is actually needed
      options.reloadEnvironment = this.testEnvironment !== TestEnvironmentState.Pristine;

      if (options.reloadEnvironment && !(await this.testRunnerIsCapableOfReload())) {
        await this.recover();
        options.reloadEnvironment = false;
      }
    } else {
      // Reload might still be needed actually, since a static mutant could be loaded
      newState = TestEnvironmentState.Loaded;
      if (this.testEnvironment === TestEnvironmentState.LoadedStaticMutant) {
        // Test env needs reloading
        if (await this.testRunnerIsCapableOfReload()) {
          options.reloadEnvironment = true;
        } else {
          // loaded a static mutant in previous run, need to reload first
          await this.recover();
        }
      }
    }
    const metrics = Metrics.metricsFor(options.activeMutant.id);
    const session = metrics.startTestSession(this.toTestSessionType(this.testEnvironment, newState));
    const result = await super.mutantRun(options);
    metrics.endTestSession(session);
    this.testEnvironment = newState;
    return result;
  }

  public async simultaneousMutantRun(options: SimultaneousMutantRunOptions): Promise<SimultaneousMutantRunResult> {
    let newState: TestEnvironmentState;
    if (options.reloadEnvironment) {
      newState = TestEnvironmentState.LoadedStaticMutant;

      // If env is still pristine (first run), no reload is actually needed
      options.reloadEnvironment = this.testEnvironment !== TestEnvironmentState.Pristine;

      if (options.reloadEnvironment && !(await this.testRunnerIsCapableOfReload())) {
        await this.recover();
        options.reloadEnvironment = false;
      }
    } else {
      // Reload might still be needed actually, since a static mutant could be loaded
      newState = TestEnvironmentState.Loaded;
      if (this.testEnvironment === TestEnvironmentState.LoadedStaticMutant) {
        // Test env needs reloading
        if (await this.testRunnerIsCapableOfReload()) {
          options.reloadEnvironment = true;
        } else {
          // loaded a static mutant in previous run, need to reload first
          await this.recover();
        }
      }
    }
    const metrics = Metrics.metricsFor(options.groupId);
    const session = metrics.startTestSession(this.toTestSessionType(this.testEnvironment, newState));
    const result = await super.simultaneousMutantRun(options);
    metrics.endTestSession(session);
    this.testEnvironment = newState;
    return result;
  }

  private async testRunnerIsCapableOfReload() {
    return (await this.capabilities()).reloadEnvironment;
  }

  private toTestSessionType(currentState: TestEnvironmentState, newState: TestEnvironmentState): SessionType {
    switch (currentState) {
      case TestEnvironmentState.Pristine: {
        return SessionType.Initial;
      }
      case TestEnvironmentState.Loaded: {
        if (newState === TestEnvironmentState.LoadedStaticMutant) return SessionType.Reset;
        return SessionType.Reload;
      }
      case TestEnvironmentState.LoadedStaticMutant: {
        return SessionType.Reset;
      }
    }
  }
}
