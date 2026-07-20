// @vitest-environment node
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPackTargetForTest } from '../../../src/core/scripting/packer-driver';
import { eventEmitter } from '../../../src/core/scripting/event-emitter';
import {
  hasValidPreviewOutputIntegritySeal,
  writePreviewOutputIntegritySeal,
} from '../../../src/core/scripting/packer-driver/script-registration-integrity';
import { AssetActionEnum } from '@cocos/asset-db/libs/asset';

vi.mock('@cocos/ccbuild', () => ({
  StatsQuery: class StatsQuery {
    static async create() {
      return new StatsQuery();
    }

    evaluateIndexModuleSource() {
      return '';
    }

    getFeatureUnits() {
      return [];
    }

    getFeatures() {
      return [];
    }

    getUnitsOfFeatures() {
      return [];
    }
  },
}));

vi.mock('@cocos/lib-programming/dist/utils', () => ({
  editorBrowserslistQuery: 'test-editor',
}));

vi.mock('../../../src/core/scripting/shared/query-shared-settings', () => ({
  querySharedSettings: vi.fn(async () => ({
    useDefineForClassFields: true,
    allowDeclareFields: true,
    loose: false,
    guessCommonJsExports: false,
    exportsConditions: [],
    preserveSymlinks: false,
  })),
  scriptConfig: {
    init: vi.fn(async () => undefined),
    getProject: vi.fn(async () => ''),
  },
}));

vi.mock('../../../src/core/scripting/intelligence', () => ({
  TypeScriptConfigBuilder: class TypeScriptConfigBuilder {},
}));

vi.mock('../../../src/core/assets/utils', () => ({
  url2path: (value: string) => value,
}));

vi.mock('../../../src/core/builder/worker/builder/utils', () => ({
  compressUuid: (value: string) => value,
}));

function createLogger(lines: string[] = []) {
  return {
    clear: vi.fn(),
    debug: vi.fn((line: string) => lines.push(line)),
    error: vi.fn((line: string) => lines.push(line)),
    warn: vi.fn((line: string) => lines.push(line)),
  };
}

function createModLo() {
  return {
    addMemoryModule: vi.fn((url: string, source: string) => ({ url, source })),
    setUUID: vi.fn(),
    unsetUUID: vi.fn(),
    setImportMap: vi.fn(),
    setAssetPrefixes: vi.fn(),
  };
}

async function writeText(filePath: string, value: string) {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, value, 'utf8');
}

async function createLastGoodOutput(workspace: string) {
  const chunkId = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  const depChunkId = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
  const chunkPath = join(workspace, 'chunks', 'aa', `${chunkId}.js`);
  const depChunkPath = join(workspace, 'chunks', 'bb', `${depChunkId}.js`);
  const mapPath = `${chunkPath}.map`;
  await writeText(join(workspace, 'main-record.json'), '{"modules":{"last":"good"}}');
  await writeText(join(workspace, 'assembly-record.json'), '{"chunks":{"last":{"imports":{}}},"entries":{"entry":"last"}}');
  await writeText(join(workspace, 'import-map.json'), JSON.stringify({
    imports: {
      'cce:/internal/x/prerequisite-imports': './chunks/aa/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.js',
    },
    scopes: {
      './chunks/aa/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.js': {
        __unresolved_0: './chunks/bb/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.js',
      },
    },
  }));
  await writeText(join(workspace, 'resolution-detail-map.json'), '{"last":"good"}');
  await writeText(chunkPath, 'System.register(["__unresolved_0"], function () {})');
  await writeText(depChunkPath, 'last-good dependency chunk');
  await writeText(mapPath, 'last-good map');
  writePreviewOutputIntegritySeal(workspace);
  return { chunkId, chunkPath, mapPath };
}

