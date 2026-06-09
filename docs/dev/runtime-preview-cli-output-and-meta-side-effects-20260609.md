# Runtime Preview CLI Output 与 Meta 写入事实

记录时间：2026-06-09

## 目的

本文独立记录两个事实域：

1. CLI 生成的 `library` / `programming` 与 Creator editor 生成产物的已知差异。
2. 使用 CLI runtime preview 打开小项目 `E:\own_space\cocos_work_lab_38x` 时，项目 `.meta` 文件是否发生变化。

本文不替代 `runtime-preview-architecture-facts-20260606.md`，只把当前可验证的 output 差异和 `.meta` 副作用集中记录。没有直接证据的因果关系不写成结论。

## 输入与证据

### 项目与参考产物

- Small project: `E:\own_space\cocos_work_lab_38x`
- Frozen editor library: `E:\own_space\engines\cocos-cli\.codex-tmp\reference-library\cocos_work_lab_38x-editor-library-20260606`
- Frozen editor programming: `E:\own_space\engines\cocos-cli\.codex-tmp\reference-temp\cocos_work_lab_38x-editor-programming-20260606`
- Current CLI repo: `E:\own_space\engines\cocos-cli`
- Current engine source: `D:\workspace\engines\cocos\3.8.6`

### 相关源码事实

- `src/core/assets/asset-config.ts`
  - project AssetDB output library: `<project>/library/cli`
  - internal AssetDB library: `<engine>/editor/library`
  - extension AssetDB library: `<project>/library/cli-extensions/<name>`
  - AssetDB temp root: `<project>/temp/cli/asset-db`
- `src/runtime-preview/server/runtime-preview-server.ts`
  - default CLI programming root: `<project>/temp/cli/programming`
- `src/core/scripting/programming/Facet.ts`
  - SystemJS output: `<project>/temp/cli/programming/preview/systemjs`

### 可执行测试事实

- `vitests/suites/runtime-preview/editor-cli-output-consistency.test.ts`
  - 当前 diagnostic category: `source-backed-split-library-layout`
  - 该测试断言 CLI output 已生成，且与 frozen editor output 做 representative comparison。

## CLI output 与 editor output 差异

| 项 | Editor 产物 | CLI 产物 | 当前结论 |
| --- | --- | --- | --- |
| project library root | `<project>/library` | `<project>/library/cli` | 差异存在，有源码事实支撑 |
| internal library | editor project `library` 内含 `.internal-*` metadata 和 internal files | `<engine>/editor/library` | 差异存在，有源码事实支撑 |
| extension library | `<project>/library/.<extension>-*` metadata | `<project>/library/cli-extensions/<name>` | 差异存在，有源码事实支撑 |
| project metadata naming | `.assets-info1.0.0.json` | `.assets-info.json` | 差异存在，由 `@cocos/asset-db` 当前命名行为确认 |
| internal metadata naming | `.internal-info1.0.0.json` | `.internal-info.json` | 差异存在，由 engine internal library 当前产物确认 |
| project serialized/native files | uuid/hash bucket under `<project>/library` | uuid/hash bucket under `<project>/library/cli` | representative files 已验证存在 |
| programming root | `<project>/temp/programming` | `<project>/temp/cli/programming` | 差异存在，有源码事实支撑 |
| preview records | `programming/packer-driver/targets/preview/*` | `temp/cli/programming/packer-driver/targets/preview/*` | root 不同，结构同类 |
| SystemJS | `programming/preview/systemjs/*` | `temp/cli/programming/preview/systemjs/*` | root 不同，结构同类 |

当前不能声明 CLI output 与 editor output 完全一致。正确分类是 `source-backed-split-library-layout`：CLI 不是简单复刻 editor 的 `<project>/library` 和 `<project>/temp/programming`，而是把 project / internal / extension / programming 分到不同 source-backed roots。

## 已验证的代表性一致点

`editor-cli-output-consistency.test.ts` 当前已验证：

- CLI project library root `<project>/library/cli` 存在。
- CLI programming root `<project>/temp/cli/programming` 存在。
- CLI preview import-map 存在：`packer-driver/targets/preview/import-map.json`。
- engine internal library root `<engine>/editor/library` 存在。
- CLI project asset metadata 文件存在：
  - `.assets-data.json`
  - `.assets-info.json`
  - `.assets-dependency.json`
- engine internal metadata 文件存在：
  - `.internal-data.json`
  - `.internal-info.json`
  - `.internal-dependency.json`
- representative project asset files 在 `<project>/library/cli` 中存在。
- representative internal files 在 `<engine>/editor/library` 中存在。
- representative project asset 的 load-relevant data entries 与 frozen editor reference 对齐。
- representative extension `view-state-group` 的 CLI output 位于 `<project>/library/cli-extensions/view-state-group`，并与 frozen editor extension metadata keys 对齐。

## 已知差异点

### Metadata info 文件命名

Frozen editor output 使用 versioned info 文件：

- `.assets-info1.0.0.json`
- `.internal-info1.0.0.json`

CLI / current AssetDB output 使用 unversioned info 文件：

- `.assets-info.json`
- `.internal-info.json`

