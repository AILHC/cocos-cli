import { accessSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { chromium, type Browser, type ConsoleMessage, type Page } from 'playwright-core';

export interface BrowserConsoleEvidenceOptions {
  url: string;
  runtimeServerOrigin: string;
  readyTimeoutMs?: number;
  stableWindowMs?: number;
  evidenceFilePath?: string;
  evidenceContext?: Record<string, unknown>;
}

export interface BrowserConsoleMessageEvidence {
  type: string;
  text: string;
  location: {
    url: string;
    lineNumber: number;
    columnNumber: number;
  };
}

export interface BrowserRequestFailureEvidence {
  url: string;
  method: string;
  errorText: string;
}

export interface BrowserBadResponseEvidence {
  url: string;
  status: number;
  statusText: string;
}

export interface BrowserConsoleEvidence {
  url: string;
  runtimeServerOrigin: string;
  ready: unknown;
  readyTimedOut: boolean;
  elapsedReadyMs: number;
  elapsedTotalMs: number;
  consoleMessages: BrowserConsoleMessageEvidence[];
  pageErrors: string[];
  failedRequests: BrowserRequestFailureEvidence[];
  badResponses: BrowserBadResponseEvidence[];
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
      // Try next Chromium-compatible browser candidate.
    }
  }

  throw new Error('No Chrome/Edge executable found. Set COCOS_CLI_TEST_BROWSER to a Chromium-compatible browser.');
}

function isRuntimeServerUrl(url: string, runtimeServerOrigin: string): boolean {
  try {
    return new URL(url).origin === runtimeServerOrigin;
  } catch {
    return false;
  }
}

function serializeConsoleMessage(message: ConsoleMessage): BrowserConsoleMessageEvidence {
  const location = message.location();
  return {
    type: message.type(),
    text: message.text(),
    location: {
      url: location.url,
      lineNumber: location.lineNumber,
      columnNumber: location.columnNumber,
    },
  };
}

async function waitForReady(page: Page, timeoutMs: number): Promise<{ ready: unknown; timedOut: boolean; elapsedMs: number }> {
  const startedAt = Date.now();
  try {
    await page.waitForFunction(() => Boolean((window as any).__RUNTIME_PREVIEW_READY), undefined, {
      timeout: timeoutMs,
    });
    const ready = await page.evaluate(() => (window as any).__RUNTIME_PREVIEW_READY);
    return {
      ready,
      timedOut: false,
      elapsedMs: Date.now() - startedAt,
    };
  } catch (error) {
    if (error instanceof Error && error.message.includes('Timeout')) {
      return {
        ready: null,
        timedOut: true,
        elapsedMs: Date.now() - startedAt,
      };
    }
    throw error;
  }
}

async function writeEvidence(filePath: string | undefined, evidence: BrowserConsoleEvidence, context?: Record<string, unknown>): Promise<void> {
  if (!filePath) {
    return;
  }
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify({
    ...context,
    ...evidence,
  }, null, 2)}\n`, 'utf8');
}

export async function collectBrowserConsoleEvidence(options: BrowserConsoleEvidenceOptions): Promise<BrowserConsoleEvidence> {
  const readyTimeoutMs = options.readyTimeoutMs ?? 120_000;
  const stableWindowMs = options.stableWindowMs ?? 10_000;
  const startedAt = Date.now();
  let browser: Browser | null = null;
  const consoleMessages: BrowserConsoleMessageEvidence[] = [];
  const pageErrors: string[] = [];
  const failedRequests: BrowserRequestFailureEvidence[] = [];
  const badResponses: BrowserBadResponseEvidence[] = [];

  try {
    browser = await chromium.launch({
      executablePath: findBrowserExecutable(),
      headless: true,
    });
    const page = await browser.newPage({
      viewport: { width: 1280, height: 720 },
    });

    page.on('console', (message) => {
      if (message.type() === 'error' || message.type() === 'warning') {
        consoleMessages.push(serializeConsoleMessage(message));
      }
    });
    page.on('pageerror', (error) => {
      pageErrors.push(String(error.stack || error.message || error));
    });
    page.on('requestfailed', (request) => {
      if (!isRuntimeServerUrl(request.url(), options.runtimeServerOrigin)) {
        return;
      }
      failedRequests.push({
        url: request.url(),
        method: request.method(),
        errorText: request.failure()?.errorText ?? '',
      });
    });
    page.on('response', (response) => {
      if (!isRuntimeServerUrl(response.url(), options.runtimeServerOrigin) || response.status() < 400) {
        return;
      }
      badResponses.push({
        url: response.url(),
        status: response.status(),
        statusText: response.statusText(),
      });
    });

    await page.goto(options.url, { waitUntil: 'domcontentloaded', timeout: readyTimeoutMs });
    const ready = await waitForReady(page, readyTimeoutMs);
    await page.waitForTimeout(stableWindowMs);

    const evidence: BrowserConsoleEvidence = {
      url: options.url,
      runtimeServerOrigin: options.runtimeServerOrigin,
      ready: ready.ready,
      readyTimedOut: ready.timedOut,
      elapsedReadyMs: ready.elapsedMs,
      elapsedTotalMs: Date.now() - startedAt,
      consoleMessages,
      pageErrors,
      failedRequests,
      badResponses,
    };
    await writeEvidence(options.evidenceFilePath, evidence, options.evidenceContext);
    return evidence;
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
  }
}
