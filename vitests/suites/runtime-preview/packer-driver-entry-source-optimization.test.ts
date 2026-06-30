// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AssetActionEnum } from '@cocos/asset-db/libs/asset';
import { createPackerDriverForTest, createPackTargetForTest } from '../../../src/core/scripting/packer-driver';

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

function createLogger() {
  return {
    clear: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  };
}

function createTrackedModLo() {
  let entrySource = '';
  let entrySourceSetCount = 0;
  const entryModule = {
    get source() {
      return entrySource;
    },
    set source(value: string) {
      entrySourceSetCount += 1;
      entrySource = value;
    },
  };
  const engineModule = {
    source: '',
  };
  const modLo = {
    addMemoryModule: vi.fn((url: string, source: string) => {
      if (url === 'cce:/internal/x/prerequisite-imports') {
        entrySource = source;
        return entryModule;
      }
      engineModule.source = source;
      return engineModule;
    }),
    setUUID: vi.fn(),
    unsetUUID: vi.fn(),
    setImportMap: vi.fn(),
    setAssetPrefixes: vi.fn(),
  };

  return {
    modLo,
    get entrySourceSetCount() {
      return entrySourceSetCount;
    },
    get entrySource() {
      return entrySource;
    },
  };
}

function createPackTarget(options: { optimizeEntrySourceCompilation?: boolean } = {}) {
  const tracker = createTrackedModLo();
  const target = createPackTargetForTest({
    modLo: tracker.modLo as any,
    quickPack: {
      build: vi.fn(async () => ({ depsGraph: {} })),
    } as any,
    logger: createLogger(),
    optimizeEntrySourceCompilation: options.optimizeEntrySourceCompilation,
  });
  return { target, tracker };
}

function createScriptChange(target: string, type: AssetActionEnum = AssetActionEnum.change) {
  return {
    type,
    uuid: target,
    filePath: target.replace('db://', ''),
    url: new URL(target),
    importer: 'typescript',
    userData: {},
    isPluginScript: false,
  } as any;
}

function createFakePackerTarget(overrides: Record<string, unknown> = {}) {
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
    ...overrides,
  };
}

describe('PackerDriver entry source optimization', () => {
  beforeEach(() => {
    vi.spyOn(console, 'time').mockImplementation(() => undefined);
    vi.spyOn(console, 'timeEnd').mockImplementation(() => undefined);
    vi.spyOn(console, 'debug').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('skips prerequisite entry source update when opt-in optimization sees unchanged import list', async () => {
    const { target, tracker } = createPackTarget({ optimizeEntrySourceCompilation: true });

    await target.applyAssetChanges([createScriptChange('db://assets/a.ts')]);
    await target.applyAssetChanges([createScriptChange('db://assets/a.ts')]);

    expect(tracker.entrySourceSetCount).toBe(1);
  });

  it('keeps the default behavior of updating prerequisite entry source even when import list is unchanged', async () => {
    const { target, tracker } = createPackTarget();

    await target.applyAssetChanges([createScriptChange('db://assets/a.ts')]);
    await target.applyAssetChanges([createScriptChange('db://assets/a.ts')]);

    expect(tracker.entrySourceSetCount).toBe(2);
  });

  it('updates prerequisite entry source when opt-in optimization sees a new import', async () => {
    const { target, tracker } = createPackTarget({ optimizeEntrySourceCompilation: true });

    await target.applyAssetChanges([createScriptChange('db://assets/a.ts')]);
    await target.applyAssetChanges([createScriptChange('db://assets/b.ts')]);

    expect(tracker.entrySourceSetCount).toBe(2);
    expect(tracker.entrySource).toContain('db://assets/a.ts');
    expect(tracker.entrySource).toContain('db://assets/b.ts');
  });

  it('updates prerequisite entry source when opt-in optimization sees a removed import', async () => {
    const { target, tracker } = createPackTarget({ optimizeEntrySourceCompilation: true });

    await target.applyAssetChanges([
      createScriptChange('db://assets/a.ts'),
      createScriptChange('db://assets/b.ts'),
    ]);
    await target.applyAssetChanges([
      createScriptChange('db://assets/b.ts', AssetActionEnum.delete),
    ]);

    expect(tracker.entrySourceSetCount).toBe(2);
    expect(tracker.entrySource).toContain('db://assets/a.ts');
    expect(tracker.entrySource).not.toContain('db://assets/b.ts');
  });

  it('does not pass dts-only changes to target applyAssetChanges', async () => {
    const applyAssetChanges = vi.fn(async () => undefined);
    const target = createFakePackerTarget({ applyAssetChanges });
    const driver = createPackerDriverForTest({
      targets: { preview: target as any },
    });

    await driver.build([{
      type: AssetActionEnum.change,
      uuid: 'db://assets/types.d.ts',
      filePath: 'assets/types.d.ts',
      importer: 'typescript',
      userData: {},
    } as any]);

    expect(applyAssetChanges).not.toHaveBeenCalled();
  });

  it('does not update real target entry source for dts-only changes', async () => {
    const { target, tracker } = createPackTarget({ optimizeEntrySourceCompilation: true });
    const driver = createPackerDriverForTest({
      targets: { preview: target as any },
    });

    await target.applyAssetChanges([createScriptChange('db://assets/a.ts')]);
    expect(tracker.entrySourceSetCount).toBe(1);

    await driver.build([{
      type: AssetActionEnum.change,
      uuid: 'db://assets/types.d.ts',
      filePath: 'assets/types.d.ts',
      importer: 'typescript',
      userData: {},
    } as any]);

    expect(tracker.entrySourceSetCount).toBe(1);
  });
});
