import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { getFixturePaths } from '@shared/fixture-paths';
import { captureJsonAssetHttpRuntimeUrls, captureRepresentativeHttpRuntimeUrls } from '@shared/http-url-capture';
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
      expect(nativeResponse.status).toBe(200);

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
  }, 120_000);

  it('serves engine-captured native URLs by direct library tail lookup', async () => {
    const paths = getFixturePaths();
    const capturedUrls = await captureRepresentativeHttpRuntimeUrls();
    const capturedNative = capturedUrls.find((entry) => entry.routeCategory === 'native');
    expect(capturedNative).toMatchObject({
      routeCategory: 'native',
      sourceOperation: 'resources.load(ImageAsset)',
      expectedArtifactKind: 'native-image',
      probe: 'http-base',
    });

    const imageAssetUuid = /^\/assets\/resources\/native\/[0-9a-f]{2}\/([0-9a-f-]{36})\.(?:png|jpg|jpeg)$/.exec(capturedNative!.url)?.[1];
    expect(imageAssetUuid).toBeTruthy();

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
                [imageAssetUuid!]: [
                  'test_dynamic_atlas/Atlas',
                  'cc.ImageAsset',
                ],
              },
            },
          ],
        }),
      }),
    });

    try {
      const response = await fetch(`${server.url}${capturedNative!.url}`);
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('image/png');

      const unconfiguredExistingNativeRelativePath = '08/0868af97-c788-44fb-a472-5b6e27a05f81.png';
      expect(existsSync(join(paths.editorLibraryRef, unconfiguredExistingNativeRelativePath))).toBe(true);
      const unconfiguredExistingNativeResponse = await fetch(
        `${server.url}/assets/resources/native/${unconfiguredExistingNativeRelativePath}`,
      );
      expect(unconfiguredExistingNativeResponse.status).toBe(200);

      const configuredUuidWrongNativeExtensionResponse = await fetch(
        `${server.url}${capturedNative!.url.replace(/\.(?:png|jpg|jpeg)$/, '.json')}`,
      );
      expect(configuredUuidWrongNativeExtensionResponse.status).toBe(200);
    } finally {
      await server.close();
    }
  }, 120_000);

  it('starts the real Launcher runtime preview path and warms settings before browser settings requests', async () => {
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
          settingsTimeoutMs: 120_000,
        });

        try {
          const health = await fetch(server.url + '/__runtime-preview/health');
          process.stdout.write('AFTER_START\\n');
          const settingsResponse = await fetch(server.url + '/settings.js');
          const settingsSource = await settingsResponse.text();
          const settings = JSON.parse(settingsSource.replace(/^window\\._CCSettings = /, '').replace(/;$/, ''));
          const defaultPhysicsMaterialUuid = 'ba21476f-2866-4f81-9c4d-6e359316e448';
          const previewSettings = await server.settingsProvider.getPreviewSettings();
          const bundleConfigSummaries = [];
          for (const providerConfig of previewSettings.bundleConfigs) {
            const bundleName = providerConfig.name;
            if (typeof bundleName !== 'string' || !bundleName) {
              continue;
            }
            const configResponse = await fetch(server.url + '/assets/' + bundleName + '/config.json');
            const config = configResponse.status === 200 ? await configResponse.json() : null;
            bundleConfigSummaries.push({
              name: bundleName,
              status: configResponse.status,
              providerPackCount: providerConfig.packs ? Object.keys(providerConfig.packs).length : 0,
              routePackCount: config?.packs ? Object.keys(config.packs).length : 0,
              providerRedirectCount: Array.isArray(providerConfig.redirect) ? providerConfig.redirect.length : 0,
              routeRedirectCount: Array.isArray(config?.redirect) ? config.redirect.length : 0,
            });
          }
          process.stdout.write('RESULT ' + JSON.stringify({
            serverUrl: server.url,
            healthStatus: health.status,
            settingsStatus: settingsResponse.status,
            assetsServer: settings.assets?.server,
            launchScene: settings.launch?.launchScene,
            defaultPhysicsMaterialIncluded: Array.isArray(settings.engine?.builtinAssets)
              && settings.engine.builtinAssets.includes(defaultPhysicsMaterialUuid),
            logFilePath: server.logFilePath,
            bundleConfigSummaries,
          }) + '\\n');
        } finally {
          await server.close();
        }
      })().catch((error) => {
        process.stderr.write(String(error && (error.stack || error.message || error)) + '\\n');
        process.exit(1);
      });
    `;

    let stdout = '';
    try {
      ({ stdout } = await execFileAsync(process.execPath, [tsxCli, '-e', code], {
        cwd: repoRoot,
        env: {
          ...process.env,
          COCOS_CLI_TEST_PROJECT_ROOT: paths.projectRoot,
          COCOS_CLI_TEST_ENGINE_ROOT: paths.engineRoot,
        },
        timeout: 120_000,
      }));
    } catch (error: any) {
      throw new Error([
        error?.message,
        'stdout:',
        error?.stdout ?? '',
        'stderr:',
        error?.stderr ?? '',
      ].join('\n'));
    }
    const resultLine = stdout.trim().split(/\r?\n/).find((line) => line.startsWith('RESULT '));
    expect(resultLine).toBeTruthy();
    expect(stdout.indexOf('[runtime-preview] engine:init:start')).toBeLessThan(stdout.indexOf('AFTER_START'));
    expect(stdout.indexOf('[runtime-preview] preview:ready')).toBeLessThan(stdout.indexOf('AFTER_START'));
    expect(stdout).toContain('[runtime-preview] server:listening ');
    expect(stdout).toContain('[runtime-preview] preview:preparing');
    expect(stdout).toContain('[runtime-preview] engine:init:start');
    expect(stdout).toContain('[runtime-preview] engine:init:done');
    expect(stdout).toContain('[runtime-preview] programming:cache-clear:start');
    expect(stdout).toContain('[runtime-preview] programming:cache-clear:done');
    expect(stdout).toContain('[runtime-preview] asset-db:start');
    expect(stdout).toContain('[runtime-preview] asset-db:script-compile:done');
    expect(stdout).toContain('[runtime-preview] asset-db:done');
    expect(stdout).toContain('[runtime-preview] builder:init:start');
    expect(stdout).toContain('[runtime-preview] builder:init:done');
    expect(stdout).toContain('[runtime-preview] programming:prerequisite-scope');
    expect(stdout).toContain('[runtime-preview] preview:ready');
    expect(stdout.indexOf('[runtime-preview] programming:cache-clear:start')).toBeLessThan(stdout.indexOf('[runtime-preview] asset-db:start'));
    expect(stdout.indexOf('[runtime-preview] asset-db:script-compile:done')).toBeLessThan(stdout.indexOf('[runtime-preview] preview:ready'));
    expect(stdout).not.toContain('[runtime-preview] asset-db:script-compile:error');
    const result = JSON.parse(resultLine!.slice('RESULT '.length)) as {
      serverUrl: string;
      healthStatus: number;
      settingsStatus: number;
      assetsServer: string;
      launchScene: string;
      defaultPhysicsMaterialIncluded: boolean;
      logFilePath: string;
      bundleConfigSummaries: Array<{
        name: string;
        status: number;
        providerPackCount: number;
        routePackCount: number;
        providerRedirectCount: number;
        routeRedirectCount: number;
      }>;
    };

    expect(result.healthStatus).toBe(200);
    expect(result.settingsStatus).toBe(200);
    expect(result.assetsServer).toBe(result.serverUrl);
    expect(result.launchScene).toBe(diagnosticSceneUuid);
    expect(result.defaultPhysicsMaterialIncluded).toBe(true);
    expect(result.bundleConfigSummaries.length).toBeGreaterThan(0);
    expect(result.bundleConfigSummaries.every((summary) => summary.status === 200)).toBe(true);
    expect(result.bundleConfigSummaries.map((summary) => summary.routePackCount)).toEqual(
      result.bundleConfigSummaries.map((summary) => summary.providerPackCount),
    );
    expect(result.bundleConfigSummaries.map((summary) => summary.routeRedirectCount)).toEqual(
      result.bundleConfigSummaries.map((summary) => summary.providerRedirectCount),
    );
    expect(
      result.bundleConfigSummaries.filter((summary) => summary.providerPackCount > 0 || summary.providerRedirectCount > 0),
      'current real CLI preview bundle configs have no pack/redirect entries; any non-empty entry must become a fact-backed route implementation task',
    ).toEqual([]);
    const logSource = await readFile(result.logFilePath, 'utf8');
    expect(logSource).toContain('server:listening');
    expect(logSource).toContain('preview:preparing');
    expect(logSource).toContain('engine:init:start');
    expect(logSource).toContain('engine:init:done');
    expect(logSource).toContain('programming:cache-clear:start');
    expect(logSource).toContain('programming:cache-clear:done');
    expect(logSource).toContain('asset-db:start');
    expect(logSource).toContain('asset-db:script-compile:done');
    expect(logSource).toContain('asset-db:done');
    expect(logSource).toContain('builder:init:start');
    expect(logSource).toContain('builder:init:done');
    expect(logSource).toContain('programming:prerequisite-scope');
    expect(logSource).toContain('preview:ready');
    expect(logSource).not.toContain('asset-db:script-compile:error');
  }, 120_000);

  it('reports runtime preview script compile errors without blocking preview ready', async () => {
    const paths = getFixturePaths();
    const repoRoot = join(process.cwd(), '..');
    const tsxCli = join(repoRoot, 'node_modules/tsx/dist/cli.mjs');
    const code = `
      import Launcher from './src/core/launcher.ts';

      const originalImport = Launcher.prototype.import;
      Launcher.prototype.import = async function patchedRuntimePreviewImport(options) {
        await originalImport.call(this, options);
        globalThis.__cocosCliRuntimePreviewDiagnostics?.event(
          'asset-db:script-compile:error durationMs=1 count=1 synthetic-error',
        );
      };

      void (async () => {
        const launcher = new Launcher(process.env.COCOS_CLI_TEST_PROJECT_ROOT);
        const server = await launcher.startRuntimePreview({
          host: '127.0.0.1',
          port: 0,
          scene: '${diagnosticSceneUuid}',
          settingsTimeoutMs: 120_000,
        });

        try {
          process.stdout.write('RESULT ' + JSON.stringify({
            serverUrl: server.url,
            logFilePath: server.logFilePath,
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
    expect(stdout).toContain('[runtime-preview] asset-db:script-compile:error durationMs=1 count=1 synthetic-error');
    expect(stdout).toContain('[runtime-preview] asset-db:script-compile:report-only source=asset-db:script-compile:error');
    expect(stdout).toContain('[runtime-preview] preview:ready');

    const result = JSON.parse(resultLine!.slice('RESULT '.length)) as {
      serverUrl: string;
      logFilePath: string;
    };
    expect(result.serverUrl).toContain('http://');
    const logSource = await readFile(result.logFilePath, 'utf8');
    expect(logSource).toContain('asset-db:script-compile:error durationMs=1 count=1 synthetic-error');
    expect(logSource).toContain('asset-db:script-compile:report-only source=asset-db:script-compile:error');
    expect(logSource).toContain('preview:ready');
  }, 120_000);

  it('reports programming artifact inspection failures after script compile errors without blocking preview ready', async () => {
    const paths = getFixturePaths();
    const repoRoot = join(process.cwd(), '..');
    const tsxCli = join(repoRoot, 'node_modules/tsx/dist/cli.mjs');
    const code = `
      import { mkdtemp } from 'node:fs/promises';
      import { tmpdir } from 'node:os';
      import { join } from 'node:path';
      import Launcher from './src/core/launcher.ts';

      const originalImport = Launcher.prototype.import;
      Launcher.prototype.import = async function patchedRuntimePreviewImport(options) {
        await originalImport.call(this, options);
        globalThis.__cocosCliRuntimePreviewDiagnostics?.event(
          'asset-db:script-compile:error durationMs=1 count=1 synthetic-error',
        );
      };

      void (async () => {
        process.env.COCOS_CLI_TEST_EDITOR_PROGRAMMING_REF = await mkdtemp(join(tmpdir(), 'runtime-preview-missing-programming-'));
        const launcher = new Launcher(process.env.COCOS_CLI_TEST_PROJECT_ROOT);
        const server = await launcher.startRuntimePreview({
          host: '127.0.0.1',
          port: 0,
          scene: '${diagnosticSceneUuid}',
          settingsTimeoutMs: 120_000,
        });

        try {
          process.stdout.write('RESULT ' + JSON.stringify({
            serverUrl: server.url,
            logFilePath: server.logFilePath,
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
    expect(stdout).toContain('[runtime-preview] asset-db:script-compile:error durationMs=1 count=1 synthetic-error');
    expect(stdout).toContain('[runtime-preview] programming:inspection:report-only source=asset-db:script-compile:error');
    expect(stdout).toContain('[runtime-preview] preview:ready');

    const result = JSON.parse(resultLine!.slice('RESULT '.length)) as {
      serverUrl: string;
      logFilePath: string;
    };
    expect(result.serverUrl).toContain('http://');
    const logSource = await readFile(result.logFilePath, 'utf8');
    expect(logSource).toContain('programming:inspection:report-only source=asset-db:script-compile:error');
    expect(logSource).toContain('preview:ready');
  }, 120_000);
});
