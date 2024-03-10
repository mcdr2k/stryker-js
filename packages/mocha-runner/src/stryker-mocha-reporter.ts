import { Logger } from '@stryker-mutator/api/logging';
import {
  FailedTestResult,
  TestResult,
  SuccessTestResult,
  TestStatus,
  MutantRunOptions,
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
  private testCount = 0;

  public tests: TestResult[] = [];
  public pendingTests: Mocha.Test[] = [];

  public static currentInstance: I<StrykerMochaReporter> | undefined;
  public static liveReporter: LiveTestRunReporter | undefined;
  public static mutantRunOptions: MutantRunOptions[] | undefined;
  public static instrumenterContext: InstrumenterContextWrapper;
  public static bail = true;

  public testRunBeginMs = 0;
  private readonly isSimultaneousRun: boolean;

  public static clearStatic(): void {
    StrykerMochaReporter.mutantRunOptions = undefined;
    StrykerMochaReporter.liveReporter = undefined;
  }

  // Stryker disable all
  constructor(private readonly runner: NodeJS.EventEmitter) {
    this.isSimultaneousRun = StrykerMochaReporter.mutantRunOptions ? StrykerMochaReporter.mutantRunOptions.length > 1 : false;
    if (StrykerMochaReporter.mutantRunOptions) {
      this.registerSimultaneousEvents();
    } else {
      this.registerEvents();
    }
    StrykerMochaReporter.currentInstance = this;
  }

  private registerSimultaneousEvents() {
    this.runner.on(EVENT_RUN_BEGIN, () => {
      StrykerMochaReporter.liveReporter!.testRunStarted(StrykerMochaReporter.instrumenterContext);
      this.passedCount = 0;
      this.skippedCount = 0;
      this.testCount = 0;
      this.pendingTests = [];
      this.timer.reset();
      this.tests = undefined!; // deliberate cheat, tests should not be used during simultaneous testing
      this.testRunBeginMs = Metrics.now();
      StrykerMochaReporter.log!.debug('Starting Mocha test run');
    });

    // only subscribe to SUITE_BEGIN when simultaneous testing (>1 mutant) with bail enabled
    if (this.isSimultaneousRun && StrykerMochaReporter.bail) {
      this.runner.on(EVENT_SUITE_BEGIN, (suite: Mocha.Suite) => {
        // it is not possible to 'skip' a test that is already running (EVENT_TEST_BEGIN)
        // so instead we do it from the suite. It does seem rather expensive to do this smart bail.
        // todo: do note that if a test kills a mutant within this suite, then we cannot 'skip' related tests from this suite anymore
        for (const test of suite.tests) {
          if (StrykerMochaReporter.liveReporter!.shouldSkipTest(test.fullTitle())) {
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
      if (StrykerMochaReporter.log!.isTraceEnabled()) {
        StrykerMochaReporter.log!.trace(`TEST_BEGIN: ${test.fullTitle()}.`);
      }
      this.timer.reset();
      const pendingCount = this.pendingTests.push(test);

      StrykerMochaReporter.liveReporter!.startTest(test.fullTitle());

      if (pendingCount > 1) {
        StrykerMochaReporter.log!.fatal(
          `Multiple tests ([${this.pendingTests.map((t) => t.fullTitle())}]) were executed simultaneously for mutants ${Array.from(
            StrykerMochaReporter.instrumenterContext.activeMutants!,
          )}, this is a problem!`,
        );
      }
    });

    this.runner.on(EVENT_TEST_END, (test: Mocha.Test) => {
      if (StrykerMochaReporter.log!.isTraceEnabled()) {
        StrykerMochaReporter.log!.trace(`TEST_END: ${test.fullTitle()}.`);
      }
      // ok: mocha has got to be the worst EVENT_TEST_END is sent without an EVENT_TEST_BEGIN for tests that are skipped (EVENT_TEST_PENDING)
      // horrendous design: https://github.com/mochajs/mocha/issues/4079
      const index = this.pendingTests.indexOf(test);
      if (index >= 0) {
        this.pendingTests.splice(index, 1);
      } else {
        // cry in mocha
        // StrykerMochaReporter.log!.fatal(
        //   `Test '${test.fullTitle()}' ended but was never pending (pending tests are: [${this.pendingTests.map((t) => t.fullTitle())}])`,
        // );
      }
    });

    this.runner.on(EVENT_TEST_PENDING, (test: Mocha.Test) => {
      if (StrykerMochaReporter.log!.isTraceEnabled()) {
        StrykerMochaReporter.log!.trace(`TEST_PENDING: ${test.fullTitle()}.`);
      }
      this.testCount++;
      this.skippedCount++;

      const result: SkippedTestResult = this.createPendingResult(test);
      StrykerMochaReporter.liveReporter!.reportTestResult(result);

      if (StrykerMochaReporter.log!.isTraceEnabled()) {
        StrykerMochaReporter.log!.trace(`Test skipped: ${test.fullTitle()}.`);
      }
    });

    this.runner.on(EVENT_TEST_PASS, (test: Mocha.Test) => {
      if (StrykerMochaReporter.log!.isTraceEnabled()) {
        StrykerMochaReporter.log!.trace(`TEST_PASS: ${test.fullTitle()}.`);
      }
      this.testCount++;
      this.passedCount++;

      const result: SuccessTestResult = this.createPassResult(test);
      StrykerMochaReporter.liveReporter!.reportTestResult(result);
    });

    this.runner.on(EVENT_TEST_FAIL, (test: Mocha.Hook | Mocha.Test, err: Error) => {
      if (StrykerMochaReporter.log!.isTraceEnabled()) {
        StrykerMochaReporter.log!.trace(`TEST_FAIL: ${test.fullTitle()}.`);
      }
      this.testCount++;

      const result: FailedTestResult = this.createFailedResult(test, err);
      StrykerMochaReporter.liveReporter!.reportTestResult(result);

      if (StrykerMochaReporter.log!.isTraceEnabled()) {
        StrykerMochaReporter.log!.trace(`Test failed: ${test.fullTitle()}. Error: ${err.message}`);
      }
    });

    this.runner.on(EVENT_RUN_END, () => {
      StrykerMochaReporter.liveReporter!.testRunFinished();
      StrykerMochaReporter.log!.debug(
        'Mocha test run completed: %s/%s passed (skipped %s)',
        this.passedCount,
        this.testCount - this.skippedCount,
        this.skippedCount,
      );
    });
  }
  // Stryker restore all

  private registerEvents() {
    this.runner.on(EVENT_RUN_BEGIN, () => {
      this.passedCount = 0;
      this.skippedCount = 0;
      this.timer.reset();
      this.tests = [];
      this.testRunBeginMs = Metrics.now();
      StrykerMochaReporter.log!.debug('Starting Mocha test run');
    });

    this.runner.on(EVENT_TEST_BEGIN, (_test: Mocha.Test) => {
      this.timer.reset();
    });

    this.runner.on(EVENT_TEST_PENDING, (test: Mocha.Test) => {
      this.skippedCount++;

      const result: SkippedTestResult = this.createPendingResult(test);
      this.tests.push(result);

      if (StrykerMochaReporter.log!.isTraceEnabled()) {
        StrykerMochaReporter.log!.trace(`Test skipped: ${test.fullTitle()}.`);
      }
    });

    this.runner.on(EVENT_TEST_PASS, (test: Mocha.Test) => {
      this.passedCount++;

      const result: SuccessTestResult = this.createPassResult(test);
      this.tests.push(result);
    });

    this.runner.on(EVENT_TEST_FAIL, (test: Mocha.Hook | Mocha.Test, err: Error) => {
      const result: FailedTestResult = this.createFailedResult(test, err);
      this.tests.push(result);

      if (StrykerMochaReporter.log!.isTraceEnabled()) {
        StrykerMochaReporter.log!.trace(`Test failed: ${test.fullTitle()}. Error: ${err.message}`);
      }
    });

    this.runner.on(EVENT_RUN_END, () => {
      StrykerMochaReporter.log!.debug(
        'Mocha test run completed: %s/%s passed (skipped %s)',
        this.passedCount,
        this.tests.length - this.skippedCount,
        this.skippedCount,
      );
    });
  }

  private createPendingResult(test: Mocha.Test): SkippedTestResult {
    const title = test.fullTitle();
    return {
      id: title,
      name: title,
      status: TestStatus.Skipped,
      timeSpentMs: 0,
      fileName: test.file,
    };
  }

  private createPassResult(test: Mocha.Test): SuccessTestResult {
    const title = test.fullTitle();
    return {
      id: title,
      name: title,
      status: TestStatus.Success,
      timeSpentMs: this.timer.elapsedMs(),
      fileName: test.file,
    };
  }

  private createFailedResult(test: Mocha.Hook | Mocha.Test, err: Error): FailedTestResult {
    const title = test.ctx?.currentTest?.fullTitle() ?? test.fullTitle();
    return {
      id: title,
      failureMessage: (err.message || err.stack) ?? '<empty failure message>',
      name: title,
      status: TestStatus.Failed,
      timeSpentMs: this.timer.elapsedMs(),
    };
  }
}
