# `watch-assets` / `refresh-on-reload` 卡住与启动窗口事实记录

日期：2026-06-29

## 背景

真实项目：

`D:\ps_copy\p7\trunk\GameClient\Client-fight-roguelike-migration`

启动参数：

```powershell
preview --runtime --project "D:\ps_copy\p7\trunk\GameClient\Client-fight-roguelike-migration" --watch-assets --refresh-on-reload
```

用户反馈现象：

- preview server 端口已监听，但页面无法访问或请求长期无响应。
- 变更脚本后，reload 触发 dirty refresh，进程没有结束。
- 不能通过随意增加硬超时处理，因为硬超时可能掩盖 AssetDB / QuickPack 正在写产物的真实状态。

## 已观察到的现场证据

原始 global CLI 进程：

- Node command 指向 `C:\nvm4w\nodejs\node_modules\cocos-cli\dist\cli.js`。
- server 监听 `127.0.0.1:9527`。
- health / root 请求出现 0 bytes timeout。

原始 runtime preview log：

`D:\ps_copy\p7\trunk\GameClient\Client-fight-roguelike-migration\temp\preview-logs\runtime-preview-20260629-155657.log`

关键记录：

- `preview:ready durationMs=625893`
- `asset-db:script-compile:done durationMs=233192 count=3051`
- watcher 在 `preview:ready` 后启动并记录 dirty events。
- dirty files 包含：
  - `effect_damage.ts`
  - `rogue_fight_define.ts`
  - `buff_add_condition_registry.ts`
  - `damage_system.ts`
  - `battle_interface.d.ts`
  - `control_state_buff.ts`
- 未观察到对应 `runtime-refresh` 成功或失败结果。

原始 packer-driver debug log：

`D:\ps_copy\p7\trunk\GameClient\Client-fight-roguelike-migration\temp\cli\programming\packer-driver\logs\debug.log`

关键记录：

- `16:35:26.932` build iteration start，`Number of accumulated asset changes: 1`。
- `16:39:31.462` `Target(editor) build started.`。
- 之后出现大量来自 `cce:/internal/x/prerequisite-imports` 的 resolve。
- 未出现 `Target(editor) ends`。
- 文件系统时间显示 editor target 输出文件已在 `16:39:34` 更新，包括 `import-map.json`、`main-record.json`、`assembly-record.json`。
- preview target 输出仍停留在更早时间，没有进入或完成 `Target(preview)`。

基于这些事实，原始卡住点更接近：

`Target(editor).build()` 已写出 editor target 产物，但 `QuickPack.build()` 没有返回，或者返回后的 packer-driver 阶段没有继续记录 `Target(editor) ends`。

## 已完成复现和验证

单元与 route contract：

- `runtime-refresh-coordinator.test.ts`
- `runtime-preview-express-server.test.ts`
- 结果：44 tests passed。

live fixture：

- 使用错误 engine root `E:\own_space\engines\3.8.6` 时失败，失败点为 `web-adapter.js` 中 `window` undefined，属于 engine root 不匹配，不作为本问题证据。
- 使用 `D:\workspace\engines\cocos\3.8.6` 时通过。
- `runtime-refresh-live-integration.test.ts` 中 JSON resource 和 TypeScript script reload 验证通过。

主测试项目：

- `COCOS_CLI_TEST_ENGINE_ROOT=D:\workspace\engines\cocos\3.8.6`
- `COCOS_CLI_TEST_PROJECT_ROOT=E:\own_space\engines\cocos-test-projects`
- `main-test-project-cli-integration.test.ts` 通过。

`feature-c` 真实项目：

- 默认 JSON probe：`watchReloadChanged` refresh 约 `382ms`。
- TypeScript probe：`watchReloadChanged` refresh 约 `6743ms`。
- 未复现卡住。

P7 真实项目，local instrumented `dist/cli.js`：

- 首次 `preview:ready durationMs=401010`。
- 初始 full build 中 `Target(editor)` 约 `78.8s`，`Target(preview)` 约 `78.1s`。
- 仅 touch `damage_system.ts` 后，root 请求成功，refresh 约 `5542ms`。
- touch 原始 6 个 dirty files 后，root 请求成功，refresh 约 `25968ms`。
- 未复现卡住。

P7 真实项目，global CLI clean restart：

