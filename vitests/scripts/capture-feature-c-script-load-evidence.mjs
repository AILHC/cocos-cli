import { promises as fs } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';

const DEFAULT_PREVIEW_URL = 'http://127.0.0.1:19530/?scene=4c721bfe-0b6e-46c2-97f0-644adfdcba31';
const DEFAULT_PROJECT_ROOT = 'D:/ps_copy/p6/trunk/Project/GameClient/feature-c';
const VIEWPORT = { width: 1280, height: 720 };

const previewUrl = process.env.COCOS_CLI_FEATURE_C_PREVIEW_URL || DEFAULT_PREVIEW_URL;
const projectRoot = process.env.COCOS_CLI_FEATURE_C_PROJECT_ROOT || DEFAULT_PROJECT_ROOT;
const outputDir = process.env.COCOS_CLI_FEATURE_C_EVIDENCE_DIR
  || path.join(projectRoot, 'temp', 'codex-runtime-preview');
const readyTimeoutMs = Number(process.env.COCOS_CLI_FEATURE_C_READY_TIMEOUT_MS || 120_000);
const stableWindowMs = Number(process.env.COCOS_CLI_FEATURE_C_STABLE_WINDOW_MS || 5_000);
const cdpEndpoint = process.env.COCOS_CLI_FEATURE_C_CDP_ENDPOINT || '';
const timestamp = formatTimestamp(new Date());
const urlSafe = toUrlSafe(previewUrl);
const evidencePath = path.join(outputDir, `feature-c-script-load-evidence-${timestamp}.json`);
const screenshotPath = path.join(outputDir, `feature-c-script-load-evidence-${urlSafe}-${timestamp}.png`);

const failures = [];
const chunkResponses = [];
const consoleErrors = [];
const pageErrors = [];
const badResponses = [];
const consoleMessages = [];
const prerequisiteTimings = [];

const evidence = {
  url: previewUrl,
  timestamp: new Date().toISOString(),
  cdpMode: cdpEndpoint ? 'connect-over-cdp' : 'launched-browser',
  cdpEndpoint: cdpEndpoint || undefined,
  cacheDisabled: false,
  cacheDisabledEvidence: [],
  systemHooks: {
    instantiate: 'missing',
    fetchScript: 'missing',
    createScript: 'missing',
  },
  failures,
  chunkResponses,
  consoleErrors,
  consoleMessages,
  pageErrors,
  badResponses,
  prerequisiteTimings,
  limiter: null,
  ready: null,
  readyTimedOut: false,
  screenshotPath,
};

let browser;
let context;
let page;
let cdp;

await fs.mkdir(outputDir, { recursive: true });

try {
  const session = cdpEndpoint
    ? await connectToExistingBrowser(cdpEndpoint)
    : await launchBrowser();
  browser = session.browser;
  context = session.context;
  page = session.page;

  wirePlaywrightEvents(page);
  cdp = await context.newCDPSession(page);
  await wireCdpEvents(cdp);
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  await cdp.send('Runtime.enable');
  evidence.cacheDisabled = true;
  evidence.cacheDisabledEvidence.push({
    source: 'CDP',
    method: 'Network.setCacheDisabled',
    cacheDisabled: true,
  });

  await page.setViewportSize(VIEWPORT);
  await page.goto(previewUrl, {
    waitUntil: 'domcontentloaded',
    timeout: 60_000,
  }).catch((error) => {
    failures.push({
      url: previewUrl,
      errorText: String(error?.message || error),
      type: 'navigation',
    });
  });

  await waitForReadyOrTimeout(page, readyTimeoutMs);
  if (stableWindowMs > 0) {
    await page.waitForTimeout(stableWindowMs);
  }

  const runtimeState = await evaluateRuntimeState(page);
  evidence.systemHooks = runtimeState.systemHooks;
  evidence.limiter = runtimeState.limiter;
  evidence.ready = runtimeState.ready;
  evidence.readyTimedOut = !runtimeState.ready;
  prerequisiteTimings.push(...runtimeState.prerequisiteTimings);

  await page.screenshot({ path: screenshotPath, fullPage: true }).catch((error) => {
    failures.push({
      url: previewUrl,
      errorText: String(error?.message || error),
      type: 'screenshot',
    });
  });
} catch (error) {
  failures.push({
    url: previewUrl,
    errorText: String(error?.stack || error?.message || error),
    type: 'script',
  });
} finally {
  await fs.writeFile(evidencePath, JSON.stringify(evidence, null, 2), 'utf8');
  if (context && !cdpEndpoint) {
    await context.close().catch(() => {});
  }
  if (browser && !cdpEndpoint) {
    await browser.close().catch(() => {});
  }
  console.log(JSON.stringify({
    evidencePath,
    screenshotPath,
    cacheDisabled: evidence.cacheDisabled,
    systemHooks: evidence.systemHooks,
    ready: evidence.ready,
    limiter: evidence.limiter,
    failures: evidence.failures.length,
    chunkResponses: evidence.chunkResponses.length,
    consoleErrors: evidence.consoleErrors.length,
    pageErrors: evidence.pageErrors.length,
  }, null, 2));
}

