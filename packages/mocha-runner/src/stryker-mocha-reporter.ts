import { Logger } from '@stryker-mutator/api/logging';
import {
  FailedTestResult,
  TestResult,
  SuccessTestResult,
  TestStatus,
  MutantRunOptions,
  MutantRunStatus,
  SkippedTestResult,
  LiveTestRunReporter,
} from '@stryker-mutator/api/test-runner';
import { I } from '@stryker-mutator/util';

import { Metrics } from '@stryker-mutator/api/metrics';

import { InstrumenterContextWrapper } from '@stryker-mutator/api/core';

import { Timer } from './timer.js';

const { EVENT_RUN_BEGIN, EVENT_TEST_PASS, EVENT_TEST_FAIL, EVENT_RUN_END, EVENT_TEST_END, EVENT_TEST_BEGIN, EVENT_TEST_PENDING, EVENT_SUITE_BEGIN } =
  {
    EVENT_RUN_BEGIN: 'start',
    EVENT_TEST_PASS: 'pass',
    EVENT_TEST_FAIL: 'fail',
    EVENT_RUN_END: 'end',
    EVENT_TEST_END: 'test end',
    EVENT_TEST_BEGIN: 'test',
    EVENT_TEST_PENDING: 'pending',
    EVENT_SUITE_BEGIN: 'suite',
  }; // from: Mocha.Runner.constants

// todo: Mocha has a reporter field, this can possibly be used instead of using this (accepts constructor for reporter)
// class is required to extend from Mocha.reporters.Base in that case. Allows us to provide data to the reporter if necessary
// https://github.com/mochajs/mocha-examples/blob/master/packages/third-party-reporter/lib/my-reporter.js
export class StrykerMochaReporter {
  /*
   * The stryker logger instance injected into this plugin
   * Needs to be set from 'the outside' because mocha doesn't really have a nice way of providing
   * data to reporters...
   */
  public static log: Logger | undefined;
  private readonly timer = new Timer();
  private passedCount = 0;
  private skippedCount = 0;

  public tests: TestResult[] = [];
  public pendingCount = 0;
  public pendingTest: Mocha.Test | undefined;

  public static currentInstance: I<StrykerMochaReporter> | undefined;
  public static liveReporter: LiveTestRunReporter | undefined;
  public static mutantRunOptions: MutantRunOptions[] | undefined;
  public static instrumenterContext: InstrumenterContextWrapper;
  public static bail = true;

  public readonly testTitleToMutantId = new Map<string, string>();
  public readonly mutantIdToStatus = new Map<string, MutantRunStatus>();
  public testRunBeginMs = 0;
  private isSimultaneousRun = false;
  private done = false;

  public static clearStatic(): void {
    StrykerMochaReporter.mutantRunOptions = undefined;
    StrykerMochaReporter.liveReporter = undefined;
  }

  constructor(private readonly runner: NodeJS.EventEmitter) {
    this.initData();
    this.registerEvents();
    StrykerMochaReporter.currentInstance = this;
  }

  private initData() {
    this.testTitleToMutantId.clear();
    this.mutantIdToStatus.clear();
    this.isSimultaneousRun = false;

    if (StrykerMochaReporter.mutantRunOptions && StrykerMochaReporter.mutantRunOptions.length > 1) {
      this.isSimultaneousRun = true;
      const options = StrykerMochaReporter.mutantRunOptions;
      for (const mutant of options) {
        // assume testFilter exists, if it did not then this is an invalid simultaneous mutant anyway
        mutant.testFilter!.map((t) => {
          if (this.testTitleToMutantId.get(mutant.activeMutant.id))
            StrykerMochaReporter.log?.warn(`Test '${t}' is already assigned to mutant '${mutant.activeMutant.id}'`);
          this.testTitleToMutantId.set(t, mutant.activeMutant.id);
        });
        this.mutantIdToStatus.set(mutant.activeMutant.id, MutantRunStatus.Pending);
      }
    }
  }

  public isDone(): boolean {
    return this.done;
  }

