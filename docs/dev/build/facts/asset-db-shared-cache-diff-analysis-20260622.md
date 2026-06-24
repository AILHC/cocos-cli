# AssetDB shared cache 差异分析

日期：2026-06-22

## 目的

本文只回答一个问题：CLI 如果改成与 Editor 前后串行共享 `temp/asset-db`、`library` 等缓存目录，当前差异的原因是什么，哪些能共享，哪些需要 adapter 处理后才能共享。

本文不把“继续隔离”作为目标。隔离路径只作为对照组，用来观察 Editor 与 CLI 分别生成的缓存差异。

## 验证现场

测试项目：

```text
E:\own_space\engines\cocos-test-projects
```

引擎：

```text
D:\workspace\engines\cocos\3.8.6
```

快照与日志：

```text
E:\own_space\engines\cocos-cli\.worktrees\rebase-adapter-to-386-origin-main-20260622\.codex-tmp\assetdb-path-compare-final-20260622
```

验证顺序：

1. 清理测试项目 `library` 和 `temp`。
2. 用 `cce run` 打开项目，让 Editor 生成 baseline。
3. 对 Editor 产物快照。
4. 用 CLI 跑 runtime preview，确认到 `preview:ready`。
5. 对 CLI 产物快照并比较。

CLI preview 已到 ready：

```text
[runtime-preview] asset-db:done durationMs=82012
[runtime-preview] settings:build:done durationMs=947 scene= scripts=235 bundles=11
[runtime-preview] programming:prerequisite-scope required=233 mapped=233 missing=0
[runtime-preview] preview:ready durationMs=90564
```

## 总体差异

| 对比项 | Editor | CLI | 共同路径 | 相同 hash | 不同 hash | Editor-only | CLI-only |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `temp/asset-db` vs `temp/cli/asset-db` | 757 | 134 | 134 | 104 | 30 | 623 | 0 |
| `library` vs `library/cli` | 6355 | 5935 | 5933 | 5594 | 339 | 422 | 2 |
| 共享 `library` 排除 `cli/` 和 `cli-extensions/` | 6355 | 6356 | 6355 | 6354 | 1 | 0 | 1 |
| `temp/programming` 前后 | 969 | 969 | 969 | 969 | 0 | 0 | 0 |

解释：

- `temp/programming` 当前已经被 CLI 移到 `temp/cli/programming`，不再影响 Editor 的 `temp/programming`。
- `library` 仍存在真实共享写入：即使 CLI 主缓存在 `library/cli`，共享根目录仍新增 `.internal`，并修改一个 internal asset json。
- `library` 与 `library/cli` 的大多数共同文件 hash 一致，说明很多 import output 可以共享；但 record 文件和一部分 importer output 不能直接共享。

## 1. record 文件路径与 `library` 其他文件能否共享

### 结论

record 文件路径可以不一样。短期更方便、风险更低的做法是：

- `library` 作为共享 import output 根目录。
- CLI 不直接复用或迁移 Editor 的 `.assets-info1.0.0.json`、`.assets-dependency.json`、`.assets-data.json`。
- CLI 使用 CLI-owned record sidecar，例如 `.cli-assets-info.json`、`.cli-assets-dependency.json`、`.cli-assets-data.json`、`.cli-assets`。
- 真正的 asset import output，也就是 `library/<uuid-prefix>/<uuid...>` 下的产物，在 importer 对齐后共享。

原因：当前 `@cocos/asset-db` 的 `assets` record 格式与 Editor 3.8.6 baseline 不兼容。如果直接把 CLI 的 `assets` DB 指到 `library`，它会尝试迁移 Editor record，而不是只读复用。

### 事实依据

Editor 生成的 project assets record：

```text
library/.assets-info1.0.0.json
library/.assets-dependency.json
library/.assets-data.json
```

CLI 当前生成的 project assets record：

```text
library/cli/.assets-info.json
library/cli/.assets-dependency.json
library/cli/.assets-data.json
library/cli/.assets
```

`.assets-dependency.json` 的顶层结构不同：

```text
Editor: path, uuid
CLI:    data, version
```

`node_modules/@cocos/asset-db/libs/info.js` 中，非 `editorCompatibility` 模式会：

1. 对 `.assets-info.json` 推导 legacy path `.assets-info1.0.0.json`。
2. 如果 legacy path 存在，读取后删除旧文件。
3. 再写出 `.assets-info.json`。

当前 `editorCompatibility` 只对 internal 文件名生效：

```text
.internal-info1.0.0.json
.internal-dependency.json
.internal-data.json
```

它没有覆盖 `assets` record。因此直接共享 `library` 会把 Editor 的 `.assets-info1.0.0.json` 迁移掉。

### `library` 其他文件是否能共享

可以有条件共享，不能无条件共享。

支持共享的事实：

- `library` vs `library/cli` 有 5933 个共同路径。
- 其中 5594 个 hash 相同。
- `.assets-data.json` 两边都有 5197 个 uuid key，没有出现 CLI 少一批 asset key 的情况。

