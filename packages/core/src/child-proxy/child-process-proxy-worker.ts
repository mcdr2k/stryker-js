import path from 'path';
import { fileURLToPath } from 'url';

import { errorToString } from '@stryker-mutator/util';
import log4js from 'log4js';
import { createInjector } from 'typed-inject';
import { commonTokens, PluginContext, Injector } from '@stryker-mutator/api/plugin';

import { MutantRunResult, TestResult, TestStatus } from '@stryker-mutator/api/test-runner';

import { LogConfigurator } from '../logging/index.js';
import { deserialize, serialize } from '../utils/string-utils.js';
import { coreTokens, provideLogger, PluginCreator } from '../di/index.js';
import { PluginLoader } from '../di/plugin-loader.js';

import {
  CallMessage,
  ParentMessage,
  ParentMessageKind,
  WorkerMessage,
  WorkerMessageKind,
  InitMessage,
  StartedTestUpdate,
  TestUpdateType,
  FinishedTestUpdate,
  TestResultTestUpdate,
  TestUpdateMessage,
  MutantResultUpdate,
  TestStartedUpdate,
} from './message-protocol.js';

export interface ChildProcessContext extends PluginContext {
  [coreTokens.pluginCreator]: PluginCreator;
}

export class ChildProcessProxyWorker {
  private log?: log4js.Logger;

  public realSubject: any;

  constructor(private readonly injectorFactory: typeof createInjector) {
    // Make sure to bind the methods in order to ensure the `this` pointer
    this.handleMessage = this.handleMessage.bind(this);

    // Start listening before sending the spawned message
    process.on('message', this.handleMessage);
    this.send({ kind: ParentMessageKind.Ready });
  }

  private send(value: ParentMessage) {
    if (process.send) {
      const str = serialize(value);
      if (this.log?.isTraceEnabled()) {
        this.log.trace(`Sending message to parent: ${str}.`);
      }
      process.send(str, undefined, { swallowErrors: false }, (error) => {
        if (error) this.log?.error(`Error sending message: ${JSON.stringify(error)}.`);
      });
    }
  }
  private handleMessage(serializedMessage: unknown) {
    const message = deserialize<WorkerMessage>(String(serializedMessage));
    switch (message.kind) {
      case WorkerMessageKind.Init:
        // eslint-disable-next-line @typescript-eslint/no-floating-promises -- No handle needed, handleInit has try catch
        this.handleInit(message);
        this.removeAnyAdditionalMessageListeners(this.handleMessage);
        break;
      case WorkerMessageKind.Call:
        // eslint-disable-next-line @typescript-eslint/no-floating-promises -- No handle needed, handleCall has try catch
        this.handleCall(message);
        this.removeAnyAdditionalMessageListeners(this.handleMessage);
        break;
      case WorkerMessageKind.Dispose:
        const sendCompleted = () => {
          this.send({ kind: ParentMessageKind.DisposeCompleted });
        };
        LogConfigurator.shutdown().then(sendCompleted).catch(sendCompleted);
        break;
    }
  }

  private async handleInit(message: InitMessage) {
    try {
      LogConfigurator.configureChildProcess(message.loggingContext);
      this.log = log4js.getLogger(ChildProcessProxyWorker.name);
      this.handlePromiseRejections();

      // Load plugins in the child process
      const pluginInjector = provideLogger(this.injectorFactory())
        .provideValue(commonTokens.options, message.options)
        .provideValue(commonTokens.fileDescriptions, message.fileDescriptions);
      const pluginLoader = pluginInjector.injectClass(PluginLoader);
      const { pluginsByKind } = await pluginLoader.load(message.pluginModulePaths);
      const injector: Injector<ChildProcessContext> = pluginInjector
        .provideValue(coreTokens.pluginsByKind, pluginsByKind)
        .provideClass(coreTokens.pluginCreator, PluginCreator);

      const childModule = await import(message.modulePath);
      const RealSubjectClass = childModule[message.namedExport];
      const workingDir = path.resolve(message.workingDirectory);
      if (process.cwd() !== workingDir) {
        this.log.debug(`Changing current working directory for this process to ${workingDir}`);
        process.chdir(workingDir);
      }
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
      this.realSubject = injector.injectClass(RealSubjectClass);
      this.realSubject.parentWorker = this; // todo: verify
      this.send({ kind: ParentMessageKind.Initialized });
    } catch (err) {
      this.send({
        error: errorToString(err),
        kind: ParentMessageKind.InitError,
      });
    }
  }

  private async handleCall(message: CallMessage) {
    try {
      const result = await this.doCall(message);
      this.send({
        correlationId: message.correlationId,
        kind: ParentMessageKind.CallResult,
        result,
      });
    } catch (err) {
      this.send({
        correlationId: message.correlationId,
        error: errorToString(err),
        kind: ParentMessageKind.CallRejection,
      });
    }
  }

  private doCall(message: CallMessage): PromiseLike<Record<string, unknown>> | Record<string, unknown> | undefined {
    if (typeof this.realSubject[message.methodName] === 'function') {
      return this.realSubject[message.methodName](...message.args);
    } else {
      return this.realSubject[message.methodName];
    }
  }

