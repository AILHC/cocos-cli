# `cocos.config.json` Editor-owned Runtime Merge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 `cocos.config.json` 收敛为 CLI-owned overlay 文件，让 Editor-owned 配置每次从 Editor `settings/`、`profiles/` 和 global profiles 读取，并只在内存中合并供 CLI 使用。

**Architecture:** 新增 owner map 纯函数，显式区分 Editor-owned path、CLI-owned path 和 persistence metadata。`ConfigurationManager` 分离 runtime merged config 与 persisted config：初始化、reload、remigrate 每次构造 Editor snapshot；保存事件只把 CLI-owned path 写回 `cocos.config.json`，并清理旧 Editor-owned 快照。Migration loader 改为每次读取当前 project path 的 Editor files，避免 static loader/cache 复用旧内容。

**Tech Stack:** TypeScript, Jest, fs-extra, Cocos CLI configuration registry, Cocos Creator settings/profile migration.

---

## 文档归属

- Design spec：[../specs/2026-06-13-cocos-config-editor-owned-runtime-merge-design.md](../specs/2026-06-13-cocos-config-editor-owned-runtime-merge-design.md)
- Build 专题入口：[../../dev/build/README.md](../../dev/build/README.md)
- Build issue：[../../dev/build/issues.md](../../dev/build/issues.md) 中 `BUILD-ISSUE-006`
- Configuration module：[../../dev/modules/configuration.md](../../dev/modules/configuration.md)

## 执行原则

- 本计划是 implementation plan；执行时不重新讨论策略，除非测试暴露 design spec 未覆盖的事实冲突。
- 每个 Task 完成后单独提交。
- 所有文档用中文；代码标识符、路径、命令、专业术语保留 English。
- 不允许把 Editor-owned 配置持久化回 `cocos.config.json`。
- 不允许用测试 fixture 或本机缓存现象反向改变 production 默认策略。
- 不处理 `BUILD-ISSUE-007` / `BUILD-ISSUE-008` 的 AssetDB / `.meta` side effect。

## 文件职责图

- Create: `src/core/configuration/script/owner-map.ts`
  - 定义 `CLI_OWNED_CONFIG_PATHS`、persistence metadata、path 过滤和 runtime/persisted config 构造纯函数。
- Create: `src/core/configuration/test/owner-map.test.ts`
  - 覆盖 owner map 纯函数，避免直接从 manager 集成测试调试复杂事件链。
- Modify: `src/core/configuration/migration/cocos-migration.ts`
  - 去除 static loader 陈旧 projectPath/cache 风险。
- Modify: `src/core/configuration/migration/cocos-migration-manager.ts`
  - 增加不落盘读取 Editor-owned snapshot 的入口。
- Modify: `src/core/configuration/migration/cocos-config-loader.ts`
  - 支持 reset 或 per-call fresh read，确保同进程多次读取能看到 Editor 文件变化。
- Modify: `src/core/configuration/script/manager.ts`
  - 分离 persisted config 与 runtime merged config。
  - 初始化 / reload / remigrate 后刷新已注册 `BaseConfiguration` 实例。
  - 保存事件绑定处只持久化 CLI-owned path。
  - Editor-owned project-scope set/remove 默认拒绝。
- Modify: `src/core/configuration/script/config.ts`
  - 如 manager 层需要判断 set/remove 来源，新增最小 hook 或保持不改；优先在 manager 层完成 owner 判断。
- Modify: `src/core/configuration/@types/cocos.config.d.ts`
  - 将 `COCOS_CONFIG` 语义调整为 CLI persisted config，或新增 `CocosCliPersistedConfig`。
- Modify: `src/api/configuration/configuration.ts`
  - 调整 `configuration-remigrate` description 和行为说明。
- Modify: `src/lib/configuration/configuration.ts`
  - 确认 public lib `migrateFromProject()`、`migrate()`、`save()` 语义与新 manager 一致。
- Modify: `src/core/configuration/test/manager.test.ts`
  - 覆盖初始化、保存、reload、remigrate、拒绝 Editor-owned 写入。
- Modify: `src/core/configuration/test/cocos-migration.test.ts`
  - 覆盖 migration 每次读取当前 Editor files，不复用旧 projectPath/cache。
- Modify: `src/core/assets/test/config-sync.test.ts`
  - 保留 CLI-owned `import` 配置行为，删除或调整旧的 `import.fbx` 从 `cocos.config.json` 生效断言。
