import { from, partition, merge, Observable, lastValueFrom, EMPTY, concat, bufferTime, mergeMap } from 'rxjs';
import { toArray, map, shareReplay, tap, mergeAll } from 'rxjs/operators';
import { tokens, commonTokens } from '@stryker-mutator/api/plugin';
import { MutantResult, Mutant, StrykerOptions, PlanKind, MutantTestPlan, MutantRunPlan, SimultaneousMutantRunPlan } from '@stryker-mutator/api/core';
import { TestRunner, CompleteDryRunResult, TestRunnerCapabilities } from '@stryker-mutator/api/test-runner';
import { Logger } from '@stryker-mutator/api/logging';
import { I } from '@stryker-mutator/util';
import { CheckStatus } from '@stryker-mutator/api/check';

import { coreTokens } from '../di/index.js';
import { StrictReporter } from '../reporters/strict-reporter.js';
import { MutationTestReportHelper } from '../reporters/mutation-test-report-helper.js';
import { Timer } from '../utils/timer.js';
import { ConcurrencyTokenProvider, Pool } from '../concurrent/index.js';
import { isEarlyResult, MutantTestPlanner } from '../mutants/index.js';
import { CheckerFacade } from '../checker/index.js';

import { DryRunContext } from './3-dry-run-executor.js';

export interface MutationTestContext extends DryRunContext {
  [coreTokens.testRunnerPool]: I<Pool<TestRunner>>;
  [coreTokens.timeOverheadMS]: number;
  [coreTokens.mutationTestReportHelper]: MutationTestReportHelper;
  [coreTokens.capabilities]: TestRunnerCapabilities;
  [coreTokens.mutantTestPlanner]: MutantTestPlanner;
  [coreTokens.dryRunResult]: I<CompleteDryRunResult>;
}

const CHECK_BUFFER_MS = 10_000;

/**
 * Sorting the tests just before running them can yield a significant performance boost,
 * because it can reduce the number of times a test runner process needs to be recreated.
 * However, we need to buffer the results in order to be able to sort them.
 *
 * This value is very low, since it would halt the test execution otherwise.
 * @see https://github.com/stryker-mutator/stryker-js/issues/3462
 */
const BUFFER_FOR_SORTING_MS = 0;
const MUTANT_COUNT_SIMULTANEOUS_TESTING_THRESHOLD = 2; // 100?
const MARK_MUTATION_TEST_START = 'MUTATION_RUN';

export class MutationTestExecutor {
  public static inject = tokens(
    coreTokens.reporter,
    coreTokens.testRunnerPool,
    coreTokens.checkerPool,
    coreTokens.mutants,
    coreTokens.mutantTestPlanner,
    coreTokens.mutationTestReportHelper,
    coreTokens.capabilities,
    commonTokens.logger,
    commonTokens.options,
    coreTokens.timer,
    coreTokens.concurrencyTokenProvider,
    coreTokens.dryRunResult,
  );

  constructor(
    private readonly reporter: StrictReporter,
    private readonly testRunnerPool: I<Pool<TestRunner>>,
    private readonly checkerPool: I<Pool<I<CheckerFacade>>>,
    private readonly mutants: readonly Mutant[],
    private readonly planner: MutantTestPlanner,
    private readonly mutationTestReportHelper: I<MutationTestReportHelper>,
    private readonly capabilities: TestRunnerCapabilities,
    private readonly log: Logger,
    private readonly options: StrykerOptions,
    private readonly timer: I<Timer>,
    private readonly concurrencyTokenProvider: I<ConcurrencyTokenProvider>,
    private readonly dryRunResult: CompleteDryRunResult,
    private markedMutationTestStart = false,
  ) {}

