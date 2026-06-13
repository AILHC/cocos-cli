# `cocos.config.json` Editor-owned 配置运行时合并规格

状态：Draft，等待确认。

专题入口：[../../dev/build/README.md](../../dev/build/README.md)

关联问题：[../../dev/build/issues.md](../../dev/build/issues.md) 中 `BUILD-ISSUE-006`

相关正式模块：

- [Configuration Module](../../dev/modules/configuration.md)
- [Builder Module](../../dev/modules/builder.md)
- [Project Module](../../dev/modules/project.md)

## 目标

让 CLI 使用的项目配置与 Cocos Creator Editor 保持一致：Editor 维护的配置每次从 Editor 的 `settings/`、`profiles/` 等真实文件读取，CLI-only 配置可以保存在项目根目录 `cocos.config.json`，最终只在内存中合并后供 build / import / preview 使用。

本规格不要求禁止 CLI 新增或修改项目根目录文件。约束是：CLI 不能把 Editor-owned 配置字段持久化成旧快照，也不能用 `cocos.config.json` 中的旧值覆盖 Editor 当前配置。

## 背景事实

当前 `src/core/configuration/script/manager.ts` 的 `ConfigurationManager.initialize()` 会：

1. 读取项目根目录 `cocos.config.json`。
2. 复制 schema 到 `temp/cli/cocos.config.schema.json`。
3. 当 `cocos.config.json.version` 落后于 `ConfigurationManager.VERSION` 时，从 Creator 配置执行 migration。
4. 将迁移结果写回 `cocos.config.json`。

当前 `src/core/configuration/migration/cocos-config-loader.ts` 会从以下路径读取 Creator 配置：

- `<project>/settings/v2/packages/<package>.json`
- `<project>/profiles/v2/packages/<package>.json`
- `<home>/.CocosCreator/profiles/v2/packages/<package>.json`

因此现状中，`cocos.config.json` 同时承担了两类职责：

- CLI-only 配置的持久化。
- Editor-owned 配置的迁移快照。

这会导致：Editor 后续修改 `settings/v2/packages/*.json` 后，只要 `cocos.config.json.version` 已是当前版本，CLI 再次打开/构建时仍可能读取旧快照。

## 设计原则

1. Editor-owned 配置以 Editor 文件为准。
2. CLI-only 配置可以由 `cocos.config.json` 持久化。
3. 运行时配置只在内存中合并；不要把 Editor-owned 配置合并结果写回 `cocos.config.json`。
4. 合并必须按 owner 边界执行，不能让 CLI-only 文件中的同名旧字段覆盖 Editor-owned 当前值。
5. migration 仍可存在，但用途从“生成全量 `cocos.config.json`”调整为“构造 Editor-owned runtime config snapshot”。
6. 测试和临时环境不能反向改变 production 默认策略。

## Owner 边界

### Editor-owned

Editor-owned 配置是 Editor 已经在项目或用户配置目录中维护的字段。CLI 读取这些字段时，应直接读取当前 Editor 文件并迁移到内存结构。

当前按现有 migration 入口归类：

| Runtime module | Editor source | 当前迁移入口 |
| --- | --- | --- |
| `builder` | `settings/v2/packages/builder.json`、`profiles/v2/packages/builder.json`、平台 profile 如 `profiles/v2/packages/web-mobile.json` | `register-migration.ts` 中 builder / platform 迁移器 |
| `engine` | `settings/v2/packages/engine.json`、`settings/v2/packages/project.json` | `register-migration.ts` 中 engine / project 迁移器 |
| `script` | `settings/v2/packages/project.json` | `register-migration.ts` 中 project 迁移器 |
| `scene` | global profile `scene.json` | `register-migration.ts` 中 scene 迁移器 |
| `import.fbx` 等来自 Editor project settings 的 import 子字段 | `settings/v2/packages/project.json` | `register-migration.ts` 中 project 迁移器 |

这些字段不应再作为 `cocos.config.json` 中的持久化 authority。

### CLI-only

CLI-only 配置是 Editor 不负责维护、只服务 CLI 行为的字段。它们可以保存在 `cocos.config.json`。

当前候选：

