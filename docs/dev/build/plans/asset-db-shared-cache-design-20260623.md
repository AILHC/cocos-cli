# AssetDB shared cache 方案设计

日期：2026-06-23

## 目标

目标是尽量让 CLI 与 Editor 串行共享项目缓存目录，减少 adapter 与官方 Creator 目录结构的偏离，并降低重复导入成本。

共享不是无条件共享。本文按“收益 / 修改成本 / 风险”评估每类目录：

- 能共享的，给出实现路径。
- 暂时不能共享的，说明 blocker 和需要补的事实。
- 收益低且风险高的，允许不共享。

## 事实来源

已有对比文档：

```text
docs/dev/build/facts/asset-db-shared-cache-diff-analysis-20260622.md
```

真实验证现场：

```text
E:\own_space\engines\cocos-test-projects
E:\own_space\engines\cocos-cli\.worktrees\rebase-adapter-to-386-origin-main-20260622\.codex-tmp\assetdb-path-compare-final-20260622
```

关键验证结果：

```text
[runtime-preview] asset-db:done durationMs=82012
[runtime-preview] preview:ready durationMs=90564
```

快照结论：

| 对比项 | Editor | CLI | 共同路径 | 相同 hash | 不同 hash | Editor-only | CLI-only |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `temp/asset-db` vs `temp/cli/asset-db` | 757 | 134 | 134 | 104 | 30 | 623 | 0 |
| `library` vs `library/cli` | 6355 | 5935 | 5933 | 5594 | 339 | 422 | 2 |
| 共享 `library` 排除 `cli/` / `cli-extensions/` | 6355 | 6356 | 6355 | 6354 | 1 | 0 | 1 |
| `temp/programming` 前后 | 969 | 969 | 969 | 969 | 0 | 0 | 0 |

## 当前源码约束

### 1. `AssetDBOptions` 没有 record/output 分离能力

`@cocos/asset-db` 当前 `AssetDBOptions` 只有：

```text
name
target
library
temp
```

`VirtualAsset.library` 和 `VirtualAsset.temp` 都直接从 `assetDB.options.library` / `assetDB.options.temp` 派生。

结果：

- 设置 `library=<project>/library` 会同时影响 import output、record 文件、`.assets` cache 文件。
- 设置 `temp=<project>/temp/asset-db/assets` 会同时影响 per-asset temp output。
- 目前不能只靠配置做到“共享 output，但 record 放 sidecar”。

### 2. `AssetDB.prepareStart()` 硬编码 record 文件名

当前 `AssetDB.prepareStart()` 行为：

```text
info:       <library>/.<name>-info.json
data:       <library>/.<name>-data.json
dependency: <library>/.<name>-dependency.json
cache:      <library>/.<name>
```

`internal` 是特例：

```text
info: <library>/.internal-info1.0.0.json
```

因此，如果直接把 `assets.library` 改成 `<project>/library`，CLI 会尝试使用：

```text
library/.assets-info.json
library/.assets-data.json
library/.assets-dependency.json
library/.assets
```

这和 Editor 3.8.6 baseline 不完全一致。

### 3. record manager 的 Editor 兼容只覆盖 `internal`

当前 local `@cocos/asset-db` patch：

- `InfoManager.editorCompatibility` 只在文件名为 `.internal-info1.0.0.json` 时启用。
- `DependencyManager.editorCompatibility` 只在文件名为 `.internal-dependency.json` 时启用。
- `DataManager.shouldPreserve()` 只对 `.internal-data.json` 生效。

对 `assets` record，CLI 仍使用新版 record 格式：

```text
.assets-info.json
.assets-dependency.json => { data, version }
.assets-data.json       => 可覆盖 versionCode / value
```

并且 `InfoManager` 非兼容模式发现 legacy `.assets-info1.0.0.json` 时会读取并删除旧文件，再写 `.assets-info.json`。

### 4. importer 不一致会删除共享 output

