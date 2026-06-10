import { promises as fs } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';

const url = process.env.COCOS_CLI_LISTEN_PREVIEW_URL;
if (!url) {
  throw new Error('Set COCOS_CLI_LISTEN_PREVIEW_URL to the preview URL.');
}

const origin = new URL(url).origin;
const readyTimeoutMs = Number(process.env.COCOS_CLI_LISTEN_READY_TIMEOUT_MS ?? 90_000);
const stableWindowMs = Number(process.env.COCOS_CLI_LISTEN_STABLE_WINDOW_MS ?? 60_000);
const evidenceFile = process.env.COCOS_CLI_LISTEN_EVIDENCE
  ?? path.join(process.cwd(), 'temp', 'runtime-preview-existing-url-browser-evidence.json');

const browserCandidates = [
  process.env.COCOS_CLI_TEST_BROWSER,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files/Google/Chrome Dev/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].filter(Boolean);

let executablePath;
for (const candidate of browserCandidates) {
  try {
    await fs.access(candidate);
    executablePath = candidate;
    break;
  } catch {
    // Try the next Chromium-compatible browser.
  }
}

if (!executablePath) {
  throw new Error('No Chrome/Edge executable found. Set COCOS_CLI_TEST_BROWSER.');
}

function isSameOrigin(value) {
  try {
    return new URL(value).origin === origin;
  } catch {
    return false;
  }
}

function serializeConsoleMessage(message) {
  return {
    type: message.type(),
    text: message.text(),
    location: message.location(),
  };
}

const startedAt = Date.now();
const consoleMessages = [];
const pageErrors = [];
const failedRequests = [];
const badResponses = [];

const browser = await chromium.launch({
  executablePath,
  headless: true,
});

try {
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
    failedRequests.push({
      url: request.url(),
      method: request.method(),
      errorText: request.failure()?.errorText ?? '',
      sameOrigin: isSameOrigin(request.url()),
    });
  });
  page.on('response', (response) => {
    if (response.status() < 400) {
      return;
    }
    badResponses.push({
      url: response.url(),
      status: response.status(),
      statusText: response.statusText(),
      sameOrigin: isSameOrigin(response.url()),
    });
  });

  await page.goto(url, {
    waitUntil: 'domcontentloaded',
    timeout: readyTimeoutMs,
  });

  const readyStartedAt = Date.now();
  let ready = null;
  let readyTimedOut = false;
  try {
    await page.waitForFunction(() => Boolean(window.__RUNTIME_PREVIEW_READY), undefined, {
      timeout: readyTimeoutMs,
    });
    ready = await page.evaluate(() => window.__RUNTIME_PREVIEW_READY);
  } catch (error) {
    if (String(error?.message || error).includes('Timeout')) {
      readyTimedOut = true;
    } else {
      throw error;
    }
  }

  await page.waitForTimeout(stableWindowMs);

  const evidence = {
    url,
    origin,
    executablePath,
    readyTimeoutMs,
    stableWindowMs,
    ready,
    readyTimedOut,
    elapsedReadyMs: Date.now() - readyStartedAt,
    elapsedTotalMs: Date.now() - startedAt,
    consoleMessages,
    pageErrors,
    failedRequests,
    badResponses,
  };

  await fs.mkdir(path.dirname(evidenceFile), { recursive: true });
  await fs.writeFile(evidenceFile, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');

  console.log(JSON.stringify({
    evidenceFile,
    readyTimedOut,
    ready,
    elapsedTotalMs: evidence.elapsedTotalMs,
    consoleMessages: consoleMessages.length,
    pageErrors: pageErrors.length,
    failedRequests: failedRequests.length,
    sameOriginFailedRequests: failedRequests.filter((entry) => entry.sameOrigin).length,
    badResponses: badResponses.length,
    sameOriginBadResponses: badResponses.filter((entry) => entry.sameOrigin).length,
    consoleSample: consoleMessages.slice(0, 10).map((entry) => `[${entry.type}] ${entry.text}`),
    failedRequestSample: failedRequests.filter((entry) => entry.sameOrigin).slice(0, 10),
  }, null, 2));
} finally {
  await browser.close().catch(() => {});
}
