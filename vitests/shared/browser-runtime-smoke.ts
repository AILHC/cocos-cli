import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { accessSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import WebSocket from 'ws';

export interface BrowserRuntimeSmokeOptions {
  url: string;
  runtimeServerOrigin: string;
  sceneSelectTarget?: string;
  readyTimeoutMs?: number;
  stableWindowMs?: number;
  evidenceFilePath?: string;
  evidenceContext?: Record<string, unknown>;
}

export interface BrowserRuntimeSmokeResult {
  ready: unknown;
  initialReady?: unknown;
  elapsedReadyMs: number;
  elapsedTotalMs: number;
  networkRequestCount: number;
  consoleErrors: BrowserConsoleMessage[];
  unhandledRejections: string[];
  pageErrors: string[];
  failedRequests: BrowserNetworkFailure[];
  badResponses: BrowserNetworkResponse[];
}

interface BrowserConsoleMessage {
  type: string;
  text: string;
}

interface BrowserNetworkFailure {
  url: string;
  errorText: string;
}

interface BrowserNetworkResponse {
  url: string;
  status: number;
}

interface DevtoolsPage {
  webSocketDebuggerUrl: string;
}

type CdpEventHandler = (params: any) => void;

const UNHANDLED_REJECTION_PREFIX = '[runtime-preview-unhandledrejection]';

const unhandledRejectionListenerSource = `
(() => {
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    const text = reason && (reason.stack || reason.message)
      ? String(reason.stack || reason.message)
      : String(reason);
    console.error('${UNHANDLED_REJECTION_PREFIX} ' + text);
  });
})();
`;

class CdpSession {
  private nextId = 1;
  private pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>();
  private handlers = new Map<string, CdpEventHandler[]>();

  constructor(private readonly socket: WebSocket) {
    socket.on('message', (data) => {
      const message = JSON.parse(String(data));
      if (typeof message.id === 'number') {
        const pending = this.pending.get(message.id);
        if (!pending) {
          return;
        }
        this.pending.delete(message.id);
        if (message.error) {
          pending.reject(new Error(message.error.message ?? JSON.stringify(message.error)));
        } else {
          pending.resolve(message.result);
        }
        return;
      }

      if (typeof message.method === 'string') {
        for (const handler of this.handlers.get(message.method) ?? []) {
          handler(message.params);
        }
      }
    });
  }

  static connect(url: string): Promise<CdpSession> {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(url);
      socket.once('open', () => resolve(new CdpSession(socket)));
      socket.once('error', reject);
    });
  }

  on(method: string, handler: CdpEventHandler): void {
    const handlers = this.handlers.get(method) ?? [];
    handlers.push(handler);
    this.handlers.set(method, handlers);
  }

  send(method: string, params: Record<string, unknown> = {}): Promise<any> {
    const id = this.nextId++;
    this.socket.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
  }

  close(): Promise<void> {
    return new Promise((resolve) => {
      this.socket.once('close', () => resolve());
      this.socket.close();
    });
  }
}

function findBrowserExecutable(): string {
  const candidates = [
    process.env.COCOS_CLI_TEST_BROWSER,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files/Google/Chrome Dev/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  ].filter((value): value is string => Boolean(value));

  for (const candidate of candidates) {
    try {
      accessSync(candidate);
      return candidate;
    } catch {
      // Try next locally installed browser candidate.
    }
  }

  throw new Error(`No Chrome/Edge executable found. Set COCOS_CLI_TEST_BROWSER to a Chromium-compatible browser.`);
}

function waitForBrowserExit(browser: ChildProcessWithoutNullStreams): Promise<void> {
  return new Promise((resolve) => {
    if (browser.exitCode !== null || browser.killed) {
      resolve();
      return;
    }

    browser.once('exit', () => resolve());
    browser.kill();
    setTimeout(() => {
      if (browser.exitCode === null) {
        browser.kill('SIGKILL');
      }
      resolve();
    }, 2_000).unref();
  });
}

