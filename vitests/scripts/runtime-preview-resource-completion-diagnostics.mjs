#!/usr/bin/env node

import { access, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';

const RESOURCE_BUCKETS = [
  '/assets/*',
  '/query-extname/*',
  '/scene/*.json',
  '/chunks/*.js',
  '/scene-list',
  '/scripting/x/*',
  'other',
];

const DEFAULT_VIEWPORT = { width: 1280, height: 720 };

export function parseArgs(argv) {
  const options = {
    rounds: 5,
    warmup: 1,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === '--url') {
      options.url = next;
      index += 1;
    } else if (arg === '--label') {
      options.label = next;
      index += 1;
    } else if (arg === '--output') {
      options.output = next;
      index += 1;
    } else if (arg === '--rounds') {
      options.rounds = Number(next);
      index += 1;
    } else if (arg === '--warmup') {
      options.warmup = Number(next);
      index += 1;
    }
  }
  if (
    !options.url
    || !options.label
    || !options.output
    || !Number.isInteger(options.rounds)
    || options.rounds < 1
    || !Number.isInteger(options.warmup)
    || options.warmup < 0
  ) {
    throw new Error('Usage: node vitests/scripts/runtime-preview-resource-completion-diagnostics.mjs --url <url> --label <label> --output <json> [--rounds 5] [--warmup 1]');
  }
  return options;
}

function summarize(values) {
  const sorted = values.filter(Number.isFinite).sort((left, right) => left - right);
  if (sorted.length === 0) {
    throw new Error('Cannot summarize empty numeric values');
  }
  return {
    min: sorted[0],
    median: sorted[Math.floor(sorted.length / 2)],
    max: sorted[sorted.length - 1],
  };
}

function addStatusCounts(accumulator, statusCounts) {
  for (const [status, count] of Object.entries(statusCounts ?? {})) {
    const numeric = Number(count);
    if (!Number.isFinite(numeric) || numeric < 0) {
      continue;
    }
    accumulator[status] = (accumulator[status] ?? 0) + numeric;
  }
  return accumulator;
}

function emptyBucketSummary() {
  return Object.fromEntries(
    RESOURCE_BUCKETS.map((bucket) => [bucket, { count: 0, maxResponseEndMs: 0 }]),
  );
}

function mergeBucketSummary(accumulator, bucketSummary) {
  for (const bucket of RESOURCE_BUCKETS) {
    const source = bucketSummary?.[bucket];
    if (!source) {
      continue;
    }
    accumulator[bucket].count += Number(source.count ?? 0);
    accumulator[bucket].maxResponseEndMs = Math.max(
      accumulator[bucket].maxResponseEndMs,
      Number(source.maxResponseEndMs ?? 0),
    );
  }
  return accumulator;
}

export function validateResourceCompletionResult(result) {
  const numericSummaryKeys = [
    'resourceResponseEndMs',
    'sameOriginLastFinishMs',
    'networkQuietMs',
    'loadingFailedCount',
  ];
  for (const key of numericSummaryKeys) {
    for (const field of ['min', 'median', 'max']) {
      if (
        typeof result?.[key]?.[field] !== 'number'
        || !Number.isFinite(result[key][field])
        || result[key][field] < 0
      ) {
        throw new Error(`Invalid ${key}.${field}`);
      }
    }
  }
  if (typeof result?.target !== 'string' || result.target.length === 0) {
    throw new Error('Invalid target');
  }
  if (!Number.isInteger(result?.rounds) || result.rounds < 1) {
    throw new Error('Invalid rounds');
  }
  if (!result.wireStatus || typeof result.wireStatus !== 'object') {
    throw new Error('Invalid wireStatus');
  }
  validateCountObject('wireStatus', result.wireStatus);
  if (!result.surfaceStatus || typeof result.surfaceStatus !== 'object') {
    throw new Error('Invalid surfaceStatus');
  }
  validateCountObject('surfaceStatus', result.surfaceStatus);
  if (!result.bucketMaxResponseEnd || typeof result.bucketMaxResponseEnd !== 'object') {
    throw new Error('Invalid bucketMaxResponseEnd');
  }
  for (const bucket of RESOURCE_BUCKETS) {
    const summary = result.bucketMaxResponseEnd[bucket];
    if (!summary || typeof summary !== 'object') {
      throw new Error(`Invalid bucketMaxResponseEnd.${bucket}`);
    }
    if (!Number.isInteger(summary.count) || summary.count < 0) {
      throw new Error(`Invalid bucketMaxResponseEnd.${bucket}.count`);
    }
    if (
      typeof summary.maxResponseEndMs !== 'number'
      || !Number.isFinite(summary.maxResponseEndMs)
      || summary.maxResponseEndMs < 0
    ) {
      throw new Error(`Invalid bucketMaxResponseEnd.${bucket}.maxResponseEndMs`);
    }
  }
  if (!Array.isArray(result.roundsRaw)) {
    throw new Error('Invalid roundsRaw');
  }
  if (result.roundsRaw.length !== result.rounds) {
    throw new Error('Invalid roundsRaw.length');
  }
}

