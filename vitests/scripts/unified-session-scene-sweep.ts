import { access, mkdir, opendir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import {
  canListen,
  startRuntimePreviewCliProcess,
  type StartedRuntimePreviewCliProcess,
} from '../shared/runtime-preview-cli-process';

interface Arguments {
  repoRoot: string;
  projectRoot: string;
  evidenceFile: string;
  screenshotDirectory: string;
  readyTimeoutMs: number;
  stableWindowMs: number;
  useRuntimeFlag: boolean;
}

interface PreviewSceneRecord {
  uuid: string;
  url: string;
  name?: string;
  bundle?: string;
}

interface SceneSweepResult {
  index: number;
  scene: PreviewSceneRecord;
  url: string;
  status: 'pass' | 'fail';
  failures: string[];
  ready: unknown;
  elapsedMs: number;
  networkRequestCount: number;
  consoleErrors: string[];
  unhandledRejections: string[];
  pageErrors: string[];
  failedRequests: Array<{ url: string; errorText: string }>;
  badResponses: Array<{ url: string; status: number }>;
  canvas: {
    width: number;
    height: number;
    clientWidth: number;
    clientHeight: number;
  } | null;
  screenshotFile: string;
  screenshotError?: string;
}

const UNHANDLED_REJECTION_PREFIX = '[runtime-preview-unhandledrejection]';

function parseArguments(argv: string[]): Arguments {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith('--') || !value) {
      throw new Error(`Expected --name value arguments, got: ${argv.join(' ')}`);
    }
    values.set(key.slice(2), value);
  }

  const requiredPath = (name: string): string => {
    const value = values.get(name);
    if (!value) {
      throw new Error(`Missing required argument: --${name}`);
    }
    return resolve(value);
  };
  const positiveInteger = (name: string, fallback: number): number => {
    const source = values.get(name);
    if (!source) {
      return fallback;
    }
    const value = Number(source);
    if (!Number.isInteger(value) || value <= 0) {
      throw new Error(`Expected positive integer for --${name}, got: ${source}`);
    }
    return value;
  };

  return {
    repoRoot: requiredPath('repo'),
    projectRoot: requiredPath('project'),
    evidenceFile: requiredPath('evidence'),
    screenshotDirectory: requiredPath('screenshots'),
    readyTimeoutMs: positiveInteger('ready-timeout-ms', 60_000),
    stableWindowMs: positiveInteger('stable-window-ms', 1_500),
    useRuntimeFlag: values.get('runtime') === 'true',
  };
}

async function findAvailablePort(startPort: number): Promise<number> {
  for (let offset = 0; offset < 50; offset += 1) {
    const port = startPort + offset;
    if (await canListen(port)) {
      return port;
    }
  }
  throw new Error(`No available port from ${startPort}.`);
}

async function findBrowserExecutable(): Promise<string> {
  const candidates = [
    process.env.COCOS_CLI_TEST_BROWSER,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files/Google/Chrome Dev/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  ].filter((value): value is string => Boolean(value));

  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Try the next installed Chromium browser.
    }
  }
  throw new Error('No Chrome/Edge executable found. Set COCOS_CLI_TEST_BROWSER.');
}

async function readEngineRoot(projectRoot: string): Promise<string> {
  const packageJson = JSON.parse(
    await readFile(join(projectRoot, 'package.json'), 'utf8'),
  ) as { 'cocos-cli'?: { enginePath?: string } };
  const enginePath = packageJson['cocos-cli']?.enginePath;
  if (!enginePath) {
    throw new Error(`Project has no cocos-cli.enginePath: ${projectRoot}`);
  }
  return resolve(projectRoot, enginePath);
}

async function countSceneFiles(projectRoot: string): Promise<number> {
  const pending = [join(projectRoot, 'assets')];
  let count = 0;
  while (pending.length > 0) {
    const directory = pending.pop()!;
    const entries = await opendir(directory);
    for await (const entry of entries) {
      const absolutePath = join(directory, entry.name);
      if (entry.isDirectory()) {
        pending.push(absolutePath);
      } else if (entry.isFile() && extname(entry.name).toLowerCase() === '.scene') {
        count += 1;
      }
    }
  }
  return count;
}

