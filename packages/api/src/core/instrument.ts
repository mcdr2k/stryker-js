import { MutantCoverage } from './mutant-coverage.js';

/**
 * Identifiers used when instrumenting the code
 */
export const INSTRUMENTER_CONSTANTS = Object.freeze({
  NAMESPACE: '__stryker__',
  MUTATION_COVERAGE_OBJECT: identity('mutantCoverage'),
  ACTIVE_MUTANTS: identity('activeMutants'),
  CURRENT_TEST_ID: identity('currentTestId'),
  HIT_COUNTS: identity('hitCounts'),
  HIT_LIMITS: identity('hitLimits'),
  ACTIVE_MUTANT_ENV_VARIABLE: '__STRYKER_ACTIVE_MUTANT__',
} as const);

export interface InstrumenterContext {
  activeMutants?: Set<string>;
  currentTestId?: string;
  mutantCoverage?: MutantCoverage;
  hitCounts?: Map<string, number>;
  hitLimits?: Map<string, number>;
}

function identity<T extends keyof InstrumenterContext>(key: T): T {
  return key;
}

/**
 * Wrapper for the {@link InstrumenterContext} interface, providing useful utility functions for modifying
 * the context. Includes a static method for wrapping the global context.
 */
export class InstrumenterContextWrapper implements InstrumenterContext {
  constructor(private readonly context: InstrumenterContext = {}) {}

  /**
   * Creates a new wrapper based on the global instrumenter context. Note: if the global context was undefined
   * at the time of calling this function, a new context will be created and assigned globally.
   * @param globalNamespace The namespace of the global instrumenter context that should be wrapped.
   * @returns A (new) wrapped instrumenter context.
   */
  public static WrapGlobalContext(globalNamespace: typeof INSTRUMENTER_CONSTANTS.NAMESPACE | '__stryker2__'): InstrumenterContextWrapper {
    const context: InstrumenterContext = global[globalNamespace] ?? (global[globalNamespace] = {});
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

  public assignHitCount(id: string, count: number | undefined): void {
    this.clearHitCounts();
    if (count !== undefined) this.addHitCount(id, count);
  }

  public clearHitCounts(): void {
    this.hitCounts = undefined;
  }

  public addHitCount(id: string, count = 0): void {
    if (!this.hitCounts) {
      this.hitCounts = new Map();
    }
    this.hitCounts.set(id, count);
  }

  public getHitCount(id: string): number | undefined {
    return this.hitCounts?.get(id);
  }

  public get hitCount(): number | undefined {
    if (this.hitCounts === undefined) {
      return undefined;
    }
    if (this.hitCounts.size !== 1) {
      throw new Error('Cannot get hit count, size of the map was not equal to 1');
    }
    return this.hitCounts.values().next().value;
  }

  public set hitCounts(value: Map<string, number> | undefined) {
    this.context.hitCounts = value;
  }

  public get hitCounts(): Map<string, number> | undefined {
    return this.context.hitCounts;
  }

  public assignHitLimit(id: string, limit: number | undefined): void {
    this.clearHitLimits();
    if (limit !== undefined) this.addHitLimit(id, limit);
  }

  public clearHitLimits(): void {
    this.hitLimits = undefined;
  }

  public addHitLimit(id: string, limit: number): void {
    if (!this.hitLimits) {
      this.hitLimits = new Map();
    }
    this.hitLimits.set(id, limit);
  }

  public set hitLimits(value: Map<string, number> | undefined) {
    this.context.hitLimits = value;
  }

  public get hitLimits(): Map<string, number> | undefined {
    return this.context.hitLimits;
  }

  public getHitLimit(id: string): number | undefined {
    return this.hitLimits?.get(id);
  }

  public get hitLimit(): number | undefined {
    const limits = this.hitLimits;
    if (limits === undefined) {
      return undefined;
    }
    if (limits.size !== 1) {
      throw new Error('Cannot get hit limit, size of the map was not equal to 1');
    }
    return limits.values().next().value;
  }
}