  private registerEvents() {
    this.runner.on(EVENT_RUN_BEGIN, () => {
      StrykerMochaReporter.liveReporter?.testRunStarted(StrykerMochaReporter.instrumenterContext);
      this.done = false;
      this.passedCount = 0;
      this.skippedCount = 0;
      this.pendingCount = 0;
      this.pendingTest = undefined;
      this.timer.reset();
      this.tests = [];
      this.testRunBeginMs = Metrics.now();
      StrykerMochaReporter.log?.debug('Starting Mocha test run');
    });

    // only subscribe to SUITE_BEGIN when simultaneous testing with bail enabled
    if (this.isSimultaneousRun && StrykerMochaReporter.bail) {
      this.runner.on(EVENT_SUITE_BEGIN, (suite: Mocha.Suite) => {
        // it is not possible to 'skip' a test that is already running (EVENT_TEST_BEGIN)
        // so instead we do it from the suite
        // todo: do note that if a test kills a mutant within this suite, then we cannot 'skip' related tests from this suite anymore
        for (const test of suite.tests) {
          if (StrykerMochaReporter.liveReporter?.shouldSkipTest(test.fullTitle())) {
            try {
              test.skip();
            } catch (e) {}
          }
        }
      });
    }

    // todo: we could actually change ns.activeMutants from here if we want to
    // that way we can mitigate many(!) issues with dependencies between multiple mutants
    // could run into trouble if suites ('describes') also creates data
    this.runner.on(EVENT_TEST_BEGIN, (test: Mocha.Test) => {
      this.timer.reset();
      this.pendingTest = test;
      this.pendingCount++;
      StrykerMochaReporter.liveReporter?.startTest(test.fullTitle());
      if (this.isSimultaneousRun && this.pendingCount > 1) {
        StrykerMochaReporter.log?.fatal(`Multiple tests (${this.pendingCount}) were executed simultaneously, this is a problem!`);
      }
    });

    this.runner.on(EVENT_TEST_END, (_test: Mocha.Test) => {
      this.pendingCount--;
      this.pendingTest = undefined;
    });

    this.runner.on(EVENT_TEST_PENDING, (test: Mocha.Test) => {
      if (StrykerMochaReporter.log?.isTraceEnabled()) {
        StrykerMochaReporter.log?.trace(`Test skipped: ${test.fullTitle()}.`);
      }
      const title = test.fullTitle();
      const result: SkippedTestResult = {
        id: title,
        name: title,
        status: TestStatus.Skipped,
        timeSpentMs: 0,
        fileName: test.file,
      };
      this.tests.push(result);
      StrykerMochaReporter.liveReporter?.reportTestResult(result);
      this.skippedCount++;
    });

    this.runner.on(EVENT_TEST_PASS, (test: Mocha.Test) => {
      const title: string = test.fullTitle();
      const result: SuccessTestResult = {
        id: title,
        name: title,
        status: TestStatus.Success,
        timeSpentMs: this.timer.elapsedMs(),
        fileName: test.file,
      };
      StrykerMochaReporter.liveReporter?.reportTestResult(result);
      this.tests.push(result);
      this.passedCount++;
    });

    this.runner.on(EVENT_TEST_FAIL, (test: Mocha.Hook | Mocha.Test, err: Error) => {
      const title = test.ctx?.currentTest?.fullTitle() ?? test.fullTitle();
      const result: FailedTestResult = {
        id: title,
        failureMessage: (err.message || err.stack) ?? '<empty failure message>',
        name: title,
        status: TestStatus.Failed,
        timeSpentMs: this.timer.elapsedMs(),
      };
      this.tests.push(result);
      StrykerMochaReporter.liveReporter?.reportTestResult(result);
      if (this.isSimultaneousRun) {
        const mutantId = this.testTitleToMutantId.get(test.fullTitle());
        if (mutantId) {
          this.mutantIdToStatus.set(mutantId, MutantRunStatus.Killed);
        }
      }
      if (StrykerMochaReporter.log?.isTraceEnabled()) {
        StrykerMochaReporter.log?.trace(`Test failed: ${test.fullTitle()}. Error: ${err.message}`);
      }
    });

    this.runner.on(EVENT_RUN_END, () => {
      StrykerMochaReporter.liveReporter?.testRunFinished();
      this.done = true;
      StrykerMochaReporter.log?.debug(
        'Mocha test run completed: %s/%s passed (skipped %s)',
        this.passedCount,
        this.tests.length - this.skippedCount,
        this.skippedCount,
      );
    });
  }
}