- `preview:ready durationMs=98824`。
- touch 原始 6 个 dirty files 后，root 请求成功，refresh 约 `25804ms`。
- 未复现卡住。

## 源码事实

`--refresh-on-reload` 语义：

- root `/` 在启用 `refreshOnReload` 时调用 `prepareRuntimePreview()`，然后调用 `RuntimeRefreshCoordinator.refresh({ reason: "reload" })`。
- `--watch-assets` 启用 dirty store 后，无 target reload refresh 使用 dirty-set。
- dirty-set 为空时返回 skipped，不 fallback 到 `db://assets` root refresh。

watcher 启动时机：

- `Launcher` 在 runtime preview server 创建时传入 `deferAssetWatcherStart: options.watchAssets === true`。
- server listen 后不会立刻启动 watcher。
- `settingsProvider.getPreviewSettings()` 完成后才调用 `server.startAssetWatcher()`。
- 这样可以避免启动期 AssetDB 写 `.meta` 污染 dirty-set，但存在启动窗口：初始 import / compile 之后、watcher start 之前的外部变更可能不会进入 dirty-set。

route ready 语义：

- server listen 早于 `preview:ready`。
- route 可以在 `preview:ready` 前被访问。
- route 会等待 `prepareRuntimePreview()`，但不会统一等待 watcher start / artifact inspection 完整完成。
- 这会造成早访问时 dirty-store 为空、watcher 未 ready、settings warm-up 并发等边界行为。

PackerDriver / QuickPack：

- `PackerDriver.waitForIdle()` 依赖 pending compile promise；如果底层 build promise 不 resolve，外层等待也不会进入可控失败。
- `PackerDriver._startBuild()` 使用 `_building` 标记，但没有 `try/finally` 保护。
- `_building` guard skip 逻辑当前被注释，build iteration 理论上可能重入。
- target 顺序为 `editor` 后 `preview`。runtime preview dirty refresh 会被 editor target build 阻塞。
- `OPTIMIZE_ENTRY_SOURCE_COMPILATION = false`，因此非 `.d.ts` script 变更会重新设置 `prerequisite-imports` entry source。
- `QuickPack.build()` 的主要阶段是 lock、instantiate specifiers、set entry chunks、save、生成 depsGraph、unlock。原始现场显示 editor 产物已写出但没有返回到 `Target(editor) ends`，需要更细 instrumentation 才能区分卡在 save、depsGraph、unlock 或返回后逻辑。

## 候选问题评估

1. 原始卡住根因仍未闭环。

   当前证据只支持“卡在 editor target build 返回链路附近”，不支持直接断言是 watcher、dirty-store 或 `--refresh-on-reload` 自身卡住。

2. 启动窗口确实存在。

   watcher 延后到 `settingsProvider.getPreviewSettings()` 后启动，可以过滤启动期内部写入，但会漏掉“初始 import / compile 已读过文件之后、watcher 启动之前”的外部变更。这个问题和本次原始卡住不是同一个已证实根因，因为原始 log 中 dirty events 发生在 `preview:ready` 后。

3. `preview:ready` 前 route 可访问是独立风险。

   server listen 和 URL 暴露早于 watcher ready / inspection ready。早访问可能触发 refresh 路径、settings 生成或 warm-up 并发，需要统一 ready gate 或明确 503/loading 语义。

4. `editor` target 阻塞 runtime preview refresh 是真实性能和稳定性风险。

   TS dirty refresh 即使只服务 browser preview，也会先 build editor target。P7 原始卡住发生在 `Target(editor)`，导致 preview target 没机会执行。

5. build reentry / pending promise 无 finally 是稳定性风险。

   如果 `_startBuild()` 在任何 await 中卡住或异常路径没有复位，后续 `waitForIdle()` 和 refresh 会被同一个 pending 状态拖住。

6. `OPTIMIZE_ENTRY_SOURCE_COMPILATION = false` 放大 TS dirty refresh 成本。

   当前默认 false 来自 packer-driver 既有逻辑，不是 runtime preview 后续新增。它会让非 `.d.ts` script 变更更新完整 `prerequisite-imports` source，P7 有约 3000 个 script specifiers，因此每次 TS dirty refresh 都会触发较重 QuickPack 路径。

## 建议后续方向