function isSameOrigin(url: string, origin: string): boolean {
  try {
    return new URL(url).origin === origin;
  } catch {
    return false;
  }
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.stack ?? error.message : String(error);
}

function sceneScreenshotName(index: number, scene: PreviewSceneRecord): string {
  const sourceName = scene.name || basename(scene.url, extname(scene.url));
  const safeName = sourceName.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
  return `${String(index + 1).padStart(3, '0')}-${safeName || 'scene'}-${scene.uuid}.png`;
}

async function runScene(
  context: BrowserContext,
  origin: string,
  scene: PreviewSceneRecord,
  index: number,
  options: Arguments,
): Promise<SceneSweepResult> {
  const startedAt = Date.now();
  const screenshotFile = join(
    options.screenshotDirectory,
    sceneScreenshotName(index, scene),
  );
  const url = `${origin}/?scene=${encodeURIComponent(scene.uuid)}&runtimePreviewRenderType=webgl&debug=false`;
  const consoleErrors: string[] = [];
  const unhandledRejections: string[] = [];
  const pageErrors: string[] = [];
  const failedRequests: Array<{ url: string; errorText: string }> = [];
  const badResponses: Array<{ url: string; status: number }> = [];
  const failures: string[] = [];
  let networkRequestCount = 0;
  let ready: unknown = null;
  let canvas: SceneSweepResult['canvas'] = null;
  let screenshotError: string | undefined;
  let collecting = true;
  let page: Page | null = null;

  try {
    page = await context.newPage();
    page.on('console', (message) => {
      if (!collecting || message.type() !== 'error') {
        return;
      }
      const text = message.text();
      if (text.includes(UNHANDLED_REJECTION_PREFIX)) {
        unhandledRejections.push(text);
      } else {
        consoleErrors.push(text);
      }
    });
    page.on('pageerror', (error) => {
      if (collecting) {
        pageErrors.push(errorText(error));
      }
    });
    page.on('crash', () => {
      if (collecting) {
        pageErrors.push('Page crashed.');
      }
    });
    page.on('request', (request) => {
      if (collecting && isSameOrigin(request.url(), origin)) {
        networkRequestCount += 1;
      }
    });
    page.on('requestfailed', (request) => {
      if (collecting && isSameOrigin(request.url(), origin)) {
        failedRequests.push({
          url: request.url(),
          errorText: request.failure()?.errorText ?? '',
        });
      }
    });
    page.on('response', (response) => {
      if (collecting && isSameOrigin(response.url(), origin) && response.status() >= 400) {
        badResponses.push({ url: response.url(), status: response.status() });
      }
    });
    await page.addInitScript((prefix) => {
      window.addEventListener('unhandledrejection', (event) => {
        const reason = event.reason;
        const text = reason && (reason.stack || reason.message)
          ? String(reason.stack || reason.message)
          : String(reason);
        console.error(`${prefix} ${text}`);
      });
    }, UNHANDLED_REJECTION_PREFIX);

    await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: options.readyTimeoutMs,
    });
    await page.waitForFunction(
      (sceneUuid) => {
        const signal = (window as typeof window & {
          __RUNTIME_PREVIEW_READY?: { scene?: string };
        }).__RUNTIME_PREVIEW_READY;
        return signal?.scene === sceneUuid;
      },
      scene.uuid,
      { timeout: options.readyTimeoutMs },
    );
    ready = await page.evaluate(() => (
      window as typeof window & { __RUNTIME_PREVIEW_READY?: unknown }
    ).__RUNTIME_PREVIEW_READY ?? null);
    await page.waitForTimeout(options.stableWindowMs);
    canvas = await page.evaluate(() => {
      const element = document.querySelector('#GameCanvas');
      if (!(element instanceof HTMLCanvasElement)) {
        return null;
      }
      const rect = element.getBoundingClientRect();
      return {
        width: element.width,
        height: element.height,
        clientWidth: rect.width,
        clientHeight: rect.height,
      };
    });
  } catch (error) {
    failures.push(`runtime: ${errorText(error)}`);
  }

  if (page) {
    try {
      await page.screenshot({ path: screenshotFile, fullPage: false });
    } catch (error) {
      screenshotError = errorText(error);
      failures.push(`screenshot: ${screenshotError}`);
    }
  } else {
    screenshotError = 'Page was not created.';
    failures.push(`screenshot: ${screenshotError}`);
  }

  if (
    !ready
    || typeof ready !== 'object'
    || (ready as { scene?: unknown }).scene !== scene.uuid
  ) {
    failures.push(`ready: expected scene ${scene.uuid}, got ${JSON.stringify(ready)}`);
  }
  if (!canvas || canvas.width <= 0 || canvas.height <= 0 || canvas.clientWidth <= 0 || canvas.clientHeight <= 0) {
    failures.push(`canvas: invalid dimensions ${JSON.stringify(canvas)}`);
  }
  if (consoleErrors.length > 0) {
    failures.push(`console: ${consoleErrors.length} error(s)`);
  }
  if (unhandledRejections.length > 0) {
    failures.push(`unhandledrejection: ${unhandledRejections.length} error(s)`);
  }
  if (pageErrors.length > 0) {
    failures.push(`pageerror: ${pageErrors.length} error(s)`);
  }
  if (failedRequests.length > 0) {
    failures.push(`network: ${failedRequests.length} failed request(s)`);
  }
  if (badResponses.length > 0) {
    failures.push(`http: ${badResponses.length} response(s) >= 400`);
  }

  collecting = false;
  if (page) {
    await page.close({ runBeforeUnload: false }).catch(() => undefined);
  }

  return {
    index,
    scene,
    url,
    status: failures.length === 0 ? 'pass' : 'fail',
    failures,
    ready,
    elapsedMs: Date.now() - startedAt,
    networkRequestCount,
    consoleErrors,
    unhandledRejections,
    pageErrors,
    failedRequests,
    badResponses,
    canvas,
    screenshotFile,
    screenshotError,
  };
}

