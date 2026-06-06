import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { getFixturePaths } from '@shared/fixture-paths';
import { captureJsonAssetHttpRuntimeUrls } from '@shared/http-url-capture';
import { PreviewSettingsProvider } from '@runtime-preview/settings/preview-settings-provider';
import { startRuntimePreviewServer } from '@runtime-preview/server/runtime-preview-server';

describe('runtime preview production asset routes', () => {
  it('serves an engine-captured asset import URL without test-only capturedRuntimeUrls', async () => {
    const paths = getFixturePaths();
    const capturedUrls = await captureJsonAssetHttpRuntimeUrls();
    const capturedImport = capturedUrls.find((entry) => entry.routeCategory === 'import');
    expect(capturedImport?.probe).toBe('http-base');

    const server = await startRuntimePreviewServer({
      projectRoot: paths.projectRoot,
      engineRoot: paths.engineRoot,
      projectLibraryRoot: paths.editorLibraryRef,
      projectProgrammingRoot: join(paths.editorProgrammingRef, 'programming'),
      host: '127.0.0.1',
      port: 0,
      settingsProvider: new PreviewSettingsProvider({
        loadPreviewSettings: async () => ({
          settings: {
            assets: {
              importBase: 'http://127.0.0.1:19530/assets',
              nativeBase: 'http://127.0.0.1:19530/assets',
              server: 'http://127.0.0.1:19530',
              remoteBundles: ['resources'],
            },
          },
          script2library: {},
          bundleConfigs: [
            {
              name: 'resources',
              importBase: 'import',
              nativeBase: 'native',
              paths: {
                'e62d10c9-29b9-4d53-833b-5769b524b759': [
                  'test_area_edge_graphic/Season_1',
                  'cc.JsonAsset',
                ],
              },
            },
          ],
        }),
      }),
    });

    try {
      const response = await fetch(`${server.url}${capturedImport!.url}`);
      expect(response.status).toBe(200);
      expect((await response.json()).__type__).toBe('cc.JsonAsset');

      const nativeResponse = await fetch(`${server.url}${capturedImport!.url.replace('/import/', '/native/')}`);
      expect(nativeResponse.status).toBe(404);

      const unconfiguredImportResponse = await fetch(
        `${server.url}${capturedImport!.url.replace(
          'e62d10c9-29b9-4d53-833b-5769b524b759',
          'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        )}`,
      );
      expect(unconfiguredImportResponse.status).toBe(404);

      expect(server.context.preloadedLibraryFileCount).toBe(0);
      expect(server.context.preloadedProgrammingFileCount).toBe(0);
    } finally {
      await server.close();
    }
  });
});