- 为 PackerDriver build iteration 增加串行化和 `try/finally`，确保 busy / pending 状态可恢复。
- 为 QuickPack build 加更细阶段 instrumentation，至少区分 `lock`、`instantiate`、`setEntryChunks`、`save`、`depsGraph`、`unlock`。
- 评估 runtime preview dirty refresh 是否可以只 build preview target，或至少让 editor target hang 不阻塞 preview reload。
- 重新设计 watcher 启动窗口：
  - 候选 A：更早启动 watcher，但忽略 AssetDB / CLI 自身写入。
  - 候选 B：保留延后启动 watcher，但在启动 watcher 时做 baseline mtime / content snapshot diff。
  - 候选 C：ready 前外部变更统一要求下一次 root refresh 走 root target 或 scoped rescan。
- 给 server route 增加明确 ready gate，避免 URL 已暴露但 watcher / settings / artifacts 未完成时进入不确定路径。
- 重新评估 `OPTIMIZE_ENTRY_SOURCE_COMPILATION` 默认值或局部启用条件。不能只为了 P7 性能改默认，必须验证 QuickPack / Editor parity 和新增 script import 列表变化行为。

## 验收建议

- 构造启动期变更测试：在 initial import / compile 后、watcher start 前修改资源或脚本，验证不会静默丢失。
- 构造 `preview:ready` 前访问 root / settings / refresh endpoint 的集成测试，验证行为确定。
- 构造 script dirty refresh 下 PackerDriver build reentry 测试，验证同一时间只有一个 build iteration。
- P7 真实项目重复原始 dirty set 验收：如果再次卡住，日志必须能定位到 QuickPack 的具体阶段。
- 对比 `OPTIMIZE_ENTRY_SOURCE_COMPILATION` 开关下新增脚本、删除脚本、修改脚本、`.d.ts` 修改的产物和 browser runtime 行为。

## Task 5 评估记录

本轮只把 `OPTIMIZE_ENTRY_SOURCE_COMPILATION` 从文件级常量收敛为 `PackTarget` 的显式 option，默认仍为 `false`。production `PackerDriver.create()` 没有开启该 option；当前只能通过 test-only factory 显式 opt-in。

已新增 opt-in 行为测试：

- import list 不变时，opt-in 路径不会重复设置 `prerequisite-imports` entry source。
- import list 不变时，默认路径仍会重复设置 entry source，保持既有行为。
- 新增 import 时，opt-in 路径会更新 entry source。
- 删除 import 时，opt-in 路径会更新 entry source。
- `.d.ts` only 变化在 `PackerDriver` 层不会调用 target `applyAssetChanges()`，真实 `PackTarget` 不会更新 `prerequisite-imports` entry source。

已执行命令：

```powershell
npm --prefix vitests run test -- suites/runtime-preview/packer-driver-entry-source-optimization.test.ts
npx tsc -b --pretty false
```

结果：

- `packer-driver-entry-source-optimization.test.ts`：6 tests passed。
- TypeScript 编译检查通过。

边界：

- 这些测试只证明 opt-in option 的局部行为和默认行为未变。
- 尚未证明可以把 `optimizeEntrySourceCompilation` 改成 production 默认开启。
- 尚未对比真实项目的 `import-map.json`、`main-record.json`、`assembly-record.json`、browser 实际加载、`queryScriptDeps()` / `queryScriptUsers()`。

## Task 6 诊断脚本记录

已新增 P7 专项诊断脚本：

```powershell
node vitests\scripts\runtime-preview-p7-watch-refresh-diagnostics.mjs --project "D:\ps_copy\p7\trunk\GameClient\Client-fight-roguelike-migration" --port 20031
```

脚本行为：

- 清理 child process 中的 `COCOS_CLI_TEST_*` 和 `COCOS_CLI_SHARED_LIBRARY_OUTPUT`。
- 使用 `node dist/cli.js preview --runtime --watch-assets --refresh-on-reload` 启动真实项目。
- 等待 stdout 出现 `preview:ready`。
- 默认在 `assets` 下按文件名查找原始 dirty files；若出现重名文件则失败，并要求使用 `--dirty-file` 传入路径。
- `--dirty-file` 必须解析到项目 `assets` 目录内，且不能是 `.meta` 文件。
- 使用 `utimes` touch dirty files，不写文件内容，不写 `.meta`。
- 请求 `/`、`/__runtime-preview/status`、`/__runtime-preview/health`。
- 收集 runtime preview log、packer-driver debug log、stdout/stderr tail，并输出 JSON summary。
- 若 root 请求失败，结合 `Target(...) build started` / `ends` / `build failed` 和 `QuickPack(...)` 阶段日志给出失败原因。

