import { promises as fs } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';

const DEFAULT_PREVIEW_URL = 'http://localhost:7457/';
const VIEWPORT = { width: 1280, height: 720 };
const TIMESTAMP = formatTimestamp(new Date());

const url = process.env.COCOS_CLI_CAPTURE_PREVIEW_URL || DEFAULT_PREVIEW_URL;
let parsedUrl;
try {
  parsedUrl = new URL(url);
} catch (error) {
  throw new Error(`Invalid COCOS_CLI_CAPTURE_PREVIEW_URL: ${String(error?.message || error)}`);
}

const previewUrl = parsedUrl.href;
const outputDir = process.env.COCOS_CLI_CAPTURE_OUTPUT_DIR
  ? path.resolve(process.cwd(), process.env.COCOS_CLI_CAPTURE_OUTPUT_DIR)
  : path.resolve(process.cwd(), '.codex-tmp', `editor-preview-capture-${TIMESTAMP}`);

const urlSafe = toUrlSafe(previewUrl);
const artifactFiles = {
  rootHtml: `editor-root-${urlSafe}-${VIEWPORT.width}x${VIEWPORT.height}-${TIMESTAMP}.html`,
  settings: `editor-settings-${TIMESTAMP}.js`,
  importMap: `editor-import-map-${TIMESTAMP}.json`,
  prerequisiteChunk: `editor-prerequisite-chunk-${TIMESTAMP}.js`,
  browserDebug: `editor-browser-debug-${urlSafe}-${VIEWPORT.width}x${VIEWPORT.height}-${TIMESTAMP}.json`,
  screenshot: `editor-root-${urlSafe}-${VIEWPORT.width}x${VIEWPORT.height}-${TIMESTAMP}.png`,
};

const artifacts = Object.fromEntries(
  Object.entries(artifactFiles).map(([key, file]) => [key, path.join(outputDir, file)]),
);

let rootStatus = 0;
let settingsStatus = 0;
let importMapStatus = 0;
let prerequisiteStatus = 0;
let prerequisiteChunkUrl = '';
let screenshotStat;
let browser;
let page;
let context;
let hasNavigationError = false;
const browserCandidates = [
  process.env.COCOS_CLI_TEST_BROWSER,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files/Google/Chrome Dev/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].filter(Boolean);
let executablePath = '';

const consoleErrors = [];
const pageErrors = [];
const failedRequests = [];
const badResponses = [];
const failureReasons = [];
let navigationError = '';
const summary = {
  source: 'editor',
  timestamp: TIMESTAMP,
  previewUrl,
  outputDir,
  artifacts,
  rootStatus,
  settingsStatus,
  importMapStatus,
  prerequisiteChunkUrl: '',
  prerequisiteStatus: 0,
  screenshotFilePath: artifacts.screenshot,
  screenshotSize: 0,
  success: false,
  failureReasons,
  navigationError: '',
  browserDebugPath: artifacts.browserDebug,
};

await fs.mkdir(outputDir, { recursive: true });

