import { INSTRUMENTER_CONSTANTS, StrykerOptions, InstrumenterContextWrapper } from '@stryker-mutator/api/core';
import { Logger } from '@stryker-mutator/api/logging';
import { commonTokens, tokens } from '@stryker-mutator/api/plugin';
import { I, escapeRegExp } from '@stryker-mutator/util';

import {
  DryRunResult,
  DryRunOptions,
  MutantRunOptions,
  MutantRunResult,
  DryRunStatus,
  toMutantRunResult,
  CompleteDryRunResult,
  determineHitLimitReached,
  TestRunnerCapabilities,
  MutantActivation,
  SimultaneousTestRunner,
  SimultaneousMutantRunOptions,
  SimultaneousMutantRunResult,
  SimultaneousMutantRunStatus,
  MutantRunStatus,
} from '@stryker-mutator/api/test-runner';

import { Context, RootHookObject, Suite } from 'mocha';

import { StrykerMochaReporter } from './stryker-mocha-reporter.js';
import { MochaRunnerWithStrykerOptions } from './mocha-runner-with-stryker-options.js';
import * as pluginTokens from './plugin-tokens.js';
import { MochaOptionsLoader } from './mocha-options-loader.js';
import { MochaAdapter } from './mocha-adapter.js';

export class MochaTestRunner extends SimultaneousTestRunner {
  private mocha!: Mocha;
  private readonly instrumenterContext: InstrumenterContextWrapper;
  private originalGrep?: string;
  public beforeEach?: (context: Context) => void;

  public static inject = tokens(
    commonTokens.logger,
    commonTokens.options,
    pluginTokens.loader,
    pluginTokens.mochaAdapter,
    pluginTokens.globalNamespace,
  );
  private loadedEnv = false;
  constructor(
    private readonly log: Logger,
    private readonly options: StrykerOptions,
    private readonly loader: I<MochaOptionsLoader>,
    private readonly mochaAdapter: I<MochaAdapter>,
    globalNamespace: typeof INSTRUMENTER_CONSTANTS.NAMESPACE | '__stryker2__',
  ) {
    super();
    StrykerMochaReporter.log = log;
    this.instrumenterContext = InstrumenterContextWrapper.WrapGlobalContext(globalNamespace);
  }

  public async capabilities(): Promise<TestRunnerCapabilities> {
    return {
      // Mocha directly uses `import`, so reloading files once they are loaded is impossible
      reloadEnvironment: false,
      simultaneousTesting: true,
      smartBail: false,
    };
  }

  public async init(): Promise<void> {
    const mochaOptions = this.loader.load(this.options as MochaRunnerWithStrykerOptions);
    const testFileNames = this.mochaAdapter.collectFiles(mochaOptions);
    let rootHooks: RootHookObject | undefined;
    if (mochaOptions.require) {
      if (mochaOptions.require.includes('esm')) {
        throw new Error(
          'Config option "mochaOptions.require" does not support "esm", please use `"testRunnerNodeArgs": ["--require", "esm"]` instead. See https://github.com/stryker-mutator/stryker-js/issues/3014 for more information.',
        );
      }
      rootHooks = await this.mochaAdapter.handleRequires(mochaOptions.require);
    }
    this.mocha = this.mochaAdapter.create({
      reporter: StrykerMochaReporter as any,
      timeout: 0,
      rootHooks,
    });
    this.mocha.cleanReferencesAfterRun(false);
    testFileNames.forEach((fileName) => this.mocha.addFile(fileName));

    this.setIfDefined(mochaOptions['async-only'], (asyncOnly) => asyncOnly && this.mocha.asyncOnly());
    this.setIfDefined(mochaOptions.ui, this.mocha.ui);
    this.setIfDefined(mochaOptions.grep, this.mocha.grep);
    this.originalGrep = mochaOptions.grep;

    // Bind beforeEach, so we can use that for per code coverage in dry run
    const self = this;
    this.mocha.suite.beforeEach(function (this: Context) {
      self.beforeEach?.(this);
    });
  }

