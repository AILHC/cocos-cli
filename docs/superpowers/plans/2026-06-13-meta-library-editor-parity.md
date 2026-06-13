# CLI Build 项目状态写入一致性阶段计划

日期：2026-06-13

专题入口：[../../dev/build/README.md](../../dev/build/README.md)

相关正式模块：

- [Builder Module](../../dev/modules/builder.md)
- [AssetDB Module](../../dev/modules/asset-db.md)
- [Configuration Module](../../dev/modules/configuration.md)
- [Scripting Module](../../dev/modules/scripting.md)

## 目标

验证并修正 CLI build 对主测试项目项目状态的写入行为，使其与 Editor 行为一致。

本计划不要求 CLI 禁止写 `.meta` 或 `library` 顶层 JSON。判断标准是：在同一 Editor 基线下，CLI build 写出的 importer `ver`、字段结构、默认值、文件布局和关键数据 shape 必须与 Editor 逻辑一致。

## Baseline

- `.meta` baseline：主测试项目当前 git 提交。用户已确认 Editor 打开项目产生的约 `2700+` 个 `.meta` 迁移变更已经提交，因此后续可直接用 `git diff` 判断 CLI 是否额外产生 `.meta` 变更。
- `library` 顶层 JSON baseline：`E:\own_space\engines\cocos-cli\.codex-tmp\bak_test_projects_library_data_json`。
- 主测试项目：`E:\own_space\engines\cocos-test-projects`。
- CLI 仓库：`E:\own_space\engines\cocos-cli`。
- 构建配置：`E:\own_space\engines\cocos-test-projects\profiles\v2\packages\web-mobile.json`。

`library` baseline 使用规则：

- 验证前必须先比较当前项目 `library` 顶层 JSON 与 backup baseline 的文件集合、raw hash、canonical JSON hash。
- 如果 build 前当前项目 `library` 与 backup baseline 不一致，不能继续用 backup 直接判断 CLI side effect。
- 出现 build 前不一致时，必须先停止并复述差异；确认后只能二选一：
  - 让用户重新提供或更新 Editor baseline。
  - 记录“build 前当前项目快照”作为本轮 CLI side-effect baseline，并把 backup 仅作为历史 Editor reference，不再作为直接 pass/fail 依据。

## 范围

第一阶段重点验证：

- 非 3D `.meta` 是否被 CLI build 额外改写。
- `library` 顶层 JSON 是否被 CLI build 改写。
- 若发生改写，改写内容是否与 Editor baseline 的字段结构和逻辑一致。

第一阶段先忽略 3D 相关资产，包括：

- `.gltf.meta`
- `.glb.meta`
- `.fbx.meta`
- `gltf` / `fbx` importer
- `gltf-mesh` / `gltf-scene` subMeta
- `triangleCount`
- `meshOptimizer`
- `lods`
- `legacyFbxImporter`
- `allowMeshDataAccess`
- `addVertexColor`
- `generateLightmapUVNode`

## 已知风险入口

源码入口：

- `src/core/launcher.ts`
  - `Launcher.build()` 会先执行 `this.import()`。
  - `Launcher.import()` 会执行 `initAssetDB()` / `startAssetDB()`。
- `src/core/assets/asset-config.ts`
  - `assets` DB：
    - `target`: `<project>/assets`
    - `library`: `<project>/library/cli`
  - `internal` DB：
    - `target`: `<engine>/editor/assets`
    - `library`: `<project>/library`
- `src/core/assets/index.ts`
  - `initAssetDB()` 设置 `globalThis.Build = true`，然后调用 `assetConfig.init()`、`assetManager.init()`、`assetDBManager.init()`。
  - `startAssetDB()` 进入真实 AssetDB 启动流程。
- `src/core/assets/manager/asset-db.ts`
  - `AssetDBManager.init()` 消费 `assetDBList`、`libraryRoot`、`tempRoot`。
  - `_createDB()` 调用 `assetdb.create(info)`。
  - `_startDB()` / `_startDirectly()` 调用 `db.start()`，是 `.meta` 和 library data 实际写入风险路径。