- Modify: `docs/dev/modules/configuration.md`
  - 实施后记录稳定 owner 边界。
- Modify: `docs/dev/build/issues.md`
  - 实施后更新 `BUILD-ISSUE-006` 状态和事实入口。

## Task 1：新增 owner map 纯函数

**Files:**

- Create: `src/core/configuration/script/owner-map.ts`
- Create: `src/core/configuration/test/owner-map.test.ts`

- [ ] **Step 1: 写失败测试**

Create `src/core/configuration/test/owner-map.test.ts`:

```ts
import {
    buildPersistedCliConfig,
    mergeRuntimeProjectConfig,
    isCliOwnedConfigPath,
    isEditorOwnedConfigPath,
} from '../script/owner-map';

describe('configuration owner map', () => {
    it('keeps only CLI-owned import fields and persistence metadata in cocos.config.json', () => {
        const source = {
            version: '1.0.0',
            $schema: './temp/cli/cocos.config.schema.json',
            import: {
                restoreAssetDBFromCache: true,
                globList: ['!**/*.tmp'],
                createTemplateRoot: '.creator/custom-template-root',
                fbx: {
                    material: {
                        smart: true,
                    },
                },
            },
            engine: {
                globalConfigKey: 'stale-engine',
            },
            builder: {
                common: {
                    platform: 'web-mobile',
                },
            },
        };

        expect(buildPersistedCliConfig(source)).toEqual({
            version: '1.0.0',
            $schema: './temp/cli/cocos.config.schema.json',
            import: {
                restoreAssetDBFromCache: true,
                globList: ['!**/*.tmp'],
                createTemplateRoot: '.creator/custom-template-root',
            },
        });
    });

    it('merges editor-owned config before CLI-owned overlay', () => {
        const editorConfig = {
            import: {
                fbx: {
                    material: {
                        smart: false,
                    },
                },
            },
            engine: {
                globalConfigKey: 'from-editor',
            },
        };
        const cliConfig = {
            import: {
                globList: ['!**/*.cache'],
                fbx: {
                    material: {
                        smart: true,
                    },
                },
            },
            engine: {
                globalConfigKey: 'from-cocos-config',
            },
        };

        expect(mergeRuntimeProjectConfig(editorConfig, cliConfig)).toEqual({
            import: {
                globList: ['!**/*.cache'],
                fbx: {
                    material: {
                        smart: false,
                    },
                },
            },
            engine: {
                globalConfigKey: 'from-editor',
            },
        });
    });

    it('classifies config paths by owner', () => {
        expect(isCliOwnedConfigPath('import.globList')).toBe(true);
        expect(isCliOwnedConfigPath('import.restoreAssetDBFromCache')).toBe(true);
        expect(isCliOwnedConfigPath('import.createTemplateRoot')).toBe(true);
        expect(isCliOwnedConfigPath('version')).toBe(true);
        expect(isCliOwnedConfigPath('$schema')).toBe(true);

        expect(isEditorOwnedConfigPath('engine.globalConfigKey')).toBe(true);
        expect(isEditorOwnedConfigPath('builder.common.platform')).toBe(true);
        expect(isEditorOwnedConfigPath('script.useDefineForClassFields')).toBe(true);
        expect(isEditorOwnedConfigPath('scene.tick')).toBe(true);
        expect(isEditorOwnedConfigPath('import.fbx.material.smart')).toBe(true);
    });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```powershell
rtk npm test -- src/core/configuration/test/owner-map.test.ts --runInBand
```

Expected:

```text
Cannot find module '../script/owner-map'
```

- [ ] **Step 3: 实现 owner map**

Create `src/core/configuration/script/owner-map.ts`:

```ts
import * as utils from './utils';

export type ConfigRecord = Record<string, any>;

const CLI_OWNED_CONFIG_PATHS = [
    'import.restoreAssetDBFromCache',
    'import.globList',
    'import.createTemplateRoot',
] as const;

const PERSISTENCE_METADATA_PATHS = [
    'version',
    '$schema',
] as const;

const EDITOR_OWNED_ROOTS = [
    'builder',
    'engine',
    'script',
    'scene',
] as const;

const EDITOR_OWNED_EXACT_PATHS = [
    'import.fbx',
] as const;

function hasPath(value: ConfigRecord, path: string): boolean {
    return utils.getByDotPath(value, path) !== undefined;
}