| Runtime module | CLI-only field | 用途 |
| --- | --- | --- |
| `import` | `restoreAssetDBFromCache` | CLI AssetDB 是否尝试从 cache 恢复 |
| `import` | `globList` | CLI AssetDB glob 过滤 |
| `import` | `createTemplateRoot` | CLI create menu / template root |

如果后续发现某个字段同时被 Editor 和 CLI 使用，必须先确认真实 owner，再加入 owner map，不能默认由 `cocos.config.json` 覆盖。

## 目标架构

引入一个 runtime project config 构造流程：

```text
Editor files
  settings/v2/packages/*.json
  profiles/v2/packages/*.json
  global profiles
        |
        v
Editor-owned migration snapshot
        |
        +---- defaults from configurationRegistry registrations
        |
cocos.config.json
  CLI-only persisted config
        |
        v
In-memory projectConfig
        |
        v
BaseConfiguration instances
```

推荐合并顺序：

1. module defaults：来自 `configurationRegistry.register(..., { defaults, nodes })`。
2. Editor-owned snapshot：每次初始化时从 Editor 文件实时读取并迁移。
3. CLI-only config：只把 owner map 允许的 CLI-only 字段合并进对应模块。

同一路径如果属于 Editor-owned，则 `cocos.config.json` 中的值必须忽略。

## 文件职责建议

预计涉及文件：

- Modify: `src/core/configuration/script/manager.ts`
  - 初始化时构造 in-memory `projectConfig`。
  - 保存时只写 CLI-only config 到 `cocos.config.json`。
  - 避免把 Editor-owned snapshot 写回 `cocos.config.json`。
- Modify: `src/core/configuration/migration/cocos-migration-manager.ts`
  - 保留 `migrate(projectPath)` 作为 Editor-owned snapshot 构造入口。
  - 如有必要，新增不落盘的 `loadEditorOwnedConfig(projectPath)` 语义包装。
- Modify: `src/core/configuration/migration/cocos-config-loader.ts`
  - 确保每次初始化可以读取最新 Editor 文件。
  - 当前 loader 内有 `configMap` cache，必须处理同进程多次 reload / remigrate 时的陈旧缓存。
- Create: `src/core/configuration/script/owner-map.ts`
  - 显式声明 Editor-owned 和 CLI-only path。
  - 提供 `pickCliOwnedConfig()`、`stripEditorOwnedConfig()` 或等价函数。
- Modify: `src/core/configuration/@types/cocos.config.d.ts`
  - 将 `COCOS_CONFIG` 从“全量项目配置”调整为“CLI persisted config”或新增独立类型。
- Modify: `src/core/configuration/test/manager.test.ts`
  - 覆盖 `cocos.config.json` 不再覆盖 Editor-owned 字段。
- Modify: `src/core/assets/test/config-sync.test.ts`
  - 保留 CLI-only import 配置从 `cocos.config.json` 生效。
- Modify: `src/core/builder/share/common-options-validator.ts`
  - 若当前 build config / profile adapter 有直接读取 Creator profile 的逻辑，确认它与新 runtime merge 不重复或冲突。
- Modify: `docs/dev/modules/configuration.md`
  - 实施完成后回填稳定结论。

## 行为规格

### 初始化

`configurationManager.initialize(projectPath)` 应完成：

1. 读取 `cocos.config.json`，仅作为 CLI persisted config。
2. 从 Editor 配置文件实时构造 Editor-owned snapshot。
3. 按 owner map 合并出内存 `projectConfig`。
4. 后续 `configurationRegistry.register(moduleName, ...)` 时，把内存中对应 module config 注入 `BaseConfiguration.configs`。

### 保存

当 `BaseConfiguration.save()` 触发 `ConfigurationManager.save()` 时：

1. 只允许保存 CLI-only path 到 `cocos.config.json`。
2. 不把 Editor-owned path 写入 `cocos.config.json`。
3. 如果 `cocos.config.json` 已存在旧的 Editor-owned 字段，可以选择在下一次 save 时清理；清理策略需要在实施前确认：
   - 方案 A：只写 owner map 中的 CLI-only 字段，自动移除旧 Editor-owned 字段。
   - 方案 B：保留未知旧字段但读取时忽略，降低破坏性。

