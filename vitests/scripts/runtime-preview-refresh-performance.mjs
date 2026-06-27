#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { existsSync, writeSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '../..');
const fixtureRoot = path.join(repoRoot, 'tests/fixtures/projects/asset-operation');
const roundsPerScenario = Number.parseInt(process.env.COCOS_CLI_REFRESH_PERF_ROUNDS || '5', 10);

function toPosix(value) {
  return value.replace(/\\/g, '/');
}

function requireExistingPath(name, value) {
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  const resolved = path.resolve(value);
  if (!existsSync(resolved)) {
    throw new Error(`Path from ${name} does not exist: ${resolved}`);
  }
  return resolved;
}

function elapsedMs(startedAt) {
  return Math.round((performance.now() - startedAt) * 1000) / 1000;
}

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

async function copyFixtureProject(projectRoot) {
  await cp(fixtureRoot, projectRoot, {
    recursive: true,
    filter: (source) => {
      const relative = path.relative(fixtureRoot, source).replace(/\\/g, '/');
      if (!relative) {
        return true;
      }
      const first = relative.split('/')[0];
      return !['build', 'library', 'temp'].includes(first);
    },
  });
}

async function prepareProject(engineRoot) {
  const tempParent = await mkdtemp(path.join(os.tmpdir(), 'runtime-refresh-perf-'));
  const projectRoot = path.join(tempParent, 'project');
  await copyFixtureProject(projectRoot);

  const packagePath = path.join(projectRoot, 'package.json');
  const packageJson = await readJson(packagePath);
  packageJson['cocos-cli'] = {
    ...(packageJson['cocos-cli'] ?? {}),
    enginePath: toPosix(engineRoot),
  };
  await writeJson(packagePath, packageJson);

  await writeJson(path.join(projectRoot, 'assets/resources/runtime-refresh-perf.json'), {
    value: 'initial',
  });
  await writeFile(
    path.join(projectRoot, 'assets/runtime-refresh-perf.ts'),
    "export const runtimeRefreshPerfValue = 'script-initial';\n",
    'utf8',
  );

  return { tempParent, projectRoot };
}

function installSourceLoader() {
  process.chdir(repoRoot);
  require('ts-node/register/transpile-only');
}

function loadCliModules() {
  installSourceLoader();
  const LauncherModule = require(path.join(repoRoot, 'src/core/launcher.ts'));
  const assetsModule = require(path.join(repoRoot, 'src/core/assets/index.ts'));
  const assetOperationModule = require(path.join(repoRoot, 'src/core/assets/manager/operation.ts'));
  const scriptingModule = require(path.join(repoRoot, 'src/core/scripting/index.ts'));
  const settingsModule = require(path.join(repoRoot, 'src/runtime-preview/settings/preview-settings-provider.ts'));
  const serverModule = require(path.join(repoRoot, 'src/runtime-preview/server/runtime-preview-server.ts'));
  const refreshModule = require(path.join(repoRoot, 'src/runtime-preview/refresh/runtime-refresh-coordinator.ts'));
  return {
    Launcher: LauncherModule.default ?? LauncherModule,
    stopAssetDB: assetsModule.stopAssetDB,
    assetOperation: assetOperationModule.assetOperation,
    scripting: scriptingModule.default ?? scriptingModule,
    PreviewSettingsProvider: settingsModule.PreviewSettingsProvider,
    startRuntimePreviewServer: serverModule.startRuntimePreviewServer,
    createRuntimeRefreshCoordinator: refreshModule.createRuntimeRefreshCoordinator,
  };
}

function parseRefreshState(html) {
  const match = /window\.__RUNTIME_PREVIEW_REFRESH_STATE__ = (\{[\s\S]*?\});/.exec(html);
  if (!match) {
    return null;
  }
  return JSON.parse(match[1]);
}

async function walkFiles(root) {
  const entries = await readdir(root, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const absolute = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...await walkFiles(absolute));
    } else if (entry.isFile()) {
      files.push(absolute);
    }
  }
  return files;
}