function validateCountObject(name, values) {
  for (const [key, count] of Object.entries(values)) {
    if (typeof count !== 'number' || !Number.isFinite(count) || count < 0) {
      throw new Error(`Invalid ${name}.${key}`);
    }
  }
}

export function createSummary(target, rounds) {
  const result = {
    target,
    rounds: rounds.length,
    resourceResponseEndMs: summarize(rounds.map((round) => round.resourceResponseEndMs)),
    sameOriginLastFinishMs: summarize(rounds.map((round) => round.sameOriginLastFinishMs)),
    networkQuietMs: summarize(rounds.map((round) => round.networkQuietMs)),
    loadingFailedCount: summarize(rounds.map((round) => round.loadingFailedCount ?? 0)),
    wireStatus: rounds.reduce((acc, round) => addStatusCounts(acc, round.wireStatus), {}),
    surfaceStatus: rounds.reduce((acc, round) => addStatusCounts(acc, round.surfaceStatus), {}),
    bucketMaxResponseEnd: rounds.reduce(
      (acc, round) => mergeBucketSummary(acc, round.bucketMaxResponseEnd),
      emptyBucketSummary(),
    ),
    roundsRaw: rounds,
  };
  validateResourceCompletionResult(result);
  return result;
}

function isSameOrigin(urlValue, origin) {
  try {
    return new URL(urlValue).origin === origin;
  } catch {
    return false;
  }
}

function incrementStatus(target, status) {
  const key = String(status || 'unknown');
  target[key] = (target[key] ?? 0) + 1;
}

function classifyBucket(urlValue, origin) {
  let pathname;
  try {
    const parsed = new URL(urlValue, origin);
    pathname = parsed.pathname;
  } catch {
    return 'other';
  }
  if (pathname.startsWith('/assets/')) {
    return '/assets/*';
  }
  if (pathname.startsWith('/query-extname/')) {
    return '/query-extname/*';
  }
  if (/^\/scene\/[^/]+\.json$/.test(pathname)) {
    return '/scene/*.json';
  }
  if (/\/chunks\/[^/]+\.js$/.test(pathname)) {
    return '/chunks/*.js';
  }
  if (pathname === '/scene-list') {
    return '/scene-list';
  }
  if (pathname.startsWith('/scripting/x/')) {
    return '/scripting/x/*';
  }
  return 'other';
}

async function findBrowserExecutable() {
  const candidates = [
    process.env.COCOS_CLI_TEST_BROWSER,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files/Google/Chrome Dev/Application/chrome.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Try the next Chromium-compatible browser.
    }
  }
  return '';
}

async function collectResourceBuckets(page, origin) {
  const entries = await page.evaluate(() => performance.getEntriesByType('resource')
    .map((entry) => ({
      name: entry.name,
      responseEnd: entry.responseEnd,
    })));
  const summary = emptyBucketSummary();
  let maxResponseEnd = 0;
  for (const entry of entries) {
    if (!isSameOrigin(entry.name, origin)) {
      continue;
    }
    const responseEnd = Number(entry.responseEnd);
    if (!Number.isFinite(responseEnd)) {
      continue;
    }
    maxResponseEnd = Math.max(maxResponseEnd, responseEnd);
    const bucket = classifyBucket(entry.name, origin);
    summary[bucket].count += 1;
    summary[bucket].maxResponseEndMs = Math.max(summary[bucket].maxResponseEndMs, responseEnd);
  }
  return {
    resourceResponseEndMs: maxResponseEnd,
    bucketMaxResponseEnd: summary,
  };
}