- `src/core/assets/manager/filesystem.ts`
  - AssetDB filesystem provider 最终会走 `writeFile` / `outputFile` 等写入接口，可用于确认写入是否经过 CLI provider。

当前 `BUILD-ISSUE-007` 的重点风险点是 `internal` DB 使用项目级 `library`，可能触碰 Editor 同样使用的顶层 data JSON。

## 阶段 1：验证前快照

目的：确认验证起点干净，记录 `.meta` 和 `library` baseline。

命令：

```powershell
cd E:\own_space\engines\cocos-test-projects
git status --short
git diff --name-only -- ":(glob)**/*.meta"
git ls-files --others --exclude-standard -- ":(glob)**/*.meta"
```

预期：

- `.meta` 基线应为干净状态。
- 如果存在非预期 `.meta` diff，停止验证，先确认是否来自用户未提交变更。

记录当前 `library` 顶层 JSON：

```powershell
cd E:\own_space\engines\cocos-test-projects
$projectLibraryJson = Get-ChildItem -LiteralPath "library" -File -Force |
  Where-Object { $_.Extension -ieq ".json" }

$projectLibraryJson |
  Select-Object Name,Length,LastWriteTime |
  Format-Table -AutoSize

$projectLibraryJson |
  Get-FileHash -Algorithm SHA256 |
  Sort-Object Path |
  Format-Table Hash,Path -AutoSize
```

记录 backup baseline：

```powershell
cd E:\own_space\engines\cocos-cli
$backupLibraryJson = Get-ChildItem -LiteralPath ".codex-tmp\bak_test_projects_library_data_json" -File -Force |
  Where-Object { $_.Extension -ieq ".json" }

$backupLibraryJson |
  Select-Object Name,Length,LastWriteTime |
  Format-Table -AutoSize

$backupLibraryJson |
  Get-FileHash -Algorithm SHA256 |
  Sort-Object Path |
  Format-Table Hash,Path -AutoSize
```

输出要求：

- 当前项目 `library` 顶层 JSON 文件列表。
- backup baseline JSON 文件列表。
- 两边文件集合是否一致；如果不一致，停止验证并复述新增/删除文件。
- 两边同名文件 raw SHA256 是否一致。
- 两边同名文件 canonical JSON SHA256 是否一致。
- 顶层 JSON key / 类型摘要。

canonical JSON 规则：

- 递归按对象 key 排序。
- 保留数组顺序，因为 AssetDB data 中数组顺序可能有语义。
- 不保留空白、缩进、换行差异。
- raw hash 不一致但 canonical hash 一致时，记录为格式化或 key 顺序变化，不直接判定为语义变化。
- canonical hash 不一致时，再输出顶层 key、key 类型和关键字段 shape 差异。

路径污染扫描：

```powershell
$projectLibraryJson = Get-ChildItem -LiteralPath "E:\own_space\engines\cocos-test-projects\library" -File -Force |
  Where-Object { $_.Extension -ieq ".json" }

$projectLibraryJson |
  Select-String `
  -Pattern "cocos-cli","library/cli","library\\cli","temp/cli","temp\\cli","E:\\own_space\\engines\\cocos-cli" `
  -SimpleMatch
```

如果扫描命中，必须记录命中文件、字段上下文和是否为 Editor baseline 已存在内容。

## 阶段 2：运行受控 CLI build

目的：只触发一次 normal build，观察项目状态副作用。

命令：

```powershell
cd E:\own_space\engines\cocos-cli
node .\dist\cli.js build `
  --project "E:\own_space\engines\cocos-test-projects" `
  --platform web-mobile `
  --build-config "E:\own_space\engines\cocos-test-projects\profiles\v2\packages\web-mobile.json" `
  --buildPath "project://build/codex-cli-output" `
  --outputName "cli-side-effect-check"