`@cocos/asset-db/libs/task.js` 中，importer 执行条件包含：

```text
importer.versionCode !== asset.versionCode
importer.version !== asset.meta.ver
asset meta files 缺失
force(asset)
```

触发导入时会执行 `asset.reset()`。

`asset.reset()` 会：

- 删除 `asset.temp`
- 删除 `asset.meta.files` 记录的 library output
- 清理 subAsset
- 清理 dependency record

所以 record sidecar 只能避免 Editor record 被迁移；如果 importer version/value 不一致，CLI 仍可能重导并覆盖共享 `library/<uuid-prefix>/...` 产物。

## 差异根因拆分

### 1. record 差异

Editor project assets record：

```text
library/.assets-info1.0.0.json
library/.assets-dependency.json      # 顶层 path / uuid
library/.assets-data.json            # 顶层 uuid map
```

CLI project assets record：

```text
library/cli/.assets-info.json
library/cli/.assets-dependency.json  # 顶层 data / version
library/cli/.assets-data.json
library/cli/.assets
```

根因：local `@cocos/asset-db` 只给 `internal` 做了 Editor record compatibility，没给 `assets` 做。

### 2. `.assets-data.json` importer 差异

`.assets-data.json` 两边都有 5197 个 uuid key，差异不是“CLI 少扫资源”，而是 715 条记录内容不同。

按 importer 分布：

| importer | diff 总数 | versionCode diff | value diff | Editor versionCode | CLI versionCode |
| --- | ---: | ---: | ---: | --- | --- |
| `gltf` | 292 | 292 | 0 | `1` | `3` |
| `scene` | 273 | 273 | 273 | `1` | `2` |
| `prefab` | 67 | 67 | 0 | `1` | `2` |
| `fbx` | 50 | 50 | 0 | `1` | `3` |
| `animation-clip` | 19 | 19 | 0 | `1` | `2` |
| `audio-clip` | 11 | 0 | 11 | `1` | `1` |
| `spine-data` | 2 | 0 | 2 | `1` | `1` |
| `video-clip` | 1 | 0 | 1 | `1` | `1` |

当前 CLI 源码事实：

```text
src/core/assets/asset-handler/assets/scene/index.ts       versionCode = 2
src/core/assets/asset-handler/assets/gltf.ts              versionCode = 3
src/core/assets/asset-handler/assets/animation-clip.ts    versionCode = 2
```

`prefab` 复用 `scene` 的 `versionCode`。

根因判断：

- `gltf` / `fbx` / `prefab` / `animation-clip` 的主要差异是 importer `versionCode`。
- `scene` 既有 `versionCode` 差异，也有 `depends` value 差异。
- `audio-clip` / `spine-data` / `video-clip` 是 value 差异，不是 versionCode。

不确定项：

- 当前没有在 `D:\workspace\engines\cocos\3.8.6` engine source 中定位到 Editor importer 源码。Editor baseline 来自 `cce run` 后的真实产物，不是源码断言。
- 需要用 Editor 强制 reimport 或找到 Editor 安装包内 importer 源码，确认 Editor 3.8.6 effective `versionCode` 是否确实为 `1`。否则不能直接把 CLI versionCode 全部降到 `1`。

### 3. `temp/asset-db` 差异

`temp/asset-db` 和 `temp/cli/asset-db` 的 30 个不同 hash 主要集中在：

```text
assets/fbx.FBX-glTF-conv/.../status.json
assets/fbx.FBX-glTF-conv/.../output/out.gltf
assets/fbx2gltf-.../status.json
```

真实差异：

```text
Editor: 22 个 FBX-glTF-conv status.json 都有 version
CLI:    22 个 FBX-glTF-conv status.json 都没有 version
```

源码事实：

- `src/core/assets/asset-handler/assets/utils/model-convert-routine.ts` 写 `version`、`sourceTimeStamp`、`outputTimeStamps`、`options`。
- `src/core/assets/asset-handler/assets/gltf/reader-manager.ts` 调用 `modelConvertRoutine('fbx.FBX-glTF-conv', ..., importerVersion, fbxConverter)`。

