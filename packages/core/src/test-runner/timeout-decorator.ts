import {
  DryRunStatus,
  DryRunResult,
  DryRunOptions,
  MutantRunOptions,
  MutantRunResult,
  MutantRunStatus,
  SimultaneousMutantRunOptions,
  SimultaneousMutantRunResult,
} from '@stryker-mutator/api/test-runner';
import log4js from 'log4js';
import { ExpirableTask } from '@stryker-mutator/util';

import { Metrics, MutantMetrics } from '@stryker-mutator/api/metrics';

import { LiverunTimeoutError } from '../errors.js';

import { TestRunnerDecorator } from './test-runner-decorator.js';

/**
 * Wraps a test runner and implements the timeout functionality.
 */
export class TimeoutDecorator extends TestRunnerDecorator {
  private readonly log = log4js.getLogger(TimeoutDecorator.name);

  public async dryRun(options: DryRunOptions): Promise<DryRunResult> {
    const result = await this.run(options, undefined, () => super.dryRun(options));
    if (result === ExpirableTask.TimeoutExpired) {
      return {
        status: DryRunStatus.Timeout,
      };
    } else {
      return result;
    }
  }

  public async mutantRun(options: MutantRunOptions): Promise<MutantRunResult> {
    const result = await this.run(options, options.activeMutant.id, () => super.mutantRun(options));
    const metrics = Metrics.metricsFor(options.activeMutant.id);
    if (result === ExpirableTask.TimeoutExpired) {
      return captureTestSessionMetrics(
        {
          status: MutantRunStatus.Timeout,
        },
        metrics,
      );
    } else {
      return captureTestSessionMetrics(result, metrics);
    }
  }

  private async run<TOptions extends { timeout: number }, TResult>(
    options: TOptions,
    activeMutantId: string | undefined,
    actRun: () => Promise<TResult>,
    handleTimeout = true,
  ): Promise<TResult | typeof ExpirableTask.TimeoutExpired> {
    this.log.debug('Starting timeout timer (%s ms) for a test run', options.timeout);
    const result = await ExpirableTask.timeout(actRun(), options.timeout);
    if (result === ExpirableTask.TimeoutExpired) {
      if (handleTimeout) await this.handleTimeout(activeMutantId);
      return result;
    } else {
      return result;
    }
  }

  public async strykerLiveMutantRun(options: SimultaneousMutantRunOptions): Promise<SimultaneousMutantRunResult | undefined> {
    try {
      return await Metrics.metricsFor(options.groupId).timeAwaitedFunction(
        () => super.strykerLiveMutantRun(options),
        TimeoutDecorator.name,
        this.strykerLiveMutantRun.name,
      );
    } catch (e) {
      if (e instanceof LiverunTimeoutError) {
        await this.handleTimeout(options.groupId);
        return e.result;
      }
      this.log.error(`Unidentified error occurred in pipe for group ${options.groupId}: ${JSON.stringify(e)}.`);
      throw e;
    }
  }

  private async handleTimeout(id: string | undefined): Promise<void> {
    this.log.debug(`Timeout expired (${id}), restarting the process and reporting timeout`);
    await this.measuredRecovery(id);
  }

  private measuredRecovery(id: string | undefined): Promise<void> {
    if (id) {
      return Metrics.metricsFor(id).timeAwaitedFunction(() => this.recover(), TimeoutDecorator.name, this.measuredRecovery.name);
    } else {
      return this.recover();
    }
  }
}

// Stryker disable all
function captureTestSessionMetrics<T extends object>(from: T, metrics: MutantMetrics) {
  const testSession = metrics.getRunningTestSession();
  if (typeof from === 'object') {
    if ('testRunBeginMs' in from && from.testRunBeginMs) {
      testSession.setTestRunBeginMs(from.testRunBeginMs as number);
    }
    if ('startToMutantRunResult' in from) {
      testSession.setStartFormulateResult(from.startToMutantRunResult as number);
    }
    if ('endToMutantRunResult' in from) {
      testSession.setEndFormulateResult(from.endToMutantRunResult as number);
    }
  }
  return from;
}
// Stryker restore all