不能直接共享的事实：

- 共同路径里还有 339 个 hash 不同。
- 抽样 diff 里包含大量 `.json` 和 `.cconb` import output。
- `.assets-data.json` 有 715 条 uuid 记录内容不同。
- CLI-only 有 `.assets`、`.assets-info.json`。
- Editor-only 有 `.assets-info1.0.0.json`、`.internal-*`、`.view-state-group-*` 以及部分 import output。

因此，`library/<uuid-prefix>/...` 下的实际 import output 大部分可共享，但共享前必须先消除 importer 输出差异。record 文件建议先从共享 output 中拆出来，避免破坏 Editor record。

### 推荐方案

第一阶段使用“共享 output + CLI-owned record sidecar”：

| 类型 | 推荐路径 |
| --- | --- |
| project assets import output | `library/<uuid-prefix>/<uuid...>` |
| Editor project assets record | 保持 `.assets-info1.0.0.json`、`.assets-dependency.json`、`.assets-data.json` |
| CLI project assets record | 使用 `.cli-assets-info.json`、`.cli-assets-dependency.json`、`.cli-assets-data.json`、`.cli-assets` |
| internal record | 继续按 Editor 兼容格式处理，或纳入同一套 sidecar 策略前先验证 |

这样可以避免 CLI 迁移 Editor record，同时为共享真实 import output 留出空间。

第二阶段如果确实需要复用 Editor record，再做完整 Editor-compatible reader/writer：

- `assets` 也支持 `.assets-info1.0.0.json`。
- `assets` dependency 也支持顶层 `path` / `uuid`。
- 不删除 legacy Editor record。
- 写回格式保持 Editor 3.8.6 baseline。

第二阶段成本更高，不是共享 output 的必要前提。

## 2. importer 版本号之前处理过，现在哪里还有问题

### 结论

当前问题不是“完全没有处理 importer versionCode”，而是 **CLI 当前实际写出的 importer record 与 Editor 3.8.6 baseline 仍不一致**。

最直接的事实是：同一个项目、Editor 先打开生成 baseline 后，CLI 再跑 preview，`.assets-data.json` 中有 715 条 uuid 记录不同。典型差异是 scene asset：

```text
Editor: versionCode = 1
CLI:    versionCode = 2
```

同时 `value.depends` 内容或顺序也不同。

### 事实依据

拆 `.assets-data.json`：

```text
assets-data keys editor=5197 cli=5197 common=5197 editorOnly=0 cliOnly=0
assets-data diffKeys=715
```

样本：

```text
d3fc11bc-05dc-4e60-bc4f-f682fa74e8b6
-> assets\cases\2D\2d-rendering-in-3d.scene

4265ae14-ce5e-41f5-818e-6670cfafbbd9
-> assets\cases\animation\AnimationEvent.scene

92ccbdcc-cf70-4f2f-842b-edbaf0a215f6
-> assets\cases\animation\EasingMethods.scene
```

这些记录里的典型 diff：

```text
value.depends.* 不同
versionCode: 1 -> 2
```

CLI 源码中 scene importer 当前是：

```text
src/core/assets/asset-handler/assets/scene/index.ts
export const versionCode = 2;
```

`CustomImporter` 注册 importer 时使用：

```text
this._versionCode = versionCode || 1;
```

所以 CLI 写出 `versionCode = 2` 是当前源码行为。问题在于 Editor 3.8.6 baseline 对这些 scene asset 写出的仍是 `versionCode = 1`。

这说明此前“版本号处理”没有覆盖本次共享目录需要的判定：即 **CLI importer versionCode 和 Editor 3.8.6 实际 baseline 是否一致**。

### 根因判断

根因有两层：

1. CLI importer 代码的 `versionCode` 与 Editor 3.8.6 实际 import record 不完全一致。
2. `depends` 输出也不一致，说明即使只改 `versionCode`，也未必能让 `.assets-data.json` 与 Editor baseline 稳定一致。

这不是简单 timestamp 差异。`versionCode` 和 `depends` 都是 asset-db 判断缓存有效性和依赖关系的核心数据。共享 `library` 后，如果不处理，Editor 与 CLI 前后打开会反复认为对方产物过期，导致持续重导入或持续改写。

### 解决方向

先做事实校准，而不是直接改版本号：

1. 列出 715 条 diff 的 importer 类型分布，确认是否主要集中在 scene / prefab / glTF / effect。
2. 对 scene importer，确认 Editor 3.8.6 源码里的 effective `versionCode`。
3. 如果 Editor 3.8.6 确认是 `1`，CLI adapter 要按 3.8.6 baseline 降回或条件化 scene `versionCode`。
4. 如果 Editor 源码是 `2`，但本次 baseline 仍写 `1`，需要查 Editor 是否复用了旧 cache 或未触发 scene reimport；验收必须增加 Editor 强制 reimport 后的快照。
5. 对 `depends` 差异单独处理，不能只靠 `versionCode` 修正。