  private setIfDefined<T>(value: T | undefined, operation: (input: T) => void) {
    if (typeof value !== 'undefined') {
      operation.apply(this.mocha, [value]);
    }
  }

  public async dryRun({ coverageAnalysis, disableBail }: DryRunOptions): Promise<DryRunResult> {
    if (coverageAnalysis === 'perTest') {
      this.beforeEach = (context) => {
        this.instrumenterContext.currentTestId = context.currentTest?.fullTitle();
      };
    }
    const runResult = await this.run(disableBail);
    if (runResult.status === DryRunStatus.Complete && coverageAnalysis !== 'off') {
      runResult.mutantCoverage = this.instrumenterContext.mutantCoverage;
    }
    delete this.beforeEach;
    return runResult;
  }

  public override async mutantRun({ activeMutant, testFilter, disableBail, hitLimit, mutantActivation }: MutantRunOptions): Promise<MutantRunResult> {
    this.instrumenterContext.assignHitLimit(activeMutant.id, hitLimit);
    this.instrumenterContext.assignHitCount(activeMutant.id, 0);

    if (testFilter) {
      const metaRegExp = testFilter.map((testId) => `(${escapeRegExp(testId)})`).join('|');
      const regex = new RegExp(metaRegExp);
      this.mocha.grep(regex);
    } else {
      this.setIfDefined(this.originalGrep, this.mocha.grep);
    }
    const dryRunResult = await this.run(disableBail, activeMutant.id, mutantActivation);
    return toMutantRunResult(dryRunResult);
  }

  public override async simultaneousMutantRun(options: SimultaneousMutantRunOptions): Promise<SimultaneousMutantRunResult> {
    this.instrumenterContext.clearHitLimits();
    this.instrumenterContext.clearHitCounts();
    let hasFilter = undefined;
    const metaRegExps = [];
    for (const option of options.mutantRunOptions) {
      if (option.hitLimit) {
        this.instrumenterContext.addHitLimit(option.activeMutant.id, option.hitLimit);
        this.instrumenterContext.addHitCount(option.activeMutant.id);
      }

      if (option.testFilter) {
        if (hasFilter === false) {
          throw new Error('Impossible state: a simultaneous mutant before the current one did not define a test filter');
        }
        hasFilter = true;
        metaRegExps.push(option.testFilter.map((testId) => `(${escapeRegExp(testId)})`).join('|'));
      } else if (hasFilter) {
        // if this happens, all tests need to be executed; for now don't accept it at all
        throw new Error('Impossible state: the simultaneous mutants combined do not all define a test filter');
      }
    }

    if (hasFilter) {
      this.mocha.grep(new RegExp(metaRegExps.join('|')));
    } else {
      this.setIfDefined(this.originalGrep, this.mocha.grep);
    }

    return this.simultaneousRun(
      // default to true since we do not support smart bail (at the moment)
      options.mutantRunOptions.length <= 1 ? options.disableBail : true,
      options.mutantRunOptions,
      options.mutantActivation,
    );
  }