async function measureRound(page, cdp, url, origin) {
  const requestUrls = new Map();
  const requestWireStatuses = new Map();
  const wireStatus = {};
  const surfaceStatus = {};
  let sameOriginLastFinishMs = 0;
  let loadingFailedCount = 0;
  const startedAt = Date.now();

  const requestWillBeSent = (event) => {
    if (event.requestId && event.request?.url) {
      requestUrls.set(event.requestId, event.request.url);
    }
  };
  const responseReceived = (event) => {
    if (event.requestId && event.response?.url) {
      requestUrls.set(event.requestId, event.response.url);
    }
  };
  const responseReceivedExtraInfo = (event) => {
    const requestUrl = requestUrls.get(event.requestId);
    if (!requestUrl || !isSameOrigin(requestUrl, origin)) {
      return;
    }
    requestWireStatuses.set(event.requestId, event.statusCode || 'unknown');
  };
  const loadingFinished = (event) => {
    const requestUrl = requestUrls.get(event.requestId);
    if (!requestUrl || !isSameOrigin(requestUrl, origin)) {
      return;
    }
    incrementStatus(wireStatus, requestWireStatuses.get(event.requestId) || 'unknown');
    sameOriginLastFinishMs = Math.max(sameOriginLastFinishMs, Date.now() - startedAt);
  };
  const loadingFailed = (event) => {
    const requestUrl = requestUrls.get(event.requestId);
    if (!requestUrl || !isSameOrigin(requestUrl, origin)) {
      return;
    }
    loadingFailedCount += 1;
    incrementStatus(wireStatus, 'loadingFailed');
    sameOriginLastFinishMs = Math.max(sameOriginLastFinishMs, Date.now() - startedAt);
  };
  const responseListener = (response) => {
    if (!isSameOrigin(response.url(), origin)) {
      return;
    }
    incrementStatus(surfaceStatus, response.status());
  };

  cdp.on('Network.requestWillBeSent', requestWillBeSent);
  cdp.on('Network.responseReceived', responseReceived);
  cdp.on('Network.responseReceivedExtraInfo', responseReceivedExtraInfo);
  cdp.on('Network.loadingFinished', loadingFinished);
  cdp.on('Network.loadingFailed', loadingFailed);
  page.on('response', responseListener);

  try {
    await page.goto(url, { waitUntil: 'load', timeout: 120_000 });
    await page.waitForLoadState('networkidle', { timeout: 120_000 });
    const networkQuietMs = Date.now() - startedAt;
    const resourceBuckets = await collectResourceBuckets(page, origin);
    return {
      ...resourceBuckets,
      sameOriginLastFinishMs,
      networkQuietMs,
      loadingFailedCount,
      wireStatus,
      surfaceStatus,
    };
  } finally {
    cdp.off('Network.requestWillBeSent', requestWillBeSent);
    cdp.off('Network.responseReceived', responseReceived);
    cdp.off('Network.responseReceivedExtraInfo', responseReceivedExtraInfo);
    cdp.off('Network.loadingFinished', loadingFinished);
    cdp.off('Network.loadingFailed', loadingFailed);
    page.off('response', responseListener);
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const targetUrl = new URL(options.url);
  const executablePath = await findBrowserExecutable();
  const browser = await chromium.launch({
    headless: true,
    ...(executablePath ? { executablePath } : {}),
  });
  const context = await browser.newContext({
    viewport: DEFAULT_VIEWPORT,
  });
  const page = await context.newPage();
  await page.addInitScript(() => performance.setResourceTimingBufferSize(5000));
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');

  const rounds = [];
  try {
    for (let index = 0; index < options.warmup + options.rounds; index += 1) {
      const round = await measureRound(page, cdp, targetUrl.href, targetUrl.origin);
      if (index >= options.warmup) {
        rounds.push(round);
      }
    }
  } finally {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }

  const result = createSummary(options.label, rounds);
  await mkdir(path.dirname(path.resolve(options.output)), { recursive: true });
  await writeFile(options.output, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