function pickPaths(source: ConfigRecord, paths: readonly string[]): ConfigRecord {
    const result: ConfigRecord = {};
    for (const path of paths) {
        const value = utils.getByDotPath(source, path);
        if (value !== undefined) {
            utils.setByDotPath(result, path, value);
        }
    }
    return result;
}

export function isCliOwnedConfigPath(path: string): boolean {
    return [...CLI_OWNED_CONFIG_PATHS, ...PERSISTENCE_METADATA_PATHS].includes(path as never);
}

export function isEditorOwnedConfigPath(path: string): boolean {
    return EDITOR_OWNED_ROOTS.some((root) => path === root || path.startsWith(`${root}.`))
        || EDITOR_OWNED_EXACT_PATHS.some((ownedPath) => path === ownedPath || path.startsWith(`${ownedPath}.`));
}

export function pickCliOwnedConfig(source: ConfigRecord): ConfigRecord {
    return pickPaths(source, CLI_OWNED_CONFIG_PATHS);
}

export function pickPersistenceMetadata(source: ConfigRecord): ConfigRecord {
    return pickPaths(source, PERSISTENCE_METADATA_PATHS);
}

export function buildPersistedCliConfig(source: ConfigRecord): ConfigRecord {
    return utils.deepMerge(
        pickPersistenceMetadata(source),
        pickCliOwnedConfig(source),
    ) as ConfigRecord;
}