  /**
   * Remove any addition message listeners that might me eavesdropping.
   * the @ngtools/webpack plugin listens to messages and throws an error whenever it could not handle a message
   * @see https://github.com/angular/angular-cli/blob/f776d3cf7982b64734c57fe4407434e9f4ec09f7/packages/%40ngtools/webpack/src/type_checker.ts#L79
   * @param exceptListener The listener that should remain
   */
  private removeAnyAdditionalMessageListeners(exceptListener: NodeJS.MessageListener) {
    process.listeners('message').forEach((listener) => {
      if (listener !== exceptListener) {
        this.log?.debug(
          "Removing an additional message listener, we don't want eavesdropping on our inter-process communication: %s",
          listener.toString(),
        );
        process.removeListener('message', listener);
      }
    });
  }

  /**
   * During mutation testing, it's to be expected that promise rejections are not handled synchronously anymore (or not at all)
   * Let's handle those events so future versions of node don't crash
   * See issue 350: https://github.com/stryker-mutator/stryker-js/issues/350
   */
  private handlePromiseRejections() {
    const unhandledRejections: Array<Promise<unknown>> = [];
    process.on('unhandledRejection', (reason, promise) => {
      const unhandledPromiseId = unhandledRejections.push(promise);
      this.log?.debug(`UnhandledPromiseRejectionWarning: Unhandled promise rejection (rejection id: ${unhandledPromiseId}): ${reason}`);
      // todo: remove
      if (this.log?.isTraceEnabled()) {
        this.log?.trace(
          `UnhandledPromiseRejectionWarning: Unhandled promise rejection (rejection id: ${unhandledPromiseId}): ${JSON.stringify(reason)}`,
        );
      }
    });
    process.on('rejectionHandled', (promise) => {
      const unhandledPromiseId = unhandledRejections.indexOf(promise) + 1;
      this.log?.debug(`PromiseRejectionHandledWarning: Promise rejection was handled asynchronously (rejection id: ${unhandledPromiseId})`);
    });
  }

  private updates = 0;
  // Stryker disable all
  public testRunStarted(): void {
    const update: StartedTestUpdate = {
      type: TestUpdateType.Started,
      testRunStartedMs: Date.now(),
    };
    const message: TestUpdateMessage = {
      kind: ParentMessageKind.Custom,
      update,
    };
    (message as any).updates = this.updates++;
    if (this.log?.isTraceEnabled()) {
      this.log.trace(`Sending test run started update: ${JSON.stringify(update)}.`);
    }
    try {
      this.send(message);
    } catch (e) {
      this.log?.error(`Error occurred in testRunStarted: ${JSON.stringify(e)}`);
    }
  }

  public reportTestResult(testResult: TestResult): void {
    // do not really care about skipped tests, at least for now...
    if (testResult.status === TestStatus.Skipped) return;
    const update: TestResultTestUpdate = {
      type: TestUpdateType.TestResult,
      testResult,
    };
    const message: TestUpdateMessage = {
      kind: ParentMessageKind.Custom,
      update,
    };
    (message as any).updates = this.updates++;
    if (this.log?.isTraceEnabled()) {
      this.log.trace(`Sending test result update: ${JSON.stringify(update)}.`);
    }
    try {
      this.send(message);
    } catch (e) {
      this.log?.error(`Error occurred in reportTestResult: ${JSON.stringify(e)}`);
    }
  }

  public reportMutantResult(mutantId: string, result: MutantRunResult): void {
    const update: MutantResultUpdate = {
      type: TestUpdateType.MutantResult,
      mutantId,
      mutantResult: result,
    };
    const message: TestUpdateMessage = {
      kind: ParentMessageKind.Custom,
      update,
    };
    (message as any).updates = this.updates++;
    if (this.log?.isTraceEnabled()) {
      this.log?.trace(`Sending mutant result update: ${JSON.stringify(update)}`);
    }
    try {
      this.send(message);
    } catch (e) {
      this.log?.error(`Error occurred in reportMutantResult: ${JSON.stringify(e)}`);
    }
  }

  public startTest(testId: string): void {
    const update: TestStartedUpdate = {
      type: TestUpdateType.TestStarted,
      test: testId,
    };
    const message: TestUpdateMessage = {
      kind: ParentMessageKind.Custom,
      update,
    };
    (message as any).updates = this.updates++;
    if (this.log?.isTraceEnabled()) {
      this.log.trace(`Sending pending test update: ${JSON.stringify(update)}.`);
    }
    try {
      this.send(message);
    } catch (e) {
      this.log?.error(`Error occurred in startTest: ${JSON.stringify(e)}`);
    }
  }

  public testRunFinished(): void {
    const update: FinishedTestUpdate = {
      type: TestUpdateType.Finished,
      testRunFinishedMs: Date.now(),
    };
    const message: TestUpdateMessage = {
      kind: ParentMessageKind.Custom,
      update,
    };
    (message as any).updates = this.updates++;
    if (this.log?.isTraceEnabled()) {
      this.log.trace(`Sending test run finished update: ${JSON.stringify(update)}.`);
    }
    try {
      this.send(message);
    } catch (e) {
      this.log?.error(`Error occurred in testRunFinished: ${JSON.stringify(e)}`);
    }
  }
}
// Stryker restore all

// Prevent side effects for merely importing the file
// Only actually start the child worker when it is requested
// Stryker disable all
if (fileURLToPath(import.meta.url) === process.argv[1]) {
  new ChildProcessProxyWorker(createInjector);
}
// Stryker restore all
