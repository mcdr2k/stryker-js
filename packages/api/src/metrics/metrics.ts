// Stryker disable all

export interface Measurement {
  readonly start: number;
  readonly end: number | undefined;
  readonly elapsedMs: number;
  markEnd(errorIfAlreadyMarked?: boolean): void;
}

class RealMeasurement implements Measurement {
  private readonly _start: number;
  private _end: number | undefined = undefined;
  public stack?: string;

  constructor() {
    this._start = Metrics.now();
  }

  public markEnd(errorIfAlreadyMarked = true): void {
    if (this._end != undefined) {
      if (errorIfAlreadyMarked) throw new Error('end already marked');
      return;
    }
    this._end = Metrics.now();
  }

  public get start(): number {
    return this._start;
  }

  public get end(): number | undefined {
    return this._end;
  }

  public get elapsedMs(): number {
    if (this._end == undefined) {
      throw new Error('end not marked');
    }
    return this._end - this.start;
  }
}

class DummyMeasurement implements Measurement {
  public readonly start = 0;
  public readonly end = 0;
  public readonly elapsedMs = 0;
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  public markEnd(_errorIfAlreadyMarked?: boolean): void {}
}

export interface FunctionMeasurement extends Measurement {
  readonly functionIdentifier: string;
}

class DummyFunctionMeasurement extends DummyMeasurement {
  constructor(public readonly functionIdentifier = '__DUMMY__') {
    super();
  }
}

class RealFunctionMeasurement extends RealMeasurement implements FunctionMeasurement {
  constructor(public readonly functionIdentifier: string) {
    super();
  }
}

export interface MeasuredTestSession extends Measurement {
  setTestRunBeginMs(testRunBeginMs: number): void;
  setStartFormulateResult(startFormulateResult: number): void;
  setEndFormulateResult(endFormulateResult: number): void;
}

class RealMeasuredTestSession extends RealMeasurement implements MeasuredTestSession {
  private testRunBeginMs: number | undefined = undefined;
  private startFormulateResult: number | undefined = undefined;
  private endFormulateResult: number | undefined = undefined;

  constructor(public readonly type: SessionType) {
    super();
  }

  public setTestRunBeginMs(testRunBeginMs: number): void {
    if (this.testRunBeginMs != undefined) {
      throw new Error('Cannot set testRunBeginMs because it was already set.');
    }
    this.testRunBeginMs = testRunBeginMs;
  }

  public setStartFormulateResult(startFormulateResult: number): void {
    if (this.startFormulateResult != undefined) {
      throw new Error('Cannot set startFormulateResult because it was already set.');
    }
    this.startFormulateResult = startFormulateResult;
  }

  public setEndFormulateResult(endFormulateResult: number): void {
    if (this.endFormulateResult != undefined) {
      throw new Error('Cannot set endFormulateResult because it was already set.');
    }
    this.endFormulateResult = endFormulateResult;
  }
}

class DummyMeasuredTestSession extends DummyMeasurement implements MeasuredTestSession {
  private readonly testRunBeginMs: number | undefined = undefined;

  constructor(public readonly type = SessionType.Reset) {
    super();
  }

  // eslint-disable-next-line @typescript-eslint/no-empty-function
  public setTestRunBeginMs(_testRunBeginMs: number): void {}
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  public setStartFormulateResult(startFormulateResult: number): void {}
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  public setEndFormulateResult(endFormulateResult: number): void {}
}

export enum SessionType {
  Initial = 'initial',
  Reload = 'reload',
  Reset = 'reset',
}

export interface MutantMetrics {
  measureTestSession(type: SessionType): MeasuredTestSession;
  getRunningTestSession(): MeasuredTestSession;
  getFunctionCallCount(): number;
  timeFunction<T>(func: () => T, firstQualifiedName: string, ...specification: string[]): T;
  timeAwaitedFunction<T>(func: () => Promise<T>, firstQualifiedName: string, ...specification: string[]): Promise<T>;
}

class DummyMutantMetrics implements MutantMetrics {
  public readonly identifier = '__DUMMY__';

  public measureTestSession(_type: SessionType): DummyMeasuredTestSession {
    return DummyMetrics.testSession;
  }

  public getRunningTestSession(): DummyMeasuredTestSession {
    return DummyMetrics.testSession;
  }

  public getFunctionCallCount(): number {
    return 0;
  }

  public timeFunction<T>(func: () => T, _firstQualifiedName: string, ..._specification: string[]): T {
    return func();
  }

  public timeAwaitedFunction<T>(func: () => Promise<T>, _firstQualifiedName: string, ..._specification: string[]): Promise<T> {
    return func();
  }
}