不确定项：

- 源码看起来 CLI 应该写 `version`，但实际 CLI 产物缺 `version`。需要确认实际运行是否加载了另一份 `modelConvertRoutine`、旧 dist、或旧缓存文件未重写。
- 这项必须复测，不能仅凭源码下结论。

## 方案选项

### 方案 A：直接采用官方路径，完全共享 `library` / `temp/asset-db`

路径：

```text
assets.library = <project>/library
internal.library = <project>/library
tempRoot = <project>/temp/asset-db
extension.library = <project>/library/<extensionName>
```

收益：

- 路径最接近官方 Creator。
- 改动最少。
- 不再有 `library/cli`、`temp/cli/asset-db` 双份缓存。

成本：

- 低。主要改 `asset-config.ts`、effect bin path、schema path 和测试。

风险：

- 高。CLI 会迁移或删除 `.assets-info1.0.0.json`。
- `.assets-dependency.json` 可能从 Editor `path/uuid` 形态改成 CLI `{ data, version }` 形态。
- importer `versionCode` 不一致会触发 `asset.reset()`，覆盖共享 import output。
- `scene` 的 `depends` value 不一致会造成持续改写。

结论：

不建议直接做。它能共享目录，但会破坏 Editor baseline，收益被风险抵消。

### 方案 B：共享 `temp/asset-db`，暂缓共享 project `library`

路径：

```text
tempRoot = <project>/temp/asset-db
assets.library = <project>/library/cli
internal.library = <project>/library
extension.library = <project>/library/cli-extensions/<extensionName>
temp/programming 继续 CLI-owned
```

收益：

- 先消除一类官方路径偏离。
- 避开 `library` record 和 importer output 的高风险。
- `temp/asset-db` 的差异集中在 FBX 转换缓存，范围相对小。

成本：

- 低到中。
- 需要修 effect bin path：
  - `src/runtime-preview/server/preview-app-required-routes.ts`
  - `src/core/scene/scene.scripting.middleware.ts`
- 需要复查 `assetConfig.data.tempRoot` 相关清理逻辑。
- 需要定位 FBX status 缺 `version` 的实际原因。

风险：

- 中。FBX `status.json` schema 不一致会导致重复转换或 cache miss。
- Editor-only 的 623 个 temp 文件不能被 CLI whole-directory clean。

结论：

可以作为第一阶段，但前提是先修/验证 FBX status schema，并明确禁止清空整个 `temp/asset-db`。

### 方案 C：共享 `library` output，但 CLI record 使用 sidecar

目标：

```text
assets import output: <project>/library/<uuid-prefix>/<uuid...>
CLI record:           <project>/library/.cli-assets-*
Editor record:        <project>/library/.assets-*
```

收益：

- 最大化共享真实 import output。
- 不迁移、不删除 Editor record。
- 比完整复用 Editor record 风险低。

成本：

- 中到高。
- 需要扩展 local `@cocos/asset-db`，让 record/cache 路径可配置。当前 `AssetDBOptions` 不支持。
- 候选新增能力：

```ts
interface AssetDBOptions {
    library: string;          // import output root
    temp: string;             // temp output root
    records?: {
        info?: string;
        data?: string;
        dependency?: string;
        cache?: string;
    };
}
```

或更窄：

```ts
recordPrefix?: string; // assets -> cli-assets
recordRoot?: string;   // 默认等于 library
```

风险：

- 只做 sidecar 还不够。第一次 CLI 启动如果 sidecar record 为空，会全量导入并覆盖共享 output。
- 即使 sidecar 有记录，只要 importer `versionCode` / `value` 不对齐，仍会触发 `asset.reset()` 并重写 output。

结论：

这是推荐的中间架构，但不能单独交付。必须和 importer parity、sidecar bootstrap 或 Editor baseline import record 转换配套。