本规格推荐方案 A，因为它能让 `cocos.config.json` 语义收敛为 CLI-only 文件；但实施前需要确认是否存在用户手写的未知 CLI 字段。

### Reload / remigrate

`configurationManager.reload()` 应重新读取：

- `cocos.config.json` 的 CLI-only 字段。
- 当前 Editor files 的 Editor-owned 字段。

`configuration-remigrate` API 的语义需要调整：

- 旧语义：从 settings 重新迁移并生成 `cocos.config.json`。
- 新语义建议：重新读取 Editor-owned config 并刷新内存配置；不再生成全量 `cocos.config.json`。

API 文案也需要同步调整，避免继续宣称“generate cocos.config.json from settings”。

## 验收测试规格

### 测试 1：Editor-owned 配置不被旧 `cocos.config.json` 覆盖

目的：证明 `engine` / `builder` 等 Editor-owned 字段以 Editor 文件为准。

步骤：

1. 在临时项目写入 `settings/v2/packages/engine.json`，设置 `modules.globalConfigKey = "from-editor"`。
2. 写入 `cocos.config.json`，设置旧值 `engine.globalConfigKey = "from-cocos-config"`。
3. 执行 `configurationManager.initialize(projectRoot)` 并注册 `engine` 配置。
4. 断言读取到的是 `"from-editor"`。

预期：

```text
engine.globalConfigKey === "from-editor"
```

### 测试 2：Editor 修改后同一初始化流程读取新值

目的：证明 CLI 不再依赖 `cocos.config.json.version` 判断是否重迁移 Editor-owned 字段。

步骤：

1. 写入 Editor setting `engine.globalConfigKey = "before-editor-change"`。
2. 初始化并读取，确认值为 `"before-editor-change"`。
3. 重置 runtime module state。
4. 修改 Editor setting 为 `"after-editor-change"`，不修改 `cocos.config.json.version`。
5. 重新初始化并读取。

预期：

```text
engine.globalConfigKey === "after-editor-change"
```

### 测试 3：CLI-only import 配置仍从 `cocos.config.json` 生效

目的：证明 `cocos.config.json` 仍可保存 CLI-only 配置。

步骤：

1. 写入 `cocos.config.json`：

```json
{
  "version": "1.0.0",
  "import": {
    "restoreAssetDBFromCache": true,
    "globList": ["!**/*.tmp"],
    "createTemplateRoot": ".creator/custom-template-root"
  }
}
```

2. 初始化 `configurationManager`、`project`、`Engine`、`assetConfig`。
3. 读取 `assetConfig.data`。

预期：

```text
assetConfig.data.restoreAssetDBFromCache === true
assetConfig.data.globList === ["!**/*.tmp"]
assetConfig.data.createTemplateRoot === <project>/.creator/custom-template-root
```

### 测试 4：保存时不写回 Editor-owned 字段

目的：证明 CLI save 不再把 Editor-owned snapshot 持久化成旧快照。

步骤：

1. Editor files 中提供 `engine` / `builder` 字段。
2. `cocos.config.json` 中只提供 `import.globList`。
3. 初始化后调用 `assetConfig.setProject("globList", ["!**/*.cache"])`。
4. 读取磁盘上的 `cocos.config.json`。

预期：

```text
cocos.config.json contains import.globList
cocos.config.json does not contain engine
cocos.config.json does not contain builder
```

### 测试 5：旧 `cocos.config.json` 兼容

目的：确认已有项目中包含旧 Editor-owned 快照时，不会破坏 CLI 启动。

步骤：

1. 写入包含旧 `builder`、`engine`、`script`、`scene`、`import` 的 `cocos.config.json`。
2. 写入 Editor files 中不同的 `builder` / `engine` 值。
3. 初始化。
4. 读取内存配置。
5. 触发一次 CLI-only save。

预期：

```text
Editor-owned fields use Editor files
CLI-only fields use cocos.config.json
save result follows chosen cleanup strategy
```

## 非目标

- 本规格不处理 `library` 顶层 JSON 改写问题；该问题属于 `BUILD-ISSUE-007`。
- 本规格不改变 `--build-config` profile adapter 的参数语义，除非验证发现与 runtime merge 冲突。
- 本规格不要求 CLI 禁止写项目文件。
- 本规格不把测试 env override 作为 production 默认策略。
- 本规格不直接修改 Editor 的 `settings/` 或 `profiles/` 文件。