class RealMutantMetrics implements MutantMetrics {
  public readonly identifier;
  private readonly testSessions: RealMeasuredTestSession[] = [];
  private readonly functionCalls: RealFunctionMeasurement[] = [];

  constructor(activeMutant: string) {
    this.identifier = activeMutant;
  }

  public measureTestSession(type: SessionType): RealMeasuredTestSession {
    const session = new RealMeasuredTestSession(type);
    this.testSessions.push(session);
    return session;
  }

  public getRunningTestSession(): RealMeasuredTestSession {
    if (this.testSessions.length === 0) {
      throw new Error('Cannot get test session, none were started yet.');
    }
    return this.testSessions[this.testSessions.length - 1];
  }

  public getFunctionCallCount(): number {
    return this.functionCalls.length;
  }

  /**
   * Measure the time it takes to execute the provided function.
   * @param func The function to execute
   * @returns The function's result
   */
  public timeFunction<T>(func: () => T, firstQualifiedName: string, ...specification: string[]): T {
    const measurement = new RealFunctionMeasurement(Metrics.createQualifiedName(firstQualifiedName, specification));
    // measurement.stack = new Error().stack;
    this.functionCalls.push(measurement);
    try {
      return func();
    } finally {
      measurement.markEnd();
    }
  }

  /**
   * Measures the time it takes to await for the provided function. Note: due to the synchronous nature of JS, the measured duration
   * will not be accurate.
   * @param func The function to execute
   * @returns The funcion's result
   */
  public async timeAwaitedFunction<T>(func: () => Promise<T>, firstQualifiedName: string, ...specification: string[]): Promise<T> {
    const measurement = new RealFunctionMeasurement(Metrics.createQualifiedName(firstQualifiedName, specification));
    // measurement.stack = new Error().stack;
    this.functionCalls.push(measurement);
    try {
      return await func();
    } finally {
      measurement.markEnd();
    }
  }
}

class DummyMetrics {
  public static readonly mutantMetrics: MutantMetrics = new DummyMutantMetrics();
  public static readonly measurement = new DummyMeasurement();
  public static readonly functionMeasurement = new DummyFunctionMeasurement();
  public static readonly testSession = new DummyMeasuredTestSession();
}

export class Metrics {
  private static _measureMetrics = true;
  private static mutantData = new Map<string, RealMutantMetrics>();
  private static labelledData = new Map<string, Measurement[]>();
  private static functionData: FunctionMeasurement[] = [];

  public static metricsFor(activeMutant: string): MutantMetrics {
    if (!Metrics.measureMetrics) return DummyMetrics.mutantMetrics;

    if (this.mutantData.has(activeMutant)) {
      return this.mutantData.get(activeMutant)!;
    }
    const metrics = new RealMutantMetrics(activeMutant);
    this.mutantData.set(activeMutant, metrics);
    return metrics;
  }

  public static label(label: string): Measurement {
    if (!Metrics.measureMetrics) return DummyMetrics.measurement;

    const measurement = new RealMeasurement();
    const data = this.labelledData.get(label) ?? [];
    this.labelledData.set(label, data);
    data.push(measurement);
    return measurement;
  }

  public static measureFunction(firstQualifiedName: string, ...specification: string[]): FunctionMeasurement {
    if (!Metrics.measureMetrics) return DummyMetrics.functionMeasurement;

    const qualifiedName = Metrics.createQualifiedName(firstQualifiedName, specification);
    const measurement = new RealFunctionMeasurement(qualifiedName);
    this.functionData.push(measurement);
    return measurement;
  }

  public static get measureMetrics(): boolean {
    return this._measureMetrics;
  }

  public static set measureMetrics(value: boolean) {
    this._measureMetrics = value;
    if (!value) this.clear();
  }

  public static getData(): {
    mutantData: Map<string, RealMutantMetrics>;
    labelledData: Map<string, Measurement[]>;
    functionData: FunctionMeasurement[];
  } {
    return {
      mutantData: this.mutantData,
      labelledData: this.labelledData,
      functionData: this.functionData,
    };
  }

  public static exportData(data = Metrics.getData()): string {
    return JSON.stringify(
      data,
      (_key, value) => {
        if (value instanceof Map) {
          return Array.from(value.entries());
        } else {
          return value;
        }
      },
      2,
    );
  }

  public static now(): number {
    return Date.now();
  }

  public static clear(): void {
    this.mutantData = new Map();
    this.labelledData = new Map();
    this.functionData = [];
  }

  public static createQualifiedName(firstQualifiedName: string, specification: string[] = []): string {
    if (specification.length === 0) return firstQualifiedName;
    return firstQualifiedName + '#' + specification.join('#');
  }
}
// Stryker restore all
