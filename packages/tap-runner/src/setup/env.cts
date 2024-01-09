export const strykerDryRun = 'STRYKER_DRY_RUN';
export const strykerHitLimit = 'STRYKER_HIT_LIMIT';
export const strykerNamespace = 'STRYKER_NAMESPACE';
// note: keep in sync with INSTRUMENTER_CONSTANTS.ACTIVE_MUTANT_ENV_VARIABLE from api/src/core/instrument.ts
export const strykerActiveMutant = '__STRYKER_ACTIVE_MUTANT__';
export function tempTapOutputFileName(pid: number | undefined): string {
  return `stryker-output-${pid}.json`;
}