async function waitForDevtoolsPort(userDataDir: string, timeoutMs: number): Promise<number> {
  const devtoolsActivePortPath = join(userDataDir, 'DevToolsActivePort');
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const source = await readFile(devtoolsActivePortPath, 'utf8');
      const port = Number(source.split(/\r?\n/, 1)[0]);
      if (Number.isInteger(port) && port > 0) {
        const response = await fetch(`http://127.0.0.1:${port}/json/version`);
        if (response.status === 200) {
          return port;
        }
      }
    } catch {
      // Browser process is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error(`Timed out waiting for browser DevTools active port in ${userDataDir}.`);
}

async function createDevtoolsPage(port: number): Promise<DevtoolsPage> {
  const response = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' });
  if (response.status !== 200) {
    throw new Error(`Unable to create DevTools page: HTTP ${response.status} ${await response.text()}`);
  }
  return await response.json() as DevtoolsPage;
}

function launchBrowser(executable: string, userDataDir: string): ChildProcessWithoutNullStreams {
  return spawn(executable, [
    '--headless=new',
    '--remote-debugging-port=0',
    `--user-data-dir=${userDataDir}`,
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    'about:blank',
  ], { stdio: 'pipe' });
}

function consoleText(params: any): string {
  return (params.args ?? [])
    .map((arg: any) => String(arg.value ?? arg.description ?? ''))
    .filter(Boolean)
    .join(' ');
}

function formatExceptionDetails(params: any): string {
  const details = params.exceptionDetails ?? params;
  const exception = details.exception ?? {};
  const stackFrames = details.stackTrace?.callFrames ?? exception.stackTrace?.callFrames ?? [];
  const stack = stackFrames
    .map((frame: any) => {
      const functionName = frame.functionName || '<anonymous>';
      const url = frame.url || '';
      const line = typeof frame.lineNumber === 'number' ? frame.lineNumber + 1 : '';
      const column = typeof frame.columnNumber === 'number' ? frame.columnNumber + 1 : '';
      return `${functionName} ${url}:${line}:${column}`.trim();
    })
    .filter(Boolean)
    .join('\n');
  return [
    details.text,
    exception.description,
    exception.value,
    stack,
  ].filter((value) => typeof value === 'string' && value.length > 0).join('\n');
}

function isRuntimeServerUrl(url: string, runtimeServerOrigin: string): boolean {
  try {
    return new URL(url).origin === runtimeServerOrigin;
  } catch {
    return false;
  }
}

async function waitForReadySignal(session: CdpSession, timeoutMs: number): Promise<{ ready: unknown; elapsedMs: number }> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const result = await session.send('Runtime.evaluate', {
      expression: 'window.__RUNTIME_PREVIEW_READY || null',
      returnByValue: true,
      awaitPromise: false,
    });
    if (result.result?.value) {
      return {
        ready: result.result.value,
        elapsedMs: Date.now() - startedAt,
      };
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error(`fail-timeout: window.__RUNTIME_PREVIEW_READY was not set within ${timeoutMs}ms.`);
}

async function waitForSceneSelectOption(session: CdpSession, sceneUuid: string, timeoutMs: number): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const result = await session.send('Runtime.evaluate', {
      expression: `Boolean(Array.from(document.querySelector('#scene-select')?.options || []).some((option) => option.value === ${JSON.stringify(sceneUuid)}))`,
      returnByValue: true,
      awaitPromise: false,
    });
    if (result.result?.value) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error(`fail-timeout: scene selector did not expose ${sceneUuid} within ${timeoutMs}ms.`);
}

async function selectSceneAndWaitForReady(
  session: CdpSession,
  sceneUuid: string,
  timeoutMs: number,
): Promise<{ initialReady: unknown; ready: unknown; elapsedMs: number }> {
  const initialReady = await waitForReadySignal(session, timeoutMs);
  await waitForSceneSelectOption(session, sceneUuid, timeoutMs);
  await session.send('Runtime.evaluate', {
    expression: `
      window.__RUNTIME_PREVIEW_READY = null;
      {
        const selector = document.querySelector('#scene-select');
        selector.value = ${JSON.stringify(sceneUuid)};
        selector.dispatchEvent(new Event('change', { bubbles: true }));
      }
    `,
    returnByValue: true,
    awaitPromise: false,
  });
  const selectedReady = await waitForReadySignal(session, timeoutMs);
  return {
    initialReady: initialReady.ready,
    ready: selectedReady.ready,
    elapsedMs: initialReady.elapsedMs + selectedReady.elapsedMs,
  };
}

