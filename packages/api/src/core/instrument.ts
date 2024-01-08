import { MutantCoverage } from './mutant-coverage.js';

/**
 * Identifiers used when instrumenting the code
 */
export const INSTRUMENTER_CONSTANTS = Object.freeze({
  NAMESPACE: '__stryker__',
  MUTATION_COVERAGE_OBJECT: identity('mutantCoverage'),
  ACTIVE_MUTANTS: identity('activeMutants'),
  CURRENT_TEST_ID: identity('currentTestId'),
  HIT_COUNT: identity('hitCount'),
  HIT_LIMIT: identity('hitLimit'),
  HIT_COUNTS: identity('hitCounts'),
  HIT_LIMITS: identity('hitLimits'),
  ACTIVE_MUTANT_ENV_VARIABLE: '__STRYKER_ACTIVE_MUTANT__',
} as const);

export interface InstrumenterContext {
  activeMutants?: Set<string>;
  currentTestId?: string;
  mutantCoverage?: MutantCoverage;
  hitCount?: number;
  hitLimit?: number;
}

function identity<T extends keyof SimultaneousInstrumenterContext>(key: T): T {
  return key;
}

export interface SimultaneousInstrumenterContext extends InstrumenterContext {
  hitCounts?: Map<string, number>;
  hitLimits?: Map<string, number>;
}

/**
 * Wrapper for the {@link InstrumenterContext} interface, providing useful utility functions for modifying
 * the context. Includes a static method for wrapping the global context.
 */
export class InstrumenterContextWrapper implements SimultaneousInstrumenterContext {
  constructor(private readonly context: SimultaneousInstrumenterContext = {}) {}

  /**
   * Creates a new wrapper based on the global instrumenter context. Note: if the global context was undefined
   * at the time of calling this function, a new context will be created and assigned globally.
   * @param globalNamespace The namespace of the global instrumenter context that should be wrapped.
   * @returns A (new) wrapped instrumenter context.
   */
  public static WrapGlobalContext(globalNamespace: typeof INSTRUMENTER_CONSTANTS.NAMESPACE | '__stryker2__'): InstrumenterContextWrapper {
    const context: SimultaneousInstrumenterContext = global[globalNamespace] ?? (global[globalNamespace] = {});
    return new InstrumenterContextWrapper(context);
  }

  /**
   * Convenience method for setting the active mutants with any number of mutants. If the first argument
   * is undefined it will set the active mutants to being undefined, regardless of the following arguments.
   */
  public setActiveMutants(activeMutant: string | undefined, ...activeMutants: readonly string[]): void {
    if (activeMutant === undefined) {
      this.clearActiveMutants();
    } else {
      this.activeMutants = new Set([activeMutant, ...activeMutants]);
    }
  }

  /**
   * Convenience method for setting active mutants to being undefined.
   */
  public clearActiveMutants(): void {
    this.activeMutants = undefined;
  }

  public set activeMutants(value: Set<string> | undefined) {
    this.context.activeMutants = value;
  }

  public get activeMutants(): Set<string> | undefined {
    return this.context.activeMutants;
  }

  public set currentTestId(value: string | undefined) {
    this.context.currentTestId = value;
  }

  public get currentTestId(): string | undefined {
    return this.context.currentTestId;
  }

  public set mutantCoverage(value: MutantCoverage | undefined) {
    this.context.mutantCoverage = value;
  }

  public get mutantCoverage(): MutantCoverage | undefined {
    return this.context.mutantCoverage;
  }

  public clearHitCount(): void {
    this.hitCount = undefined;
    this.hitCounts = undefined;
  }

  public addHitCount(id: string, count = 0): void {
    if (!this.hitCounts) {
      this.hitCounts = new Map();
    }
    this.hitCount = count;
    this.hitCounts.set(id, count);
  }

  public set hitCounts(value: Map<string, number> | undefined) {
    this.hitCount = value ? value.values().next().value : undefined;
    this.context.hitCounts = value;
  }

  public get hitCounts(): Map<string, number> | undefined {
    return this.context.hitCounts;
  }

  public set hitCount(value: number | undefined) {
    this.context.hitCount = value;
  }

  public get hitCount(): number | undefined {
    return this.context.hitCount;
  }

  public clearHitLimit(): void {
    this.hitLimit = undefined;
    this.hitLimits = undefined;
  }

  public addHitLimit(id: string, limit: number): void {
    if (!this.hitLimits) {
      this.hitLimits = new Map();
    }
    this.hitLimit = limit;
    this.hitLimits.set(id, limit);
  }

  public set hitLimits(value: Map<string, number> | undefined) {
    this.hitLimit = value ? value.values().next().value : undefined;
    this.context.hitLimits = value;
  }

  public get hitLimits(): Map<string, number> | undefined {
    return this.context.hitLimits;
  }

  public set hitLimit(value: number | undefined) {
    this.context.hitLimit = value;
  }

  public get hitLimit(): number | undefined {
    return this.context.hitLimit;
  }
}