### 方案 D：完整复用 Editor `assets` record

目标：

CLI 与 Editor 共用：

```text
library/.assets-info1.0.0.json
library/.assets-dependency.json
library/.assets-data.json
library/.assets
library/<uuid-prefix>/<uuid...>
```

收益：

- 共享程度最高。
- CLI 能直接基于 Editor record 判断缓存是否有效。
- 磁盘与导入行为最接近 Editor。

成本：

- 高。
- 需要把 `InfoManager` / `DependencyManager` / `DataManager` 的 Editor compatibility 从 `internal` 扩展到 `assets`。
- 需要保证不会删除 `.assets-info1.0.0.json`。
- 需要保证 `.assets-dependency.json` 仍写顶层 `path` / `uuid`。
- 需要明确 `.assets` cache 文件是否 Editor 使用。如果 Editor 不使用，CLI 不能随意写同名文件；如果 Editor 使用，则要确认格式一致。

风险：

- 高。CLI 会直接写 Editor record，任何兼容错误都会污染 Editor baseline。
- importer 不一致时，仍会持续改写 shared output。

结论：

这是最终可选目标，不适合作为第一阶段。只有在 importer parity 验证稳定后再考虑。

### 方案 E：谨慎评估 `temp/programming` 是否继续共享

候选路径：

```text
temp/programming
temp/cli/programming
```

事实：

- 它是 runtime-preview scripting / packer-driver workspace，不是 Editor asset-db cache。
- 之前 CLI 确实默认使用过 `temp/programming`，因为 `PackerDriver.create()` 默认从 project temp 派生 `programming` root。
- 当前这次验证显示，在 CLI 改为 `temp/cli/programming` 后，Editor 的 `temp/programming` 前后 969/969 hash 完全一致。这只能证明“隔离后没有再写 Editor programming”，不能反向证明“共享一定有问题”。
- runtime preview 已有相关 issue：`docs/dev/runtime-preview/issues.md` 的 `RP-ISSUE-007` 记录“浏览器脚本加载是否可以并发加速”。事实入口是 `docs/dev/runtime-preview/facts/browser-loading-and-cache-20260611.md` 和 `docs/dev/facts/scripting-generated-modules.md`：`preview-app` 在 `cc.game.init()` 后导入 `cce:/internal/x/prerequisite-imports`，当前不能在未验证 Cocos module loading 语义前改成全并发加载。

共享收益：

- 路径更接近既有 Editor / project temp 结构。
- 避免 `temp/programming` 与 `temp/cli/programming` 两份 packer-driver / SystemJS 产物。
- 对 runtime-preview 首次启动可能有缓存复用收益。

共享风险：

- `temp/programming` 下包含 `packer-driver/targets/*`、import map、chunks、SystemJS bundle 等 preview 编程产物，不是只读资源缓存。
- CLI preview 和 Editor preview 可能使用不同的 include modules、script config、build target、runtime mode 或 import map 生成参数。串行运行时，后运行的一方会改写 shared workspace。
- `PackerDriver.clearCache()` / target workspace 清理逻辑可能清理 shared `packer-driver/targets`，导致另一方下次 preview 需要重建，或短期内读到缺失 chunk / stale import map。
- runtime-preview server 当前允许从 `cliProgrammingRoot` 和 `projectProgrammingRoot` 查找 chunks。如果共享策略与路由候选根不一致，容易出现“构建写到 A，server 从 B 读”的错误。
- 与 `RP-ISSUE-007` 直接相关的风险是浏览器脚本加载性能和产物形态被共享 cache 掩盖：`temp/programming` 保存 `prerequisite-imports`、`import-map.json` 和 `chunks/**`，如果共享后读到旧的 static dependency chunk，可能重新触发一次性暴露大量 dependencies 的资源压力；如果读到新的 sequential dynamic import chunk，大项目仍可能因为顺序加载几千个 prerequisite scripts 而慢。共享目录只能复用产物，不能证明加载策略正确，也不能把加载慢误判为 asset-db path 问题。

