import { execFile } from 'node:child_process';
import { open, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { getCliIntegrationFixturePaths } from '@shared/fixture-paths';

const execFileAsync = promisify(execFile);
const testTimeoutMs = 240_000;

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

describe('engine graphics settings parity', () => {
  it('normalizes current and legacy project config across real preview and build providers', async () => {
    const paths = getCliIntegrationFixturePaths();
    const repoRoot = join(process.cwd(), '..');
    const tsxCli = join(repoRoot, 'node_modules/tsx/dist/cli.mjs');
    const code = `
      import fs from 'node:fs/promises';
      import path from 'node:path';
      import Launcher from './src/core/launcher.ts';

      (async () => {
        const unwrap = (moduleNamespace) => moduleNamespace.default || moduleNamespace;
        const clone = (value) => JSON.parse(JSON.stringify(value));
        const graphicsModuleNames = new Set([
          'legacy-pipeline',
          'custom-pipeline',
          'custom-pipeline-post-process',
        ]);
        const selectGraphicsModules = (modules) => modules.filter((moduleName) => graphicsModuleNames.has(moduleName));
        const projectRoot = process.env.COCOS_CLI_TEST_PROJECT_ROOT;
        const configPath = path.join(projectRoot, 'cocos.config.json');
        const originalConfigSource = await fs.readFile(configPath, 'utf8');

        try {
          const startupConfig = JSON.parse(originalConfigSource);
          startupConfig.import = { ...(startupConfig.import || {}), restoreAssetDBFromCache: true };
          await fs.writeFile(configPath, JSON.stringify(startupConfig, null, 2) + '\\n', 'utf8');

          const launcher = new Launcher(projectRoot);
          await launcher.import({ engineRuntimeMode: 'build-nodejs' });

          const { Engine } = unwrap(await import('./src/core/engine/index.ts'));
          const { configurationManager } = unwrap(await import('./src/core/configuration/index.ts'));
          const { MessageType } = unwrap(await import('./src/core/configuration/script/interface.ts'));
          const { scriptingRoutes } = unwrap(await import('./src/core/preview/scripting-routes.ts'));
          const {
            getCachedPreviewSettings,
            invalidatePreviewSettings,
          } = unwrap(await import('./src/core/preview/preview-settings.ts'));
          const {
            init: initBuilder,
            queryDefaultBuildConfigByPlatform,
          } = unwrap(await import('./src/core/builder/index.ts'));
          const {
            checkProjectSetting,
          } = unwrap(await import('./src/core/builder/share/common-options-validator.ts'));
          const {
            patchOptionsToSettings,
          } = unwrap(await import('./src/core/builder/worker/builder/tasks/setting-task/utils/project-options.ts'));

          await initBuilder();
          const modulesRoute = scriptingRoutes.find((route) => route.url === '/scripting/engine/modules');
          if (!modulesRoute) {
            throw new Error('Missing /scripting/engine/modules route.');
          }

          const baseProjectConfig = clone(Engine._configInstance.getAll() || {});
          const baseModules = Engine.getConfig().includeModules.filter((moduleName) => !graphicsModuleNames.has(moduleName));
          const scenarios = [
            {
              name: 'absent-selected-legacy',
              modules: [...baseModules, 'legacy-pipeline'],
              moduleSource: 'selected',
            },
            {
              name: 'absent-custom-post-process',
              modules: [...baseModules, 'custom-pipeline', 'custom-pipeline-post-process'],
            },
            {
              name: 'partial-custom-post-process',
              modules: [...baseModules, 'custom-pipeline'],
              graphics: { 'custom-pipeline-post-process': true },
            },
            {
              name: 'full-legacy-ignores-post-process-module',
              modules: [...baseModules, 'custom-pipeline', 'custom-pipeline-post-process'],
              graphics: { pipeline: 'legacy-pipeline', 'custom-pipeline-post-process': true },
            },
            {
              name: 'full-custom-without-post-process',
              modules: [...baseModules, 'legacy-pipeline', 'custom-pipeline-post-process'],
              graphics: { pipeline: 'custom-pipeline', 'custom-pipeline-post-process': false },
            },
            {
              name: 'full-custom-with-post-process',
              modules: [...baseModules, 'legacy-pipeline'],
              graphics: { pipeline: 'custom-pipeline', 'custom-pipeline-post-process': true },
            },
            {
              name: 'legacy-customPipeline-false',
              modules: [...baseModules, 'custom-pipeline', 'custom-pipeline-post-process'],
              customPipeline: false,
            },
            {
              name: 'legacy-customPipeline-true',
              modules: [...baseModules, 'legacy-pipeline'],
              customPipeline: true,
            },
          ];
          const results = [];

          for (const scenario of scenarios) {
            const projectConfig = clone(baseProjectConfig);
            delete projectConfig.graphics;
            delete projectConfig.customPipeline;
            if (scenario.moduleSource === 'selected') {
              delete projectConfig.includeModules;
              projectConfig.globalConfigKey = 'graphicsParity';
              projectConfig.configs = {
                graphicsParity: {
                  name: 'graphics parity',
                  flags: {},
                  includeModules: clone(scenario.modules),
                  noDeprecatedFeatures: { value: false, version: '' },
                },
              };
            } else {
              projectConfig.includeModules = clone(scenario.modules);
            }
            if (scenario.graphics) {
              projectConfig.graphics = clone(scenario.graphics);
            }
            if (Object.prototype.hasOwnProperty.call(scenario, 'customPipeline')) {
              projectConfig.customPipeline = scenario.customPipeline;
            }

            const diskConfig = JSON.parse(originalConfigSource);
            diskConfig.import = { ...(diskConfig.import || {}), restoreAssetDBFromCache: true };
            diskConfig.engine = clone(projectConfig);
            await fs.writeFile(configPath, JSON.stringify(diskConfig, null, 2) + '\\n', 'utf8');

            const currentProjectConfig = Engine._configInstance.getAll();
            for (const key of Object.keys(currentProjectConfig)) {
              delete currentProjectConfig[key];
            }
            Object.assign(currentProjectConfig, clone(projectConfig));
            configurationManager.emit(MessageType.Reload, projectConfig);

            let routeModules;
            await modulesRoute.handler({}, {
              json(value) {
                routeModules = value;
                return this;
              },
            });
            if (!routeModules) {
              throw new Error('The modules route did not return a module list.');
            }

            const liveConfig = Engine.getConfig();
            const gameSettings = await Engine.getGameConfig('', '', '', true);
            invalidatePreviewSettings();
            const runtimeResult = await getCachedPreviewSettings();

            const buildOptions = clone(await queryDefaultBuildConfigByPlatform('web-desktop'));
            Object.assign(buildOptions, {
              startScene: '',
              debug: true,
              platform: 'web-desktop',
              server: '',
              preview: true,
            });
            await checkProjectSetting(buildOptions);
            const buildSettings = {
              engine: { engineModules: buildOptions.includeModules },
              screen: {}, assets: {}, rendering: {}, animation: {}, launch: {},
            };
            await patchOptionsToSettings(buildOptions, buildSettings);

            results.push({
              name: scenario.name,
              engine: {
                modules: selectGraphicsModules(liveConfig.includeModules),
                graphics: liveConfig.graphics,
                customPipeline: liveConfig.customPipeline,
              },
              normalRoute: {
                modules: selectGraphicsModules(routeModules),
              },
              game: {
                modules: selectGraphicsModules(routeModules),
                customPipeline: gameSettings.overrideSettings.rendering.customPipeline,
              },
              runtime: {
                modules: selectGraphicsModules(runtimeResult.settings.engine.engineModules),
                customPipeline: runtimeResult.settings.rendering.customPipeline,
              },
              build: {
                modules: selectGraphicsModules(buildSettings.engine.engineModules),
                customPipeline: buildSettings.rendering.customPipeline,
              },
            });
          }

          console.log('GRAPHICS_PARITY=' + JSON.stringify(results));
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
        maxBuffer: 30 * 1024 * 1024,
      });
      const status = await execFileAsync('git', ['status', '--short', '--untracked-files=all'], {
        cwd: paths.projectRoot,
        timeout: 10_000,
      });
      return { stdout: probe.stdout, fixtureStatus: status.stdout };
    });
    const results = parseProbe<Array<{
      name: string;
      engine: {
        modules: string[];
        graphics: Record<string, unknown>;
        customPipeline: boolean;
      };
      normalRoute: { modules: string[] };
      game: { modules: string[]; customPipeline: boolean };
      runtime: { modules: string[]; customPipeline: boolean };
      build: { modules: string[]; customPipeline: boolean };
    }>>(stdout, 'GRAPHICS_PARITY=');

    const expected = [
      {
        name: 'absent-selected-legacy',
        modules: ['legacy-pipeline'],
        graphics: { pipeline: 'legacy-pipeline', 'custom-pipeline-post-process': false },
        customPipeline: false,
      },
      {
        name: 'absent-custom-post-process',
        modules: ['custom-pipeline', 'custom-pipeline-post-process'],
        graphics: { pipeline: 'custom-pipeline', 'custom-pipeline-post-process': true },
        customPipeline: true,
      },
      {
        name: 'partial-custom-post-process',
        modules: ['custom-pipeline', 'custom-pipeline-post-process'],
        graphics: { pipeline: 'custom-pipeline', 'custom-pipeline-post-process': true },
        customPipeline: true,
      },
      {
        name: 'full-legacy-ignores-post-process-module',
        modules: ['legacy-pipeline'],
        graphics: { pipeline: 'legacy-pipeline', 'custom-pipeline-post-process': true },
        customPipeline: false,
      },
      {
        name: 'full-custom-without-post-process',
        modules: ['custom-pipeline'],
        graphics: { pipeline: 'custom-pipeline', 'custom-pipeline-post-process': false },
        customPipeline: true,
      },
      {
        name: 'full-custom-with-post-process',
        modules: ['custom-pipeline', 'custom-pipeline-post-process'],
        graphics: { pipeline: 'custom-pipeline', 'custom-pipeline-post-process': true },
        customPipeline: true,
      },
      {
        name: 'legacy-customPipeline-false',
        modules: ['legacy-pipeline'],
        graphics: { pipeline: 'legacy-pipeline', 'custom-pipeline-post-process': true },
        customPipeline: false,
      },
      {
        name: 'legacy-customPipeline-true',
        modules: ['custom-pipeline'],
        graphics: { pipeline: 'custom-pipeline', 'custom-pipeline-post-process': false },
        customPipeline: true,
      },
    ];

    expect(results.map(({ name, engine }) => ({ name, ...engine }))).toEqual(expected);
    for (const [index, result] of results.entries()) {
      const parity = {
        modules: expected[index].modules,
        customPipeline: expected[index].customPipeline,
      };
      expect(result.normalRoute.modules, `${result.name}: normal route modules`).toEqual(parity.modules);
      expect(result.game, `${result.name}: game settings`).toEqual(parity);
      expect(result.runtime, `${result.name}: runtime settings`).toEqual(parity);
      expect(result.build, `${result.name}: build settings`).toEqual(parity);
    }

    expect(fixtureStatus.trim()).toBe('M package.json');
  }, testTimeoutMs);
});
