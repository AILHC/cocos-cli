import { execFile } from 'node:child_process';
import { open, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { getCliIntegrationFixturePaths } from '@shared/fixture-paths';

const execFileAsync = promisify(execFile);
const testTimeoutMs = 180_000;
const skeletonUuid = 'c12c45f3-dca3-4d8a-8226-f0bebb48a791@30732';
const clipUuid = 'c12c45f3-dca3-4d8a-8226-f0bebb48a791@73b7f';
const missingUuid = '00000000-0000-4000-8000-000000000001';

function parseProbe<T>(stdout: string, marker: string): T {
  const line = stdout.split(/\r?\n/).find((entry) => entry.includes(marker));
  if (!line) {
    throw new Error(`Missing ${marker} output.\n${stdout}`);
  }
  return JSON.parse(line.slice(line.indexOf(marker) + marker.length)) as T;
}

async function withFixtureLock<T>(projectRoot: string, action: () => Promise<T>): Promise<T> {
  const lockPath = join(projectRoot, '..', 'cocos-cli-official-sync-settings-parity.lock');
  const deadline = Date.now() + testTimeoutMs;
  let handle;
  while (!handle) {
    try {
      handle = await open(lockPath, 'wx');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST' || Date.now() >= deadline) {
        throw error;
      }
      await delay(100);
    }
  }
  try {
    return await action();
  } finally {
    await handle.close();
    await unlink(lockPath).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') {
        throw error;
      }
    });
  }
}