结论：

`temp/programming` 可以作为共享候选，但不应该在没有验证的情况下简单归为“无风险”。它的风险不是破坏 asset-db record，而是 preview workspace 被串行改写、清理和 import map/chunk 不一致。

推荐：

- 若目标是最大化共享，可以把 `temp/programming` 纳入独立阶段验证。
- 若目标是先降低 asset-db 路径偏离，`temp/programming` 可暂时保持 CLI-owned，避免和 asset-db shared cache 问题混在一起。
- 最终是否共享，以 `Editor preview -> CLI preview -> Editor preview` 三段验证为准；验证必须同时记录 `RP-ISSUE-007` 相关的 prerequisite module 形态、实际 loaded script/chunk 数量、浏览器请求失败、加载耗时和 cache 命中情况。若出现加载慢，不能用清 `programming` cache 或改全并发作为默认修复。

`cocos.config.schema.json`：

- 它不是 asset-db cache。
- 可以跟官方放到 `temp/cocos.config.schema.json`，也可以保留 `temp/cli/cocos.config.schema.json`。
- 收益主要是路径对齐，不影响 asset import output。
- 如果改到 `temp/cocos.config.schema.json`，需要确认 Editor 是否会写同名 schema；当前未见证据。

## 推荐总体方案

推荐按缓存收益分阶段推进。

### 阶段 0：补可重复验证工具

先固化验收链路：

```text
clean library/temp
-> cce run
-> snapshot A
-> cli preview --runtime until preview:ready
-> snapshot B
-> cce run again
-> snapshot C
```

必须输出：

- `library` record diff
- `library/<uuid-prefix>` output diff
- `temp/asset-db` diff
- `.assets-data.json` 按 importer 分类 diff
- repeated rewrite 列表

收益：

- 防止继续基于错误快照判断。
- 后续每阶段都有可回归验收。

成本：

- 中。主要是 PowerShell/Node 脚本和文档化。

### 阶段 1：先解决 `library` output 共享的前置结构

缓存收益判断：

```text
temp/asset-db:     约 90 MiB
library/cli:       约 585 MiB
library excluding cli/cli-extensions: 约 620 MiB
```

`temp/asset-db` 不是当前缓存收益主战场。隔离 `temp/asset-db` 不会让同一个工具“下次打开重新导入”，只会让 Editor 和 CLI 各自维护一份转换缓存。真正导致重复导入、重复占用和启动成本高的是 project `library` import output 双份存在。

第一阶段不先切 `temp/asset-db`，而是先给 `library` output 共享补结构：

```text
assets.library = <project>/library/cli
assets.records = <project>/library/cli/.assets-*   # 当前等价行为
```

目标：

- 在 local `@cocos/asset-db` 增加 record path 可配置能力。
- 先保持现有 output path，不改变 runtime 行为。
- 用测试证明 record/cache path 和 import output path 已经解耦。

验收：

- `library` 可作为 future output root。
- CLI record 仍可写在 sidecar path。
- `AssetDB.prepareStart()` 不再把所有 record path 硬编码到 `library` root。

收益：

- 为真正共享大缓存 `library/<uuid-prefix>/...` 提供必要前置。
- 不先碰 Editor record，不污染现有项目。

### 阶段 2：对齐 importer parity，并准备 sidecar bootstrap

处理 blocker：

1. 找到或验证 Editor 3.8.6 importer effective `versionCode`。
2. 对齐 `.assets-data.json` 中高频差异：
   - `gltf` / `fbx`
   - `scene` / `prefab`
   - `animation-clip`
   - `scene.depends`
   - `audio-clip` / `spine-data` / `video-clip` value diff
3. 设计 CLI sidecar bootstrap：
   - 只读 Editor `.assets-info1.0.0.json` / `.assets-data.json`。
   - 转换为 CLI sidecar record。
   - 不写回、不迁移、不删除 Editor record。