共享目录的验收标准不是“CLI 能 preview ready”，而是：

```text
Editor 打开 -> CLI preview ready -> Editor 再打开
```

之后 `.assets-data.json` 不再出现同一批 uuid 的持续 `versionCode` / `depends` 抖动。

## 3. `temp/asset-db` / FBX 转换缓存可以共享，但要补兼容字段

### 结论

`temp/asset-db` 可以作为共享方向继续推进，但 FBX 转换缓存当前有结构差异，不能只改路径。

### 事实依据

`temp/asset-db` vs `temp/cli/asset-db`：

```text
共同路径 134
相同 hash 104
不同 hash 30
Editor-only 623
CLI-only 0
```

不同 hash 主要集中在：

```text
assets/fbx.FBX-glTF-conv/.../status.json
assets/fbx.FBX-glTF-conv/.../output/out.gltf
assets/fbx2gltf-.../status.json
```

`status.json` 结构差异：

```text
Editor: 22 个 status.json 都有 version
CLI:    22 个 status.json 都没有 version
```

样本：

```json
{
  "version": "2.3.13",
  "sourceTimeStamp": 1781158454197.395,
  "outputTimeStamps": {},
  "options": {
    "smartMaterialEnabled": false,
    "matchMeshNames": false
  }
}
```

CLI 对应文件缺少 `version`。时间戳差异本身可以接受，但缺少 `version` 会影响缓存有效性判断。

### 解决方向

1. 找到 CLI FBX 转换 status 写入点。
2. 补齐 Editor 3.8.6 baseline 中的 `version` 字段。
3. 确认 converter 版本和 options 与 Editor 一致。
4. 对 `out.gltf` 的 hash 差异做 JSON 级 diff，区分格式化/字段顺序/浮点抖动/真实内容差异。
5. 禁止 CLI 清空整个共享 `temp/asset-db`。Editor-only 的 623 个文件不能因为 CLI 未生成就删除。

验收标准：

```text
Editor 生成 temp/asset-db -> CLI 使用同一 temp/asset-db -> Editor 再打开
```

不应出现 FBX 重复转换、status schema 回退、或 `out.gltf` 持续改写。

## 需要修改的代码方向

### A. 支持共享 `library` output 但分离 record

当前 `AssetDB.prepareStart()` 在 `@cocos/asset-db` 内硬编码 record 路径：

```text
info:       <library>/.<name>-info.json
data:       <library>/.<name>-data.json
dependency: <library>/.<name>-dependency.json
cache:      <library>/.<name>
```

要实现“共享 output + CLI-owned record sidecar”，需要 adapter 能分别配置：

- import output root：`library`
- record root / record file prefix：CLI-owned sidecar
- cache file：CLI-owned sidecar

可以在 local `@cocos/asset-db` patch 或 CLI wrapper 中实现，不应只改 `asset-config.ts`。

### B. 处理 importer 对齐

需要新增一个 importer parity 表，记录每类 importer 的 Editor 3.8.6 baseline：

| importer | CLI 当前 | Editor baseline | 当前状态 |
| --- | --- | --- | --- |
| scene | `versionCode = 2` | 本次快照显示 `1` | 不一致，需要确认 Editor 源码或强制 reimport |
| glTF / FBX | 待拆 | status 缺 `version` | 不一致 |
| effect | 待拆 | 待拆 | 需验证 |
| prefab | 待拆 | 待拆 | 需验证 |

### C. 共享目录清理规则

共享目录后，CLI 不能再执行 whole-directory clean：

```text
library
temp/asset-db
```

只能清理可证明属于某个 asset 的无效产物，或者使用 asset-db 自身的 per-asset reset 逻辑。

## 推荐落地顺序

1. 增加快照测试脚本：`Editor -> CLI -> Editor`，输出 record、library output、temp output 的 diff。
2. 实现 CLI-owned record sidecar，先避免破坏 Editor record。
3. 将 project assets import output 指向共享 `library`，但保留 CLI sidecar records。
4. 对齐 importer versionCode 与 `depends` 输出，先处理 scene。
5. 修 FBX `status.json` 缺 `version`。
6. 再决定是否需要完整 Editor-compatible record reader/writer。

## 当前结论

共享目录方向可行，但当前不能只做路径替换。

真正 blocker 是：

1. `assets` record 格式会被 CLI 迁移或改写。
2. scene 等 importer 的 `versionCode` / `depends` 与 Editor 3.8.6 baseline 不一致。
3. FBX temp status 缺少 Editor baseline 的 `version` 字段。

按缓存收益重新排序后，优先方案是：**先共享 project `library` import output，但把 CLI record 先拆成 sidecar，并逐项对齐 importer 输出。**

`temp/asset-db` 可以作为后续候选继续评估；当前主测试项目中它约 90 MiB，不是主要缓存收益来源。只有在真实项目证明跨工具复用 FBX / model conversion 缓存收益明显，并且 FBX `status.json` schema 差异已解释或修复后，再切共享。
