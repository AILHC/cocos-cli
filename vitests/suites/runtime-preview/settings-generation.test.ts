import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it, vi } from 'vitest';
import { PreviewSettingsProvider } from '@runtime-preview/settings/preview-settings-provider';
import { getFixturePaths } from '@shared/fixture-paths';

const execFileAsync = promisify(execFile);
const diagnosticSceneUuid = '5d1de01c-5229-4d34-bde3-2c90372f88d9';
// Real Engine.init can take longer when other engine-source probes run in the full suite.
const realEngineInitTimeoutMs = 120_000;

describe('runtime preview settings provider', () => {
  it('delegates to CLI preview settings output and preserves settings, bundle configs, and script map', async () => {
    const loadPreviewSettings = vi.fn(async () => ({
      settings: {
        assets: {
          importBase: 'http://127.0.0.1:19530/assets',
          nativeBase: 'http://127.0.0.1:19530/assets',
          server: 'http://127.0.0.1:19530',
          remoteBundles: ['internal', 'main', 'resources'],
        },
      },
      script2library: {
        'scripts/common/UICamera.js': '7d/7dcad1aac0fa6fc1a7794cb029eca6baa6a7601e.js',
        'test_cases/test_active_event_proccer/test_active_event_proccer.js': '6c/6cfa67594146f0e4f3017b0b9475bd63ad05873b.js',
      },
      bundleConfigs: [
        {
          name: 'resources',
          importBase: 'import',
          nativeBase: 'native',
          paths: {
            'e62d10c9-29b9-4d53-833b-5769b524b759': ['test_area_edge_graphic/Season_1', 'cc.JsonAsset'],
          },
        },
        {
          name: 'main',
          importBase: 'import',
          nativeBase: 'native',
          paths: {},
        },
      ],
    }));
    const provider = new PreviewSettingsProvider({
      loadPreviewSettings,
      now: (() => {
        let time = 100;
        return () => time += 7;
      })(),
    });

    const result = await provider.getPreviewSettings();

    expect(loadPreviewSettings).toHaveBeenCalledTimes(1);
    expect(result.settings.assets.server).toBe('http://127.0.0.1:19530');
    expect(result.settingsJsSource).toContain('window._CCSettings = ');
    expect(result.settingsJsSource).toContain('"remoteBundles":["internal","main","resources"]');
    expect(result.bundleConfigs).toHaveLength(2);
    expect(result.bundleConfigs[0].importBase).toBe('import');
    expect(result.bundleConfigs[0].nativeBase).toBe('native');
    expect(result.scriptRuntimeMap.script2library['scripts/common/UICamera.js']).toMatch(/\.js$/);
    expect(result.assetBaseConfig).toEqual({
      importBase: 'http://127.0.0.1:19530/assets',
      nativeBase: 'http://127.0.0.1:19530/assets',
      server: 'http://127.0.0.1:19530',
      remoteBundles: ['internal', 'main', 'resources'],
    });
    expect(result.diagnostics.elapsedMs).toBe(7);
    expect(result.diagnostics.timeoutMs).toBeNull();
    expect(result.diagnostics.normalBuildPipelineExecuted).toBe(false);
    expect(result.diagnostics.source).toBe('cli-getPreviewSettings');
  });

  it('initializes CLI Engine from the real engine root on Windows absolute paths', async () => {
    const paths = getFixturePaths();
    const packageJson = JSON.parse(await readFile(join(paths.engineRoot, 'package.json'), 'utf8')) as { version: string };
    const repoRoot = join(process.cwd(), '..');
    const tsxCli = join(repoRoot, 'node_modules/tsx/dist/cli.mjs');
    const code = `
      import('./src/core/engine/index.ts').then(async (m) => {
        const engineModule = m.default || m;
        await engineModule.Engine.init(process.env.COCOS_CLI_TEST_ENGINE_ROOT);
        console.log(JSON.stringify(engineModule.Engine.getInfo()));
      }).catch((error) => {
        console.error(error && (error.stack || error.message || error));
        process.exit(1);
      });
    `;

    const { stdout } = await execFileAsync(process.execPath, [tsxCli, '-e', code], {
      cwd: repoRoot,
      env: {
        ...process.env,
        COCOS_CLI_TEST_ENGINE_ROOT: paths.engineRoot,
      },
      timeout: realEngineInitTimeoutMs,
    });
    const info = JSON.parse(stdout.trim()) as { version: string; typescript: { path: string } };

    expect(info.typescript.path).toBe(paths.engineRoot);
    expect(info.version).toBe(packageJson.version);
  }, realEngineInitTimeoutMs);

  it('forwards runtime server and scene build options to CLI preview settings generation', async () => {
    const buildOptions = {
      server: 'http://127.0.0.1:19530',
      startScene: diagnosticSceneUuid,
    };
    const loadPreviewSettings = vi.fn(async () => ({
      settings: {
        assets: {
          server: buildOptions.server,
        },
        launch: {
          launchScene: buildOptions.startScene,
        },
      },
      script2library: {},
      bundleConfigs: [],
    }));
    const provider = new PreviewSettingsProvider({
      loadPreviewSettings,
      buildOptions,
      timeoutMs: 1000,
    });

    const result = await provider.getPreviewSettings();

    expect(loadPreviewSettings).toHaveBeenCalledWith(buildOptions);
    expect(result.settings.assets.server).toBe(buildOptions.server);
    expect(result.settingsJsSource).toContain(`"launchScene":"${diagnosticSceneUuid}"`);
  });

  it('caches successful generation without erasing independent script or bundle data', async () => {
    const loadPreviewSettings = vi.fn(async () => ({
      settings: { assets: {} },
      script2library: {
        'kept-a.js': 'aa/kept-a.js',
        'kept-b.js': 'bb/kept-b.js',
      },
      bundleConfigs: [
        { name: 'bundle-with-gap', importBase: 'import', nativeBase: 'native' },
        { name: 'unrelated', importBase: 'import', nativeBase: 'native', paths: { uuid: ['path', 'cc.JsonAsset'] } },
      ],
    }));
    const provider = new PreviewSettingsProvider({ loadPreviewSettings, timeoutMs: 1000 });

    const first = await provider.getPreviewSettings();
    const second = await provider.getPreviewSettings();

    expect(loadPreviewSettings).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
    expect(Object.keys(first.scriptRuntimeMap.script2library)).toEqual(['kept-a.js', 'kept-b.js']);
    expect(first.bundleConfigs.map((config) => config.name)).toEqual(['bundle-with-gap', 'unrelated']);
  });

  it('fails with a clear timeout diagnostic', async () => {
    const provider = new PreviewSettingsProvider({
      loadPreviewSettings: () => new Promise(() => undefined),
      timeoutMs: 1,
    });

    await expect(provider.getPreviewSettings()).rejects.toThrow(
      'Preview settings generation timed out after 1ms',
    );
  });
});
