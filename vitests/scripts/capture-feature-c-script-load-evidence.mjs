import { promises as fs } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
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
const navigationTimeoutMs = Number(process.env.COCOS_CLI_FEATURE_C_NAVIGATION_TIMEOUT_MS || 180_000);
const cdpEndpoint = process.env.COCOS_CLI_FEATURE_C_CDP_ENDPOINT || '';
const batchCandidates = parseNumberList(process.env.COCOS_CLI_FEATURE_C_SCRIPT_LOAD_CONCURRENCY_CANDIDATES || '');
const batchRuns = Number(process.env.COCOS_CLI_FEATURE_C_SCRIPT_LOAD_RUNS || 0);
const isBatchChild = process.env.COCOS_CLI_FEATURE_C_BATCH_CHILD === '1';
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
  readyElapsedMs: null,
  screenshotPath,
};

let browser;
let context;
let page;
let cdp;

await fs.mkdir(outputDir, { recursive: true });

if (batchCandidates.length > 0 && batchRuns > 0 && !isBatchChild) {
  const summary = await runBatch();
  console.log(JSON.stringify(summary, null, 2));
  process.exit(summary.error ? 1 : 0);
}

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
  const navigationStartedAt = Date.now();
  await page.goto(previewUrl, {
    waitUntil: 'domcontentloaded',
    timeout: navigationTimeoutMs,
  }).catch((error) => {
    failures.push({
      url: previewUrl,
      errorText: String(error?.message || error),
      type: 'navigation',
    });
  });

  const readyElapsedMs = await waitForReadyOrTimeout(page, readyTimeoutMs, navigationStartedAt);
  if (stableWindowMs > 0) {
    await page.waitForTimeout(stableWindowMs);
  }

  const runtimeState = await evaluateRuntimeState(page);
  evidence.systemHooks = runtimeState.systemHooks;
  evidence.limiter = runtimeState.limiter;
  evidence.ready = runtimeState.ready;
  evidence.readyTimedOut = !runtimeState.ready;
  evidence.readyElapsedMs = runtimeState.ready ? readyElapsedMs : null;
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

