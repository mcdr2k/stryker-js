import * as fs from 'fs';

import { MutantResult, PartialStrykerOptions } from '@stryker-mutator/api/core';
import { createInjector } from 'typed-inject';
import { commonTokens } from '@stryker-mutator/api/plugin';

import { Measurement, Metrics } from '@stryker-mutator/api/metrics';

import { LogConfigurator } from './logging/index.js';
import { PrepareExecutor, MutantInstrumenterExecutor, DryRunExecutor, MutationTestExecutor } from './process/index.js';
import { coreTokens, provideLogger } from './di/index.js';
import { retrieveCause, ConfigError } from './errors.js';

/**
 * The main Stryker class.
 * It provides a single `runMutationTest()` function which runs mutation testing:
 */
export class Stryker {
  /**
   * @constructor
   * @param cliOptions The cli options.
   * @param injectorFactory The injector factory, for testing purposes only
   */
  constructor(
    private readonly cliOptions: PartialStrykerOptions,
    private readonly injectorFactory = createInjector,
  ) {}

  public async runMutationTest(): Promise<MutantResult[]> {
    const rootInjector = this.injectorFactory();
    const loggerProvider = provideLogger(rootInjector);
    let measurement: Measurement | undefined = undefined;
    try {
      measurement = Metrics.measureFunction(Stryker.name, 'prepare');
      // 1. Prepare. Load Stryker configuration, load the input files and starts the logging server
      const prepareExecutor = loggerProvider.injectClass(PrepareExecutor);
      const mutantInstrumenterInjector = await prepareExecutor.execute(this.cliOptions);
      measurement.markEnd();

      const options = mutantInstrumenterInjector.resolve(commonTokens.options);
      Metrics.measureMetrics = options.measureMetrics;

      try {
        // 2. Mutate and instrument the files and write to the sandbox.
        measurement = Metrics.measureFunction(Stryker.name, 'mutate-and-instrument');
        const mutantInstrumenter = mutantInstrumenterInjector.injectClass(MutantInstrumenterExecutor);
        const dryRunExecutorInjector = await mutantInstrumenter.execute();
        measurement.markEnd();

        // 3. Perform a 'dry run' (initial test run). Runs the tests without active mutants and collects coverage.
        measurement = Metrics.measureFunction(Stryker.name, 'dry-run');
        const dryRunExecutor = dryRunExecutorInjector.injectClass(DryRunExecutor);
        const mutationRunExecutorInjector = await dryRunExecutor.execute();
        measurement.markEnd();

        // 4. Actual mutation testing. Will check every mutant and if valid run it in an available test runner.
        measurement = Metrics.measureFunction(Stryker.name, 'mutation-testing');
        const mutationRunExecutor = mutationRunExecutorInjector.injectClass(MutationTestExecutor);
        const mutantResults = await mutationRunExecutor.execute();
        measurement.markEnd();

        if (options.measureMetrics) {
          fs.writeFileSync(options.measureMetricsOutputFile, Metrics.exportData(), 'utf8');
        }

        return mutantResults;
      } catch (error) {
        measurement?.markEnd(false);
        if (mutantInstrumenterInjector.resolve(commonTokens.options).cleanTempDir !== 'always') {
          const log = loggerProvider.resolve(commonTokens.getLogger)(Stryker.name);
          log.debug('Not removing the temp dir because an error occurred');
          mutantInstrumenterInjector.resolve(coreTokens.temporaryDirectory).removeDuringDisposal = false;
        }
        throw error;
      }
    } catch (error) {
      const log = loggerProvider.resolve(commonTokens.getLogger)(Stryker.name);
      const cause = retrieveCause(error);
      if (cause instanceof ConfigError) {
        log.error(cause.message);
      } else {
        log.error('Unexpected error occurred while running Stryker', error);
        log.info('This might be a known problem with a solution documented in our troubleshooting guide.');
        log.info('You can find it at https://stryker-mutator.io/docs/stryker-js/troubleshooting/');
        if (!log.isTraceEnabled()) {
          log.info(
            'Still having trouble figuring out what went wrong? Try `npx stryker run --fileLogLevel trace --logLevel debug` to get some more info.',
          );
        }
      }
      throw cause;
    } finally {
      await rootInjector.dispose();
      await LogConfigurator.shutdown();
    }
  }
}