这一步仍可保持：

```text
assets.library = <project>/library/cli
records = <project>/library/cli/.assets-*
```

收益：

- 避免切 shared output 后第一次 CLI 启动因为 sidecar record 为空而全量重导。
- 避免 importer `versionCode` / `depends` 不一致导致 `asset.reset()` 来回覆盖共享 output。

成本：

- 高。这里是共享 `library` 的主要成本。

验收：

- `.assets-data.json` diff 降到可解释范围。
- sidecar bootstrap 后 CLI 不进行无意义全量 reimport。
- Editor record 文件 hash 不因 CLI 启动变化。

### 阶段 3：共享 project `library` output

切路径：

```text
assets.library = <project>/library
assets.records = <project>/library/.cli-assets-*   # 阶段 3 推荐先 sidecar
```

收益：

- 真正共享 project import output。
- 保留 Editor record，避免污染。

成本：

- 高。importer parity 是主要成本。

风险：

- 如果 importer parity 未完成，共享 output 会被 CLI 重写。
- 如果 sidecar record bootstrap 不完善，首次 CLI 仍会全量导入。

建议：

- 阶段 3 不直接复用 Editor record。
- 先使用 sidecar record + shared output。
- sidecar record 初始化可以从 Editor `.assets-info1.0.0.json` / `.assets-data.json` 转换而来，但必须只读 Editor record，不写回。

### 阶段 3.5：评估 `temp/asset-db` 是否仍值得共享

默认结论：

```text
temp/asset-db 可以继续隔离
```

理由：

- 当前主测试项目中 `temp/asset-db` 与 `temp/cli/asset-db` 都约 90 MiB，不是主要磁盘成本。
- 隔离不会让 Editor 或 CLI 自己下次打开失效；每个工具都有稳定缓存路径。
- 当前差异集中在 FBX conversion status / output，直接共享前仍要解释 `status.json` schema 差异。

只有满足以下任一条件才切共享：

- 真实大项目证明 FBX / model conversion 首次成本很高，且 Editor -> CLI 的跨工具复用收益明显。
- 修复并验证 FBX `status.json` schema 一致。
- 确认 CLI 不会清空整个共享 `temp/asset-db`。

如果切，共享路径为：

```text
assetConfig.tempRoot = <project>/temp/asset-db
```

否则保留：

```text
assetConfig.tempRoot = <project>/temp/cli/asset-db
```

### 阶段 4：评估是否复用 Editor record

如果阶段 3 稳定，再评估是否把 CLI sidecar record 合并到 Editor record。

条件：

- `Editor -> CLI -> Editor` 三段快照稳定。
- `.assets-data.json` 没有持续 `versionCode` / `depends` 抖动。
- `.assets-dependency.json` 能保持 Editor `path` / `uuid` 形态。
- `.assets-info1.0.0.json` 不被删除或迁移。

收益：

- 共享程度最高。
- 减少 sidecar record 和 Editor record 的双套状态。

成本：

- 高。

建议：

- 不是当前优先项。
- 只有阶段 3 证明稳定后再做。

## extension asset-db 共享策略

当前 adapter：

```text
library/cli-extensions/<extensionName>
```

官方方向：

```text
library/<extensionName>
```

收益：

- 更接近官方路径。
- 如果 Editor project extension asset-db 也使用 `library/<extensionName>`，可共享 extension output。

成本：

- 低到中。主要改 `src/core/assets/extension-asset-db-mounts.ts` 和测试。

风险：

- `extension.name` 来自 `package.json` 或目录名，当前没有 path segment sanitization。
- 可能与 `library` 下 reserved 文件或目录冲突：
  - `.assets-*`
  - `.internal-*`
  - 两字符 uuid prefix 目录
  - 其他 extension name
- Editor extension asset-db 的真实 record/output 路径未在本次源码中确认。

建议：