```

要求：

- 记录退出码。
- 记录最新 build log 路径。
- 本阶段不先处理浏览器运行时问题。
- 输出目录使用唯一名字，避免复用旧产物。

## 阶段 3：检查 `.meta` 差异

命令：

```powershell
cd E:\own_space\engines\cocos-test-projects
git diff --name-status -- ":(glob)**/*.meta"
git diff -- ":(glob)**/*.meta"
```

若 `.meta` 无 diff：

- 记录结论：在当前 Editor `.meta` baseline 后，CLI build 没有额外改写 `.meta`。

若 `.meta` 有 diff：

先过滤 3D 资产，再对非 3D 资源按 importer 分类：

- `image`
- `typescript`
- `directory`
- `scene`
- `material`
- `prefab`
- `buffer`
- `effect`
- `audio-clip`
- `text`
- `json`
- `javascript`
- `tiled-map`
- `bitmap-font`
- `sprite-atlas`
- `auto-atlas`

3D 忽略判定顺序：

1. 优先读取 `.meta` JSON 的 `importer` 和 `subMetas.*.importer`。
2. 当 importer / subMeta importer 属于 `gltf`、`fbx`、`gltf-mesh`、`gltf-scene` 等模型链路时，标记为 3D。
3. 扩展名 `.gltf.meta`、`.glb.meta`、`.fbx.meta` 只作为辅助判定。
4. `.prefab.meta`、`.material.meta` 等不能仅凭扩展名判断为非 3D；如果其 diff 来自模型派生资源或 subMeta importer，应单独标注。

输出表：

| importer | 数量 | 旧 `ver` | 新 `ver` | 字段变化 | 典型路径 | 判断 |
| --- | ---: | --- | --- | --- | --- | --- |

判定标准：

- 只有 3D 相关 diff：第一阶段记录但不处理。
- 非 3D diff 只与 Editor baseline 一致：记录为可接受写入。
- 非 3D diff 与 Editor baseline 不一致：进入源码定位，查 importer 版本、默认字段、AssetDB 初始化配置差异。

## 阶段 4：检查 `library` 顶层 JSON 差异

比较范围：

- 当前项目：`E:\own_space\engines\cocos-test-projects\library` 下的顶层 JSON 文件全集，即 `Get-ChildItem -LiteralPath "library" -File -Force | Where-Object { $_.Extension -ieq ".json" }`。
- baseline：`E:\own_space\engines\cocos-cli\.codex-tmp\bak_test_projects_library_data_json` 下的顶层 JSON 文件全集，即同样用 `Get-ChildItem -File -Force` 加 `.Extension -ieq ".json"` 枚举。

重点文件：

- `.assets-data.json`
- `.internal-data.json`
- 其他同级 dot JSON 或 data JSON。

命令：

```powershell
cd E:\own_space\engines\cocos-test-projects
$projectLibraryJson = Get-ChildItem -LiteralPath "library" -File -Force |
  Where-Object { $_.Extension -ieq ".json" }

$projectLibraryJson |
  Get-FileHash -Algorithm SHA256 |
  Sort-Object Path |
  Format-Table Hash,Path -AutoSize

cd E:\own_space\engines\cocos-cli
$backupLibraryJson = Get-ChildItem -LiteralPath ".codex-tmp\bak_test_projects_library_data_json" -File -Force |
  Where-Object { $_.Extension -ieq ".json" }

$backupLibraryJson |
  Get-FileHash -Algorithm SHA256 |
  Sort-Object Path |
  Format-Table Hash,Path -AutoSize