  public async simultaneousRun(
    disableBail: boolean,
    mutantRunOptions: MutantRunOptions[],
    mutantActivation: MutantActivation,
  ): Promise<SimultaneousMutantRunResult> {
    setBail(!disableBail, this.mocha.suite);
    const activeMutantIds = mutantRunOptions.map((o) => o.activeMutant.id);
    try {
      if (!this.loadedEnv) {
        if (activeMutantIds.length === 1 && mutantActivation === 'static') {
          this.instrumenterContext.setActiveMutants(activeMutantIds[0]);
        } else if (activeMutantIds.length > 1 && mutantActivation === 'static') {
          throw new Error('Impossible state: multiple static mutants');
        } else {
          this.instrumenterContext.activeMutants = undefined;
        }
        // Loading files Async is needed to support native esm modules
        // See https://mochajs.org/api/mocha#loadFilesAsync
        await this.mocha.loadFilesAsync();
        this.loadedEnv = true;
      }
      this.instrumenterContext.activeMutants = activeMutantIds.length > 0 ? new Set(activeMutantIds) : undefined;
      await this.runMocha();

      // todo: fix results
      const reporter = StrykerMochaReporter.currentInstance;
      if (reporter) {
        const dryRunResults = formulateSimultaneousResults(reporter, this.instrumenterContext);
        return {
          status: SimultaneousMutantRunStatus.Valid,
          results: dryRunResults.map((dry) => toMutantRunResult(dry)),
        };
      } else {
        const errorMessage = `Mocha didn't instantiate the ${StrykerMochaReporter.name} correctly. Test result cannot be reported.`;
        this.log.error(errorMessage);
        return {
          status: SimultaneousMutantRunStatus.Invalid,
          invalidResult: { status: MutantRunStatus.Error, errorMessage },
        };
      }
    } catch (errorMessage: any) {
      this.log.info(`Simultaneous run failed with message: ${errorMessage}`);
      return {
        status: SimultaneousMutantRunStatus.Invalid,
        invalidResult: { status: MutantRunStatus.Error, errorMessage },
      };
    }

    function formulateSimultaneousResults({ tests }: I<StrykerMochaReporter>, context: InstrumenterContextWrapper): DryRunResult[] {
      const results = [];
      for (const mutant of mutantRunOptions) {
        const { id } = mutant.activeMutant;
        const timeoutResult = determineHitLimitReached(context.getHitCount(id), context.getHitLimit(id));
        if (timeoutResult) {
          results.push(timeoutResult);
        } else {
          const result: CompleteDryRunResult = {
            status: DryRunStatus.Complete,
            tests: mutant.testFilter ? tests.filter((t) => mutant.testFilter!.includes(t.id)) : tests,
          };
          results.push(result);
        }
      }
      return results;
    }

    function setBail(bail: boolean, suite: Suite) {
      suite.bail(bail);
      suite.suites.forEach((childSuite) => setBail(bail, childSuite));
    }
  }

  public async run(disableBail: boolean, activeMutantId?: string, mutantActivation?: MutantActivation): Promise<DryRunResult> {
    setBail(!disableBail, this.mocha.suite);
    try {
      if (!this.loadedEnv) {
        if (activeMutantId !== undefined && mutantActivation === 'static') {
          this.instrumenterContext.setActiveMutants(activeMutantId);
        } else {
          this.instrumenterContext.activeMutants = undefined;
        }
        // Loading files Async is needed to support native esm modules
        // See https://mochajs.org/api/mocha#loadFilesAsync
        await this.mocha.loadFilesAsync();
        this.loadedEnv = true;
      }
      this.instrumenterContext.activeMutants = activeMutantId === undefined ? undefined : new Set([activeMutantId]);
      await this.runMocha();
      const reporter = StrykerMochaReporter.currentInstance;
      if (reporter) {
        const timeoutResult = determineHitLimitReached(this.instrumenterContext.hitCount, this.instrumenterContext.hitLimit);
        if (timeoutResult) {
          return timeoutResult;
        }
        const result: CompleteDryRunResult = {
          status: DryRunStatus.Complete,
          tests: reporter.tests,
        };
        return result;
      } else {
        const errorMessage = `Mocha didn't instantiate the ${StrykerMochaReporter.name} correctly. Test result cannot be reported.`;
        this.log.error(errorMessage);
        return {
          status: DryRunStatus.Error,
          errorMessage,
        };
      }
    } catch (errorMessage: any) {
      return {
        errorMessage,
        status: DryRunStatus.Error,
      };
    }

    function setBail(bail: boolean, suite: Suite) {
      suite.bail(bail);
      suite.suites.forEach((childSuite) => setBail(bail, childSuite));
    }
  }

  public async dispose(): Promise<void> {
    try {
      this.mocha?.dispose();
    } catch (err: any) {
      if (err?.code !== 'ERR_MOCHA_INSTANCE_ALREADY_RUNNING') {
        // Oops, didn't mean to catch this one
        throw err;
      }
    }
  }

  private async runMocha(): Promise<void> {
    return new Promise<void>((res) => {
      this.mocha.run(() => res());
    });
  }
}