function failureCategory(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const match = /^([a-z-]+):/.exec(message);
  return match?.[1] ?? 'fail-unknown';
}

function classifyPreReadyFailure(
  fallbackMessage: string,
  evidence: {
    consoleErrors: BrowserConsoleMessage[];
    unhandledRejections: string[];
    pageErrors: string[];
    failedRequests: BrowserNetworkFailure[];
    badResponses: BrowserNetworkResponse[];
  },
): Error {
  const failedUrls = [
    ...evidence.failedRequests.map((entry) => entry.url),
    ...evidence.badResponses.map((entry) => entry.url),
  ];
  if (failedUrls.some((url) => {
    try {
      return new URL(url).pathname === '/settings.js';
    } catch {
      return false;
    }
  })) {
    return new Error(`fail-settings: ${fallbackMessage}`);
  }
  if (failedUrls.length > 0) {
    return new Error(`fail-route-contract: ${fallbackMessage}`);
  }
  if (evidence.pageErrors.length > 0) {
    return new Error(`fail-browser-host-boundary: ${fallbackMessage}`);
  }
  if (evidence.unhandledRejections.length > 0) {
    return new Error(`fail-browser-host-boundary: ${fallbackMessage}`);
  }
  if (evidence.consoleErrors.length > 0) {
    return new Error(`fail-engine-adaptation: ${fallbackMessage}`);
  }
  return new Error(`fail-timeout: ${fallbackMessage}`);
}