```

对变化文件输出：

| 文件 | hash 是否变化 | 顶层 keys 是否变化 | key 类型是否变化 | 可疑字段 | 判断 |
| --- | --- | --- | --- | --- | --- |

关键检查项：

- 是否新增或删除顶层 JSON。
- 同名文件 hash 是否变化。
- raw hash 变化但 canonical JSON hash 是否一致。
- 顶层 key 集合是否变化。
- 同名 key 的值类型是否变化。
- 是否出现 CLI 独有路径，例如 `library/cli`、`temp/cli`、`cocos-cli` 工作区路径。
- 是否出现 Editor baseline 不存在的字段结构。
- 是否只是排序、格式化、mtime、timestamp、cache token 等非结构性字段变化；这类必须明确列为“非结构变化候选”，不能直接判定 CLI 行为错误。

## 阶段 5：源码定位

只有在阶段 3 或阶段 4 出现不一致时执行。

定位方向：

1. 查 `Launcher.build()` 触发的 `Launcher.import()` 是否为必要 build 前置阶段。
2. 查 `initAssetDB()` / `startAssetDB()` 如何根据 `AssetConfig.assetDBList` 创建 DB。
3. 查 `internal` DB 使用 `<project>/library` 是否导致顶层 JSON 写入。
4. 查 Editor 对 internal DB 的 library root、data JSON 命名和字段结构。
5. 查 CLI 是否缺少 Editor 的配置项、迁移策略、readonly 策略或 library isolation 策略。

禁止事项：

- 不能为了让 diff 消失而简单禁止所有 `.meta` 写入。
- 不能在未确认 Editor 行为前把 `internal` DB 改到隔离目录。
- 不能用测试缓存、旧备份或一次历史目录状态反推 production 默认策略。

## 阶段 6：修复策略分支

### 分支 A：CLI 不额外改 `.meta`，也不改 `library` 顶层 JSON

处理：

- 记录验证事实。
- 将 `BUILD-ISSUE-007` 从 `fact-gap` 调整为当前基线未复现。

### 分支 B：CLI 只改 3D `.meta`

处理：

- 第一阶段记录为忽略项。
- 不阻塞当前 build/library parity。

### 分支 C：CLI 改非 3D `.meta`

处理：

- 对比 Editor baseline 的 importer `ver` 和字段结构。
- 如果 CLI 写出的 `ver` 或字段与 Editor 不一致，修 CLI 使用的 importer/schema/defaults。
- 修复后重新运行阶段 2 和阶段 3。

### 分支 D：CLI 改 `library` 顶层 JSON

处理：

- 如果 hash 变但 JSON shape 等价，继续检查是否只是排序、mtime、cache timestamp 或非语义字段。
- 如果字段结构不同，优先分析 `internal` DB 写入 `<project>/library` 的链路。
- 修复目标不是禁止写，而是让字段结构和 Editor 逻辑一致。
- 修复后重新运行阶段 2 和阶段 4。

## 阶段 7：验收标准

最终必须给出以下结论：

- CLI build 后非 3D `.meta` 是否有新增差异。
- 若有差异，每类 importer 的旧 `ver`、新 `ver`、字段变化是什么。
- CLI build 后 `library` 顶层 JSON 是否有变化。
- 若有变化，是否与 Editor baseline 的字段结构一致。
- 若不一致，明确是哪条 CLI AssetDB 配置或写入链路导致。
- 修复后再次运行同样构建，`.meta` 和 `library` 顶层 JSON 差异符合 Editor 行为。

## 文档更新

验证或修复后更新：

- `docs/dev/build-extension-hooks-20260612.md`
- `docs/dev/build/facts/meta-library-editor-parity-20260613.md`

当前 `docs/dev/build/issues.md` 正在重构，本计划执行验证后先不更新该文件。验证事实、命令输出摘要、hash 对比、diff 分类、日志路径和阶段性结论统一写入 `docs/dev/build/facts/meta-library-editor-parity-20260613.md`。

`BUILD-ISSUE-007` 状态更新规则：

- 未复现：保留事实并标记当前基线未复现。
- 已复现且定位中：保持 `open` 或 `fact-gap`，补充可重复步骤。
- 已修复且有验证：标记 `fixed`，记录命令、日志、hash 对比结果。

上述状态更新规则暂作为后续 issue 重构完成后的迁移依据，不在本轮验证中直接修改 `docs/dev/build/issues.md`。
