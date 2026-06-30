// @vitest-environment node
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { AssetActionEnum } from '@cocos/asset-db/libs/asset';
import { PackerDriver, createPackerDriverForTest } from '../../../src/core/scripting/packer-driver';
import { eventEmitter } from '../../../src/core/scripting/event-emitter';

const diagnosticsTestState = vi.hoisted(() => {
  const quickPackInstances: any[] = [];
  const modLoInstances: any[] = [];
  const logLines: string[] = [];

  class FakeModLo {
    addMemoryModule = vi.fn((url: string, source: string) => ({ url, source }));
    setExtraExportsConditions = vi.fn();
    setExternals = vi.fn();
    setLoadMappings = vi.fn();
    setImportMap = vi.fn();
    setAssetPrefixes = vi.fn();
    unsetUUID = vi.fn();
    setUUID = vi.fn();

    constructor() {
      modLoInstances.push(this);
    }
  }

  class FakeQuickPack {
    __cocosCliDiagnosticsInstalled?: boolean;
    _moduleRecords = { a: {}, b: {} };
    lockRelease = vi.fn(async () => 'released-value');
    _chunkWriter = {
      setEntryChunks: vi.fn(() => 'entry-chunks'),
      persistToTempFiles: vi.fn(async () => 'persisted'),
      renameTempFiles: vi.fn(() => 'renamed'),
    };
    _middleware = {
      lock: vi.fn(async () => this.lockRelease),
    };
    _instantiateAll!: ReturnType<typeof vi.fn>;
    _getDepsGraphFromModuleRecords = vi.fn(() => ({ 'file:///a.ts': [] }));
    loadCache = vi.fn(async () => undefined);
    createLoaderContext = vi.fn(() => ({}));
    clear = vi.fn();
    build = vi.fn(async () => ({ depsGraph: {} }));

    constructor() {
      this._instantiateAll = vi.fn(async (depth = 0): Promise<string> => {
        if (depth === 0) {
          await this._instantiateAll(1);
        }
        return `instantiated-${depth}`;
      });
      quickPackInstances.push(this);
    }
  }

  class FakePackerDriverLogger {
    clear = vi.fn();
    debug = vi.fn((line: string) => {
      logLines.push(line);
    });
    error = vi.fn((line: string) => {
      logLines.push(line);
      return this;
    });
    warn = vi.fn((line: string) => {
      logLines.push(line);
      return this;
    });
  }

  return {
    quickPackInstances,
    modLoInstances,
    logLines,
    FakeQuickPack,
    FakeModLo,
    FakePackerDriverLogger,
  };
});

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

vi.mock('@cocos/creator-programming-quick-pack/lib/quick-pack', () => ({
  QuickPack: diagnosticsTestState.FakeQuickPack,
}));

vi.mock('@cocos/creator-programming-mod-lo/lib/mod-lo', () => ({
  ModLo: diagnosticsTestState.FakeModLo,
}));