describe('joint texture layout settings parity', () => {
  it('uses real 3.8.6 AssetDB records across game, runtime-preview, and build settings', async () => {
    const paths = getCliIntegrationFixturePaths();
    const repoRoot = join(process.cwd(), '..');
    const tsxCli = join(repoRoot, 'node_modules/tsx/dist/cli.mjs');
    const code = `
      import fs from 'node:fs/promises';
      import path from 'node:path';
      import Launcher from './src/core/launcher.ts';

      (async () => {
        const unwrap = (moduleNamespace) => moduleNamespace.default || moduleNamespace;
        const projectRoot = process.env.COCOS_CLI_TEST_PROJECT_ROOT;
        const configPath = path.join(projectRoot, 'cocos.config.json');
        const originalConfigSource = await fs.readFile(configPath, 'utf8');
        try {
          const diskConfig = JSON.parse(originalConfigSource);
          diskConfig.import = { ...(diskConfig.import || {}), restoreAssetDBFromCache: true };
          await fs.writeFile(configPath, JSON.stringify(diskConfig, null, 2) + '\\n', 'utf8');

          const launcher = new Launcher(projectRoot);
          await launcher.import({ engineRuntimeMode: 'build-nodejs' });

          const { Engine } = unwrap(await import('./src/core/engine/index.ts'));
          const { configurationManager } = unwrap(await import('./src/core/configuration/index.ts'));
          const { MessageType } = unwrap(await import('./src/core/configuration/script/interface.ts'));
          const {
            readJointTextureLayoutAssetState,
          } = unwrap(await import('./src/core/engine/joint-texture-layout.ts'));
          const {
            init: initBuilder,
            getPreviewSettings,
            queryDefaultBuildConfigByPlatform,
          } = unwrap(await import('./src/core/builder/index.ts'));
          const { fillIncludeModulesFromProjectConfig } = unwrap(await import('./src/core/builder/share/common-options-validator.ts'));
          const { patchOptionsToSettings } = unwrap(await import('./src/core/builder/worker/builder/tasks/setting-task/utils/project-options.ts'));

          const layouts = [
            {
              textureLength: 12,
              contents: [{
                skeleton: '${skeletonUuid}',
                clips: ['${clipUuid}', '${clipUuid}', '${missingUuid}'],
              }],
            },
            {
              textureLength: 2048,
              contents: [{ skeleton: 123, clips: [456] }],
            },
          ];
          const configInstance = Engine._configInstance;
          const projectConfig = configInstance.getAll();
          projectConfig.customJointTextureLayouts = layouts;
          configurationManager.emit(MessageType.Reload, projectConfig);

          await initBuilder();
          const gameSettings = await Engine.getGameConfig('', '', '', true);
          const runtimeResult = await getPreviewSettings();

          const liveConfig = Engine.getConfig();
          const buildOptions = await queryDefaultBuildConfigByPlatform('web-desktop');
          await fillIncludeModulesFromProjectConfig(buildOptions);
          Object.assign(buildOptions, {
            startScene: '',
            debug: true,
            platform: 'web-desktop',
            server: '',
            preview: true,
            resolution: {
              width: liveConfig.designResolution.width,
              height: liveConfig.designResolution.height,
              policy: 4,
            },
            customLayers: liveConfig.customLayers,
            sortingLayers: liveConfig.sortingLayers,
            renderPipeline: liveConfig.renderPipeline,
            customPipeline: liveConfig.customPipeline,
            includeModules: liveConfig.includeModules,
            physicsConfig: liveConfig.physicsConfig,
            macroConfig: liveConfig.macroConfig,
            useSplashScreen: false,
            splashScreen: liveConfig.splashScreen,
          });
          const buildSettings = {
            engine: {}, screen: {}, assets: {}, rendering: {}, animation: {}, launch: {},
          };
          await patchOptionsToSettings(buildOptions, buildSettings);

          console.log('JTL_PARITY=' + JSON.stringify({
            skeleton: await readJointTextureLayoutAssetState('${skeletonUuid}'),
            clip: await readJointTextureLayoutAssetState('${clipUuid}'),
            preview: await Engine.queryJointTextureLayoutPreview(),
            game: gameSettings.overrideSettings.animation.customJointTextureLayouts,
            runtime: runtimeResult.settings.animation.customJointTextureLayouts,
            build: buildSettings.animation.customJointTextureLayouts,
          }));
        } finally {
          await fs.writeFile(configPath, originalConfigSource, 'utf8');
        }
        process.exit(0);
      })().catch((error) => {
        console.error(error && (error.stack || error.message || error));
        process.exit(1);
      });
    `;

    const { stdout, fixtureStatus } = await withFixtureLock(paths.projectRoot, async () => {
      const probe = await execFileAsync(process.execPath, [tsxCli, '-e', code], {
        cwd: repoRoot,
        env: {
          ...process.env,
          COCOS_CLI_TEST_PROJECT_ROOT: paths.projectRoot,
          COCOS_CLI_TEST_ENGINE_ROOT: paths.engineRoot,
        },
        timeout: testTimeoutMs,
        maxBuffer: 20 * 1024 * 1024,
      });
      const status = await execFileAsync('git', ['status', '--short', '--untracked-files=all'], {
        cwd: paths.projectRoot,
        timeout: 10_000,
      });
      return { stdout: probe.stdout, fixtureStatus: status.stdout };
    });
    const result = parseProbe<{
      skeleton: { hash: number; jointsLength: number };
      clip: { hash: number; sample: number; duration: number };
      preview: {
        missingAssets: string[];
        layouts: Array<{ textureLength: number; tip: { level: string }; missingAssets: string[] }>;
        resolvedLayouts: unknown[];
      };
      game: unknown[];
      runtime: unknown[];
      build: unknown[];
    }>(stdout, 'JTL_PARITY=');

    expect(result.skeleton).toEqual({ hash: 2449757756, jointsLength: 84 });
    expect(result.clip).toEqual({ hash: 1824678836, sample: 30, duration: 12.458333015441895 });
    expect(result.preview.missingAssets).toEqual([missingUuid]);
    expect(result.preview.layouts[0]).toMatchObject({
      textureLength: 444,
      tip: { level: 'valid' },
      missingAssets: [missingUuid],
    });
    expect(result.preview.layouts[1]).toMatchObject({
      textureLength: 2048,
      tip: { level: 'error' },
      missingAssets: [],
    });
    expect(result.game).toEqual(result.preview.resolvedLayouts);
    expect(result.runtime).toEqual(result.preview.resolvedLayouts);
    expect(result.build).toEqual(result.preview.resolvedLayouts);
    expect(result.game).toEqual([
      {
        textureLength: 444,
        contents: [{ skeleton: 2449757756, clips: [1824678836, 1824678836] }],
      },
      {
        textureLength: 2048,
        contents: [{ skeleton: 123, clips: [456] }],
      },
    ]);

    expect(fixtureStatus.trim()).toBe('M package.json');
  }, testTimeoutMs);
});