async function findScriptChunkHash(projectProgrammingRoot, marker) {
  const previewRoot = path.join(projectProgrammingRoot, 'packer-driver/targets/preview');
  const files = await walkFiles(previewRoot);
  for (const file of files) {
    if (!file.endsWith('.js') || file.endsWith('.map')) {
      continue;
    }
    const source = await readFile(file, 'utf8');
    if (source.includes(marker)) {
      return {
        file: toPosix(file),
        hash: createHash('sha256').update(source).digest('hex'),
        mtimeMs: (await stat(file)).mtimeMs,
      };
    }
  }
  return null;
}

function metric(values, key) {
  const numbers = values
    .map((value) => value[key])
    .filter((value) => typeof value === 'number' && Number.isFinite(value))
    .sort((a, b) => a - b);
  if (!numbers.length) {
    return { min: null, p50: null, p95: null, max: null };
  }
  const percentile = (p) => {
    const index = Math.min(numbers.length - 1, Math.max(0, Math.ceil((p / 100) * numbers.length) - 1));
    return numbers[index];
  };
  return {
    min: numbers[0],
    p50: percentile(50),
    p95: percentile(95),
    max: numbers[numbers.length - 1],
  };
}

function summarize(rounds) {
  return {
    rootHtmlMs: metric(rounds, 'rootHtmlMs'),
    assetDbRefreshMs: metric(rounds, 'assetDbRefreshMs'),
    scriptCompileMs: metric(rounds, 'scriptCompileMs'),
    settingsGenerationMs: metric(rounds, 'settingsGenerationMs'),
    readyMs: metric(rounds, 'readyMs'),
    refreshTotalMs: metric(rounds, 'refreshTotalMs'),
  };
}

function silenceProcessOutput() {
  const originalLog = console.log;
  const originalWarn = console.warn;
  const originalError = console.error;
  const originalStdoutWrite = process.stdout.write.bind(process.stdout);
  console.log = (...args) => writeSync(2, `${args.join(' ')}\n`);
  console.warn = (...args) => writeSync(2, `${args.join(' ')}\n`);
  console.error = (...args) => writeSync(2, `${args.join(' ')}\n`);
  process.stdout.write = ((chunk, encoding, callback) => {
    if (typeof encoding === 'function') {
      callback = encoding;
      encoding = undefined;
    }
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), encoding);
    writeSync(2, buffer);
    if (callback) {
      callback();
    }
    return true;
  });
  return () => {
    console.log = originalLog;
    console.warn = originalWarn;
    console.error = originalError;
    process.stdout.write = originalStdoutWrite;
  };
}

async function startInstrumentedServer({
  modules,
  projectRoot,
  engineRoot,
  projectLibraryRoot,
  projectProgrammingRoot,
  refreshOnReload,
  prepareRuntimePreview,
}) {
  let activeRound = null;
  const settingsProvider = new modules.PreviewSettingsProvider({
    loadPreviewSettings: async () => {
      const startedAt = performance.now();
      try {
        return {
          settings: {
            assets: {
              server: '',
              importBase: '',
              nativeBase: '',
            },
          },
          script2library: {},
          bundleConfigs: [],
        };
      } finally {
        if (activeRound) {
          activeRound.settingsGenerationMs = elapsedMs(startedAt);
        }
      }
    },
  });
  const refreshCoordinator = modules.createRuntimeRefreshCoordinator({
    projectRoot,
    refreshTarget: async (target) => {
      const startedAt = performance.now();
      try {
        return await modules.assetOperation.refreshAsset(target);
      } finally {
        if (activeRound) {
          activeRound.assetDbRefreshMs = elapsedMs(startedAt);
        }
      }
    },
    waitForIdle: async () => {
      const startedAt = performance.now();
      try {
        await modules.scripting.waitForIdle({ timeoutMs: 30_000 });
      } finally {
        if (activeRound) {
          activeRound.scriptCompileMs = elapsedMs(startedAt);
        }
      }
    },
    invalidateSettings: () => settingsProvider.invalidate(),
    clearImportReplacement: () => undefined,
  });
  const server = await modules.startRuntimePreviewServer({
    projectRoot,
    engineRoot,
    projectLibraryRoot,
    projectProgrammingRoot,
    host: '127.0.0.1',
    port: 0,
    settingsProvider,
    refreshCoordinator,
    prepareRuntimePreview,
    refreshOnReload,
  });

  return {
    server,
    async runRootRound({ scenario, round }) {
      const measurement = {
        scenario,
        round,
        rootHtmlMs: null,
        assetDbRefreshMs: null,
        scriptCompileMs: null,
        settingsGenerationMs: null,
        readyMs: null,
        refreshTotalMs: null,
        changedAssetCount: null,
        refreshOk: null,
      };
      activeRound = measurement;
      const startedAt = performance.now();
      try {
        const response = await fetch(`${server.url}/`);
        const html = await response.text();
        measurement.rootHtmlMs = elapsedMs(startedAt);
        measurement.rootStatus = response.status;
        const state = parseRefreshState(html);
        const refresh = state?.lastRefresh || state?.refreshOnReloadFailure || null;
        if (refresh) {
          measurement.refreshOk = refresh.ok === true;
          measurement.refreshTotalMs = refresh.durationMs;
          measurement.changedAssetCount = refresh.changedAssetCount;
          if (typeof refresh.scriptCompile?.durationMs === 'number' && measurement.scriptCompileMs === null) {
            measurement.scriptCompileMs = refresh.scriptCompile.durationMs;
          }
          if (typeof refresh.scriptCompile?.durationMs === 'number') {
            measurement.coordinatorScriptCompileMs = refresh.scriptCompile.durationMs;
          }
          if (refresh.error) {
            measurement.error = refresh.error;
          }
        }
        return measurement;
      } finally {
        activeRound = null;
      }
    },
  };
}