  public async execute(): Promise<MutantResult[]> {
    this.markedMutationTestStart = false;
    if (this.options.dryRunOnly) {
      this.log.info('The dry-run has been completed successfully. No mutations have been executed.');
      return [];
    }

    if (this.dryRunResult.tests.length === 0 && this.options.allowEmpty) {
      this.logDone();
      return [];
    }

    const mutantTestPlans = await this.planner.makePlan(this.mutants);
    const { earlyResult$, runMutant$ } = this.executeEarlyResult(from(mutantTestPlans));
    const { passedMutant$, checkResult$ } = this.executeCheck(runMutant$);
    const { coveredMutant$, noCoverageResult$ } = this.executeNoCoverage(passedMutant$);

    let testRunnerResult$: Observable<MutantResult>;
    // todo: prefer the use of coveredMutant$, might impact performance due to synchronization
    if (this.shouldPerformSimultaneousMutationTesting(this.mutants.length)) {
      const coveredMutantArray = await lastValueFrom(coveredMutant$.pipe(toArray()));
      const simultaneousMutantRunPlan$ = from(await this.planner.makeSimultaneousPlan(coveredMutantArray, this.dryRunResult.tests.length));
      testRunnerResult$ = this.executeSimultaneousRunInTestRunner(simultaneousMutantRunPlan$);
    } else {
      // todo: remove this, testing purposes only
      const coveredMutantDelayed = await lastValueFrom(coveredMutant$.pipe(toArray()));
      testRunnerResult$ = this.executeRunInTestRunner(from(coveredMutantDelayed));
      // original code:
      //testRunnerResult$ = this.executeRunInTestRunner(coveredMutant$);
    }
    const results = await lastValueFrom(merge(testRunnerResult$, checkResult$, noCoverageResult$, earlyResult$).pipe(toArray()));
    this.logMutationRunDone();
    await this.mutationTestReportHelper.reportAll(results);
    await this.reporter.wrapUp();
    this.logDone();
    return results;
  }

  private executeEarlyResult(input$: Observable<MutantTestPlan>) {
    const [earlyResultMutants$, runMutant$] = partition(input$.pipe(shareReplay()), isEarlyResult);
    const earlyResult$ = earlyResultMutants$.pipe(map(({ mutant }) => this.mutationTestReportHelper.reportMutantStatus(mutant, mutant.status)));
    return { earlyResult$, runMutant$ };
  }

  private executeNoCoverage(input$: Observable<MutantRunPlan>) {
    const [noCoverageMatchedMutant$, coveredMutant$] = partition(input$.pipe(shareReplay()), ({ runOptions }) => runOptions.testFilter?.length === 0);
    const noCoverageResult$ = noCoverageMatchedMutant$.pipe(
      map(({ mutant }) => this.mutationTestReportHelper.reportMutantStatus(mutant, 'NoCoverage')),
    );
    return { noCoverageResult$, coveredMutant$ };
  }

  private executeRunInTestRunner(input$: Observable<MutantRunPlan>): Observable<MutantResult> {
    const sortedPlan$ = input$.pipe(
      bufferTime(BUFFER_FOR_SORTING_MS),
      mergeMap((plans) => plans.sort(reloadEnvironmentLast)),
    );
    return this.testRunnerPool.schedule(sortedPlan$, async (testRunner, { mutant, runOptions }) => {
      this.markMutationTestStart();
      const result = await testRunner.mutantRun(runOptions);
      return this.mutationTestReportHelper.reportMutantRunResult(mutant, result);
    });
  }

  private executeSimultaneousRunInTestRunner(input$: Observable<SimultaneousMutantRunPlan>): Observable<MutantResult> {
    const sortedPlan$ = input$.pipe(
      bufferTime(BUFFER_FOR_SORTING_MS),
      mergeMap((plans) => plans.sort(simultaneousReloadEnvironmentLast)),
    );
    return this.testRunnerPool
      .schedule(sortedPlan$, async (testRunner, { mutants, runOptions }) => {
        // todo: ensure that #simultaneousMutantRun's result always has the results of
        // the mutants in the same order as presented in the mutants input
        if (this.log.isDebugEnabled() && runOptions.mutantRunOptions.length > 1) {
          this.log.debug(`Attempting to run simultaneous mutant: ${JSON.stringify(runOptions, null, 2)}`);
        }
        this.markMutationTestStart();
        const result = await testRunner.simultaneousMutantRun(runOptions);
        return this.mutationTestReportHelper.reportSimultaneousMutantRunResult(mutants, result);
      })
      .pipe(mergeAll());
  }

  private logMutationRunDone() {
    this.log.info('Finished running mutants in %s.', this.timer.humanReadableElapsed(MARK_MUTATION_TEST_START));
  }

  private logDone() {
    this.log.info('Done in %s.', this.timer.humanReadableElapsed());
  }

  private markMutationTestStart() {
    if (this.markedMutationTestStart) return;
    this.timer.mark(MARK_MUTATION_TEST_START);
    this.markedMutationTestStart = true;
  }