vi.mock('../../../src/core/scripting/packer-driver/logger', () => ({
  PackerDriverLogger: diagnosticsTestState.FakePackerDriverLogger,
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

function createFakePackTarget(name: string, overrides: Record<string, unknown> = {}) {
  return {
    get quickPackLoaderContext() {
      return undefined;
    },
    get ready() {
      return true;
    },
    get respectToEngineFeatureSetting() {
      return false;
    },
    updateDbInfos: vi.fn(),
    setAssetDatabaseDomains: vi.fn(async () => undefined),
    setEngineIndexModuleSource: vi.fn(async () => undefined),
    clearCache: vi.fn(async () => undefined),
    applyAssetChanges: vi.fn(async () => undefined),
    deleteCacheFile: vi.fn(),
    build: vi.fn(async () => ({ depsGraph: {} })),
    name,
    ...overrides,
  };
}

function createAssetChange(filePath: string) {
  return {
    type: AssetActionEnum.change,
    uuid: filePath,
    filePath,
    importer: 'typescript',
    userData: {},
  };
}

describe('PackerDriver build diagnostics', () => {
  it('logs target build start and end boundaries for each target', async () => {
    const lines: string[] = [];
    const logger = createLogger(lines);

    const driver = createPackerDriverForTest({
      logger,
      targets: {
        editor: createFakePackTarget('editor', { build: vi.fn(async () => ({ depsGraph: {} })) }),
        preview: createFakePackTarget('preview', { build: vi.fn(async () => ({ depsGraph: {} })) }),
      },
    });

    await driver.build([]);

    const logText = lines.join('\n');
    expect(logText).toContain('Target(editor) build started.');
    expect(logText).toContain('Target(editor) ends');
    expect(logText).toContain('Target(preview) build started.');
    expect(logText).toContain('Target(preview) ends');
  });

  it('logs a failed boundary when a target returns BuildResult.err', async () => {
    const lines: string[] = [];
    const logger = createLogger(lines);
    const targetError = new Error('target build result failure');
    const driver = createPackerDriverForTest({
      logger,
      targets: {
        preview: createFakePackTarget('preview', {
          build: vi.fn(async () => ({ err: targetError })),
        }),
      },
    });

    await expect(driver.build([])).rejects.toThrow('target build result failure');

    const logText = lines.join('\n');
    expect(logText).toContain('Target(preview) build started.');
    expect(logText).toContain('Target(preview) build failed, cost:');
    expect(logText).not.toContain('Target(preview) ends');
  });

  it('wraps QuickPack diagnostics without changing release behavior or recursive instantiate boundaries', async () => {
    diagnosticsTestState.quickPackInstances.length = 0;
    diagnosticsTestState.modLoInstances.length = 0;
    diagnosticsTestState.logLines.length = 0;

    const root = await mkdtemp(join(tmpdir(), 'packer-driver-diagnostics-'));
    await PackerDriver.create(join(root, 'project'), join(root, 'engine'), {
      programmingRoot: join(root, 'project', 'temp', 'programming'),
    });
    const quickPack = diagnosticsTestState.quickPackInstances[0];

    await quickPack.build(['entry']);
    await quickPack._instantiateAll(0);
    await quickPack._chunkWriter.setEntryChunks();
    await quickPack._chunkWriter.persistToTempFiles();
    await quickPack._chunkWriter.renameTempFiles();
    quickPack._getDepsGraphFromModuleRecords();
    const wrappedRelease = await quickPack._middleware.lock('file.lock');
    const releaseResult = await wrappedRelease('release-arg');
    quickPack.lockRelease.mockRejectedValueOnce(new Error('release failed'));
    const rejectingRelease = await quickPack._middleware.lock('file.lock');

    expect(releaseResult).toBe('released-value');
    expect(quickPack.lockRelease).toHaveBeenCalledWith('release-arg');
    await expect(rejectingRelease('release-arg')).rejects.toThrow('release failed');

    const lines = diagnosticsTestState.logLines;
    const logText = lines.join('\n');
    expect(logText).toContain('QuickPack(editor) build:start');
    expect(logText).toContain('QuickPack(editor) build:returned');
    expect(logText).toContain('QuickPack(editor) setEntryChunks:start');
    expect(logText).toContain('QuickPack(editor) setEntryChunks:done');
    expect(logText).toContain('QuickPack(editor) persistTempFiles:start');
    expect(logText).toContain('QuickPack(editor) persistTempFiles:done');
    expect(logText).toContain('QuickPack(editor) renameTempFiles:start');
    expect(logText).toContain('QuickPack(editor) renameTempFiles:done');
    expect(logText).toContain('QuickPack(editor) depsGraph:start');
    expect(logText).toContain('QuickPack(editor) depsGraph:done');
    expect(logText).toContain('QuickPack(editor) lock:start');
    expect(logText).toContain('QuickPack(editor) lock:done');
    expect(logText).toContain('QuickPack(editor) unlock:start');
    expect(logText).toContain('QuickPack(editor) unlock:done');
    expect(logText).toContain('QuickPack(editor) unlock:error');
    expect(lines.filter((line) => line.includes('QuickPack(editor) instantiate:start'))).toHaveLength(1);
    expect(lines.filter((line) => line.includes('QuickPack(editor) instantiate:done'))).toHaveLength(1);
  });
});

describe('PackerDriver build state', () => {
  it('serializes concurrent build requests and consumes each request changes in its own iteration', async () => {
    const order: string[] = [];
    const appliedChanges: string[][] = [];
    let markFirstStarted!: () => void;
    const firstBuildStarted = new Promise<void>((resolve) => {
      markFirstStarted = resolve;
    });
    let releaseFirst!: () => void;
    const firstBuildBlocker = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const target = createFakePackTarget('preview', {
      async applyAssetChanges(changes: Array<{ filePath: string }>) {
        appliedChanges.push(changes.map((change) => change.filePath));
      },
      async build() {
        order.push('build:start');
        if (order.length === 1) {
          markFirstStarted();
          await firstBuildBlocker;
        }
        order.push('build:end');
        return { depsGraph: {} };
      },
    });
    const driver = createPackerDriverForTest({ targets: { preview: target } });

    const first = driver.build([createAssetChange('a.ts')]);
    const second = driver.build([createAssetChange('b.ts')]);

    await firstBuildStarted;
    expect(driver.busy()).toBe(true);
    releaseFirst();
    await Promise.all([first, second]);
    expect(driver.busy()).toBe(false);

    expect(order).toEqual(['build:start', 'build:end', 'build:start', 'build:end']);
    expect(appliedChanges).toEqual([['a.ts'], ['b.ts']]);
  });

  it('resets busy state and task id when target build throws', async () => {
    const driver = createPackerDriverForTest({
      targets: {
        preview: createFakePackTarget('preview', {
          async build() {
            throw new Error('simulated build failure');
          },
        }),
      },
    });

    await expect(driver.build([], 'task-a')).rejects.toThrow('simulated build failure');
    expect(driver.busy()).toBe(false);
    expect(driver.getCurrentTaskId()).toBeNull();

    await expect(driver.build([], 'task-b')).rejects.toThrow('simulated build failure');
    expect(driver.getCurrentTaskId()).toBeNull();
  });

  it('reports idle inside compiled listener for a single build request', async () => {
    const driver = createPackerDriverForTest({
      targets: {
        preview: createFakePackTarget('preview'),
      },
    });
    const busyStates: boolean[] = [];
    const listener = () => {
      busyStates.push(driver.busy());
    };

    eventEmitter.once('compiled', listener);
    try {
      await driver.build([]);
    } finally {
      eventEmitter.off('compiled', listener);
    }

    expect(busyStates).toEqual([false]);
  });

  it('keeps busy true inside first compiled listener when another build is queued', async () => {
    const order: string[] = [];
    let markFirstStarted!: () => void;
    const firstBuildStarted = new Promise<void>((resolve) => {
      markFirstStarted = resolve;
    });
    let releaseFirst!: () => void;
    const firstBuildBlocker = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const target = createFakePackTarget('preview', {
      async build() {
        order.push('build:start');
        if (order.length === 1) {
          markFirstStarted();
          await firstBuildBlocker;
        }
        order.push('build:end');
        return { depsGraph: {} };
      },
    });
    const driver = createPackerDriverForTest({ targets: { preview: target } });
    const busyStates: boolean[] = [];
    const listener = () => {
      busyStates.push(driver.busy());
    };

    eventEmitter.on('compiled', listener);
    try {
      const first = driver.build([]);
      const second = driver.build([]);

      await firstBuildStarted;
      releaseFirst();
      await Promise.all([first, second]);
    } finally {
      eventEmitter.off('compiled', listener);
    }

    expect(busyStates).toEqual([true, false]);
  });
});