function createChunkWriter(workspace: string, chunkId: string) {
  return {
    _build: {
      chunks: {},
      entries: {},
    },
    _generateChunkId: vi.fn(() => chunkId),
    _calculateChunkCodeFileName: vi.fn(() => join(workspace, 'chunks', chunkId.slice(0, 2), `${chunkId}.js`)),
    addChunk: vi.fn(function (_moduleURL: URL, code: string, map?: string) {
      const chunkPath = join(workspace, 'chunks', chunkId.slice(0, 2), `${chunkId}.js`);
      writeFileSync(chunkPath, code, 'utf8');
      if (map) {
        writeFileSync(`${chunkPath}.map`, map, 'utf8');
      }
      return chunkId;
    }),
    setEntryChunks: vi.fn(),
    persistToTempFiles: vi.fn(),
    renameTempFiles: vi.fn(),
    deserializeRecord: vi.fn(function (record: unknown) {
      this._build = record as any;
    }),
  };
}

function createQuickPack(workspace: string, build: (this: any, entries: unknown[]) => Promise<unknown>) {
  return {
    _middleware: {
      workspace,
      mainRecordPath: join(workspace, 'main-record.json'),
      assemblyRecordPath: join(workspace, 'assembly-record.json'),
      importMapPath: join(workspace, 'import-map.json'),
      resolutionDetailMapPath: join(workspace, 'resolution-detail-map.json'),
      chunkHomePath: join(workspace, 'chunks'),
    },
    _moduleRecords: {},
    _chunkWriter: createChunkWriter(workspace, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'),
    build: vi.fn(build),
    loadCache: vi.fn(async function () {
      this._moduleRecords = JSON.parse(await readFile(join(workspace, 'main-record.json'), 'utf8')).modules;
      this._chunkWriter.deserializeRecord(JSON.parse(await readFile(join(workspace, 'assembly-record.json'), 'utf8')));
    }),
  };
}

describe('PackerDriver output transaction', () => {
  afterEach(() => {
    eventEmitter.removeAllListeners('pack-build-start');
    eventEmitter.removeAllListeners('pack-build-end');
    eventEmitter.removeAllListeners('pack-build-failed');
  });

  it('rolls back records and overwritten chunks when QuickPack build fails after writing output', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'packer-driver-output-rollback-'));
    const { chunkPath, mapPath } = await createLastGoodOutput(workspace);
    const events: string[] = [];
    eventEmitter.on('pack-build-start', (targetName) => events.push(`start:${targetName}`));
    eventEmitter.on('pack-build-end', (targetName) => events.push(`end:${targetName}`));
    eventEmitter.on('pack-build-failed', ({ targetName }) => events.push(`failed:${targetName}`));

    const quickPack = createQuickPack(workspace, async function () {
      this._chunkWriter.addChunk(new URL('file:///broken.ts'), 'bad chunk', 'bad map');
      await writeText(join(workspace, 'main-record.json'), '{"modules":{"bad":"polluted"}}');
      await writeText(join(workspace, 'assembly-record.json'), '{"chunks":{"bad":{"imports":{}}},"entries":{"entry":"bad"}}');
      await writeText(join(workspace, 'import-map.json'), '{"imports":{"entry":"./chunks/aa/bad.js"}}');
      await writeText(join(workspace, 'resolution-detail-map.json'), '{"bad":"polluted"}');
      await writeText(join(workspace, 'chunks', 'cc', 'cccccccccccccccccccccccccccccccccccccccc.js'), 'new bad chunk');
      throw Object.assign(new SyntaxError('Invalid left-hand side in assignment expression. (2047:0)'), {
        file: 'assets/tests/TestApi.ts',
      });
    });
    const target = createPackTargetForTest({
      modLo: createModLo() as any,
      quickPack: quickPack as any,
      logger: createLogger(),
    });

    const result = await target.build();

    expect(result.err?.message).toContain('Invalid left-hand side');
    expect(target.ready).toBe(false);
    expect(events).toEqual(['start:preview', 'failed:preview']);
    expect(await readFile(join(workspace, 'main-record.json'), 'utf8')).toBe('{"modules":{"last":"good"}}');
    expect(await readFile(join(workspace, 'assembly-record.json'), 'utf8')).toBe('{"chunks":{"last":{"imports":{}}},"entries":{"entry":"last"}}');
    expect(await readFile(join(workspace, 'import-map.json'), 'utf8')).toContain('"cce:/internal/x/prerequisite-imports"');
    expect(await readFile(join(workspace, 'resolution-detail-map.json'), 'utf8')).toBe('{"last":"good"}');
    expect(await readFile(chunkPath, 'utf8')).toBe('System.register(["__unresolved_0"], function () {})');
    expect(await readFile(mapPath, 'utf8')).toBe('last-good map');
    expect(hasValidPreviewOutputIntegritySeal(workspace)).toBe(true);
    expect(existsSync(join(workspace, 'chunks', 'cc', 'cccccccccccccccccccccccccccccccccccccccc.js'))).toBe(false);
    await rm(workspace, { recursive: true, force: true });
  });

  it('rejects a UUID script chunk before writing when registration metadata is missing', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'packer-driver-script-registration-'));
    const { chunkPath } = await createLastGoodOutput(workspace);
    const scriptURL = new URL('file:///broken.ts');
    const scriptUuid = 'a4de7990-0a51-4c38-9cee-75f282f83f39';
    const quickPack = createQuickPack(workspace, async function () {
      const chunkId = this._chunkWriter.addChunk(scriptURL, 'System.register([], function () {})');
      this._moduleRecords[scriptURL.href] = {
        mTimestamp: { mtime: 1, uuid: scriptUuid },
        chunkId,
        type: 'esm',
      };
      return { depsGraph: {} };
    });
    const target = createPackTargetForTest({
      modLo: createModLo() as any,
      quickPack: quickPack as any,
      logger: createLogger(),
    });
    await target.applyAssetChanges([{
      type: AssetActionEnum.add,
      uuid: scriptUuid,
      filePath: '/broken.ts',
      importer: 'typescript',
      url: scriptURL,
      isPluginScript: false,
    }]);

    const result = await target.build();

    expect(result.err?.message).toContain('does not register UUID');
    expect(await readFile(chunkPath, 'utf8')).toBe('System.register(["__unresolved_0"], function () {})');
    expect(hasValidPreviewOutputIntegritySeal(workspace)).toBe(true);
    await rm(workspace, { recursive: true, force: true });
  });

  it('commits a script chunk only when RF registration and the module record agree', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'packer-driver-script-registration-valid-'));
    await createLastGoodOutput(workspace);
    const scriptURL = new URL('file:///valid.ts');
    const scriptUuid = 'a4de7990-0a51-4c38-9cee-75f282f83f39';
    const quickPack = createQuickPack(workspace, async function () {
      const chunkId = this._chunkWriter.addChunk(
        scriptURL,
        `System.register([], function () { _cclegacy._RF.push({}, "${scriptUuid}", "Valid", undefined); _cclegacy._RF.pop(); });`,
      );
      this._moduleRecords[scriptURL.href] = {
        mTimestamp: { mtime: 1, uuid: scriptUuid },
        chunkId,
        type: 'esm',
      };
      return { depsGraph: {} };
    });
    const target = createPackTargetForTest({
      modLo: createModLo() as any,
      quickPack: quickPack as any,
      logger: createLogger(),
    });
    await target.applyAssetChanges([{
      type: AssetActionEnum.add,
      uuid: scriptUuid,
      filePath: '/valid.ts',
      importer: 'typescript',
      url: scriptURL,
      isPluginScript: false,
    }]);

    const result = await target.build();

    expect(result.err).toBeUndefined();
    expect(target.ready).toBe(true);
    expect(hasValidPreviewOutputIntegritySeal(workspace)).toBe(true);
    await rm(workspace, { recursive: true, force: true });
  });

  it('does not require RF registration for a CommonJS script module', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'packer-driver-commonjs-registration-'));
    await createLastGoodOutput(workspace);
    const scriptURL = new URL('file:///commonjs-script.js');
    const scriptUuid = '8fd97JkCJxK6LFPOt93xa/d';
    const quickPack = createQuickPack(workspace, async function () {
      const chunkId = this._chunkWriter.addChunk(scriptURL, 'System.register([], function () { module.exports = {}; })');
      this._moduleRecords[scriptURL.href] = {
        mTimestamp: { mtime: 1, uuid: scriptUuid },
        chunkId,
        type: 'commonjs',
      };
      return { depsGraph: {} };
    });
    const target = createPackTargetForTest({
      modLo: createModLo() as any,
      quickPack: quickPack as any,
      logger: createLogger(),
    });
    await target.applyAssetChanges([{
      type: AssetActionEnum.add,
      uuid: scriptUuid,
      filePath: '/commonjs-script.js',
      importer: 'typescript',
      url: scriptURL,
      isPluginScript: false,
    }]);

    const result = await target.build();

    expect(result.err).toBeUndefined();
    expect(hasValidPreviewOutputIntegritySeal(workspace)).toBe(true);
    await rm(workspace, { recursive: true, force: true });
  });

  it('treats missing prerequisite import-map scope as build failure before committing output', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'packer-driver-integrity-gate-'));
    const { chunkPath } = await createLastGoodOutput(workspace);
    const events: string[] = [];
    eventEmitter.on('pack-build-start', (targetName) => events.push(`start:${targetName}`));
    eventEmitter.on('pack-build-end', (targetName) => events.push(`end:${targetName}`));
    eventEmitter.on('pack-build-failed', ({ targetName }) => events.push(`failed:${targetName}`));
    const quickPack = createQuickPack(workspace, async () => {
      await writeText(join(workspace, 'main-record.json'), '{"modules":{"bad":"polluted"}}');
      await writeText(join(workspace, 'assembly-record.json'), '{"chunks":{"bad":{"imports":{}}},"entries":{"entry":"bad"}}');
      await writeText(join(workspace, 'import-map.json'), JSON.stringify({
        imports: {
          'cce:/internal/x/prerequisite-imports': './chunks/cc/cccccccccccccccccccccccccccccccccccccccc.js',
        },
      }));
      await writeText(join(workspace, 'chunks', 'cc', 'cccccccccccccccccccccccccccccccccccccccc.js'), 'System.register(["__unresolved_0"], function () {})');
      return { depsGraph: {} };
    });
    const target = createPackTargetForTest({
      modLo: createModLo() as any,
      quickPack: quickPack as any,
      logger: createLogger(),
    });

    const result = await target.build();

    expect(result.err?.message).toContain('prerequisite import scope is missing');
    expect(target.ready).toBe(false);
    expect(events).toEqual(['start:preview', 'failed:preview']);
    expect(await readFile(join(workspace, 'main-record.json'), 'utf8')).toBe('{"modules":{"last":"good"}}');
    expect(await readFile(chunkPath, 'utf8')).toBe('System.register(["__unresolved_0"], function () {})');
    expect(existsSync(join(workspace, 'chunks', 'cc', 'cccccccccccccccccccccccccccccccccccccccc.js'))).toBe(false);
    await rm(workspace, { recursive: true, force: true });
  });

  it('reloads QuickPack memory from restored records before the next build', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'packer-driver-output-memory-'));
    await createLastGoodOutput(workspace);
    let buildCount = 0;
    let secondBuildModuleRecords: unknown;
    let secondBuildChunkRecord: unknown;
    const quickPack = createQuickPack(workspace, async function () {
      buildCount += 1;
      if (buildCount === 1) {
        this._moduleRecords = { bad: 'polluted' };
        this._chunkWriter._build = { chunks: { bad: { imports: {} } }, entries: { entry: 'bad' } };
        this._chunkWriter.addChunk(new URL('file:///broken.ts'), 'bad chunk');
        await writeText(join(workspace, 'main-record.json'), '{"modules":{"bad":"polluted"}}');
        await writeText(join(workspace, 'assembly-record.json'), '{"chunks":{"bad":{"imports":{}}},"entries":{"entry":"bad"}}');
        throw new Error('first build failed');
      }
      secondBuildModuleRecords = this._moduleRecords;
      secondBuildChunkRecord = this._chunkWriter._build;
      return { depsGraph: { 'file:///ok.ts': [] } };
    });
    const target = createPackTargetForTest({
      modLo: createModLo() as any,
      quickPack: quickPack as any,
      logger: createLogger(),
    });

    const failed = await target.build();
    const succeeded = await target.build();

    expect(failed.err?.message).toBe('first build failed');
    expect(succeeded.err).toBeUndefined();
    expect(quickPack.loadCache).toHaveBeenCalledTimes(1);
    expect(secondBuildModuleRecords).toEqual({ last: 'good' });
    expect(secondBuildChunkRecord).toEqual({ chunks: { last: { imports: {} } }, entries: { entry: 'last' } });
    expect(target.ready).toBe(true);
    await rm(workspace, { recursive: true, force: true });
  });

  it('creates a cold QuickPack workspace before acquiring the output lock', async () => {
    const root = await mkdtemp(join(tmpdir(), 'packer-driver-output-cold-lock-'));
    const workspace = join(root, 'targets', 'editor');
    const lockEvents: string[] = [];
    const quickPack = createQuickPack(workspace, async () => {
      lockEvents.push('build');
      return { depsGraph: {} };
    });
    const middleware = quickPack._middleware as any;
    const lockSpy = vi.fn(async () => {
      lockEvents.push(`outer-lock:${existsSync(workspace)}`);
      return async () => {
        lockEvents.push('outer-unlock');
      };
    });
    middleware.lock = lockSpy;
    const target = createPackTargetForTest({
      name: 'editor',
      modLo: createModLo() as any,
      quickPack: quickPack as any,
      logger: createLogger(),
    });

    expect(existsSync(workspace)).toBe(false);
    const result = await target.build();

    expect(result.err).toBeUndefined();
    expect(target.ready).toBe(true);
    expect(lockEvents).toEqual(['outer-lock:true', 'build', 'outer-unlock']);
    expect(lockSpy).toHaveBeenCalledTimes(1);
    await rm(root, { recursive: true, force: true });
  });

  it('keeps rollback and cache reload inside the QuickPack workspace lock', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'packer-driver-output-lock-'));
    await createLastGoodOutput(workspace);
    const lockEvents: string[] = [];
    const quickPack = createQuickPack(workspace, async function () {
      lockEvents.push('build-start');
      const innerUnlock = await this._middleware.lock();
      lockEvents.push('inner-lock-returned');
      await innerUnlock();
      lockEvents.push('inner-unlock-returned');
      await writeText(join(workspace, 'main-record.json'), '{"modules":{"bad":"polluted"}}');
      throw new Error('locked build failed');
    });
    const middleware = quickPack._middleware as any;
    const lockSpy = vi.fn(async () => {
      lockEvents.push('outer-lock');
      return async () => {
        lockEvents.push('outer-unlock');
      };
    });
    const unlockSpy = vi.fn(async () => {
      lockEvents.push('force-unlock');
    });
    middleware.lock = lockSpy;
    middleware.unlock = unlockSpy;
    quickPack.loadCache = vi.fn(async function () {
      lockEvents.push('load-cache');
      this._moduleRecords = JSON.parse(await readFile(join(workspace, 'main-record.json'), 'utf8')).modules;
      this._chunkWriter.deserializeRecord(JSON.parse(await readFile(join(workspace, 'assembly-record.json'), 'utf8')));
    });
    const target = createPackTargetForTest({
      modLo: createModLo() as any,
      quickPack: quickPack as any,
      logger: createLogger(),
    });

    const result = await target.build();

    expect(result.err?.message).toBe('locked build failed');
    expect(lockEvents).toEqual([
      'outer-lock',
      'build-start',
      'inner-lock-returned',
      'inner-unlock-returned',
      'load-cache',
      'outer-unlock',
    ]);
    expect(lockSpy).toHaveBeenCalledTimes(1);
    expect(unlockSpy).not.toHaveBeenCalled();
    expect(await readFile(join(workspace, 'main-record.json'), 'utf8')).toBe('{"modules":{"last":"good"}}');
    await rm(workspace, { recursive: true, force: true });
  });
});