1. 在未确认 Editor extension 路径前，保留 `cli-extensions`。
2. 如果要共享，先加 collision guard：
   - 禁止 `.` 开头。
   - 禁止路径分隔符。
   - 禁止长度为 2 且为 hex 的名称。
   - 禁止 `assets`、`internal`、`cli`、`cli-extensions` 等保留名。
3. 通过真实 project extension fixture 验证 Editor 路径后，再切到 `library/<extensionName>`。

## 成本 / 收益矩阵

| 项 | 共享建议 | 收益 | 修改成本 | 风险 | 结论 |
| --- | --- | --- | --- | --- | --- |
| `temp/asset-db` | 可隔离，按证据再共享 | 低到中 | 低到中 | 中 | 不是主缓存收益，放到阶段 3.5 |
| `temp/programming` | 可共享候选 | 中 | 低到中 | 中 | 单独阶段验证，不和 asset-db 一起切 |
| `cocos.config.schema.json` | 可共享路径 | 低 | 低 | 低 | 可按官方路径，但不是 asset cache blocker |
| `internal.library` | 已共享 | 中 | 已有 | 中 | 继续验证 internal diff |
| project `library` output | 尽量共享 | 高 | 高 | 高 | 主目标，阶段 1-3 做 |
| project `assets` record | 先不共享 | 中 | 高 | 高 | 先 sidecar，后评估复用 |
| extension library | 待验证后共享 | 中 | 低到中 | 中 | 需要 Editor fixture 证明 |

## 推荐决策

当前不建议一次性把所有路径改成官方共享路径。

推荐落地决策：

1. **主目标改为共享 project `library` import output**，因为这是最大的缓存收益来源。
2. **先为 `@cocos/asset-db` 增加 record path 可配置能力**，这是共享 `library` output 的前置架构。
3. **对齐 importer parity 并设计 sidecar bootstrap**，避免第一次 CLI 启动全量重导，也避免 `asset.reset()` 来回覆盖共享 output。
4. **project `assets` record 先 sidecar，不直接复用 Editor record**。
5. **`temp/asset-db` 默认可继续隔离**；只有真实项目证明跨工具复用收益明显，并修复 FBX status schema 后再共享。
6. **`temp/programming` 单独评估**，它之前确实共享过；但它关联 browser script loading / prerequisite imports，不是 asset-db 缓存主线。
7. **extension library 等 Editor 路径确认后再共享**，不要只凭官方路径推断。

这个方案的核心取舍：

- 优先共享真正有缓存收益的真实产物目录。
- 不让 CLI 直接改坏 Editor record。
- 不在 importer parity 未完成时共享会被 `asset.reset()` 覆盖的 output。

## 2026-06-23 实施状态

本轮已完成推荐方案的前置结构，但未把 shared output 设为 production default。

已完成：

1. `@cocos/asset-db` 支持 `AssetDBOptions.records`，record/cache path 可与 import output root 解耦。
2. CLI `AssetDBRegisterInfo` 透传 `records`，默认 `assets` DB 仍写入 `library/cli` output 与 `library/cli/.assets-*` record，行为不回退。
3. 增加显式 gate：只有 `COCOS_CLI_SHARED_LIBRARY_OUTPUT=1` 时，`assets.library` 才切到 `<project>/library`，records 使用 `<project>/library/.cli-assets-*`。
4. 增加 CLI sidecar bootstrap：在 shared output gate 下，只读 Editor `.assets-info1.0.0.json` / `.assets-data.json` / `.assets-dependency.json`，写入 `.cli-assets-*`，不写回或迁移 Editor `.assets-*` record。

验证事实见：

```text
docs/dev/build/facts/build-issue-023-editor-cli-editor-validation-20260623.md
```

关键结论：

