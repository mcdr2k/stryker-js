import fs from 'fs';

import { tempTapOutputFileName, strykerDryRun, strykerHitLimit, strykerNamespace, strykerActiveMutant } from './env.cjs';

const strykerGlobalNamespace = (process.env[strykerNamespace] as '__stryker__' | '__stryker2__' | undefined) ?? '__stryker__';
const dryRun = process.env[strykerDryRun] === 'true';
const hitLimit = process.env[strykerHitLimit] ? +process.env[strykerHitLimit] : undefined;
const activeMutantId = process.env[strykerActiveMutant];

global[strykerGlobalNamespace] = {};

if (hitLimit) {
  // todo: verify
  global[strykerGlobalNamespace]!.hitLimits = new Map([[activeMutantId!, hitLimit]]);
  global[strykerGlobalNamespace]!.hitCounts = new Map([[activeMutantId!, 0]]);
  //global[strykerGlobalNamespace]!.hitLimit = hitLimit;
  //global[strykerGlobalNamespace]!.hitCount = 0;
}

process.on('exit', finalCleanup);

(['SIGABRT', 'SIGINT', 'SIGHUP', 'SIGTERM'] as const).forEach((signal) =>
  process.on(signal, (_: unknown, signalNumber: number) => {
    process.exit(128 + signalNumber);
  }),
);

function finalCleanup() {
  // todo: verify
  function replacer(key: any, value: any) {
    if (value instanceof Map) {
      return {
        dataType: 'Map',
        value: Array.from(value.entries()), // or with spread: value: [...value]
      };
    } else {
      return value;
    }
  }

  if (!dryRun) {
    delete global[strykerGlobalNamespace]!.mutantCoverage;
  }
  fs.writeFileSync(tempTapOutputFileName(process.pid), JSON.stringify(global[strykerGlobalNamespace], replacer));
}