  /**
   * Checks mutants against all configured checkers (if any) and returns steams for failed checks and passed checks respectively
   * @param input$ The mutant run plans to check
   */
  public executeCheck(input$: Observable<MutantRunPlan>): {
    checkResult$: Observable<MutantResult>;
    passedMutant$: Observable<MutantRunPlan>;
  } {
    let checkResult$: Observable<MutantResult> = EMPTY;
    let passedMutant$ = input$;
    for (const checkerName of this.options.checkers) {
      // Use this checker
      const [checkFailedResult$, checkPassedResult$] = partition(
        this.executeSingleChecker(checkerName, passedMutant$).pipe(shareReplay()),
        isEarlyResult,
      );

      // Prepare for the next one
      passedMutant$ = checkPassedResult$;
      checkResult$ = concat(checkResult$, checkFailedResult$.pipe(map(({ mutant }) => mutant)));
    }
    return {
      checkResult$,
      passedMutant$: passedMutant$.pipe(
        tap({
          complete: async () => {
            await this.checkerPool.dispose();
            this.concurrencyTokenProvider.freeCheckers();
          },
        }),
      ),
    };
  }

  /**
   * Executes the check task for one checker
   * @param checkerName The name of the checker to execute
   * @param input$ The mutants tasks to check
   * @returns An observable stream with early results (check failed) and passed results
   */
  private executeSingleChecker(checkerName: string, input$: Observable<MutantRunPlan>): Observable<MutantTestPlan> {
    const group$ = this.checkerPool
      .schedule(input$.pipe(bufferTime(CHECK_BUFFER_MS)), (checker, mutants) => checker.group(checkerName, mutants))
      .pipe(mergeMap((mutantGroups) => mutantGroups));
    const checkTask$ = this.checkerPool
      .schedule(group$, (checker, group) => checker.check(checkerName, group))
      .pipe(
        mergeMap((mutantGroupResults) => mutantGroupResults),
        map(([mutantRunPlan, checkResult]) =>
          checkResult.status === CheckStatus.Passed
            ? mutantRunPlan
            : {
                plan: PlanKind.EarlyResult as const,
                mutant: this.mutationTestReportHelper.reportCheckFailed(mutantRunPlan.mutant, checkResult),
              },
        ),
      );
    return checkTask$;
  }

  /**
   * Checks whether simultaneous testing should be performed. This includes checks for test-runner capabilities,
   * configuration options, coverage analysis used.
   * @returns True if simultaneous testing is possible and desired, false otherwise.
   */
  private shouldPerformSimultaneousMutationTesting(mutantCount: number): boolean {
    if (!this.capabilities.simultaneousTesting) {
      this.log.info('Simultaneous testing is not performed because the test-runner does not support it');
      return false;
    }
    if (this.options.disableSimultaneousTesting) {
      this.log.info('Simultaneous testing is not performed because it was disabled by the configuration');
      return false;
    }
    if (this.options.coverageAnalysis === 'off') {
      this.log.info('Simultaneous testing is not performed because coverage analysis was "off"');
      return false;
    }
    // todo: not necessarily a bad thing to still use simultaneous testing when there are few mutants
    if (mutantCount < MUTANT_COUNT_SIMULTANEOUS_TESTING_THRESHOLD) {
      this.log.info(
        `Simultaneous testing is not performed because there were too few mutants (${mutantCount}), need at least ${MUTANT_COUNT_SIMULTANEOUS_TESTING_THRESHOLD} mutants`,
      );
      return false;
    }
    // todo: some test frameworks cannot provide coverage data, then we cannot determine reachability between mutants
    // unclear how I should determine whether frameworks can provide coverage data
    this.log.info('Simultaneous testing is being performed');
    return true;
  }
}

/**
 * Sorting function that sorts mutant run plans that reload environments last.
 * This can yield a significant performance boost, because it reduces the times a test runner process needs to restart.
 * @see https://github.com/stryker-mutator/stryker-js/issues/3462
 */
function reloadEnvironmentLast(a: MutantRunPlan, b: MutantRunPlan): number {
  if (a.plan === PlanKind.Run && b.plan === PlanKind.Run) {
    if (a.runOptions.reloadEnvironment && !b.runOptions.reloadEnvironment) {
      return 1;
    }
    if (!a.runOptions.reloadEnvironment && b.runOptions.reloadEnvironment) {
      return -1;
    }
    return 0;
  }
  return 0;
}

/**
 * Sorting function that sorts mutant run plans that reload environments last.
 * This can yield a significant performance boost, because it reduces the times a test runner process needs to restart.
 * @see https://github.com/stryker-mutator/stryker-js/issues/3462
 */
function simultaneousReloadEnvironmentLast(a: SimultaneousMutantRunPlan, b: SimultaneousMutantRunPlan): number {
  if (a.plan === PlanKind.Run && b.plan === PlanKind.Run) {
    if (a.runOptions.reloadEnvironment && !b.runOptions.reloadEnvironment) {
      return 1;
    }
    if (!a.runOptions.reloadEnvironment && b.runOptions.reloadEnvironment) {
      return -1;
    }
    return 0;
  }
  return 0;
}