- default isolated output 下，CLI preview 没有改写 Editor record、Editor output 或 source `.meta`。
- `COCOS_CLI_SHARED_LIBRARY_OUTPUT=1` 下，CLI preview 没有删除或迁移 Editor `.assets-*` record，并创建了 `.cli-assets-*` sidecar。
- `COCOS_CLI_SHARED_LIBRARY_OUTPUT=1` 下，CLI preview 首次仍改写 336 个 `library/<uuid-prefix>/...` output 文件；第二次 Editor open 未继续改写这些 output，但 336 个 rewrite 尚未逐项按 importer parity 差异分类。
- normal build validation 未完成；真实项目被 `build-ex:onBeforeBuild` 的 `Editor.Message send scheduled after hook scope` 阻塞。失败前后快照未观察到 record/output/source `.meta` 增量污染。

2026-06-23 当时默认策略：

```text
assets.library = <project>/library/cli
shared output opt-in = COCOS_CLI_SHARED_LIBRARY_OUTPUT=1
```

2026-06-24 后续决策：

```text
assets.library = <project>/library
records = <project>/library/.cli-assets-*
emergency opt-out = COCOS_CLI_SHARED_LIBRARY_OUTPUT=0
```

本次决策基于后续 shared output 手测基本通过和用户确认。`library/cli` 不再是默认 project assets output，只作为 emergency opt-out 路径保留。336 个 shared output rewrite 的字段级质量评估不再阻塞默认切换，已拆到 `BUILD-ISSUE-025` 继续跟踪；如果后续证明差异不可接受，再回退默认或补 importer parity。

此前设计建议若要把 shared output 设为默认，应把默认从显式 opt-in 改为带 emergency opt-out 的策略；2026-06-24 实际采用如下语义：

```text
shared output default = true
emergency opt-out = COCOS_CLI_SHARED_LIBRARY_OUTPUT=0
```

## 待确认问题

1. Editor 3.8.6 importer 源码位置。
   - 当前 `D:\workspace\engines\cocos\3.8.6` 未定位到 importer 源码。
   - 需要 Editor 安装包源码或强制 reimport 快照证明 `versionCode` baseline。
2. CLI FBX `status.json` 为什么实际缺 `version`。
   - 源码路径显示 `modelConvertRoutine` 会写 `version`。
   - 需要确认运行时加载的 dist 与源码是否一致，或是否读到了旧缓存。
3. `scene` `depends` 差异原因。
   - 需要对 `getDependList()` 与 Editor dependency collector 做逐项对比。
4. `audio-clip` / `spine-data` / `video-clip` value 差异是否稳定。
   - 可能来自 duration、atlas 查找、媒体探测环境。
   - 需要 JSON 级 diff 分类。
5. Extension asset-db 在 Editor 里的真实 output / record path。
   - 未确认前不应切到 `library/<extensionName>`。

## 验收标准

每个阶段都必须跑：

```text
clean library/temp
-> Editor open
-> snapshot A
-> CLI preview ready
-> snapshot B
-> Editor open again
-> snapshot C
```

阶段 1 验收：

- record path 和 output path 可分别配置。
- 当前 `library/cli` 行为不回退。
- Editor record 文件 hash 不因 CLI 启动变化。

阶段 2 验收：

- `.assets-data.json` diff 降到可解释范围。
- sidecar bootstrap 后 CLI 不进行无意义全量 reimport。
- Editor record 文件 hash 不因 CLI 启动变化。

阶段 3 验收：

- `library/.assets-info1.0.0.json` 不被删除。
- `library/.assets-dependency.json` 不被迁移成 `{ data, version }`。
- `.assets-data.json` 不出现持续 `versionCode` / `depends` 抖动。
- `library/<uuid-prefix>/...` output 不出现 CLI/Editor 来回重写。

阶段 3.5 验收：

- `temp/asset-db` 不被 CLI 全量清空。
- FBX status schema 不回退。
- Editor 再打开不持续重转 FBX。

完成标准：

```text
Editor -> CLI -> Editor
```

第三段 Editor 打开后，除 timestamp 或明确可接受的 generated log 外，不再产生不可解释 diff。