已执行命令：

```powershell
node --check vitests\scripts\runtime-preview-p7-watch-refresh-diagnostics.mjs
npm run compile
node vitests\scripts\runtime-preview-p7-watch-refresh-diagnostics.mjs --project "D:\ps_copy\p7\trunk\GameClient\Client-fight-roguelike-migration" --port 20031
```

结果：

- 脚本语法检查通过。
- `npm run compile` 通过，已生成更新后的 `dist/cli.js`。
- P7 真实项目诊断脚本通过，输出：
  - JSON summary: `D:\ps_copy\p7\trunk\GameClient\Client-fight-roguelike-migration\temp\codex-runtime-preview\p7-watch-refresh-diagnostics-20260630-091757.json`
  - startup: `preview:ready durationMs=661309`，脚本侧 `elapsedStartupMs=674999`。
  - root `/`: HTTP `200`，`elapsedMs=41675.709`。
  - dirty refresh: `target="dirty-set"`，6 个原始 dirty targets，`durationMs=39973`，`changedAssetCount=6`，`scriptCompile.status="done"`。
  - readiness status: before / after root 均为 `{ ready: true, settingsReady: true, assetWatcherReady: true, artifactsInspected: true }`。
  - watcher: startup baseline `dirtyTargets=0`，`ignoredMetaOnly=0`，`skippedSymlinks=0`。
- 本次未复现原始 root 请求卡住；完整 packer debug log 显示 dirty refresh 内 `Target(editor)` 和 `Target(preview)` 均有 `ends` 边界。
- 诊断脚本早期 analyzer 用重复日志文本的 `indexOf()` 判断顺序，曾把已完成的最后一轮误报为 `unresolvedTargetBuild=true`；已改为按行号比较。

边界：

- P7 本轮不复现不能反向证明原始 hang 根因已经消失；只能证明当前实现下同一 dirty set 在本机本轮可完成，并且若再次卡住，日志会定位到 QuickPack 阶段边界。
- 诊断脚本中的 timeout 只作为脚本失败 gate 和日志保留机制，不改变 production runtime preview 行为。

## Task 5/6 验收矩阵

| Case | 当前状态 | 已有证据 | 仍需证据 |
| --- | --- | --- | --- |
| `optimizeEntrySourceCompilation` 默认关闭 | 已覆盖 | 默认路径 import list 不变仍设置 entry source；`PackerDriver.create()` 未开启 option | 无 |
| opt-in：修改已有 `.ts` 且 import list 不变 | 已覆盖局部行为 | `packer-driver-entry-source-optimization.test.ts` | 真实项目产物和 browser runtime 对比 |
| opt-in：新增 import | 已覆盖局部行为 | `packer-driver-entry-source-optimization.test.ts` | `queryScriptDeps()` / `queryScriptUsers()` 与产物对比 |
| opt-in：删除 import | 已覆盖局部行为 | `packer-driver-entry-source-optimization.test.ts` | `queryScriptDeps()` / `queryScriptUsers()` 与产物对比 |
| opt-in：新增 `.ts` | 部分覆盖 | 新增 target 进入 import list 的局部行为已覆盖 | 真实新增 source file、AssetDB import、产物对比 |
| opt-in：删除 `.ts` | 部分覆盖 | 删除 target 从 import list 移除的局部行为已覆盖 | 真实删除 source file、AssetDB import、产物对比 |
| `.d.ts` only | 已覆盖局部行为 | `PackerDriver` 不调用 target `applyAssetChanges()`；真实 `PackTarget` entry source setter 不增加 | 真实项目 `.d.ts` refresh 不触发 browser 运行异常 |
| P7 原始 dirty set 诊断脚本 | 已通过一次真实项目运行 | `node --check`、`npm run compile`、P7 JSON summary | 后续复现时继续保留 summary |
| P7 原始 hang 是否 fixed | 部分闭环 | 本轮同一 dirty set root `/` 返回 `200`，dirty refresh `39973ms`，未复现原始 hang | 仍需后续观察；若复现，依据 QuickPack 阶段日志定位 |