export function mergeRuntimeProjectConfig(editorConfig: ConfigRecord, cliPersistedConfig: ConfigRecord): ConfigRecord {
    const runtimeConfig = utils.deepMerge({}, editorConfig) as ConfigRecord;
    const cliOwnedConfig = pickCliOwnedConfig(cliPersistedConfig);

    for (const path of CLI_OWNED_CONFIG_PATHS) {
        if (hasPath(cliOwnedConfig, path)) {
            utils.setByDotPath(runtimeConfig, path, utils.getByDotPath(cliOwnedConfig, path));
        }
    }

    return runtimeConfig;
}
```

- [ ] **Step 4: 运行测试确认通过**

Run:

```powershell
rtk npm test -- src/core/configuration/test/owner-map.test.ts --runInBand
```

Expected:

```text
PASS src/core/configuration/test/owner-map.test.ts
```

- [ ] **Step 5: 提交 Task 1**

Run:

```powershell
rtk git add src/core/configuration/script/owner-map.ts src/core/configuration/test/owner-map.test.ts
rtk git commit -m "test: define configuration owner map"
```

## Task 2：让 migration 每次读取当前 Editor files

**Files:**

- Modify: `src/core/configuration/migration/cocos-migration.ts`
- Modify: `src/core/configuration/migration/cocos-migration-manager.ts`
- Modify: `src/core/configuration/migration/cocos-config-loader.ts`
- Modify: `src/core/configuration/test/cocos-migration.test.ts`

- [ ] **Step 1: 写失败测试**

Append to `src/core/configuration/test/cocos-migration.test.ts`:

```ts
describe('editor-owned config snapshot loading', () => {
    it('does not reuse stale project path or package cache between migrations', async () => {
        const originalRegisterMigration = CocosMigrationManager['registerMigration'];
        CocosMigrationManager['registerMigration'] = jest.fn().mockResolvedValue(undefined);

        try {
            const target: IMigrationTarget = {
                sourceScope: 'project',
                pluginName: 'engine',
                migrate: async (oldConfig: Record<string, any>) => ({
                    engine: {
                        globalConfigKey: oldConfig.modules.globalConfigKey,
                    },
                }),
            };
            CocosMigrationManager.register(target);

            mockMigrate
                .mockResolvedValueOnce({ engine: { globalConfigKey: 'project-a' } })
                .mockResolvedValueOnce({ engine: { globalConfigKey: 'project-b' } });

            await expect(CocosMigrationManager.loadEditorOwnedConfig('/project-a')).resolves.toEqual({
                engine: { globalConfigKey: 'project-a' },
            });
            await expect(CocosMigrationManager.loadEditorOwnedConfig('/project-b')).resolves.toEqual({
                engine: { globalConfigKey: 'project-b' },
            });
            expect(mockMigrate).toHaveBeenNthCalledWith(1, '/project-a', target);
            expect(mockMigrate).toHaveBeenNthCalledWith(2, '/project-b', target);
        } finally {
            CocosMigrationManager['registerMigration'] = originalRegisterMigration;
        }
    });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```powershell
rtk npm test -- src/core/configuration/test/cocos-migration.test.ts --runInBand
```

Expected:

```text
Property 'loadEditorOwnedConfig' does not exist
```

- [ ] **Step 3: 修改 `CocosMigration` 避免 static loader 陈旧**

Modify `src/core/configuration/migration/cocos-migration.ts` so `migrate()` creates a fresh loader per call:

```ts
public static async migrate(projectPath: string, target: IMigrationTarget): Promise<any> {
    const loader = new CocosConfigLoader();
    loader.initialize(projectPath);
    const oldPluginConfig = await loader.loadConfig(target.sourceScope, target.pluginName);
    if (!oldPluginConfig) return {};

    let migratedConfig: any = await target.migrate(oldPluginConfig);

    if (target.targetPath) {
        migratedConfig = CocosMigration.applyTargetPath(migratedConfig, target.targetPath);
    }

    return migratedConfig;
}
```

Remove the static `loader` field.

- [ ] **Step 4: 新增 `loadEditorOwnedConfig()`**

Modify `src/core/configuration/migration/cocos-migration-manager.ts`:

```ts
public static async loadEditorOwnedConfig(projectPath: string): Promise<Record<string, any>> {
    const result = await this.migrate(projectPath);
    return result.project;
}
```

If implementation keeps `migrate()` returning `{ project }`, `loadEditorOwnedConfig()` is the non-persisting semantic wrapper used by `ConfigurationManager`.

- [ ] **Step 5: 运行 migration 测试**

Run:

```powershell
rtk npm test -- src/core/configuration/test/cocos-migration.test.ts --runInBand
```

Expected:

```text
PASS src/core/configuration/test/cocos-migration.test.ts
```

- [ ] **Step 6: 提交 Task 2**

Run:

```powershell
rtk git add src/core/configuration/migration/cocos-migration.ts src/core/configuration/migration/cocos-migration-manager.ts src/core/configuration/migration/cocos-config-loader.ts src/core/configuration/test/cocos-migration.test.ts
rtk git commit -m "fix: load editor configuration without stale migration cache"
```

## Task 3：重构 ConfigurationManager 的 runtime / persisted config 分离

**Files:**

- Modify: `src/core/configuration/script/manager.ts`
- Modify: `src/core/configuration/test/manager.test.ts`

- [ ] **Step 1: 写失败测试：Editor-owned 不被旧 `cocos.config.json` 覆盖**

Append to `src/core/configuration/test/manager.test.ts`:

```ts
describe('editor-owned runtime merge', () => {
    it('uses editor-owned config from migration instead of stale cocos.config.json fields', async () => {
        const { CocosMigrationManager } = require('../migration');
        CocosMigrationManager.loadEditorOwnedConfig = jest.fn().mockResolvedValue({
            engine: {
                globalConfigKey: 'from-editor',
            },
        });

        mockFse.pathExists.mockResolvedValue(true);
        mockFse.readJSON.mockResolvedValue({
            version: '1.0.0',
            engine: {
                globalConfigKey: 'from-cocos-config',
            },
        });
        mockFse.copy.mockResolvedValue(undefined);

        const configInstance = {
            moduleName: 'engine',
            configs: {},
            getAll: jest.fn(() => configInstance.configs),
            on: jest.fn(),
            off: jest.fn(),
        };

        mockRegistry.getInstance.mockReturnValue(configInstance as any);
        await manager.initialize(projectPath);

        const registryHandler = mockRegistry.on.mock.calls.find((call) => call[0] === MessageType.Registry)?.[1];
        registryHandler(configInstance);

        expect(configInstance.configs).toEqual({
            globalConfigKey: 'from-editor',
        });
    });
});
```

- [ ] **Step 2: 写失败测试：save 只写 CLI-owned 字段**

Append to the same describe:

```ts
it('persists only CLI-owned fields and metadata when a registered config saves', async () => {
    const { CocosMigrationManager } = require('../migration');
    CocosMigrationManager.loadEditorOwnedConfig = jest.fn().mockResolvedValue({
        engine: {
            globalConfigKey: 'from-editor',
        },
        import: {
            fbx: {
                material: {
                    smart: false,
                },
            },
        },
    });

    mockFse.pathExists.mockResolvedValue(true);
    mockFse.readJSON.mockResolvedValue({
        version: '1.0.0',
        $schema: './temp/cli/cocos.config.schema.json',
        import: {
            globList: ['!**/*.tmp'],
            fbx: {
                material: {
                    smart: true,
                },
            },
        },
        engine: {
            globalConfigKey: 'stale',
        },
    });
    mockFse.copy.mockResolvedValue(undefined);
    mockFse.ensureDir.mockResolvedValue(undefined);
    mockFse.writeJSON.mockResolvedValue(undefined);

    const importConfigInstance = {
        moduleName: 'import',
        configs: {
            globList: ['!**/*.cache'],
            fbx: {
                material: {
                    smart: false,
                },
            },
        },
        getAll: jest.fn(() => importConfigInstance.configs),
        on: jest.fn(),
        off: jest.fn(),
    };

    await manager.initialize(projectPath);
    const registryHandler = mockRegistry.on.mock.calls.find((call) => call[0] === MessageType.Registry)?.[1];
    registryHandler(importConfigInstance);

    const saveHandler = importConfigInstance.on.mock.calls.find((call) => call[0] === MessageType.Save)?.[1];
    await saveHandler(importConfigInstance);

    expect(mockFse.writeJSON).toHaveBeenLastCalledWith(configPath, {
        version: '1.0.0',
        $schema: ConfigurationManager.relativeSchemaPath,
        import: {
            globList: ['!**/*.cache'],
        },
    }, { spaces: 4 });
});
```

- [ ] **Step 3: 运行 manager 测试确认失败**

Run:

```powershell
rtk npm test -- src/core/configuration/test/manager.test.ts --runInBand
```

Expected:

```text
FAIL src/core/configuration/test/manager.test.ts
```

The failures should show stale `engine` or `import.fbx` still comes from `cocos.config.json`.

- [ ] **Step 4: 修改 manager 状态模型**

Modify `src/core/configuration/script/manager.ts`:

- Add imports from owner map:

```ts
import {
    buildPersistedCliConfig,
    isCliOwnedConfigPath,
    isEditorOwnedConfigPath,
    mergeRuntimeProjectConfig,
} from './owner-map';
```

- Add fields:

```ts
private cliPersistedConfig: IConfiguration = {};
private editorOwnedConfig: IConfiguration = {};
```

- Change `load()` so it reads disk into `cliPersistedConfig`, then builds persisted-only data:

```ts
this.cliPersistedConfig = buildPersistedCliConfig(await fse.readJSON(this.configPath)) as IConfiguration;
this.cliPersistedConfig.version && (this.version = this.cliPersistedConfig.version);
```

- Add a method:

```ts
private async rebuildRuntimeProjectConfig(): Promise<void> {
    const { CocosMigrationManager } = await import('../migration');
    this.editorOwnedConfig = await CocosMigrationManager.loadEditorOwnedConfig(this.projectPath) as IConfiguration;
    this.projectConfig = mergeRuntimeProjectConfig(this.editorOwnedConfig, this.cliPersistedConfig) as IConfiguration;
    this.refreshRegisteredInstances();
}
```

- Add `refreshRegisteredInstances()` that iterates current registry instances and calls existing `initializeConfigFromProject(instance, config)` for modules with runtime config.

- [ ] **Step 5: Filter save event and reject Editor-owned writes**

Update `onRegistryConfiguration()` save binding:

```ts
const bind = async (configInstance: IBaseConfiguration) => {
    const moduleConfig = configInstance.getAll() ?? {};
    this.projectConfig[configInstance.moduleName] = moduleConfig;
    this.cliPersistedConfig = buildPersistedCliConfig(this.projectConfig) as IConfiguration;
    await this.save();
};
```

Update `set()` and `remove()` before delegating to the instance:

```ts
const fullPath = `${moduleName}.${actualKey}`;
if (scope !== 'default' && isEditorOwnedConfigPath(fullPath) && !isCliOwnedConfigPath(fullPath)) {
    throw new Error(`[Configuration] ${fullPath} is maintained by Cocos Creator Editor settings/profiles and cannot be persisted to cocos.config.json`);
}
```

Keep default-scope writes unchanged.

- [ ] **Step 6: Make `save()` write persisted config only**

Update `save()` so it serializes `this.cliPersistedConfig`, not full `this.projectConfig`:

```ts
const persistedConfig = buildPersistedCliConfig(this.cliPersistedConfig) as IConfiguration;
if (!force && !Object.keys(persistedConfig).length) {
    return;
}
persistedConfig.version = ConfigurationManager.VERSION;
persistedConfig.$schema = ConfigurationManager.relativeSchemaPath;
await fse.writeJSON(this.configPath, persistedConfig, { spaces: 4 });
```

After successful write, keep `this.cliPersistedConfig = persistedConfig`.

- [ ] **Step 7: Run manager tests**

Run:

```powershell
rtk npm test -- src/core/configuration/test/manager.test.ts --runInBand
```

Expected:

```text
PASS src/core/configuration/test/manager.test.ts
```

- [ ] **Step 8: 提交 Task 3**

Run:

```powershell
rtk git add src/core/configuration/script/manager.ts src/core/configuration/test/manager.test.ts
rtk git commit -m "fix: separate runtime and persisted project config"
```

## Task 4：实现 reload / remigrate 的内存刷新语义

**Files:**

- Modify: `src/core/configuration/script/manager.ts`
- Modify: `src/core/configuration/test/manager.test.ts`
- Modify: `src/api/configuration/configuration.ts`
- Modify: `src/lib/configuration/configuration.ts`

- [ ] **Step 1: 写失败测试：reload 刷新已注册实例**

Append to `manager.test.ts`:

```ts
it('reload refreshes already registered configuration instances from latest editor files', async () => {
    const { CocosMigrationManager } = require('../migration');
    CocosMigrationManager.loadEditorOwnedConfig = jest.fn()
        .mockResolvedValueOnce({ engine: { globalConfigKey: 'before' } })
        .mockResolvedValueOnce({ engine: { globalConfigKey: 'after' } });

    mockFse.pathExists.mockResolvedValue(true);
    mockFse.readJSON.mockResolvedValue({ version: '1.0.0' });
    mockFse.copy.mockResolvedValue(undefined);

    const configInstance = {
        moduleName: 'engine',
        configs: {},
        getAll: jest.fn(() => configInstance.configs),
        on: jest.fn(),
        off: jest.fn(),
    };

    await manager.initialize(projectPath);
    const registryHandler = mockRegistry.on.mock.calls.find((call) => call[0] === MessageType.Registry)?.[1];
    registryHandler(configInstance);
    expect(configInstance.configs).toEqual({ globalConfigKey: 'before' });

    await manager.reload();
    expect(configInstance.configs).toEqual({ globalConfigKey: 'after' });
});
```

- [ ] **Step 2: 写失败测试：migrateFromProject 不落盘全量 config**

Append:

```ts
it('migrateFromProject refreshes runtime config without persisting editor-owned snapshot', async () => {
    const { CocosMigrationManager } = require('../migration');
    CocosMigrationManager.loadEditorOwnedConfig = jest.fn().mockResolvedValue({
        engine: { globalConfigKey: 'from-editor' },
        import: { globList: ['!**/*.tmp'] },
    });

    mockFse.pathExists.mockResolvedValue(true);
    mockFse.readJSON.mockResolvedValue({ version: '1.0.0' });
    mockFse.copy.mockResolvedValue(undefined);
    mockFse.ensureDir.mockResolvedValue(undefined);
    mockFse.writeJSON.mockResolvedValue(undefined);

    await manager.initialize(projectPath);
    await manager.migrateFromProject(projectPath);

    expect(mockFse.writeJSON).not.toHaveBeenCalledWith(
        configPath,
        expect.objectContaining({ engine: expect.any(Object) }),
        expect.any(Object),
    );
});
```

- [ ] **Step 3: Run tests and confirm failure**

Run:

```powershell
rtk npm test -- src/core/configuration/test/manager.test.ts --runInBand
```

Expected:

```text
FAIL src/core/configuration/test/manager.test.ts
```

- [ ] **Step 4: Implement reload/remigrate**

Update `reload()`:

```ts
public async reload(): Promise<void> {
    await this.load();
    await this.rebuildRuntimeProjectConfig();
    this.emit(MessageType.Reload, this.projectConfig);
}
```

Update `migrateFromProject(projectPath)`:

```ts
public async migrateFromProject(projectPath: string): Promise<IConfiguration> {
    this.editorOwnedConfig = await CocosMigrationManager.loadEditorOwnedConfig(projectPath) as IConfiguration;
    this.projectConfig = mergeRuntimeProjectConfig(this.editorOwnedConfig, this.cliPersistedConfig) as IConfiguration;
    this.refreshRegisteredInstances();
    return this.projectConfig;
}
```

Update `migrate()` to call `migrateFromProject()` when version upgrade is needed, without forcing full persisted write.

- [ ] **Step 5: Update API/lib wording and behavior**

Modify `src/api/configuration/configuration.ts`:

```ts
@description('Re-read Editor-owned project configuration from settings/profiles and refresh runtime configuration without generating a full cocos.config.json')
```

Keep tool name unless product API owners decide to rename later.

Modify `src/lib/configuration/configuration.ts` only if typings/comments need clarification. The function may continue delegating to `configurationManager.migrateFromProject()`.

- [ ] **Step 6: Run tests**

Run:

```powershell
rtk npm test -- src/core/configuration/test/manager.test.ts --runInBand
```

Expected:

```text
PASS src/core/configuration/test/manager.test.ts
```

- [ ] **Step 7: 提交 Task 4**

Run:

```powershell
rtk git add src/core/configuration/script/manager.ts src/core/configuration/test/manager.test.ts src/api/configuration/configuration.ts src/lib/configuration/configuration.ts
rtk git commit -m "fix: refresh runtime config from editor settings"
```

## Task 5：保留 CLI-owned AssetDB 配置并移除 Editor-owned import 快照依赖

**Files:**

- Modify: `src/core/assets/test/config-sync.test.ts`
- Inspect/Modify if needed: `src/core/assets/asset-config.ts`

- [ ] **Step 1: 更新 config-sync 测试**

Modify `createImportConfig()` in `src/core/assets/test/config-sync.test.ts` so `fbx.material.smart` is no longer expected from `cocos.config.json`:

```ts
function createImportConfig(customTemplateRoot: string) {
    return {
        globList: ['!**/*.tmp', '!**/*.bak'],
        restoreAssetDBFromCache: true,
        createTemplateRoot: customTemplateRoot,
        fbx: {
            material: {
                smart: true,
            },
        },
    };
}
```

Keep the stale `fbx` value in the fixture to prove it is ignored, but change the assertion:

```ts
await expect(runtime.assetConfig.getProject<boolean>('fbx.material.smart')).resolves.toBe(false);
```

If Editor-owned defaults make this assertion unstable, assert only that `runtime.assetConfig.data` consumes CLI-owned paths and add a separate manager-level test for `import.fbx` owner behavior.

- [ ] **Step 2: Run config-sync test and confirm failure or pass depending on Task 3**

Run:

```powershell
rtk npm test -- src/core/assets/test/config-sync.test.ts --runInBand
```

Expected before complete manager integration:

```text
FAIL or PASS depending on prior task order; if FAIL, failure should be limited to import.fbx owner behavior.
```

- [ ] **Step 3: Adjust AssetConfig only if needed**

If `assetConfig.syncRuntimeConfigFromConfiguration()` already reads only:

```ts
restoreAssetDBFromCache
globList
createTemplateRoot
```

do not change `src/core/assets/asset-config.ts`. It currently does not need `import.fbx` for runtime asset config sync.

- [ ] **Step 4: Run config-sync test**

Run:

```powershell
rtk npm test -- src/core/assets/test/config-sync.test.ts --runInBand
```

Expected:

```text
PASS src/core/assets/test/config-sync.test.ts
```

- [ ] **Step 5: 提交 Task 5**

Run:

```powershell
rtk git add src/core/assets/test/config-sync.test.ts src/core/assets/asset-config.ts
rtk git commit -m "test: keep asset db cli-owned config overlay"
```

If `asset-config.ts` was not modified, omit it from `git add`.

## Task 6：类型、schema 和文档收口

**Files:**

- Modify: `src/core/configuration/@types/cocos.config.d.ts`
- Modify: `docs/dev/modules/configuration.md`
- Modify: `docs/dev/build/issues.md`
- Modify: `docs/dev/build/README.md`

- [ ] **Step 1: Adjust config type**

Modify `src/core/configuration/@types/cocos.config.d.ts` to add a persisted config type:

```ts
export interface COCOS_CLI_PERSISTED_CONFIG {
    $schema?: string;
    version: string;
    import?: Pick<ImportConfiguration, 'restoreAssetDBFromCache' | 'globList' | 'createTemplateRoot'>;
}
```

Keep `COCOS_CONFIG` only if schema generation or downstream type users still require it. If `COCOS_CONFIG` is now only schema output for the persisted file, update it to match `COCOS_CLI_PERSISTED_CONFIG`.

- [ ] **Step 2: Verify generated schema behavior**

Run:

```powershell
rtk npm run build
```

Expected:

```text
build 成功，并生成匹配 CLI-owned persisted config 的 cocos.config.schema.json。
```

If schema generation still expects `COCOS_CONFIG`, adjust the generator or exported interface name in the same task.

- [ ] **Step 3: Update configuration module docs**

Modify `docs/dev/modules/configuration.md` Current Constraints to include:

```md
`cocos.config.json` 是 CLI-owned overlay 文件，只持久化 CLI-only 配置和文件 metadata。Editor-owned 配置必须从 Creator `settings/`、`profiles/` 和 global profiles 读取，并只在 runtime 内存中合并。
```

- [ ] **Step 4: Update build issue**

Modify `docs/dev/build/issues.md` for `BUILD-ISSUE-006` after verification:

```md
| BUILD-ISSUE-006 | CLI 生成的 `cocos.config.json` 可能滞后于 Editor 修改后的项目配置 | `fixed` | 已将 `cocos.config.json` 收敛为 CLI-owned overlay；Editor-owned 配置每次从 Editor settings/profiles 读取并在内存合并。保存时只写 CLI-owned import 字段和 metadata，旧 Editor-owned 快照会被清理。 | [../../superpowers/specs/2026-06-13-cocos-config-editor-owned-runtime-merge-design.md](../../superpowers/specs/2026-06-13-cocos-config-editor-owned-runtime-merge-design.md)；本计划 | 保持 owner map 测试和 manager reload/remigrate 测试覆盖。 |
```

- [ ] **Step 5: Update build README if needed**

Ensure `docs/dev/build/README.md` links this implementation plan:

```md
`cocos.config.json` Editor-owned 配置运行时合并实施计划：[../../superpowers/plans/2026-06-13-cocos-config-editor-owned-runtime-merge.md](../../superpowers/plans/2026-06-13-cocos-config-editor-owned-runtime-merge.md)
```

- [ ] **Step 6: 提交 Task 6**

Run:

```powershell
rtk git add src/core/configuration/@types/cocos.config.d.ts docs/dev/modules/configuration.md docs/dev/build/issues.md docs/dev/build/README.md
rtk git commit -m "docs: document cocos config overlay ownership"
```

## Task 7：最终验证

**Files:** 不改文件。

- [ ] **Step 1: Run focused configuration tests**

Run:

```powershell
rtk npm test -- src/core/configuration/test/owner-map.test.ts src/core/configuration/test/cocos-migration.test.ts src/core/configuration/test/manager.test.ts --runInBand
```

Expected:

```text
PASS src/core/configuration/test/owner-map.test.ts
PASS src/core/configuration/test/cocos-migration.test.ts
PASS src/core/configuration/test/manager.test.ts
```

- [ ] **Step 2: Run AssetDB config sync test**

Run:

```powershell
rtk npm test -- src/core/assets/test/config-sync.test.ts --runInBand
```

Expected:

```text
PASS src/core/assets/test/config-sync.test.ts
```

- [ ] **Step 3: Run build**

Run:

```powershell
rtk npm run build
```

Expected:

```text
build 成功。
```

- [ ] **Step 4: Inspect git diff**

Run:

```powershell
rtk git status --short
rtk git diff --stat
```

Expected:

```text
只包含本计划相关文件的修改；没有项目 fixture、library、temp 或无关源码变更。
```

- [ ] **Step 5: Final commit if previous tasks were batched**

If any changes remain unstaged from the implementation:

```powershell
rtk git add <remaining related files>
rtk git commit -m "fix: use editor settings as configuration source"
```

## Plan Self-Review

- Spec coverage：覆盖 CLI-owned overlay、Editor-owned runtime read、in-memory merge、save filtering、reload/remigrate refresh、static loader cache、metadata owner、API/docs。
- Placeholder scan：本计划不使用 `TBD` / `TODO` / “fill in later”。如果执行中发现真实 API 与 snippets 不一致，应更新 plan 或记录偏差后再继续。
- Type consistency：新增函数名在 tasks 中保持一致：`buildPersistedCliConfig()`、`mergeRuntimeProjectConfig()`、`isCliOwnedConfigPath()`、`isEditorOwnedConfigPath()`、`loadEditorOwnedConfig()`。
