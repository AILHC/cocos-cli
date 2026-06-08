import { join } from 'node:path';
import { createServer } from 'node:net';
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { getFixturePaths } from '@shared/fixture-paths';
import {
  buildEditorLibraryInternalBundle,
  buildEditorLibraryResourcesBundle,
} from '@shared/editor-library-bundle';
import { runBrowserRuntimeSmoke } from '@shared/browser-runtime-smoke';
import { PreviewSettingsProvider } from '@runtime-preview/settings/preview-settings-provider';
import { startRuntimePreviewServer } from '@runtime-preview/server/runtime-preview-server';

function canListen(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once('error', () => resolve(false));
    server.listen(port, '127.0.0.1', () => {
      server.close(() => resolve(true));
    });
  });
}

describe('runtime preview browser runtime smoke', () => {
  it('opens production root and waits for browser ready after a real resources.load marker', async () => {
    const paths = getFixturePaths();
    const { config, samples } = await buildEditorLibraryResourcesBundle(paths.editorLibraryRef, { buildFileIndex: false });
    const internalBundle = await buildEditorLibraryInternalBundle(paths.engineRoot);
    const evidenceFilePath = join(paths.projectRoot, 'temp', 'runtime-preview-browser-smoke-evidence.json');

    expect(samples.jsonAsset?.resourcePath).toBeTruthy();

    const startupStartedAt = Date.now();
    const server = await startRuntimePreviewServer({
      projectRoot: paths.projectRoot,
      engineRoot: paths.engineRoot,
      projectLibraryRoot: paths.editorLibraryRef,
      projectProgrammingRoot: join(paths.editorProgrammingRef, 'programming'),
      cliProgrammingRoot: join(paths.projectRoot, 'temp', 'cli', 'programming'),
      internalLibraryRoot: join(paths.engineRoot, 'editor', 'library'),
      host: '127.0.0.1',
      port: 0,
      settingsProvider: new PreviewSettingsProvider({
        loadPreviewSettings: async () => ({
          settings: {
            launch: {
              launchScene: '',
            },
            engine: {
              builtinAssets: internalBundle.builtinAssets,
            },
            assets: {
              importBase: `${server.url}/assets`,
              nativeBase: `${server.url}/assets`,
              server: server.url,
              projectBundles: ['resources'],
              preloadBundles: [
                {
                  bundle: 'resources',
                },
              ],
              remoteBundles: ['internal'],
            },
          },
          script2library: {},
          bundleConfigs: [config, internalBundle.config],
        }),
      }),
    });
    const elapsedStartupMs = Date.now() - startupStartedAt;

    try {
      const url = [
        `${server.url}/?runtimePreviewReadyResource=${encodeURIComponent(samples.jsonAsset!.resourcePath)}`,
        'runtimePreviewReadyType=JsonAsset',
        'runtimePreviewRenderType=webgl',
        'debug=false',
      ].join('&');
      const smoke = await runBrowserRuntimeSmoke({
        url,
        runtimeServerOrigin: server.url,
        readyTimeoutMs: 60_000,
        stableWindowMs: 5_000,
        evidenceFilePath,
        evidenceContext: {
          serverUrl: server.url,
          logFilePath: server.logFilePath,
          elapsedStartupMs,
        },
      });

      expect(smoke.ready).toMatchObject({
        scene: '',
        resources: [
          {
            path: samples.jsonAsset!.resourcePath,
            type: 'JsonAsset',
          },
        ],
      });
      expect(smoke.networkRequestCount).toBeGreaterThan(0);
      expect(smoke.consoleErrors).toEqual([]);
      expect(smoke.pageErrors).toEqual([]);
      expect(smoke.failedRequests).toEqual([]);
      expect(smoke.badResponses).toEqual([]);

      const evidence = JSON.parse(await readFile(evidenceFilePath, 'utf8')) as Record<string, unknown>;
      expect(evidence).toMatchObject({
        status: 'pass',
        serverUrl: server.url,
        logFilePath: server.logFilePath,
        elapsedStartupMs,
        networkRequestCount: smoke.networkRequestCount,
      });
      expect(evidence.evidenceFilePath).toBeUndefined();
      expect(evidence.elapsedReadyMs).toBeGreaterThan(0);
      expect(evidence.elapsedTotalMs).toBeGreaterThanOrEqual(evidence.elapsedReadyMs as number);
    } finally {
      await server.close();
    }

    expect(await canListen(server.port)).toBe(true);
  }, 120_000);
});