async function connectToExistingBrowser(endpoint) {
  const connectedBrowser = await chromium.connectOverCDP(endpoint);
  const existingContexts = connectedBrowser.contexts();
  const existingPages = existingContexts.flatMap((entry) => entry.pages());
  const matchingPage = existingPages.find((entry) => entry.url().startsWith(previewUrl))
    || existingPages.find((entry) => sameOrigin(entry.url(), previewUrl));
  const selectedContext = matchingPage?.context() || existingContexts[0] || await connectedBrowser.newContext();
  const selectedPage = matchingPage || await selectedContext.newPage();
  return {
    browser: connectedBrowser,
    context: selectedContext,
    page: selectedPage,
  };
}

async function launchBrowser() {
  const executablePath = await findBrowserExecutable();
  const launchedBrowser = await chromium.launch({
    headless: process.env.COCOS_CLI_FEATURE_C_HEADLESS !== 'false',
    ...(executablePath ? { executablePath } : {}),
  });
  const launchedContext = await launchedBrowser.newContext({
    viewport: VIEWPORT,
  });
  const launchedPage = await launchedContext.newPage();
  return {
    browser: launchedBrowser,
    context: launchedContext,
    page: launchedPage,
  };
}

async function findBrowserExecutable() {
  const candidates = [
    process.env.COCOS_CLI_TEST_BROWSER,
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files/Google/Chrome Dev/Application/chrome.exe',
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // Try next candidate.
    }
  }
  return '';
}

function wirePlaywrightEvents(targetPage) {
  targetPage.on('console', (message) => {
    const entry = {
      type: message.type(),
      text: message.text(),
      location: message.location(),
    };
    consoleMessages.push(entry);
    if (message.type() === 'error') {
      consoleErrors.push(entry.text);
    }
    if (isPreviewChunkFailureText(entry.text)) {
      failures.push({
        url: extractFirstUrl(entry.text) || previewUrl,
        errorText: entry.text,
        type: 'console',
      });
    }
    const timing = parsePrerequisiteTiming(entry.text);
    if (timing) {
      prerequisiteTimings.push(timing);
    }
  });
  targetPage.on('pageerror', (error) => {
    const text = String(error?.stack || error?.message || error);
    pageErrors.push(text);
    if (isPreviewChunkFailureText(text)) {
      failures.push({
        url: extractFirstUrl(text) || previewUrl,
        errorText: text,
        type: 'pageerror',
      });
    }
  });
  targetPage.on('response', (response) => {
    const url = response.url();
    if (!isRuntimePreviewProjectChunkUrl(url)) {
      if (response.status() >= 400) {
        badResponses.push({
          url,
          status: response.status(),
          statusText: response.statusText(),
        });
      }
      return;
    }
    chunkResponses.push({
      url,
      status: response.status(),
    });
  });
  targetPage.on('requestfailed', (request) => {
    const url = request.url();
    const errorText = request.failure()?.errorText || '';
    failures.push({
      url,
      errorText,
      type: 'requestfailed',
    });
  });
}

