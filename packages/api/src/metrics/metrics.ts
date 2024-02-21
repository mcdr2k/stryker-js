/**
 * Metrics:
 *
 * Measure individual duration of mutant
 * Measure total duration of mutant group
 *
 * Measure duration of test sessions. In particular, measure the amount of time required to start a test session.
 * The duration of creating a test session is measured such that the start timestamp is on the first call to simultaneousTesting
 * and the end timestamp is right before the first test is run.
 */
// Stryker disable all

class Measurement {
  private readonly start: number;
  private end: number | undefined = undefined;
  public stack?: string;

  constructor() {
    this.start = Metrics.now();
  }

  public markEnd() {
    if (this.end != undefined) {
      throw new Error('end already marked');
    }
    this.end = Metrics.now();
  }

  public getStart() {
    return this.start;
  }

  public getEnd() {
    return this.end;
  }

  public getElapsedMs() {
    if (this.end == undefined) {
      throw new Error('end not marked');
    }
    return this.end - this.start;
  }
}

export class CheckerAndTestRunnerPoolMetrics {
  private static readonly timedResources: CheckerAndTestRunnerPoolMeasurement[] = [];

  public static timeResource(type: string): Measurement {
    const measurement = new CheckerAndTestRunnerPoolMeasurement(type);
    this.timedResources.push(measurement);
    return measurement;
  }

  public static exportData(): string {
    return JSON.stringify(CheckerAndTestRunnerPoolMetrics.timedResources, null, 2);
  }
}

export class CheckerAndTestRunnerPoolMeasurement extends Measurement {
  private readonly type: string;

  constructor(type: string) {
    super();
    this.type = type;
  }
}

export class MeasuredTestSession extends Measurement {
  public readonly type: SessionType;
  private testRunBeginMs: number | undefined = undefined;

  constructor(type: SessionType) {
    super();
    this.type = type;
  }

  public setTestRunBeginMs(testRunBeginMs: number): void {
    if (this.testRunBeginMs != undefined) {
      throw new Error('Cannot set testRunBeginMs because it was already set.');
    }
    this.testRunBeginMs = testRunBeginMs;
  }
}

class MeasuredFunction extends Measurement {
  public readonly functionName;

  constructor(functionName: string) {
    super();
    this.functionName = functionName;
  }
}

export enum SessionType {
  Initial = 'initial',
  Reload = 'reload',
  Reset = 'reset',
}

export class Metrics {
  private static readonly data = new Map<string, Metrics>();

  public readonly identifier: string;
  //private readonly timer = new Timer();
  private readonly testSessions: MeasuredTestSession[] = [];
  private readonly functionCalls: MeasuredFunction[] = [];

  // eslint-disable-next-line @typescript-eslint/no-empty-function
  private constructor(activeMutant: string) {
    this.identifier = activeMutant;
  }

  public static metricsFor(activeMutant: string): Metrics {
    if (Metrics.data.has(activeMutant)) {
      return Metrics.data.get(activeMutant)!;
    }
    const metrics = new Metrics(activeMutant);
    Metrics.data.set(activeMutant, metrics);
    return metrics;
  }

  public static exportData(data: Map<string, Metrics> = Metrics.data): string {
    return JSON.stringify(Array.from(data.entries()), null, 2);
  }

  public static getData(): Map<string, Metrics> {
    return Metrics.data;
  }

  public static now(): number {
    return Date.now();
  }

  public measureTestSession(type: SessionType): MeasuredTestSession {
    const session = new MeasuredTestSession(type);
    this.testSessions.push(session);
    return session;
  }

  public getRunningTestSession(): MeasuredTestSession {
    if (this.testSessions.length === 0) throw new Error('Cannot get test session, none were started yet.');
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
    const measurement = new MeasuredFunction(Metrics.createQualifiedName(firstQualifiedName, specification));
    // measurement.stack = new Error().stack;
    this.functionCalls.push(measurement);
    try {
      const result = func();
      return result;
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
    const measurement = new MeasuredFunction(Metrics.createQualifiedName(firstQualifiedName, specification));
    // measurement.stack = new Error().stack;
    this.functionCalls.push(measurement);
    try {
      const result = await func();
      return result;
    } finally {
      measurement.markEnd();
    }
  }

  private static createQualifiedName(firstQualifiedName: string, specification: string[] = []): string {
    if (specification.length === 0) return firstQualifiedName;
    return firstQualifiedName + '#' + specification.join('#');
  }
}
// Stryker restore all
