import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { getFixturePaths } from '@shared/fixture-paths';
import { captureJsonAssetHttpRuntimeUrls } from '@shared/http-url-capture';
import { PreviewSettingsProvider } from '@runtime-preview/settings/preview-settings-provider';
import { startRuntimePreviewServer } from '@runtime-preview/server/runtime-preview-server';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const diagnosticSceneUuid = '5d1de01c-5229-4d34-bde3-2c90372f88d9';

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

  it('starts the real Launcher runtime preview path and serves settings', async () => {
    const paths = getFixturePaths();
    const repoRoot = join(process.cwd(), '..');
    const tsxCli = join(repoRoot, 'node_modules/tsx/dist/cli.mjs');
    const code = `
      import Launcher from './src/core/launcher.ts';

      void (async () => {
        const launcher = new Launcher(process.env.COCOS_CLI_TEST_PROJECT_ROOT);
        const server = await launcher.startRuntimePreview({
          host: '127.0.0.1',
          port: 0,
          scene: '${diagnosticSceneUuid}',
        });

        try {
          const health = await fetch(server.url + '/__runtime-preview/health');
          const settingsResponse = await fetch(server.url + '/settings.js');
          const settingsSource = await settingsResponse.text();
          const settings = JSON.parse(settingsSource.replace(/^window\\._CCSettings = /, '').replace(/;$/, ''));
          process.stdout.write('RESULT ' + JSON.stringify({
            serverUrl: server.url,
            healthStatus: health.status,
            settingsStatus: settingsResponse.status,
            assetsServer: settings.assets?.server,
            launchScene: settings.launch?.launchScene,
          }) + '\\n');
        } finally {
          await server.close();
        }
      })().catch((error) => {
        process.stderr.write(String(error && (error.stack || error.message || error)) + '\\n');
        process.exit(1);
      });
    `;

    const { stdout } = await execFileAsync(process.execPath, [tsxCli, '-e', code], {
      cwd: repoRoot,
      env: {
        ...process.env,
        COCOS_CLI_TEST_PROJECT_ROOT: paths.projectRoot,
        COCOS_CLI_TEST_ENGINE_ROOT: paths.engineRoot,
      },
      timeout: 120_000,
    });
    const resultLine = stdout.trim().split(/\r?\n/).find((line) => line.startsWith('RESULT '));
    expect(resultLine).toBeTruthy();
    const result = JSON.parse(resultLine!.slice('RESULT '.length)) as {
      serverUrl: string;
      healthStatus: number;
      settingsStatus: number;
      assetsServer: string;
      launchScene: string;
    };

    expect(result.healthStatus).toBe(200);
    expect(result.settingsStatus).toBe(200);
    expect(result.assetsServer).toBe(result.serverUrl);
    expect(result.launchScene).toBe(diagnosticSceneUuid);
  }, 120_000);
});
