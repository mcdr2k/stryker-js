import { FileDescriptions, StrykerOptions } from '@stryker-mutator/api/core';

import { MutantRunResult, TestResult } from '@stryker-mutator/api/test-runner';

import { LoggingClientContext } from '../logging/index.js';

export enum WorkerMessageKind {
  Init,
  Call,
  Dispose,
}

export enum ParentMessageKind {
  /**
   * Indicates that the child process is spawned and ready to receive messages
   */
  Ready,
  /**
   * Indicates that initialization is done
   */
  Initialized,
  /**
   * Indicates an error happened during initialization
   */
  InitError,
  /**
   * Indicates that a 'Call' was successful
   */
  CallResult,
  /**
   * Indicates that a 'Call' was rejected
   */
  CallRejection,
  /**
   * Indicates that a 'Dispose' was completed
   */
  DisposeCompleted,
  /**
   * Indicates that a custom message was sent, which requires a unique way of handling.
   */
  Custom,
}

export type WorkerMessage = CallMessage | DisposeMessage | InitMessage;
export type ParentMessage =
  | CustomMessage
  | InitRejectionResult
  | RejectionResult
  | WorkResult
  | { kind: ParentMessageKind.DisposeCompleted | ParentMessageKind.Initialized | ParentMessageKind.Ready };

export interface InitMessage {
  kind: WorkerMessageKind.Init;
  loggingContext: LoggingClientContext;
  options: StrykerOptions;
  fileDescriptions: FileDescriptions;
  pluginModulePaths: readonly string[];
  workingDirectory: string;
  namedExport: string;
  modulePath: string;
}

export interface DisposeMessage {
  kind: WorkerMessageKind.Dispose;
}

export interface WorkResult {
  kind: ParentMessageKind.CallResult;
  correlationId: number;
  result: any;
}

export interface RejectionResult {
  kind: ParentMessageKind.CallRejection;
  correlationId: number;
  error: string;
}

export interface InitRejectionResult {
  kind: ParentMessageKind.InitError;
  error: string;
}

export interface CallMessage {
  correlationId: number;
  kind: WorkerMessageKind.Call;
  args: any[];
  methodName: string;
}

export interface CustomMessage {
  kind: ParentMessageKind.Custom;
}

export interface TestUpdateMessage extends CustomMessage {
  update: TestUpdate;
}

export type TestUpdate = MutantResultUpdate | TestResultTestUpdate | TestRunFinishedUpdate | TestRunStartedUpdate | TestStartedUpdate;

export interface TestRunStartedUpdate {
  type: TestUpdateType.Started;
  testRunStartedMs: number;
}

export interface TestRunFinishedUpdate {
  type: TestUpdateType.Finished;
  testRunFinishedMs: number;
}

export interface TestResultTestUpdate {
  type: TestUpdateType.TestResult;
  testResult: TestResult;
}

export interface MutantResultUpdate {
  type: TestUpdateType.MutantResult;
  mutantId: string;
  mutantResult: MutantRunResult;
}

export interface TestStartedUpdate {
  type: TestUpdateType.TestStarted;
  test: string;
}

export function isTestRunStartedUpdate(update: TestUpdate): update is TestRunStartedUpdate {
  return update.type === TestUpdateType.Started;
}

export function isTestResultUpdate(update: TestUpdate): update is TestResultTestUpdate {
  return update.type === TestUpdateType.TestResult;
}

export function isMutantResultUpdate(update: TestUpdate): update is MutantResultUpdate {
  return update.type === TestUpdateType.MutantResult;
}

export function isTestStartedUpdate(update: TestUpdate): update is TestStartedUpdate {
  return update.type === TestUpdateType.TestStarted;
}

export enum TestUpdateType {
  Started = 10,
  // eslint-disable-next-line @typescript-eslint/no-shadow
  TestResult,
  MutantResult,
  TestStarted,
  Finished,
}