该差异已有测试锚定到 `@cocos/asset-db` 当前 record naming behavior。

### Internal primitive versionCode 差异

代表性 internal uuid `1263d74c-8167-4928-91a6-4e2672411f47` 当前存在 `versionCode` 差异：

- frozen editor reference: `1`
- engine internal library: `3`

该差异已由 `editor-cli-output-consistency.test.ts` 记录，当前仍属于 `partial` 状态，不能忽略。

## 小项目 `.meta` 当前状态

### 当前 git 状态

在 `E:\own_space\cocos_work_lab_38x` 执行：

```powershell
git -C E:\own_space\cocos_work_lab_38x status --short
git -C E:\own_space\cocos_work_lab_38x diff --name-only -- "*.meta"
git -C E:\own_space\cocos_work_lab_38x diff --stat -- "*.meta"
```

当前事实：

- 小项目 git working tree 中有 `35` 个 tracked `.meta` 文件处于 modified 状态。
- `.meta` diff 统计为 `386 insertions(+), 437 deletions(-)`。
- 同时还有非 `.meta` 改动：
  - `package.json` modified
  - `cocos.config.json` untracked

### `.meta` 修改时间

对这 35 个 modified `.meta` 文件读取 `LastWriteTime`：

- 最新一批时间集中在 `2026-06-07 09:09:10`
- 另有少量为 `2026-06-07 08:53:09` 到 `2026-06-07 08:53:11`

当前 `2026-06-09` 的 runtime preview 日志位于：

- `E:\own_space\cocos_work_lab_38x\temp\preview-logs\runtime-preview-20260609-153625.log`
- `E:\own_space\cocos_work_lab_38x\temp\preview-logs\runtime-preview-20260609-153626.log`
- `E:\own_space\cocos_work_lab_38x\temp\preview-logs\runtime-preview-20260609-153629.log`
- `E:\own_space\cocos_work_lab_38x\temp\preview-logs\runtime-preview-20260609-153640.log`
- `E:\own_space\cocos_work_lab_38x\temp\preview-logs\runtime-preview-20260609-154602.log`

因此，基于文件修改时间，2026-06-09 这轮已记录的 CLI runtime preview 启动没有产生新的 tracked `.meta` 写入。

### Diff 内容样例

`assets/resources/spine/spine-blend/3.8/glow.png.meta` 的 diff 样例显示：

- `trimType` 从 spriteFrame `userData` 内的一个位置移动到另一个位置。
- 这类变化更像 importer/meta serialization 或 schema migration 造成的 metadata 结构调整，不是 runtime preview HTTP server 自身的 route 读取行为。

`assets/test_cases/test_cloud2d_effect/cloud/ui-hsv-sprite-eff.effect.meta` 的 diff 样例显示：

- 文件从单行 JSON 被格式化为多行 JSON。
- Git 还提示该文件下次 touch 时会发生 LF/CRLF 转换。

这些样例只能说明 `.meta` 已被某个流程重写过，不能单独证明是当前 CLI runtime preview 打开行为造成。

## 关于“CLI 打开小项目是否改了 meta”的结论

当前可证明结论：

1. 小项目当前确实存在 35 个 tracked `.meta` 文件 modified。
2. 这些 modified `.meta` 的文件修改时间是 `2026-06-07`，早于当前已记录的 `2026-06-09` runtime preview CLI 启动。
3. 当前 `2026-06-09` 的 CLI runtime preview 验证没有观察到新的 tracked `.meta` 写入。
4. 现有证据不能证明 2026-06-07 的 `.meta` 改动是由 CLI runtime preview、Creator editor、其他 AssetDB/import 流程，还是手动操作造成。

当前不应写成的结论：

- 不能说“CLI runtime preview 从不会改 `.meta`”。
- 不能说“这 35 个 `.meta` 一定是 CLI runtime preview 改的”。
- 不能说“这 35 个 `.meta` 与 runtime preview 无关”，因为没有 2026-06-07 当时的 before/after snapshot。

## 后续验证规则

如果要确认 CLI runtime preview 是否会改 `.meta`，必须做受控 before/after 验证：

1. 在小项目运行前记录：
   - `git status --short`
   - `git diff --name-only -- "*.meta"`
   - tracked `.meta` 文件 hash 或 `git diff --quiet -- "*.meta"` 结果
2. 启动真实 dist CLI：
   - `node E:\own_space\engines\cocos-cli\dist\cli.js preview --runtime --project E:/own_space/cocos_work_lab_38x --host 127.0.0.1 --port <port> --settings-timeout-ms 120000`
3. 等待 `[runtime-preview] preview:ready`。
4. 停止进程。
5. 再次记录：
   - `git status --short`
   - `git diff --name-only -- "*.meta"`
   - `git diff --stat -- "*.meta"`
6. 如果 before/after `.meta` diff 新增或变化，才可归类为 CLI runtime preview meta write side effect。

验收时必须把 `library/cli`、`temp/cli` 的生成与 `assets/**/*.meta` 写入分开统计。前者是当前 CLI preview 的预期 output；后者是 source asset metadata 副作用，不能默认为允许。