async function mutateChangedRound(projectRoot, round) {
  await writeJson(path.join(projectRoot, 'assets/resources/runtime-refresh-perf.json'), {
    value: `changed-${round}`,
  });
  await writeFile(
    path.join(projectRoot, 'assets/runtime-refresh-perf.ts'),
    `export const runtimeRefreshPerfValue = 'script-changed-${round}';\n`,
    'utf8',
  );
}

async function main() {
  const restoreOutput = silenceProcessOutput();
  if (!Number.isFinite(roundsPerScenario) || roundsPerScenario < 1) {
    throw new Error('COCOS_CLI_REFRESH_PERF_ROUNDS must be a positive integer.');
  }

  const engineRoot = requireExistingPath('COCOS_CLI_TEST_ENGINE_ROOT', process.env.COCOS_CLI_TEST_ENGINE_ROOT);
  delete process.env.COCOS_CLI_TEST_PROJECT_ROOT;
  delete process.env.COCOS_CLI_TEST_EDITOR_LIBRARY_REF;
  delete process.env.COCOS_CLI_TEST_EDITOR_PROGRAMMING_REF;
  delete process.env.COCOS_CLI_SHARED_LIBRARY_OUTPUT;
  let tempParent = null;
  let server = null;
  let modules = null;
  let cleanupStatus = 'pending';
  const result = {
    projectKind: 'temporary-runtime-preview-fixture',
    fixtureSource: toPosix(fixtureRoot),
    repoRoot: toPosix(repoRoot),
    projectRoot: null,
    engineRootInput: {
      env: 'COCOS_CLI_TEST_ENGINE_ROOT',
      value: toPosix(engineRoot),
      role: 'performance harness input, not production default behavior evidence',
    },
    roundsPerScenario,
    layer: 'real Launcher.import + AssetDB refresh + scripting wait + runtime preview root HTTP; lightweight settings provider; no full browser Cocos runtime',
    distUsed: false,
    sourceLoader: 'ts-node/register/transpile-only',
    testEnvCleared: {
      COCOS_CLI_TEST_PROJECT_ROOT: !process.env.COCOS_CLI_TEST_PROJECT_ROOT,
      COCOS_CLI_TEST_EDITOR_LIBRARY_REF: !process.env.COCOS_CLI_TEST_EDITOR_LIBRARY_REF,
      COCOS_CLI_TEST_EDITOR_PROGRAMMING_REF: !process.env.COCOS_CLI_TEST_EDITOR_PROGRAMMING_REF,
      COCOS_CLI_SHARED_LIBRARY_OUTPUT: !process.env.COCOS_CLI_SHARED_LIBRARY_OUTPUT,
    },
    scenarios: {
      defaultOff: [],
      onNoChange: [],
      onChanged: [],
    },
    summary: {},
    cleanupStatus,
  };

  try {
    const prepared = await prepareProject(engineRoot);
    tempParent = prepared.tempParent;
    const projectRoot = prepared.projectRoot;
    result.projectRoot = toPosix(projectRoot);
    const projectLibraryRoot = path.join(projectRoot, 'library');
    const projectProgrammingRoot = path.join(projectRoot, 'temp/cli/programming');

    modules = loadCliModules();
    const launcher = new modules.Launcher(projectRoot);
    let preparePromise = null;
    const prepareRuntimePreview = async (serverUrl) => {
      if (!preparePromise) {
        preparePromise = launcher.import({
          serverURL: serverUrl.endsWith('/') ? serverUrl : `${serverUrl}/`,
          programmingRoot: projectProgrammingRoot,
        });
      }
      return preparePromise;
    };

    const defaultServer = await startInstrumentedServer({
      modules,
      projectRoot,
      engineRoot,
      projectLibraryRoot,
      projectProgrammingRoot,
      refreshOnReload: false,
      prepareRuntimePreview,
    });
    server = defaultServer.server;
    const readyStartedAt = performance.now();
    await prepareRuntimePreview(server.url);
    const readyMs = elapsedMs(readyStartedAt);
    await findScriptChunkHash(projectProgrammingRoot, 'script-initial');
    for (let round = 1; round <= roundsPerScenario; round += 1) {
      const measurement = await defaultServer.runRootRound({ scenario: 'defaultOff', round });
      measurement.readyMs = readyMs;
      result.scenarios.defaultOff.push(measurement);
    }
    await server.close();
    server = null;

    const refreshServer = await startInstrumentedServer({
      modules,
      projectRoot,
      engineRoot,
      projectLibraryRoot,
      projectProgrammingRoot,
      refreshOnReload: true,
      prepareRuntimePreview,
    });
    server = refreshServer.server;
    for (let round = 1; round <= roundsPerScenario; round += 1) {
      const measurement = await refreshServer.runRootRound({ scenario: 'onNoChange', round });
      measurement.readyMs = readyMs;
      result.scenarios.onNoChange.push(measurement);
    }
    for (let round = 1; round <= roundsPerScenario; round += 1) {
      await mutateChangedRound(projectRoot, round);
      const measurement = await refreshServer.runRootRound({ scenario: 'onChanged', round });
      measurement.readyMs = readyMs;
      const scriptMarker = `script-changed-${round}`;
      const scriptChunk = await findScriptChunkHash(projectProgrammingRoot, scriptMarker);
      measurement.scriptMarker = scriptMarker;
      measurement.scriptChunkHash = scriptChunk?.hash ?? null;
      result.scenarios.onChanged.push(measurement);
    }

    result.summary = {
      defaultOff: summarize(result.scenarios.defaultOff),
      onNoChange: summarize(result.scenarios.onNoChange),
      onChanged: summarize(result.scenarios.onChanged),
    };
  } catch (error) {
    result.error = error instanceof Error ? error.stack || error.message : String(error);
    throw error;
  } finally {
    await server?.close().catch(() => {});
    await modules?.scripting?.close?.().catch(() => {});
    await modules?.stopAssetDB?.().catch(() => {});
    if (tempParent) {
      if (process.env.COCOS_CLI_REFRESH_PERF_KEEP_TEMP === '1') {
        cleanupStatus = 'kept';
      } else {
        await rm(tempParent, { recursive: true, force: true }).then(() => {
          cleanupStatus = 'removed';
        }).catch((error) => {
          cleanupStatus = 'failed';
          result.cleanupError = error instanceof Error ? error.stack || error.message : String(error);
        });
      }
    } else {
      cleanupStatus = 'not-created';
    }
    result.cleanupStatus = cleanupStatus;
    writeSync(1, `${JSON.stringify(result, null, 2)}\n`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => {
    process.exitCode = 1;
  });
}
