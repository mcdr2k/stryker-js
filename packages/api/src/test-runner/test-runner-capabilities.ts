/**
 * Represents the capabilities of a test runner.
 */
export interface TestRunnerCapabilities {
  /**
   * When true, the test runner is capable of reloading the test environment. Otherwise false.
   * Reloading means creating a new nodejs process, or reloading the browser.
   * When true, the test runner should reload the test environment when `reloadEnvironment` is present in the run options.
   */
  reloadEnvironment: boolean;
  /**
   * When true, the test runner is capable of performing simultaneous mutation testing. False otherwise.
   * When false, the planner will never provide a test plan that tests more than 1 mutant at the same time.
   */
  simultaneousTesting?: boolean;
  /**
   * When true, the test runner is capable of bailing only the subset of tests that are associated with the killed simultaneous
   * mutant. False otherwise. The test planner might change the schedule in the case that smart bail is not available.
   */
  smartBail?: boolean;
}