try {
  for (const candidate of browserCandidates) {
    try {
      await fs.access(candidate);
      executablePath = candidate;
      break;
    } catch {
      // Try next candidate.
    }
  }
  try {
    browser = await chromium.launch({
      headless: true,
      ...(executablePath ? { executablePath } : {}),
    });
  } catch (error) {
    hasNavigationError = true;
    navigationError = `browser launch failed: ${String(error?.message || error)}`;
    failureReasons.push(navigationError);
  }
  if (!browser) {
    summary.navigationError = navigationError;
  } else {
  context = await browser.newContext({
    viewport: VIEWPORT,
  });
  page = await context.newPage();

  const isSameOrigin = (value) => {
    try {
      return new URL(value).origin === parsedUrl.origin;
    } catch {
      return false;
    }
  };

  page.on('console', (message) => {
    if (message.type() !== 'error') {
      return;
    }
    consoleErrors.push({
      type: message.type(),
      text: message.text(),
      location: message.location(),
    });
  });
  page.on('pageerror', (error) => {
    pageErrors.push(String(error?.stack || error?.message || error));
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

  try {
    const response = await page.goto(previewUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });
    rootStatus = response?.status() ?? 0;
  } catch (error) {
    navigationError = String(error?.message || error);
    failureReasons.push(`root navigation failed: ${navigationError}`);
  }
  try {
    await fs.writeFile(artifacts.rootHtml, await page.content(), 'utf8');
  } catch {
    failureReasons.push('failed to capture root HTML');
  }

  const responseSettings = await fetchTextResource(page, new URL('/settings.js', previewUrl).href);
  settingsStatus = responseSettings.status;
  if (responseSettings.status >= 200 && responseSettings.status <= 299 && responseSettings.text !== null) {
    await fs.writeFile(artifacts.settings, responseSettings.text, 'utf8');
  }

  const responseImportMap = await fetchTextResource(page, new URL('/scripting/x/import-map.json', previewUrl).href);
  importMapStatus = responseImportMap.status;
  if (responseImportMap.status >= 200 && responseImportMap.status <= 299) {
    await fs.writeFile(artifacts.importMap, responseImportMap.text, 'utf8');
    let importMapJson = null;
    try {
      importMapJson = JSON.parse(responseImportMap.text || '{}');
    } catch {
      failureReasons.push('import-map is not valid JSON.');
    }
    prerequisiteChunkUrl = extractPrerequisiteChunkUrl(importMapJson);
    if (prerequisiteChunkUrl) {
      const prerequisiteResponse = await fetchTextResource(page, prerequisiteChunkUrl);
      prerequisiteStatus = prerequisiteResponse.status;
      if (prerequisiteResponse.status >= 200 && prerequisiteResponse.status <= 299 && prerequisiteResponse.text !== null) {
        await fs.writeFile(artifacts.prerequisiteChunk, prerequisiteResponse.text, 'utf8');
      }
    }
  }

  const viewportForDebug = await page.evaluate(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
    devicePixelRatio: window.devicePixelRatio || 1,
  }));

  const elements = await page.evaluate(() => {
    const parseRect = (rect) => {
      if (!rect) {
        return null;
      }
      return {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        top: rect.top,
        left: rect.left,
        right: rect.right,
        bottom: rect.bottom,
      };
    };

    const gameCanvas = document.querySelector('#GameCanvas');
    const gameDiv = document.querySelector('#GameDiv') || document.querySelector('#gameDiv');
    const cocos3dGameContainer = document.querySelector('#Cocos3dGameContainer') || document.querySelector('#cocos3dGameContainer');
    const getCanvasMeasured = (canvas) => {
      if (!(canvas instanceof HTMLCanvasElement)) {
        return null;
      }
      const style = getComputedStyle(canvas);
      return {
        width: canvas.width,
        height: canvas.height,
        computedWidth: Number.parseFloat(style.width),
        computedHeight: Number.parseFloat(style.height),
      };
    };

    return {
      gameCanvas: parseRect(gameCanvas?.getBoundingClientRect()),
      gameDiv: parseRect(gameDiv?.getBoundingClientRect()),
      cocos3dGameContainer: parseRect(cocos3dGameContainer?.getBoundingClientRect()),
      canvas: getCanvasMeasured(gameCanvas),
    };
  });

  const screenshotWritten = await captureScreenshot(page, artifacts.screenshot, 'png');
  screenshotStat = await getFileStat(artifacts.screenshot);
  const gameCanvas = elements.gameCanvas;
  const canvasMeta = elements.canvas;
  const hasZeroCanvas = Boolean(gameCanvas) && (
    (gameCanvas.width === 0)
    || (gameCanvas.height === 0)
    || !Number.isFinite(canvasMeta?.width)
    || canvasMeta.width <= 0
    || !Number.isFinite(canvasMeta?.height)
    || canvasMeta.height <= 0
  );

  const browserDebug = {
    source: 'editor',
    url: previewUrl,
    viewport: {
      ...VIEWPORT,
      devicePixelRatio: viewportForDebug.devicePixelRatio,
    },
    elements: {
      gameCanvas,
      gameDiv: elements.gameDiv,
      cocos3dGameContainer: elements.cocos3dGameContainer,
    },
    canvas: elements.canvas,
    screenshotFilePath: artifacts.screenshot,
    consoleErrors,
    pageErrors,
    failedRequests,
    badResponses,
  };

  if (!(rootStatus >= 200 && rootStatus <= 299)) {
    failureReasons.push(`root response non-2xx: ${rootStatus}`);
  }
  if (!(settingsStatus >= 200 && settingsStatus <= 299)) {
    failureReasons.push(`settings.js response non-2xx: ${settingsStatus}`);
  }
  if (!(importMapStatus >= 200 && importMapStatus <= 299)) {
    failureReasons.push(`import-map response non-2xx: ${importMapStatus}`);
  }
  if (!screenshotWritten || !screenshotStat || screenshotStat.size === 0) {
    failureReasons.push('screenshot missing or empty');
  }
  if (hasZeroCanvas) {
    failureReasons.push('GameCanvas exists but has zero size');
  }
  if (consoleErrors.length > 0) {
    failureReasons.push(`consoleErrors non-empty (${consoleErrors.length})`);
  }
  if (pageErrors.length > 0) {
    failureReasons.push(`pageErrors non-empty (${pageErrors.length})`);
  }
  if (failedRequests.length > 0) {
    failureReasons.push(`failedRequests non-empty (${failedRequests.length})`);
  }
  if (badResponses.length > 0) {
    failureReasons.push(`badResponses non-empty (${badResponses.length})`);
  }

  if (prerequisiteChunkUrl) {
    browserDebug.prerequisiteChunkUrl = prerequisiteChunkUrl;
  }
  await fs.writeFile(artifacts.browserDebug, JSON.stringify(browserDebug, null, 2), 'utf8');
  }
} finally {
  if (page) {
    await page.close().catch(() => {});
  }
  if (context) {
    await context.close().catch(() => {});
  }
  if (browser) {
    await browser.close().catch(() => {});
  }
  summary.rootStatus = rootStatus;
  summary.settingsStatus = settingsStatus;
  summary.importMapStatus = importMapStatus;
  summary.prerequisiteChunkUrl = prerequisiteChunkUrl;
  summary.prerequisiteStatus = prerequisiteStatus;
  summary.screenshotSize = screenshotStat?.size ?? 0;
  summary.navigationError = navigationError;
  summary.success = failureReasons.length === 0;
  summary.failureReasons = failureReasons;
  if (hasNavigationError && summary.success) {
    summary.success = false;
  }
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.success) {
    process.exitCode = 1;
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
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

async function getFileStat(filePath) {
  try {
    return await fs.stat(filePath);
  } catch {
    return null;
  }
}

async function fetchTextResource(page, urlValue) {
  try {
    const response = await page.request.get(urlValue);
    return {
      status: response.status(),
      text: await response.text(),
    };
  } catch (error) {
    const message = String(error?.message || error);
    return {
      status: 0,
      text: '',
      error: message,
    };
  }
}

async function captureScreenshot(page, filePath, type) {
  try {
    await page.screenshot({
      path: filePath,
      type,
    });
    return true;
  } catch {
    return false;
  }
}

function extractPrerequisiteChunkUrl(importMap) {
  if (!importMap || typeof importMap !== 'object') {
    return '';
  }
  const imports = importMap.imports ?? {};
  const candidate = imports['cce:/internal/x/prerequisite-imports']
    ?? importMap['cce:/internal/x/prerequisite-imports']
    ?? importMap['cce:/internal/x/prerequisite-imports/'];
  if (typeof candidate !== 'string' || !candidate) {
    return '';
  }
  if (candidate.startsWith('cce:')) {
    return new URL(candidate.replace(/^cce:/, ''), previewUrl).href;
  }
  try {
    return new URL(candidate, previewUrl).href;
  } catch {
    return '';
  }
}