async function writeSmokeEvidence(
  filePath: string | undefined,
  payload: Record<string, unknown>,
): Promise<void> {
  if (!filePath) {
    return;
  }

  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

export async function runBrowserRuntimeSmoke(options: BrowserRuntimeSmokeOptions): Promise<BrowserRuntimeSmokeResult> {
  const readyTimeoutMs = options.readyTimeoutMs ?? 60_000;
  const stableWindowMs = options.stableWindowMs ?? 5_000;
  const browserExecutable = findBrowserExecutable();
  const userDataDir = await mkdtemp(join(tmpdir(), 'cocos-runtime-preview-browser-'));
  const browser = launchBrowser(browserExecutable, userDataDir);
  const startedAt = Date.now();
  let session: CdpSession | null = null;

  const consoleErrors: BrowserConsoleMessage[] = [];
  const unhandledRejections: string[] = [];
  const pageErrors: string[] = [];
  const failedRequests: BrowserNetworkFailure[] = [];
  const badResponses: BrowserNetworkResponse[] = [];
  const requestUrls = new Map<string, string>();
  let networkRequestCount = 0;

  try {
    const debuggingPort = await waitForDevtoolsPort(userDataDir, 10_000);
    const page = await createDevtoolsPage(debuggingPort);
    session = await CdpSession.connect(page.webSocketDebuggerUrl);

    session.on('Runtime.consoleAPICalled', (params) => {
      if (params.type === 'error') {
        const text = consoleText(params);
        if (text.includes(UNHANDLED_REJECTION_PREFIX)) {
          unhandledRejections.push(text);
        } else {
          consoleErrors.push({ type: params.type, text });
        }
      }
    });
    session.on('Runtime.exceptionThrown', (params) => {
      pageErrors.push(formatExceptionDetails(params) || JSON.stringify(params.exceptionDetails ?? params));
    });
    session.on('Network.requestWillBeSent', (params) => {
      const url = params.request?.url ?? '';
      if (typeof params.requestId === 'string' && url) {
        requestUrls.set(params.requestId, url);
      }
      if (isRuntimeServerUrl(url, options.runtimeServerOrigin)) {
        networkRequestCount += 1;
      }
    });
    session.on('Network.loadingFailed', (params) => {
      const url = requestUrls.get(params.requestId) ?? '';
      if (isRuntimeServerUrl(url, options.runtimeServerOrigin)) {
        failedRequests.push({
          url,
          errorText: params.errorText ?? '',
        });
      }
    });
    session.on('Network.responseReceived', (params) => {
      const url = params.response?.url ?? '';
      const status = Number(params.response?.status ?? 0);
      if (isRuntimeServerUrl(url, options.runtimeServerOrigin) && status >= 400) {
        badResponses.push({ url, status });
      }
    });

    await Promise.all([
      session.send('Runtime.enable'),
      session.send('Log.enable'),
      session.send('Network.enable'),
      session.send('Page.enable'),
    ]);
    await session.send('Page.addScriptToEvaluateOnNewDocument', {
      source: unhandledRejectionListenerSource,
    });
    await session.send('Page.navigate', { url: options.url });

    let ready: { ready: unknown; initialReady?: unknown; elapsedMs: number };
    try {
      ready = options.sceneSelectTarget
        ? await selectSceneAndWaitForReady(session, options.sceneSelectTarget, readyTimeoutMs)
        : await waitForReadySignal(session, readyTimeoutMs);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw classifyPreReadyFailure(`${message}\n${JSON.stringify({
        consoleErrors,
        unhandledRejections,
        pageErrors,
        failedRequests,
        badResponses,
        networkRequestCount,
      }, null, 2)}`, {
        consoleErrors,
        unhandledRejections,
        pageErrors,
        failedRequests,
        badResponses,
      });
    }
    await new Promise((resolve) => setTimeout(resolve, stableWindowMs));

    if (pageErrors.length > 0) {
      throw new Error(`fail-browser-host-boundary: page errors: ${pageErrors.join('\n')}`);
    }
    if (unhandledRejections.length > 0) {
      throw new Error(`fail-browser-host-boundary: unhandled rejections: ${unhandledRejections.join('\n')}`);
    }
    if (consoleErrors.length > 0) {
      throw new Error(`fail-engine-adaptation: console errors: ${consoleErrors.map((entry) => entry.text).join('\n')}`);
    }
    if (failedRequests.length > 0) {
      throw new Error(`fail-route-contract: failed requests: ${JSON.stringify(failedRequests)}`);
    }
    if (badResponses.length > 0) {
      throw new Error(`fail-route-contract: bad responses: ${JSON.stringify(badResponses)}`);
    }

    const result = {
      ready: ready.ready,
      initialReady: ready.initialReady,
      elapsedReadyMs: ready.elapsedMs,
      elapsedTotalMs: Date.now() - startedAt,
      networkRequestCount,
      consoleErrors,
      unhandledRejections,
      pageErrors,
      failedRequests,
      badResponses,
    };
    await writeSmokeEvidence(options.evidenceFilePath, {
      status: 'pass',
      url: options.url,
      runtimeServerOrigin: options.runtimeServerOrigin,
      ...options.evidenceContext,
      ready: result.ready,
      initialReady: result.initialReady,
      elapsedReadyMs: result.elapsedReadyMs,
      elapsedTotalMs: result.elapsedTotalMs,
      networkRequestCount,
      consoleErrorCount: consoleErrors.length,
      unhandledRejectionCount: unhandledRejections.length,
      pageErrorCount: pageErrors.length,
      failedRequestCount: failedRequests.length,
      badResponseCount: badResponses.length,
    });

    return result;
  } catch (error) {
    const failureMessage = error instanceof Error ? error.message : String(error);
    await writeSmokeEvidence(options.evidenceFilePath, {
      status: 'fail',
      failureCategory: failureCategory(error),
      failureMessage,
      evidenceFilePath: options.evidenceFilePath,
      url: options.url,
      runtimeServerOrigin: options.runtimeServerOrigin,
      ...options.evidenceContext,
      elapsedTotalMs: Date.now() - startedAt,
      networkRequestCount,
      consoleErrors,
      unhandledRejections,
      pageErrors,
      failedRequests,
      badResponses,
    });
    if (options.evidenceFilePath) {
      throw new Error(`${failureMessage}\nevidenceFilePath=${options.evidenceFilePath}`);
    }
    throw error;
  } finally {
    if (session) {
      await session.close().catch(() => {});
    }
    await waitForBrowserExit(browser);
    await rm(userDataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(() => {});
  }
}
