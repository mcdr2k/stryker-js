import { Logger } from '@stryker-mutator/api/logging';
import { FailedTestResult, TestResult, SuccessTestResult, TestStatus } from '@stryker-mutator/api/test-runner';
import { I } from '@stryker-mutator/util';

import { Timer } from './timer.js';

const { EVENT_RUN_BEGIN, EVENT_TEST_PASS, EVENT_TEST_FAIL, EVENT_RUN_END, EVENT_TEST_BEGIN, EVENT_TEST_PENDING, EVENT_SUITE_BEGIN } = {
  EVENT_RUN_BEGIN: 'start',
  EVENT_TEST_PASS: 'pass',
  EVENT_TEST_FAIL: 'fail',
  EVENT_RUN_END: 'end',
  EVENT_TEST_BEGIN: 'test',
  EVENT_TEST_PENDING: 'pending',
  EVENT_SUITE_BEGIN: 'suite',
}; // from: Mocha.Runner.constants

export class StrykerMochaReporter {
  /*
   * The stryker logger instance injected into this plugin
   * Needs to be set from 'the outside' because mocha doesn't really have a nice way of providing
   * data to reporters...
   */
  public static log: Logger | undefined;
  private readonly timer = new Timer();
  private passedCount = 0;
  public tests: TestResult[] = [];

  public static REPORTER_MUTATION_RUN: boolean;
  public static currentInstance: I<StrykerMochaReporter> | undefined;

  constructor(private readonly runner: NodeJS.EventEmitter) {
    this.registerEvents();
    StrykerMochaReporter.currentInstance = this;
  }

  private registerEvents() {
    this.runner.on(EVENT_RUN_BEGIN, () => {
      this.passedCount = 0;
      this.timer.reset();
      this.tests = [];
      StrykerMochaReporter.log?.debug('Starting Mocha test run');
    });

    this.runner.on(EVENT_SUITE_BEGIN, (suite: Mocha.Suite) => {
      if (StrykerMochaReporter.REPORTER_MUTATION_RUN) {
        // todo: SMART BAIL
        // can't skip a test that is already running, so we skip them from the suite
        /*
         if (StrykerMochaReporter.log?.isTraceEnabled()) {
        StrykerMochaReporter.log?.trace(`Skipping tests for suite: ${suite.fullTitle()}.`);
      }
        suite.tests.forEach((test) => {
          try {
            test.skip();
          } catch (e) {}
        });
        */
      }
    });

    this.runner.on(EVENT_TEST_BEGIN, (test: Mocha.Test) => {
      if (StrykerMochaReporter.log?.isTraceEnabled()) {
        StrykerMochaReporter.log?.trace(`Test begin: ${test.fullTitle()}.`);
      }
      //test.skip();
    });

    this.runner.on(EVENT_TEST_PENDING, (test: Mocha.Test) => {
      if (StrykerMochaReporter.log?.isTraceEnabled()) {
        StrykerMochaReporter.log?.trace(`Test skipped: ${test.fullTitle()}.`);
      }
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
      this.tests.push(result);
      this.passedCount++;
      this.timer.reset();
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
      if (StrykerMochaReporter.log?.isTraceEnabled()) {
        StrykerMochaReporter.log?.trace(`Test failed: ${test.fullTitle()}. Error: ${err.message}`);
      }
    });

    this.runner.on(EVENT_RUN_END, () => {
      StrykerMochaReporter.log?.debug('Mocha test run completed: %s/%s passed', this.passedCount, this.tests.length);
    });
  }
}
