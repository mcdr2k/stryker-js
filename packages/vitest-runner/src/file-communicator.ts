import path from 'path';
import fs from 'fs/promises';

import { MutantRunOptions } from '@stryker-mutator/api/test-runner';
import { normalizeFileName } from '@stryker-mutator/util';

import { collectTestName, toRawTestId } from './vitest-helpers.js';

export class FileCommunicator {
  public readonly vitestSetup = normalizeFileName(path.resolve(`.'vitest.${process.env.STRYKER_MUTATOR_WORKER}.setup.js`));

  constructor(private readonly globalNamespace: string) {}

  public async setDryRun(): Promise<void> {
    // Note: TestContext.meta got renamed to TestContext.task in vitest 1.0.0
    await fs.writeFile(
      // Write hit count, hit limit, isDryRun, global namespace, etc. Altogether in 1 file
      this.vitestSetup,

      this.setupFileTemplate(`
      ns.activeMutants = undefined;
      ${collectTestName.toString()}
      ${toRawTestId.toString()}
  
      beforeEach((a) => {
        ns.currentTestId = toRawTestId(a.meta ?? a.task);
      });

      afterEach(() => {
        ns.currentTestId = undefined;
      });
  
      afterAll(async (suite) => {
        suite.meta.mutantCoverage = ns.mutantCoverage;
      });`),
    );
  }

  public async setMutantRun(options: MutantRunOptions): Promise<void> {
    // todo: verify
    const { hitLimit } = options;
    const { id } = options.activeMutant;
    const hitCountValue = hitLimit === undefined ? undefined : `new Map([['${id}', 0]])`;
    const hitLimitValue = hitLimit === undefined ? undefined : `new Map([['${id}', ${hitLimit}]])`;
    await fs.writeFile(
      this.vitestSetup,
      this.setupFileTemplate(`
      ns.hitLimits = ${hitLimitValue};
      beforeAll(() => {
        ns.hitCounts = ${hitCountValue};
      });
  
      ${
        options.mutantActivation === 'static'
          ? `ns.activeMutants = new Set(['${id}']);`
          : `
            beforeEach(() => {
              ns.activeMutants = new Set(['${id}']);
            });`
      }
      afterAll(async (suite) => {
        if (ns.hitCounts) {
          suite.meta.hitCount = ns.hitCounts.values().next().value;
        }
      });`),
    );
  }

  private setupFileTemplate(body: string) {
    return `
    import path from 'path';

    import { beforeEach, afterAll, beforeAll, afterEach } from 'vitest';

    const ns = globalThis.${this.globalNamespace} || (globalThis.${this.globalNamespace} = {});
    ${body}`;
  }

  public async dispose(): Promise<void> {
    await fs.rm(this.vitestSetup, { force: true });
  }
}