async function wireCdpEvents(targetCdp) {
  targetCdp.on('Network.responseReceived', (event) => {
    const url = event.response?.url || '';
    if (!isRuntimePreviewProjectChunkUrl(url)) {
      return;
    }
    const entry = {
      url,
      status: event.response.status,
      fromDiskCache: Boolean(event.response.fromDiskCache),
      fromMemoryCache: Boolean(event.response.fromMemoryCache),
    };
    chunkResponses.push(entry);
    evidence.cacheDisabledEvidence.push({
      source: 'Network.responseReceived',
      url,
      fromDiskCache: entry.fromDiskCache,
      fromMemoryCache: entry.fromMemoryCache,
    });
  });
  targetCdp.on('Network.loadingFailed', (event) => {
    failures.push({
      url: event.requestId,
      errorText: event.errorText || '',
      type: event.type || 'Network.loadingFailed',
    });
  });
}

async function waitForReadyOrTimeout(targetPage, timeoutMs) {
  try {
    await targetPage.waitForFunction(() => Boolean(window.__RUNTIME_PREVIEW_READY), undefined, {
      timeout: timeoutMs,
    });
  } catch {
    // A failing baseline is still useful evidence.
  }
}

async function evaluateRuntimeState(targetPage) {
  return await targetPage.evaluate(() => {
    const system = globalThis.System;
    const consoleEntries = Array.isArray(globalThis.__RUNTIME_PREVIEW_PREREQUISITE_TIMINGS__)
      ? globalThis.__RUNTIME_PREVIEW_PREREQUISITE_TIMINGS__
      : [];
    return {
      systemHooks: {
        instantiate: typeof system !== 'undefined' ? typeof system.instantiate : 'missing',
        fetchScript: typeof system !== 'undefined' ? typeof system.fetchScript : 'missing',
        createScript: typeof system !== 'undefined' ? typeof system.createScript : 'missing',
      },
      limiter: window.__RUNTIME_PREVIEW_SCRIPT_LOAD_LIMITER__ || null,
      ready: window.__RUNTIME_PREVIEW_READY || null,
      prerequisiteTimings: consoleEntries,
    };
  }).catch(() => ({
    systemHooks: {
      instantiate: 'missing',
      fetchScript: 'missing',
      createScript: 'missing',
    },
    limiter: null,
    ready: null,
    prerequisiteTimings: [],
  }));
}

function isRuntimePreviewProjectChunkUrl(value) {
  try {
    const parsed = new URL(value, previewUrl);
    return /\/scripting\/x\/packer-driver\/targets\/preview\/chunks\/[^/]+\/[^/]+\.js$/.test(parsed.pathname);
  } catch {
    return false;
  }
}

function isPreviewChunkFailureText(text) {
  return /ERR_INSUFFICIENT_RESOURCES|SystemJS Error#3|Get .*\/scripting\/x\/packer-driver\/targets\/preview\/chunks\/.* failed|Error loading .*\/scripting\/x\/packer-driver\/targets\/preview\/chunks\//.test(text);
}

function extractFirstUrl(text) {
  const match = text.match(/https?:\/\/\S+/);
  return match?.[0]?.replace(/[),\]]+$/, '') || '';
}

function parsePrerequisiteTiming(text) {
  const match = text.match(/\[runtime-preview\] prerequisite-imports:done\s+(.*)$/);
  if (!match) {
    return null;
  }
  const result = {};
  for (const part of match[1].split(/\s+/)) {
    const [key, value] = part.split('=');
    if (!key || value === undefined) {
      continue;
    }
    const numeric = Number(value);
    result[key] = Number.isFinite(numeric) ? numeric : value;
  }
  return result;
}

function sameOrigin(left, right) {
  try {
    return new URL(left).origin === new URL(right).origin;
  } catch {
    return false;
  }
}

function toUrlSafe(value) {
  return encodeURIComponent(value)
    .replace(/%/g, '-')
    .replace(/[\\/?%*:|"<>]/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 80);
}

function formatTimestamp(value) {
  const date = new Date(value);
  const pad = (num, len = 2) => String(num).padStart(len, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}