function escapeHtml(source: string): string {
  return source
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

async function createContactSheets(
  browser: Browser,
  results: SceneSweepResult[],
  screenshotDirectory: string,
): Promise<string[]> {
  const paths: string[] = [];
  const batchSize = 20;
  for (let offset = 0; offset < results.length; offset += batchSize) {
    const batch = results.slice(offset, offset + batchSize);
    const cards = await Promise.all(batch.map(async (result) => {
      let image = '';
      try {
        image = `data:image/png;base64,${(await readFile(result.screenshotFile)).toString('base64')}`;
      } catch {
        // The card still records the missing screenshot.
      }
      return `
        <article class="${result.status}">
          <img src="${image}" alt="">
          <div><strong>${String(result.index + 1).padStart(3, '0')} ${escapeHtml(result.scene.name ?? '')}</strong></div>
          <div>${escapeHtml(result.scene.url)}</div>
          <div>${result.status.toUpperCase()} ${escapeHtml(result.failures.join(' | '))}</div>
        </article>
      `;
    }));
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    await page.setContent(`
      <!doctype html>
      <style>
        * { box-sizing: border-box; }
        body { margin: 16px; color: #111; background: #fff; font: 14px/1.35 Arial, sans-serif; }
        h1 { margin: 0 0 12px; font-size: 24px; }
        main { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
        article { min-width: 0; border: 3px solid #17823b; padding: 6px; background: #f7faf8; }
        article.fail { border-color: #c62828; background: #fff7f7; }
        img { display: block; width: 100%; aspect-ratio: 16 / 9; object-fit: contain; background: #222; }
        div { overflow-wrap: anywhere; margin-top: 3px; }
        article div:last-child { color: #b71c1c; }
      </style>
      <h1>Runtime Preview scene sweep ${offset + 1}-${offset + batch.length} / ${results.length}</h1>
      <main>${cards.join('')}</main>
    `, { waitUntil: 'load' });
    const contactPath = join(
      screenshotDirectory,
      `contact-${String(offset / batchSize + 1).padStart(2, '0')}.png`,
    );
    await page.screenshot({ path: contactPath, fullPage: true });
    await page.close();
    paths.push(contactPath);
  }
  return paths;
}

async function writeCheckpoint(
  options: Arguments,
  payload: Record<string, unknown>,
): Promise<void> {
  await mkdir(dirname(options.evidenceFile), { recursive: true });
  await writeFile(options.evidenceFile, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

async function main(): Promise<void> {
  const options = parseArguments(process.argv.slice(2));
  const startedAt = Date.now();
  const sourceSceneCount = await countSceneFiles(options.projectRoot);
  const engineRoot = await readEngineRoot(options.projectRoot);
  const port = await findAvailablePort(19740);
  const browserExecutable = await findBrowserExecutable();
  await mkdir(options.screenshotDirectory, { recursive: true });

  let cli: StartedRuntimePreviewCliProcess | null = null;
  let browser: Browser | null = null;
  const results: SceneSweepResult[] = [];
  let contactSheets: string[] = [];
  try {
    cli = await startRuntimePreviewCliProcess({
      repoRoot: options.repoRoot,
      projectRoot: options.projectRoot,
      engineRoot,
      host: '127.0.0.1',
      port,
      startupTimeoutMs: 300_000,
      useRuntimeFlag: options.useRuntimeFlag,
      useTestEnvironment: false,
      noOpen: !options.useRuntimeFlag,
    });
    const sceneListResponse = await fetch(`${cli.url}/scene-list`);
    if (sceneListResponse.status !== 200) {
      throw new Error(`/scene-list returned HTTP ${sceneListResponse.status}.`);
    }
    const sceneList = await sceneListResponse.json() as {
      scenes: PreviewSceneRecord[];
      currentScene: string;
    };
    const uniqueSceneCount = new Set(sceneList.scenes.map((scene) => scene.uuid)).size;
    if (
      sceneList.scenes.length !== sourceSceneCount
      || uniqueSceneCount !== sceneList.scenes.length
    ) {
      throw new Error(
        `Scene inventory mismatch: source=${sourceSceneCount}, route=${sceneList.scenes.length}, unique=${uniqueSceneCount}.`,
      );
    }

    browser = await chromium.launch({
      executablePath: browserExecutable,
      headless: true,
    });
    const context = await browser.newContext({
      viewport: { width: 1280, height: 720 },
      deviceScaleFactor: 1,
    });
    for (let index = 0; index < sceneList.scenes.length; index += 1) {
      const result = await runScene(
        context,
        cli.url,
        sceneList.scenes[index],
        index,
        options,
      );
      results.push(result);
      console.log(JSON.stringify({
        completed: index + 1,
        total: sceneList.scenes.length,
        status: result.status,
        scene: result.scene.url,
        elapsedMs: result.elapsedMs,
        failures: result.failures,
      }));
      await writeCheckpoint(options, {
        status: 'in-progress',
        generatedAt: new Date().toISOString(),
        sourceSceneCount,
        routeSceneCount: sceneList.scenes.length,
        currentScene: sceneList.currentScene,
        completed: results.length,
        results,
      });
    }
    await context.close();
    contactSheets = await createContactSheets(
      browser,
      results,
      options.screenshotDirectory,
    );

    const command = `${cli.command} ${cli.args.join(' ')}`;
    const previewUrl = cli.url;
    const cliOutput = cli.stdout;
    const closeResult = await cli.close();
    cli = null;
    const failures = results.filter((result) => result.status === 'fail');
    const status = failures.length === 0 && closeResult.portReleased ? 'pass' : 'fail';
    await writeCheckpoint(options, {
      status,
      generatedAt: new Date().toISOString(),
      elapsedMs: Date.now() - startedAt,
      repoRoot: options.repoRoot,
      projectRoot: options.projectRoot,
      engineRoot,
      browserExecutable,
      previewUrl,
      command,
      sourceSceneCount,
      routeSceneCount: results.length,
      passedScenes: results.length - failures.length,
      failedScenes: failures.length,
      portReleased: closeResult.portReleased,
      contactSheets,
      results,
      cliOutput,
    });
    console.log(JSON.stringify({
      status,
      evidence: options.evidenceFile,
      sourceSceneCount,
      routeSceneCount: results.length,
      passedScenes: results.length - failures.length,
      failedScenes: failures.length,
      portReleased: closeResult.portReleased,
      contactSheets,
    }, null, 2));
    if (status !== 'pass') {
      process.exitCode = 1;
    }
  } finally {
    await browser?.close().catch(() => undefined);
    if (cli) {
      await cli.close().catch(() => undefined);
    }
  }
}

void main().catch((error) => {
  console.error(errorText(error));
  process.exitCode = 1;
});
