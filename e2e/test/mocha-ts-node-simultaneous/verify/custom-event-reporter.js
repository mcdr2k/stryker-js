import { PluginKind, declareClassPlugin } from '@stryker-mutator/api/plugin';

export class CustomEventReporter {
  /**
   * @type {readonly import('@stryker-mutator/api/core').MutantTestPlan[]}
   */
  testPlan;

  /**
   * @type {import('@stryker-mutator/api/report').DryRunCompletedEvent}
   */
  dryRunCompletedEvent;

  /**
   * @type { CustomEventReporter }
   */
  static instance;

  constructor() {
    CustomEventReporter.instance = this;
  }

  /**
   * @param {import('@stryker-mutator/api/report').MutationTestingPlanReadyEvent} event
   * @returns {void}
   */
  onMutationTestingPlanReady(event) {
    this.testPlan = event.mutantPlans;
  }

  /**
   * An event emitted when the dry run completed successfully.
   * @param {import('@stryker-mutator/api/report').DryRunCompletedEvent} event
   */
  onDryRunCompleted(event) {
    this.dryRunCompletedEvent = event;
  }
}

export const strykerPlugins = [declareClassPlugin(PluginKind.Reporter, 'custom-event-reporter', CustomEventReporter)];