async function waitForReadyOrTimeout(targetPage, timeoutMs, startedAt) {
  try {
    await targetPage.waitForFunction(() => Boolean(window.__RUNTIME_PREVIEW_READY), undefined, {
      timeout: timeoutMs,
    });
    return Date.now() - startedAt;
  } catch {
    // A failing baseline is still useful evidence.
    return null;
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

async function runBatch() {
  const scriptPath = fileURLToPath(import.meta.url);
  const runs = [];
  for (const concurrency of batchCandidates) {
    for (let run = 1; run <= batchRuns; run += 1) {
      const url = withConcurrency(previewUrl, concurrency);
      const child = spawnSync(process.execPath, [scriptPath], {
        cwd: process.cwd(),
        encoding: 'utf8',
        env: {
          ...process.env,
          COCOS_CLI_FEATURE_C_BATCH_CHILD: '1',
          COCOS_CLI_FEATURE_C_PREVIEW_URL: url,
          COCOS_CLI_FEATURE_C_SCRIPT_LOAD_CONCURRENCY_CANDIDATES: '',
          COCOS_CLI_FEATURE_C_SCRIPT_LOAD_RUNS: '',
        },
      });
      if (child.stdout) {
        process.stdout.write(child.stdout);
      }
      if (child.stderr) {
        process.stderr.write(child.stderr);
      }
      const childSummary = parseChildSummary(child.stdout);
      if (!childSummary?.evidencePath) {
        runs.push({
          concurrency,
          run,
          error: `child evidence path missing; exitCode=${child.status}`,
        });
        continue;
      }
      const childEvidence = JSON.parse(await fs.readFile(childSummary.evidencePath, 'utf8'));
      runs.push({
        concurrency,
        run,
        evidencePath: childSummary.evidencePath,
        screenshotPath: childSummary.screenshotPath,
        error: child.status === 0 ? undefined : `child exitCode=${child.status}`,
        ...summarizeEvidenceRun(childEvidence, concurrency),
      });
    }
  }

  const candidates = batchCandidates.map((concurrency) => summarizeCandidate(
    concurrency,
    runs.filter((entry) => entry.concurrency === concurrency),
  ));
  const viableCandidates = candidates.filter((candidate) => candidate.errorRuns === 0);
  const selected = viableCandidates
    .slice()
    .sort((left, right) => left.readyElapsedMsMedian - right.readyElapsedMsMedian)[0];
  const summary = {
    selectedConcurrency: selected?.concurrency ?? null,
    candidates,
    runs,
  };
  const summaryPath = path.join(outputDir, 'feature-c-script-load-concurrency-summary-20260625.json');
  await fs.writeFile(summaryPath, JSON.stringify(summary, null, 2), 'utf8');
  return {
    ...summary,
    summaryPath,
    error: !selected,
  };
}

function summarizeEvidenceRun(runEvidence, concurrency) {
  const limiterMetrics = runEvidence.limiter?.metrics ?? {};
  const latestTiming = Array.isArray(runEvidence.prerequisiteTimings)
    ? runEvidence.prerequisiteTimings[runEvidence.prerequisiteTimings.length - 1]
    : undefined;
  const consoleErrorText = (runEvidence.consoleErrors ?? []).join('\n');
  const failureText = (runEvidence.failures ?? [])
    .map((entry) => `${entry.errorText ?? ''} ${entry.url ?? ''}`)
    .join('\n');
  const cacheEvidence = (runEvidence.cacheDisabledEvidence ?? [])
    .filter((entry) => entry.source === 'Network.responseReceived');
  const cacheEvidenceOk = Boolean(runEvidence.cacheDisabled)
    && cacheEvidence.length > 0
    && cacheEvidence.every((entry) => entry.fromDiskCache === false && entry.fromMemoryCache === false);
  const hasLoadFailure = /ERR_INSUFFICIENT_RESOURCES|SystemJS Error#3|Get .* failed|Error loading/.test(`${consoleErrorText}\n${failureText}`);
  const maxActive = Number(limiterMetrics.maxActive ?? 0);
  const limiterFailed = Number(limiterMetrics.failed ?? 0);
  return {
    prerequisiteImportMs: Number(latestTiming?.prerequisiteImportMs ?? NaN),
    validationMs: Number(latestTiming?.validationMs ?? NaN),
    readyElapsedMs: Number(runEvidence.readyElapsedMs ?? NaN),
    maxActive,
    queuePeak: Number(limiterMetrics.queuePeak ?? 0),
    retryCount: Number(limiterMetrics.retryCount ?? 0),
    limiterFailed,
    cacheEvidenceOk,
    readyScene: runEvidence.ready?.scene ?? '',
    failureCount: Array.isArray(runEvidence.failures) ? runEvidence.failures.length : 0,
    consoleErrorCount: Array.isArray(runEvidence.consoleErrors) ? runEvidence.consoleErrors.length : 0,
    hasLoadFailure,
    accepted: cacheEvidenceOk
      && !hasLoadFailure
      && limiterFailed === 0
      && maxActive <= concurrency
      && Number.isFinite(Number(latestTiming?.prerequisiteImportMs))
      && Number.isFinite(Number(runEvidence.readyElapsedMs)),
  };
}

function summarizeCandidate(concurrency, entries) {
  const acceptedEntries = entries.filter((entry) => entry.accepted);
  const errorRuns = entries.length - acceptedEntries.length;
  return {
    concurrency,
    runs: entries.length,
    errorRuns,
    prerequisiteImportMsMedian: median(acceptedEntries.map((entry) => entry.prerequisiteImportMs)),
    prerequisiteImportMsP95: p95(acceptedEntries.map((entry) => entry.prerequisiteImportMs)),
    readyElapsedMsMedian: median(acceptedEntries.map((entry) => entry.readyElapsedMs)),
    readyElapsedMsP95: p95(acceptedEntries.map((entry) => entry.readyElapsedMs)),
    maxActiveMax: max(acceptedEntries.map((entry) => entry.maxActive)),
    queuePeakMax: max(acceptedEntries.map((entry) => entry.queuePeak)),
    retryCountTotal: acceptedEntries.reduce((sum, entry) => sum + entry.retryCount, 0),
  };
}

function median(values) {
  const sorted = values.filter(Number.isFinite).sort((left, right) => left - right);
  if (sorted.length === 0) {
    return null;
  }
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function p95(values) {
  const sorted = values.filter(Number.isFinite).sort((left, right) => left - right);
  if (sorted.length === 0) {
    return null;
  }
  return sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)];
}

function max(values) {
  const finite = values.filter(Number.isFinite);
  return finite.length > 0 ? Math.max(...finite) : null;
}

function parseChildSummary(stdout) {
  const marker = '{\n  "evidencePath"';
  const start = stdout.lastIndexOf(marker);
  if (start < 0) {
    return null;
  }
  const end = stdout.lastIndexOf('}');
  if (end < start) {
    return null;
  }
  try {
    return JSON.parse(stdout.slice(start, end + 1));
  } catch {
    return null;
  }
}

function withConcurrency(urlValue, concurrency) {
  const parsed = new URL(urlValue);
  parsed.searchParams.set('runtimePreviewScriptLoadConcurrency', String(concurrency));
  return parsed.href;
}

function parseNumberList(value) {
  return value
    .split(',')
    .map((entry) => Number(entry.trim()))
    .filter((entry) => Number.isFinite(entry) && entry > 0);
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
