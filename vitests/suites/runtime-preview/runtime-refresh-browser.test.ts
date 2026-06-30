import { accessSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, type Browser, type ConsoleMessage, type Page } from 'playwright-core';
import { describe, expect, it, vi } from 'vitest';
import { PreviewSettingsProvider } from '@runtime-preview/settings/preview-settings-provider';
import { startRuntimePreviewServer } from '@runtime-preview/server/runtime-preview-server';
import type { RuntimeRefreshResult } from '@runtime-preview/refresh/runtime-refresh-coordinator';
import type { StartedRuntimePreviewServer } from '@runtime-preview/server/runtime-preview-server';

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

function createRefreshResult(overrides: Partial<RuntimeRefreshResult> = {}): RuntimeRefreshResult {
  return {
    ok: true,
    refreshId: 'runtime-refresh-browser',
    target: 'db://assets',
    reason: 'endpoint',
    changedAssetCount: 1,
    scriptCompile: {
      status: 'done',
      durationMs: 0,
    },
    durationMs: 0,
    ...overrides,
  };
}

async function openRuntimePreviewPage(options: {
  refresh: (input: { reason: 'endpoint' | 'reload'; target?: unknown }) => Promise<RuntimeRefreshResult>;
  templateHtml?: string;
  refreshOnReload?: boolean;
  watcherStatus?: {
    enabled: boolean;
    running: boolean;
    assetsRoot: string;
    error?: string;
    eventCount: number;
    dirtyTargetCount: number;
    sampleTargets: string[];
  };
  onConsole?: (message: ConsoleMessage) => void;
}) {
  const root = await mkdtemp(join(tmpdir(), 'runtime-refresh-browser-'));
  let server: StartedRuntimePreviewServer | null = null;
  let browser: Browser | null = null;
  try {
    const projectRoot = join(root, 'project');
    const engineRoot = join(root, 'engine');
    const projectLibraryRoot = join(projectRoot, 'library');
    const projectProgrammingRoot = join(projectRoot, 'temp', 'cli', 'programming');
    const templateRoot = join(projectRoot, 'preview-template');
    await mkdir(templateRoot, { recursive: true });
    await mkdir(projectLibraryRoot, { recursive: true });
    await mkdir(projectProgrammingRoot, { recursive: true });
    await mkdir(engineRoot, { recursive: true });
    await writeFile(
      join(templateRoot, 'index.ejs'),
      options.templateHtml ?? [
        '<html>',
        '<head><link rel="stylesheet" href="/index.css"></head>',
        '<body>',
        '<main id="custom-preview-root">custom runtime preview</main>',
        '<script>',
        'window.addEventListener("beforeunload", function () {',
        '  var count = Number(localStorage.getItem("runtime-refresh-beforeunload-count") || "0") + 1;',
        '  localStorage.setItem("runtime-refresh-beforeunload-count", String(count));',
        '  localStorage.setItem("runtime-refresh-beforeunload-last", JSON.stringify(window.__RUNTIME_PREVIEW_LAST_REFRESH__ || null));',
        '});',
        '</script>',
        '</body>',
        '</html>',
      ].join('\n'),
      'utf8',
    );

    server = await startRuntimePreviewServer({
      projectRoot,
      engineRoot,
      projectLibraryRoot,
      projectProgrammingRoot,
      host: '127.0.0.1',
      port: 0,
      settingsProvider: new PreviewSettingsProvider({
        loadPreviewSettings: async () => ({
          settings: {},
          script2library: {},
          bundleConfigs: [],
        }),
      }),
      refreshCoordinator: {
        refresh: options.refresh,
      },
      refreshOnReload: options.refreshOnReload,
      watchAssets: options.watcherStatus?.enabled,
      assetChangeWatcherFactory: options.watcherStatus
        ? () => ({
          start: async () => undefined,
          stop: async () => undefined,
          getStatus: () => options.watcherStatus!,
        })
        : undefined,
    });
    browser = await chromium.launch({
      executablePath: findBrowserExecutable(),
      headless: true,
    });
    const page = await browser.newPage({ viewport: { width: 900, height: 600 } });
    if (options.onConsole) {
      page.on('console', options.onConsole);
    }
    await page.goto(server.url, { waitUntil: 'domcontentloaded' });
    return { root, server, browser, page };
  } catch (error) {
    await browser?.close().catch(() => {});
    await server?.close().catch(() => {});
    await rm(root, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}

async function closeRuntimePreviewPage(resources: {
  root: string;
  server: { close: () => Promise<void> };
  browser: Browser;
}) {
  try {
    await resources.browser.close().catch(() => {});
    await resources.server.close().catch(() => {});
  } finally {
    await rm(resources.root, { recursive: true, force: true }).catch(() => {});
  }
}

describe('runtime refresh browser integration', () => {
  it('posts to the refresh endpoint and reloads after an ok result', async () => {
    const refresh = vi.fn(async () => createRefreshResult());
    const resources = await openRuntimePreviewPage({ refresh });
    try {
      await resources.page.waitForSelector('#btn-runtime-refresh');
      const reload = resources.page.waitForNavigation({ waitUntil: 'domcontentloaded' });
      await resources.page.click('#btn-runtime-refresh');
      await reload;
      await resources.page.waitForFunction(() => localStorage.getItem('runtime-refresh-beforeunload-count') === '1');

      expect(refresh).toHaveBeenCalledWith({ reason: 'endpoint', target: undefined });
      const savedRefresh = await resources.page.evaluate(() => localStorage.getItem('runtime-refresh-beforeunload-last'));
      expect(JSON.parse(savedRefresh ?? 'null')).toMatchObject({
        ok: true,
        refreshId: 'runtime-refresh-browser',
      });
    } finally {
      await closeRuntimePreviewPage(resources);
    }
  }, 60_000);

  it('creates a fixed fallback button for custom templates without a toolbar', async () => {
    const resources = await openRuntimePreviewPage({
      refresh: async () => createRefreshResult(),
    });
    try {
      const button = resources.page.locator('#btn-runtime-refresh');
      await expectButtonVisible(resources.page);
      await expect(button.evaluate((element) => element.classList.contains('runtime-preview-refresh-fixed'))).resolves.toBe(true);
      await expect(button.evaluate((element) => getComputedStyle(element).position)).resolves.toBe('fixed');
    } finally {
      await closeRuntimePreviewPage(resources);
    }
  }, 60_000);

  it('binds an existing toolbar refresh button without creating a duplicate', async () => {
    const refresh = vi.fn(async () => createRefreshResult());
    const resources = await openRuntimePreviewPage({
      refresh,
      templateHtml: [
        '<html>',
        '<head><link rel="stylesheet" href="/index.css"></head>',
        '<body>',
        '<div class="toolbar">',
        '<button id="btn-runtime-refresh" class="item" type="button" title="Refresh AssetDB">Refresh</button>',
        '</div>',
        '<main id="custom-preview-root">custom runtime preview</main>',
        '</body>',
        '</html>',
      ].join('\n'),
    });
    try {
      await resources.page.waitForSelector('#btn-runtime-refresh');
      await expect(resources.page.locator('#btn-runtime-refresh').count()).resolves.toBe(1);
      await expect(resources.page.locator('.toolbar #btn-runtime-refresh').count()).resolves.toBe(1);

      const reload = resources.page.waitForNavigation({ waitUntil: 'domcontentloaded' });
      await resources.page.click('#btn-runtime-refresh');
      await reload;

      expect(refresh).toHaveBeenCalledWith({ reason: 'endpoint', target: undefined });
      await expect(resources.page.locator('#btn-runtime-refresh').count()).resolves.toBe(1);
    } finally {
      await closeRuntimePreviewPage(resources);
    }
  }, 60_000);

  it('shows a toast and does not reload or console.error when refresh fails', async () => {
    const consoleErrors: string[] = [];
    const refresh = vi.fn(async () => createRefreshResult({
      ok: false,
      error: 'refresh failed',
      changedAssetCount: null,
      scriptCompile: {
        status: 'skipped',
        durationMs: 0,
      },
    }));
    const resources = await openRuntimePreviewPage({ refresh });
    resources.page.on('console', (message) => {
      if (message.type() === 'error') {
        consoleErrors.push(message.text());
      }
    });
    try {
      await resources.page.waitForSelector('#btn-runtime-refresh');
      await resources.page.click('#btn-runtime-refresh');
      await resources.page.waitForSelector('#runtime-preview-refresh-toast');

      expect(refresh).toHaveBeenCalledTimes(1);
      expect(await resources.page.locator('#runtime-preview-refresh-toast').textContent()).toContain('refresh failed');
      expect(await resources.page.evaluate(() => localStorage.getItem('runtime-refresh-beforeunload-count'))).toBeNull();
      await expect(resources.page.evaluate(() => (window as any).__RUNTIME_PREVIEW_REFRESH_STATE__)).resolves.toMatchObject({
        lastRefresh: {
          ok: false,
          error: 'refresh failed',
        },
      });
      await expect(resources.page.locator('#runtime-preview-compile-error-panel').count()).resolves.toBe(0);
      expect(consoleErrors).toEqual([]);
    } finally {
      await closeRuntimePreviewPage(resources);
    }
  }, 60_000);

  it('shows compile failure panel and does not reload after endpoint refresh compile failure', async () => {
    const refresh = vi.fn(async () => createRefreshResult({
      ok: false,
      error: 'Script compile failed: assets/scripts/broken.ts:7:11 Unexpected token',
      changedAssetCount: null,
      outputState: 'lastGoodDueToFailure',
      compileError: {
        phase: 'refresh',
        message: 'Unexpected token',
        location: {
          relativeFilePath: 'assets/scripts/broken.ts',
          line: 7,
          column: 11,
        },
        codeFrame: [
          '> 7 | const value = ;',
          '    |              ^',
        ].join('\n'),
      },
      scriptCompile: {
        status: 'failed',
        durationMs: 12,
      },
    }));
    const resources = await openRuntimePreviewPage({ refresh });
    try {
      await resources.page.waitForSelector('#btn-runtime-refresh');
      await resources.page.click('#btn-runtime-refresh');
      await resources.page.waitForSelector('#runtime-preview-compile-error-panel');

      const panelText = await resources.page.locator('#runtime-preview-compile-error-panel').textContent();
      expect(panelText).toContain('Script compile failed');
      expect(panelText).toContain('assets/scripts/broken.ts:7:11');
      expect(panelText).toContain('Unexpected token');
      expect(panelText).toContain('const value = ;');
      expect(panelText).toContain('Current change was not applied. Preview keeps last good scripts.');
      expect(await resources.page.locator('#runtime-preview-refresh-toast').textContent()).toContain('Script compile failed');
      expect(await resources.page.evaluate(() => localStorage.getItem('runtime-refresh-beforeunload-count'))).toBeNull();
      await expect(resources.page.evaluate(() => (window as any).__RUNTIME_PREVIEW_REFRESH_STATE__)).resolves.toMatchObject({
        lastRefresh: {
          ok: false,
          outputState: 'lastGoodDueToFailure',
          compileError: {
            message: 'Unexpected token',
          },
        },
      });
    } finally {
      await closeRuntimePreviewPage(resources);
    }
  }, 60_000);

  it('shows reload failure state on boot without console.error', async () => {
    const consoleErrors: string[] = [];
    const refresh = vi.fn(async (input: { reason: 'endpoint' | 'reload' }) => createRefreshResult({
      ok: false,
      reason: input.reason,
      error: 'reload failed',
      changedAssetCount: null,
      scriptCompile: {
        status: 'skipped',
        durationMs: 0,
      },
    }));
    const resources = await openRuntimePreviewPage({
      refresh,
      refreshOnReload: true,
      onConsole: (message) => {
        if (message.type() === 'error') {
          consoleErrors.push(message.text());
        }
      },
    });
    try {
      await resources.page.waitForSelector('#runtime-preview-refresh-toast');

      expect(refresh).toHaveBeenCalledWith({ reason: 'reload' });
      expect(await resources.page.locator('#runtime-preview-refresh-toast').textContent()).toContain('reload failed');
      await expect(resources.page.evaluate(() => (window as any).__RUNTIME_PREVIEW_REFRESH_ON_RELOAD__)).resolves.toMatchObject({
        ok: false,
        reason: 'reload',
        error: 'reload failed',
      });
      expect(consoleErrors).toEqual([]);
    } finally {
      await closeRuntimePreviewPage(resources);
    }
  }, 60_000);

  it('shows no-change message, clears a stale compile panel, and does not reload when watcher dirty-set is empty', async () => {
    const refresh = vi.fn()
      .mockResolvedValueOnce(createRefreshResult({
        ok: false,
        error: 'Script compile failed: assets/scripts/broken.ts:7:11 Unexpected token',
        changedAssetCount: null,
        outputState: 'lastGoodDueToFailure',
        compileError: {
          phase: 'refresh',
          target: 'preview',
          message: 'Unexpected token',
          location: {
            relativeFilePath: 'assets/scripts/broken.ts',
            line: 7,
            column: 11,
          },
          codeFrame: '> 7 | const value = ;',
          outputState: 'lastGoodDueToFailure',
        },
        scriptCompile: {
          status: 'failed',
          durationMs: 12,
          error: 'Unexpected token',
          diagnostic: {
            phase: 'refresh',
            target: 'preview',
            message: 'Unexpected token',
            location: {
              relativeFilePath: 'assets/scripts/broken.ts',
              line: 7,
              column: 11,
            },
            codeFrame: '> 7 | const value = ;',
            outputState: 'lastGoodDueToFailure',
          },
        },
      }))
      .mockResolvedValueOnce(createRefreshResult({
        ok: true,
        refreshId: 'watch-empty',
        target: 'dirty-set',
        targets: [],
        reason: 'endpoint',
        changedAssetCount: null,
        dirtyEventCount: 0,
        watcher: {
          enabled: true,
          running: true,
          assetsRoot: 'E:/project/assets',
          eventCount: 0,
          dirtyTargetCount: 0,
          sampleTargets: [],
        },
        scriptCompile: { status: 'skipped', durationMs: 0 },
        durationMs: 0,
      }));
    const resources = await openRuntimePreviewPage({ refresh });
    try {
      await resources.page.waitForSelector('#btn-runtime-refresh');
      await resources.page.click('#btn-runtime-refresh');
      await resources.page.waitForSelector('#runtime-preview-compile-error-panel');
      expect(await resources.page.locator('#runtime-preview-compile-error-panel').textContent()).toContain('Unexpected token');

      await resources.page.click('#btn-runtime-refresh');
      await resources.page.waitForFunction(() => {
        return document.querySelector('#runtime-preview-refresh-toast')?.textContent?.includes('No asset changes') === true;
      });

      expect(refresh).toHaveBeenCalledTimes(2);
      expect(await resources.page.locator('#runtime-preview-refresh-toast').textContent()).toContain('No asset changes');
      expect(await resources.page.evaluate(() => localStorage.getItem('runtime-refresh-beforeunload-count'))).toBeNull();
      await expect(resources.page.locator('#runtime-preview-compile-error-panel').count()).resolves.toBe(0);
      expect(await resources.page.locator('#btn-runtime-refresh').isEnabled()).toBe(true);
    } finally {
      await closeRuntimePreviewPage(resources);
    }
  }, 60_000);

  it('shows watcher unavailable toast from injected root state', async () => {
    const resources = await openRuntimePreviewPage({
      refresh: async () => createRefreshResult(),
      watcherStatus: {
        enabled: true,
        running: false,
        assetsRoot: 'E:/project/assets',
        error: 'native watcher unavailable',
        eventCount: 0,
        dirtyTargetCount: 0,
        sampleTargets: [],
      },
    });
    try {
      await resources.page.waitForSelector('#runtime-preview-refresh-toast');
      expect(await resources.page.locator('#runtime-preview-refresh-toast').textContent()).toContain('native watcher unavailable');
    } finally {
      await closeRuntimePreviewPage(resources);
    }
  }, 60_000);
});

async function expectButtonVisible(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const button = document.querySelector('#btn-runtime-refresh');
    if (!(button instanceof HTMLElement)) {
      return false;
    }
    const rect = button.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  });
}
