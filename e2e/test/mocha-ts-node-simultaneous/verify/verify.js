import { Stryker } from '@stryker-mutator/core';

import { expectMetricsJsonToMatchSnapshot } from '../../../helpers.js';

import { CustomEventReporter } from './custom-event-reporter.js';

describe('Verify stryker has ran correctly', () => {
  it('should report correct score', async () => {
    //await expectMetricsJsonToMatchSnapshot();
  });
});

describe('TBD', () => {
  /**
   * @type {import('@stryker-mutator/api/core').PartialStrykerOptions}
   */
  let strykerOptions;
  beforeEach(async () => {
    strykerOptions = {
      $schema: '../../node_modules/@stryker-mutator/core/schema/stryker-schema.json',
      disableSimultaneousTesting: false,
      // logLevel: 'debug',
      packageManager: 'npm',
      testRunner: 'mocha',
      concurrency: 1,
      coverageAnalysis: 'perTest',
      reporters: ['json', 'event-recorder', 'html', 'progress', 'clear-text', 'custom-event-reporter'],
      checkers: ['typescript'],
      tsconfigFile: 'tsconfig.json',
      plugins: ['./verify/custom-event-reporter.js', '@stryker-mutator/mocha-runner', '@stryker-mutator/typescript-checker'],
    };
  });

  it('hiya', async () => {
    const stryker = new Stryker({
      ...strykerOptions,
    });

    // todo
    const results = await stryker.runMutationTest();
    CustomEventReporter.instance.dryRunCompletedEvent.result.mutantCoverage.perTest;
    //logObject(CustomEventReporter.instance.testPlan.map((tp) => tp.mutant));
    //logObject(CustomEventReporter.instance.dryRunCompletedEvent.result);
    //logObject(CustomEventReporter.instance.dryRunCompletedEvent.timing);
    //logObject(CustomEventReporter.instance.dryRunCompletedEvent.capabilities);
    logObject(results);
  });

  function logObject(obj) {
    console.log(JSON.stringify(obj, null, 2));
  }
});