## 待确认事项

1. `cocos.config.json` 旧文件中的 Editor-owned 字段，在下一次 save 时是自动清理，还是保留但读取时忽略。
2. CLI-only owner map 首批是否只包含 `import.restoreAssetDBFromCache`、`import.globList`、`import.createTemplateRoot`。
3. `configuration-remigrate` API 是否改名或保留旧工具名但调整 description。
4. `scene` global profile 是否也按 Editor-owned 处理；本规格默认按 Editor-owned。

## 执行计划草案

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

### Task 1：补 owner map 和纯函数测试

**Files:**

- Create: `src/core/configuration/script/owner-map.ts`
- Create: `src/core/configuration/test/owner-map.test.ts`

- [ ] 定义 CLI-only path allow-list。
- [ ] 定义 Editor-owned module/path 判断。
- [ ] 测试 `cocos.config.json` 中旧 `engine` / `builder` 字段不会进入 CLI persisted config。
- [ ] 测试 `import.restoreAssetDBFromCache`、`import.globList`、`import.createTemplateRoot` 会保留。

### Task 2：让 migration 变成 runtime snapshot 来源

**Files:**

- Modify: `src/core/configuration/migration/cocos-migration-manager.ts`
- Modify: `src/core/configuration/migration/cocos-config-loader.ts`
- Test: `src/core/configuration/test/cocos-migration.test.ts`

- [ ] 增加不落盘读取 Editor-owned snapshot 的 public 入口，或明确复用 `migrate(projectPath)` 但调用方不 save。
- [ ] 清理或绕过 `CocosConfigLoader.configMap` 导致的同进程陈旧缓存。
- [ ] 测试同一进程两次读取 Editor config，第二次能看到文件变更。

### Task 3：调整 `ConfigurationManager.initialize()` 和 `save()`

**Files:**

- Modify: `src/core/configuration/script/manager.ts`
- Test: `src/core/configuration/test/manager.test.ts`

- [ ] `initialize()` 读取 CLI persisted config。
- [ ] `initialize()` 每次读取 Editor-owned snapshot。
- [ ] `initialize()` 构造 in-memory `projectConfig`。
- [ ] `save()` 只写 CLI-only config。
- [ ] 测试 Editor-owned 字段不被旧 `cocos.config.json` 覆盖。
- [ ] 测试 save 不写回 `engine` / `builder`。

### Task 4：保留 AssetDB CLI-only 配置行为

**Files:**

- Modify: `src/core/assets/test/config-sync.test.ts`
- Inspect/Modify if needed: `src/core/assets/asset-config.ts`

- [ ] 复用现有 `asset import config sync` 测试意图。
- [ ] 确认 `restoreAssetDBFromCache`、`globList`、`createTemplateRoot` 仍从 `cocos.config.json` 生效。
- [ ] 确认 `import.fbx` 等 Editor-owned import 子字段不被误归类为 CLI-only。

### Task 5：同步 API 文案和模块文档

**Files:**

- Modify: `src/api/configuration/configuration.ts`
- Modify: `docs/dev/modules/configuration.md`
- Modify: `docs/dev/build/issues.md`

- [ ] 调整 `configuration-remigrate` description，避免继续承诺“generate cocos.config.json from settings”。
- [ ] 在 Configuration Module 记录 owner 边界和 runtime merge 策略。
- [ ] 将 `BUILD-ISSUE-006` 状态从 `deferred` 更新为实现后的状态，并链接事实或验收结果。

### Task 6：验证

**Commands:**

```powershell
rtk npm test -- src/core/configuration/test/manager.test.ts --runInBand
rtk npm test -- src/core/configuration/test/cocos-migration.test.ts --runInBand
rtk npm test -- src/core/assets/test/config-sync.test.ts --runInBand
rtk npm run build
```

**Expected:**

```text
所有新增和相关既有测试通过。
build 成功。
```

## 确认后再执行

本规格等待确认后再进入实现。确认前不修改 production code，不改测试，不运行会写项目的 CLI build/import。
