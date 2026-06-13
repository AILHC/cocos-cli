# `cocos.config.json` Editor-owned 配置运行时合并规格

状态：Design approved，implementation plan 已创建并经 review 修订。

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

## 配置来源策略

`cocos.config.json` 不再是项目配置总源。它的角色收敛为 CLI-owned overlay 文件：

- Editor-owned 配置：每次 CLI 初始化、reload 或 remigrate 时从 Editor 文件读取。
- CLI-owned 配置：从 `cocos.config.json` 读取，只覆盖 owner map 明确允许的 CLI-only path。
- Runtime merged config：只存在于内存，供 `ConfigurationManager`、`ConfigurationRegistry` 和下游模块读取。

如果同一路径同时出现在 Editor files 和 `cocos.config.json`，且该路径属于 Editor-owned，则以 Editor files 为准，`cocos.config.json` 的旧值必须忽略。

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
| 非白名单 `import.*` 子字段，例如 `import.fbx` | `settings/v2/packages/project.json` | `register-migration.ts` 中 project 迁移器 |

这些字段不应再作为 `cocos.config.json` 中的持久化 authority。

### CLI-only

CLI-only 配置是 Editor 不负责维护、只服务 CLI 行为的字段。它们可以保存在 `cocos.config.json`。

当前候选：

| Runtime module | CLI-only field | 用途 |
| --- | --- | --- |
| `import` | `restoreAssetDBFromCache` | CLI AssetDB 是否尝试从 cache 恢复 |
| `import` | `globList` | CLI AssetDB glob 过滤 |
| `import` | `createTemplateRoot` | CLI create menu / template root |
| metadata | `version` | `cocos.config.json` 文件自身版本，不参与 runtime owner merge |
| metadata | `$schema` | `cocos.config.json` schema path，不参与 runtime owner merge |

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
  - 保存事件绑定处按 owner map 过滤，避免 `configInstance.getAll()` 整个模块重新污染 persisted config。
  - 保存时只写 CLI-only config 和 persistence metadata 到 `cocos.config.json`。
  - 避免把 Editor-owned snapshot 写回 `cocos.config.json`。
- Modify: `src/core/configuration/script/config.ts`
  - Editor-owned project-scope set/remove 必须在 `BaseConfiguration` 直连入口拒绝；manager 层也要保留同样检查，防止不同调用路径绕过 owner 边界。
- Modify: `src/core/configuration/migration/cocos-migration-manager.ts`
  - 保留 `migrate(projectPath)` 作为 Editor-owned snapshot 构造入口。
  - 新增不落盘的 `loadEditorOwnedConfig(projectPath)` 语义包装。
- Modify: `src/core/configuration/migration/cocos-migration.ts`
  - 处理 static loader 的 projectPath/cache 陈旧风险，避免同进程切项目或 remigrate 读取旧文件。
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

1. 只允许保存 CLI-only path 和 persistence metadata 到 `cocos.config.json`。
2. 不把 Editor-owned path 写入 `cocos.config.json`。
3. 如果旧 `cocos.config.json` 已存在 Editor-owned 快照字段，下一次 save 应自动清理，只写回 owner map 允许的 CLI-only path 和 `version` / `$schema`。

当前代码的关键风险在事件链：

1. `BaseConfiguration.set(..., scope='project')` 会先修改该实例的 `configs`。
2. `BaseConfiguration.save()` 会 emit `MessageType.Save`。
3. `ConfigurationManager.onRegistryConfiguration()` 当前会把 `configInstance.getAll()` 整个模块写入 `projectConfig[moduleName]`，再调用 `save()`。

因此实现不能只在最终 `writeJSON()` 前过滤。保存事件绑定处也必须区分 runtime merged config 和 persisted config，避免 Editor-owned 字段先进入 `projectConfig` 后又被保存。

对主动写入 API 的策略：

- CLI-owned path：允许 project-scope set/remove，并持久化到 `cocos.config.json`。
- Editor-owned path：默认拒绝 project-scope set/remove，错误信息说明该字段由 Editor 配置文件维护；如后续需要临时内存 override，必须另设显式 scope，不能复用持久化 project scope。

### Reload / remigrate

`configurationManager.reload()` 应重新读取：

- `cocos.config.json` 的 CLI-only 字段。
- 当前 Editor files 的 Editor-owned 字段。

reload 后必须刷新已注册的 `BaseConfiguration` 实例。仅更新 `ConfigurationManager.projectConfig` 并 emit reload 不够，因为已注册实例持有自己的 `configs`。

`configuration-remigrate` API 的语义需要调整：

- 旧语义：从 settings 重新迁移并生成 `cocos.config.json`。
- 新语义：重新读取 Editor-owned config 并刷新内存配置；不再生成全量 `cocos.config.json`。

API 文案也需要同步调整，避免继续宣称“generate cocos.config.json from settings”。

`CocosMigration` 当前持有 static loader。正式实现必须确保同进程内多次 remigrate、reload 或切换 project path 时不会复用旧 `projectPath` 或旧 `configMap`。可选实现包括：

- 每次 migration 构造新的 `CocosConfigLoader`。
- 给 loader 增加 reset API。
- 或将 cache key 扩展为 `projectPath + scope + packageName`。

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
save result removes old Editor-owned fields from cocos.config.json
cocos.config.json keeps version and $schema metadata
```

## 非目标

- 本规格不处理 `library` 顶层 JSON 改写问题；该问题属于 `BUILD-ISSUE-007`。
- 本规格不改变 `--build-config` profile adapter 的参数语义，除非验证发现与 runtime merge 冲突。
- 本规格不要求 CLI 禁止写项目文件。
- 本规格不把测试 env override 作为 production 默认策略。
- 本规格不直接修改 Editor 的 `settings/` 或 `profiles/` 文件。

## 待确认事项

1. `configuration-remigrate` API 是否改名，还是保留旧工具名但调整 description 和行为。
2. `scene` global profile 是否也按 Editor-owned 处理；本规格默认按 Editor-owned。

## Implementation Plan

正式 implementation plan 已创建：[../plans/2026-06-13-cocos-config-editor-owned-runtime-merge.md](../plans/2026-06-13-cocos-config-editor-owned-runtime-merge.md)。该 plan 必须继续符合 `superpowers:writing-plans`：

- 使用 required plan header，包含 `Goal`、`Architecture`、`Tech Stack`。
- 每个 task 包含明确文件列表。
- 先写失败测试，再写实现，再运行通过测试。
- 每个 step 包含具体代码或命令、预期失败/通过输出。
- 覆盖以下实现风险：
  - owner map 纯函数。
  - `ConfigurationManager` runtime config 与 persisted config 分离。
  - `onRegistryConfiguration()` 保存事件过滤。
  - `reload()` / `configuration-remigrate` 刷新已注册实例。
  - `CocosMigration` static loader / cache / projectPath 陈旧问题。
  - `version` / `$schema` persistence metadata。
  - API 文案和模块文档同步。
