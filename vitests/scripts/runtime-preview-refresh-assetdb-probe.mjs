#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { cp, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { existsSync, writeSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '../..');
const fixtureRoot = path.join(repoRoot, 'tests/fixtures/projects/asset-operation');
const projectKind = 'temporary-runtime-preview-fixture';

function toPosixPath(value) {
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

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

async function hashFile(filePath) {
  if (!filePath) {
    return null;
  }
  try {
    const buffer = await readFile(filePath);
    return createHash('sha256').update(buffer).digest('hex');
  } catch {
    return null;
  }
}

async function getFileStat(filePath) {
  if (!filePath) {
    return null;
  }
  try {
    const info = await stat(filePath);
    return {
      size: info.size,
      mtimeMs: info.mtimeMs,
    };
  } catch {
    return null;
  }
}

function getLibraryFile(assetInfo) {
  if (!assetInfo || typeof assetInfo !== 'object') {
    return '';
  }
  const library = assetInfo.library;
  if (!library || typeof library !== 'object') {
    return '';
  }
  const preferred = library['.json'] || library.json;
  if (typeof preferred === 'string') {
    return preferred;
  }
  const first = Object.values(library).find((value) => typeof value === 'string');
  return typeof first === 'string' ? first : '';
}

function summarizeAssetInfo(assetInfo) {
  if (!assetInfo) {
    return null;
  }
  return {
    url: assetInfo.url,
    uuid: assetInfo.uuid,
    imported: assetInfo.imported,
    invalid: assetInfo.invalid,
    importer: assetInfo.importer,
    type: assetInfo.type,
    isDirectory: assetInfo.isDirectory,
    libraryFile: toPosixPath(getLibraryFile(assetInfo)),
  };
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
  const tempParent = await mkdtemp(path.join(os.tmpdir(), 'cocos-cli-refresh-probe-'));
  const projectRoot = path.join(tempParent, 'project');
  await copyFixtureProject(projectRoot);

  const packagePath = path.join(projectRoot, 'package.json');
  const packageJson = await readJson(packagePath);
  packageJson['cocos-cli'] = {
    ...(packageJson['cocos-cli'] ?? {}),
    enginePath: toPosixPath(engineRoot),
  };
  await writeJson(packagePath, packageJson);

  const resourcesDir = path.join(projectRoot, 'assets', 'resources');
  await mkdir(resourcesDir, { recursive: true });
  await writeJson(path.join(resourcesDir, 'refresh-target-file.json'), {
    probe: 'absolute-file',
    revision: 1,
  });

  return {
    tempParent,
    projectRoot,
  };
}

function installSourceLoader() {
  process.chdir(repoRoot);
  require('ts-node/register/transpile-only');
}

function loadCliModules() {
  installSourceLoader();
  const LauncherModule = require(path.join(repoRoot, 'src/core/launcher.ts'));
  const assetOperationModule = require(path.join(repoRoot, 'src/core/assets/manager/operation.ts'));
  const assetQueryModule = require(path.join(repoRoot, 'src/core/assets/manager/query.ts'));
  const assetManagerModule = require(path.join(repoRoot, 'src/core/assets/manager/asset.ts'));
  const assetsModule = require(path.join(repoRoot, 'src/core/assets/index.ts'));
  return {
    Launcher: LauncherModule.default ?? LauncherModule,
    assetOperation: assetOperationModule.assetOperation,
    assetQuery: assetQueryModule.default ?? assetQueryModule,
    assetManager: assetManagerModule.default ?? assetManagerModule,
    stopAssetDB: assetsModule.stopAssetDB,
  };
}

function createEventCollector(assetManager) {
  const events = [];
  const disposeAdded = assetManager.onAssetAdded((info) => {
    events.push({ type: 'added', url: info?.url, uuid: info?.uuid });
  });
  const disposeChanged = assetManager.onAssetChanged((info) => {
    events.push({ type: 'changed', url: info?.url, uuid: info?.uuid });
  });
  const disposeRemoved = assetManager.onAssetRemoved((info) => {
    events.push({ type: 'removed', url: info?.url, uuid: info?.uuid });
  });

  return {
    snapshot() {
      return events.length;
    },
    since(startIndex) {
      return events.slice(startIndex);
    },
    dispose() {
      disposeAdded();
      disposeChanged();
      disposeRemoved();
    },
  };
}

async function observeRefresh({
  key,
  target,
  observedAsset,
  mutate,
  queryTarget,
  assetOperation,
  assetQuery,
  events,
  beforeLibraryFile,
}) {
  const eventStart = events.snapshot();
  const beforeHash = await hashFile(beforeLibraryFile);
  const beforeStat = await getFileStat(beforeLibraryFile);
  const startedAt = Date.now();

  try {
    await mutate();
    const changedAssetCount = await assetOperation.refreshAsset(target);
    const assetInfo = assetQuery.queryAssetInfo(queryTarget);
    const libraryFile = getLibraryFile(assetInfo);
    const afterHash = await hashFile(libraryFile);
    const afterStat = await getFileStat(libraryFile);
    return {
      key,
      target: toPosixPath(target),
      api: 'assetOperation.refreshAsset',
      ok: Boolean(assetInfo && assetInfo.imported === true && assetInfo.invalid !== true),
      changedAssetCount,
      changedAssetCountType: typeof changedAssetCount,
      observedAsset,
      observedInfo: summarizeAssetInfo(assetInfo),
      eventCount: events.since(eventStart).length,
      events: events.since(eventStart),
      libraryHashBefore: beforeHash,
      libraryHashAfter: afterHash,
      libraryHashChanged: beforeHash !== null && afterHash !== null ? beforeHash !== afterHash : null,
      libraryStatBefore: beforeStat,
      libraryStatAfter: afterStat,
      durationMs: Date.now() - startedAt,
    };
  } catch (error) {
    return {
      key,
      target: toPosixPath(target),
      api: 'assetOperation.refreshAsset',
      ok: false,
      changedAssetCount: null,
      changedAssetCountType: 'error',
      observedAsset,
      observedInfo: null,
      eventCount: events.since(eventStart).length,
      events: events.since(eventStart),
      error: error instanceof Error ? error.stack || error.message : String(error),
      durationMs: Date.now() - startedAt,
    };
  }
}

async function main() {
  const engineRoot = requireExistingPath('COCOS_CLI_TEST_ENGINE_ROOT', process.env.COCOS_CLI_TEST_ENGINE_ROOT);
  let tempParent = null;
  let projectRoot = null;
  let modules = null;
  let events = null;
  let cleanupStatus = 'pending';
  let mainError = null;
  let cleanupFailure = null;

  const result = {
    projectKind,
    repoRoot: toPosixPath(repoRoot),
    fixtureSource: toPosixPath(fixtureRoot),
    projectRoot: null,
    engineRootInput: {
      env: 'COCOS_CLI_TEST_ENGINE_ROOT',
      value: toPosixPath(engineRoot),
      role: 'probe harness input, not production default behavior evidence',
    },
    targets: {},
    cleanupStatus,
  };

  try {
    const prepared = await prepareProject(engineRoot);
    tempParent = prepared.tempParent;
    projectRoot = prepared.projectRoot;
    result.projectRoot = toPosixPath(projectRoot);

    modules = loadCliModules();
    const launcher = new modules.Launcher(projectRoot);
    events = createEventCollector(modules.assetManager);

    const resourcesDir = path.join(projectRoot, 'assets', 'resources');
    const rootFile = path.join(projectRoot, 'assets', 'refresh-root.json');
    const directoryFile = path.join(resourcesDir, 'refresh-dir.json');
    const targetFile = path.join(resourcesDir, 'refresh-target-file.json');
    const targetFileUrl = 'db://assets/resources/refresh-target-file.json';

    await launcher.import({
      programmingRoot: path.join(projectRoot, 'temp', 'cli', 'programming'),
      engineRuntimeMode: 'build-nodejs',
    });

    const targetFileBeforeInfo = modules.assetQuery.queryAssetInfo(targetFileUrl);
    const targetFileBeforeLibrary = getLibraryFile(targetFileBeforeInfo);

    result.targets.dbRoot = await observeRefresh({
      key: 'dbRoot',
      target: 'db://assets',
      observedAsset: 'db://assets/refresh-root.json',
      queryTarget: 'db://assets/refresh-root.json',
      mutate: () => writeJson(rootFile, { probe: 'db-root', revision: 1 }),
      assetOperation: modules.assetOperation,
      assetQuery: modules.assetQuery,
      events,
    });

    result.targets.directory = await observeRefresh({
      key: 'directory',
      target: 'db://assets/resources',
      observedAsset: 'db://assets/resources/refresh-dir.json',
      queryTarget: 'db://assets/resources/refresh-dir.json',
      mutate: () => writeJson(directoryFile, { probe: 'directory', revision: 1 }),
      assetOperation: modules.assetOperation,
      assetQuery: modules.assetQuery,
      events,
    });

    result.targets.absoluteFile = await observeRefresh({
      key: 'absoluteFile',
      target: targetFile,
      observedAsset: targetFileUrl,
      queryTarget: targetFileUrl,
      mutate: () => writeJson(targetFile, { probe: 'absolute-file', revision: 2 }),
      assetOperation: modules.assetOperation,
      assetQuery: modules.assetQuery,
      events,
      beforeLibraryFile: targetFileBeforeLibrary,
    });
  } catch (error) {
    mainError = error;
    result.error = error instanceof Error ? error.stack || error.message : String(error);
  } finally {
    try {
      events?.dispose();
    } catch (error) {
      cleanupFailure ??= error;
      result.eventDisposeError = error instanceof Error ? error.stack || error.message : String(error);
    }
    if (modules?.stopAssetDB) {
      await modules.stopAssetDB().catch((error) => {
        cleanupFailure ??= error;
        result.closeError = error instanceof Error ? error.stack || error.message : String(error);
      });
    }
    if (tempParent) {
      if (process.env.COCOS_CLI_REFRESH_PROBE_KEEP_TEMP === '1') {
        cleanupStatus = 'kept';
      } else {
        await rm(tempParent, { recursive: true, force: true }).then(() => {
          cleanupStatus = 'removed';
        }).catch((error) => {
          cleanupFailure ??= error;
          cleanupStatus = 'failed';
          result.cleanupError = error instanceof Error ? error.stack || error.message : String(error);
        });
      }
    } else {
      cleanupStatus = 'not-created';
    }
    result.cleanupStatus = cleanupStatus;
  }

  writeSync(1, `${JSON.stringify(result, null, 2)}\n`);
  if (mainError) {
    throw mainError;
  }
  if (cleanupFailure) {
    throw cleanupFailure;
  }
  const allTargetsOk = Object.values(result.targets).every((target) => target.ok === true);
  if (!allTargetsOk) {
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack || error.message : String(error));
    process.exitCode = 1;
  });
}
