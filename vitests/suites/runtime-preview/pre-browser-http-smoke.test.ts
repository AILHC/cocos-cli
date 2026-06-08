import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { getFixturePaths } from '@shared/fixture-paths';
import { captureJsonAssetHttpRuntimeUrls } from '@shared/http-url-capture';
import { PreviewSettingsProvider } from '@runtime-preview/settings/preview-settings-provider';
import { startRuntimePreviewServer } from '@runtime-preview/server/runtime-preview-server';

describe('runtime preview pre-browser HTTP smoke', () => {
  it('serves representative settings, bundle, captured asset, and scripting endpoints before opening a browser', async () => {
    const paths = getFixturePaths();
    const capturedRuntimeUrls = await captureJsonAssetHttpRuntimeUrls();
    const capturedImport = capturedRuntimeUrls.find((entry) => entry.routeCategory === 'import');
    expect(capturedImport).toBeTruthy();

    const server = await startRuntimePreviewServer({
      projectRoot: paths.projectRoot,
      engineRoot: paths.engineRoot,
      projectLibraryRoot: paths.editorLibraryRef,
      projectProgrammingRoot: join(paths.editorProgrammingRef, 'programming'),
      host: '127.0.0.1',
      port: 0,
      capturedRuntimeUrls,
      settingsProvider: new PreviewSettingsProvider({
        loadPreviewSettings: async () => ({
          settings: {
            assets: {
              importBase: 'http://127.0.0.1:19530/assets',
              nativeBase: 'http://127.0.0.1:19530/assets',
              server: 'http://127.0.0.1:19530',
              remoteBundles: ['internal', 'main', 'resources'],
            },
          },
          script2library: {},
          bundleConfigs: [
            {
              name: 'resources',
              importBase: 'import',
              nativeBase: 'native',
              paths: {
                'e62d10c9-29b9-4d53-833b-5769b524b759': ['test_area_edge_graphic/Season_1', 'cc.JsonAsset'],
              },
            },
          ],
        }),
      }),
    });

    try {
      const settings = await fetch(`${server.url}/settings.js`);
      expect(settings.status).toBe(200);
      expect(await settings.text()).toContain('window._CCSettings = ');

      const bundleConfig = await fetch(`${server.url}/assets/resources/config.json`);
      expect(bundleConfig.status).toBe(200);
      expect((await bundleConfig.json()).name).toBe('resources');

      const importedAsset = await fetch(`${server.url}${capturedImport!.url}`);
      expect(importedAsset.status).toBe(200);
      expect((await importedAsset.json()).__type__).toBe('cc.JsonAsset');

      const importMap = await fetch(`${server.url}/scripting/x/packer-driver/targets/preview/import-map.json`);
      expect(importMap.status).toBe(200);
      const importMapJson = await importMap.json() as { imports: Record<string, string> };
      const firstChunk = Object.values(importMapJson.imports).find((value) => value.startsWith('./chunks/'));
      expect(firstChunk).toBeTruthy();

      const chunkPath = firstChunk!.slice('./'.length);
      const chunk = await fetch(`${server.url}/scripting/x/packer-driver/targets/preview/${chunkPath}`);
      expect(chunk.status).toBe(200);
      expect(await chunk.text()).toContain('System.register');
    } finally {
      await server.close();
    }
  }, 120_000);
});
