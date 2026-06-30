# P7 dirty refresh 后 prerequisite scope 缺失事实

日期：2026-06-30

关联问题：`RP-ISSUE-032`

## 用户反馈

P7 项目路径：

`D:\ps_copy\p7\trunk\GameClient\Client-fight-roguelike-migration`

操作：

1. 修改 `assets/tests/TestApi.ts`。
2. 点击 runtime preview 页面 `Refresh`。
3. 页面刷新后报错：

```text
index.ts:75 Error: Unable to resolve bare specifier '__unresolved_0' from http://127.0.0.1:9527/scripting/x/packer-driver/targets/preview/chunks/6d/6d8fd2b0177941b032ddc0733af48a561fb60657.js (SystemJS Error#8 https://git.io/JvFET#8)
```

## 现场产物

runtime preview health：

```json
{
  "projectRoot": "D:\\ps_copy\\p7\\trunk\\GameClient\\Client-fight-roguelike-migration",
  "engineRoot": "D:\\workspace\\engines\\cocos\\3.8.6",
  "projectProgrammingRoot": "D:\\ps_copy\\p7\\trunk\\GameClient\\Client-fight-roguelike-migration\\temp\\cli\\programming",
  "logFilePath": "D:\\ps_copy\\p7\\trunk\\GameClient\\Client-fight-roguelike-migration\\temp\\preview-logs\\runtime-preview-20260629-222321.log"
}
```

`import-map.json`：

```text
imports["cce:/internal/x/prerequisite-imports"]
  = ./chunks/6d/6d8fd2b0177941b032ddc0733af48a561fb60657.js

scopes["./chunks/6d/6d8fd2b0177941b032ddc0733af48a561fb60657.js"]
  = missing

imports["__unresolved_0"]
  = missing
```

HTTP 返回与磁盘一致：

```text
GET /scripting/x/packer-driver/targets/preview/import-map.json
status=200
prerequisite=./chunks/6d/6d8fd2b0177941b032ddc0733af48a561fb60657.js
hasScope=false

GET /scripting/x/packer-driver/targets/preview/chunks/6d/6d8fd2b0177941b032ddc0733af48a561fb60657.js
status=200
prefix=System.register(["__unresolved_0", "__unresolved_1", ...])
```

因此本次不是 browser cache、HTTP route 读错文件，或 chunk 文件缺失。

## QuickPack records

当前 preview target 记录：

```json
{
  "key": "cce:/internal/x/prerequisite-imports",
  "chunkId": "6d8fd2b0177941b032ddc0733af48a561fb60657",
  "mainImports": 3032,
  "mainResolutions": 2958,
  "assemblyChunkExists": true,
  "assemblyImportsKeys": 0,
  "importMapHasScope": false
}
```

含义：

- `main-record.json` 中 prerequisite module 已有大量 `imports`，且至少前面的 imports 已解析到 project script module。
- `assembly-record.json` 中同一个 prerequisite chunk 的 `imports` 为空。
- `@cocos/creator-programming-quick-pack@1.7.15` 的 `ChunkWriter._buildMaps()` 只根据 assembly chunk `imports` 生成 `import-map.scopes`。
- 所以 prerequisite chunk scope 缺失的直接原因是 assembly record 中该 chunk imports 没有 materialize。

## refresh 日志

`runtime-refresh-4` 对 `db://assets/tests/TestApi.ts` 返回成功：

```json
{
  "ok": true,
  "refreshId": "runtime-refresh-4",
  "target": "dirty-set",
  "targets": ["db://assets/tests/TestApi.ts"],
  "scriptCompile": { "status": "done", "durationMs": 1 },
  "durationMs": 7501
}
```

随后 reload 的 `runtime-refresh-5` 因 dirty-set 为空跳过：

```json
{
  "ok": true,
  "refreshId": "runtime-refresh-5",
  "target": "dirty-set",
  "reason": "reload",
  "scriptCompile": { "status": "skipped", "durationMs": 0 },
  "targets": []
}
```

因此本次不是 refresh endpoint 失败，也不是 build 卡住；问题发生在 refresh 成功后的 QuickPack 产物一致性。

## 当前判断

已确认的不变量破坏：

```text
prerequisite chunk source contains __unresolved_N
=> import-map.scopes[prerequisiteChunk] must contain __unresolved_N mapping
```

但当前现场产物：

```text
source contains __unresolved_0
import-map.scopes[prerequisiteChunk] missing
assembly-record.chunks[prerequisiteChunkId].imports = {}
```

尚未确认的触发机制：

1. QuickPack 1.7.15 增量 build 在 prerequisite entry source 改变时，`main-record` 与 `assembly-record` 可能不同步。
2. `PackerDriver.applyAssetChanges()` 更新 entry source 后，QuickPack mtime/cache 交互可能让 prerequisite entry inspect 与 link 状态不一致。
3. dirty refresh 后的 build 虽返回 ok，但没有 integrity gate，所以不完整产物被暴露给 browser。
4. `main-record.resolutions` 数量小于 `main-record.imports`，需要进一步确认是否来自新增 imports 未完全 resolution、历史 cache 残留，或该字段本就允许稀疏。

## 追加复现：带 instrumentation 的本地 `dist/cli.js`

本地源码加入只读 QuickPack instrumentation 后执行：

```powershell
node E:\own_space\engines\cocos-cli\dist\cli.js preview --runtime `
  --project D:\ps_copy\p7\trunk\GameClient\Client-fight-roguelike-migration `
  --host 127.0.0.1 --port 9627 --watch-assets --refresh-on-reload
```

未重启原 9527 现场；新进程使用 9627。

启动期确认当前 `TestApi.ts` 存在语法错误：

```text
asset-db:script-compile:error ... assets\tests\TestApi.ts: Invalid left-hand side in assignment expression. (2047:0)

2047 | window.TestRefresh() = function (){
     | ^
```

通用 `temp/logs/cocos-20260629160000.log` 证明原始 11:25 refresh 已经发生同一语法错误：

```text
[11:25:40.997] ERROR ... TestApi.ts: Invalid left-hand side in assignment expression. (2047:0)
[11:25:44.450] ERROR ... TestApi.ts: Invalid left-hand side in assignment expression. (2047:0)
[11:25:44.454] INFO ... asset-change db://assets/tests/TestApi.ts
```

本地 instrumentation 进程复现同一错误，preview target 栈显示错误发生在 QuickPack 处理 prerequisite entry 的 dependency 时：

```text
QuickPack(preview) instantiate:error ... TestApi.ts: Invalid left-hand side in assignment expression. (2047:0)
...
at BabelEsmMod.systemjs (...)
at QuickPack._inspect (...)
at QuickPack._inspectWithCache (...)
at QuickPack._getOrCreateInspectRecord (...)
at handleImport (...)
at QuickPack._link (...)
at Object.inspectRecord.linkCb (...)
at QuickPack._instantiateAll (...)
at QuickPack.build (...)
```

QuickPack 1.7.15 相关源码链路：

```text
QuickPack._inspect()
  -> moduleRecord.imports = specifiers
  -> this._moduleRecords[url.href] = moduleRecord
  -> this._chunkWriter.addChunk(url, jsSource)
     addChunk() initializes chunk.imports = {}

QuickPack._link()
  -> loops moduleRecord.imports
  -> handleImport(TestApi.ts)
  -> _inspect(TestApi.ts) throws SyntaxError
  -> _link catch runs before chunk.imports = chunkImports

QuickPack.build() catch
  -> this._chunkWriter.removeEntry(errFile)
  -> this._removeFromDeps(errFile)
  -> await save()
```

因此当前更具体的根因是：

1. `TestApi.ts` 的非法语法使 QuickPack 在 prerequisite entry `_link()` 中途失败。
2. prerequisite entry chunk 已经被 `addChunk()` 重置为 `imports={}`。
3. `_link()` 失败后没有执行末尾的 `chunk.imports = chunkImports`。
4. QuickPack `build()` catch 仍保存当前半成品记录。
5. `assembly-record.json` 持久化出 prerequisite chunk `imports={}`。
6. `ChunkWriter._buildMaps()` 只从 assembly chunk imports 生成 `import-map.scopes`，所以不会写出 prerequisite chunk scope。
7. browser 继续加载旧坏产物后，SystemJS 报 `Unable to resolve bare specifier '__unresolved_0'`。

这说明本问题不是普通 cache stale，也不是 watcher dirty-set 漏事件；根因在“脚本编译失败时 QuickPack 持久化半成品 records，runtime preview 又继续暴露该不一致产物”。

## 下一步验证

1. 修复前增加 failing test：QuickPack / PackerDriver build error 后不得保存缺 prerequisite scope 的 programming output。
2. 修复方向优先考虑 failure rollback：QuickPack build 失败时保留上一份可用 `import-map.json` / `main-record.json` / `assembly-record.json` / chunk imports，不暴露半成品。
3. runtime refresh endpoint 需要把脚本编译 / QuickPack build error 明确返回给页面；不能在失败后让页面继续 reload 到不一致 output。
4. 保留 runtime preview programming integrity gate：当 `cce:/internal/x/prerequisite-imports` chunk source 含 `__unresolved_N` 时，`import-map.scopes[chunk]` 必须覆盖所有 unresolved specifiers。
5. 用户代码层面，当前 `window.TestRefresh() = function () {}` 应改为合法赋值，例如 `window.TestRefresh = function () {}`；但 CLI 仍必须正确处理这种用户脚本错误，不能生成坏 preview records。

## 修复后验证：本地 `dist/cli.js` + P7

执行日期：2026-06-30

使用命令：

```powershell
node E:\own_space\engines\cocos-cli\dist\cli.js preview --runtime `
  --project D:\ps_copy\p7\trunk\GameClient\Client-fight-roguelike-migration `
  --host 127.0.0.1 --port 9632 --watch-assets --refresh-on-reload
```

验证进程只使用 `9632`，未停止用户原有 `9527` 进程。stdout / stderr 记录：

```text
E:\own_space\engines\cocos-cli\.codex-tmp\runtime-preview-p7-validation\preview-9632.stdout.log
E:\own_space\engines\cocos-cli\.codex-tmp\runtime-preview-p7-validation\preview-9632.stderr.log
E:\own_space\engines\cocos-cli\.codex-tmp\runtime-preview-p7-validation\preview-9632.browser.stdout.log
E:\own_space\engines\cocos-cli\.codex-tmp\runtime-preview-p7-validation\preview-9632.browser.stderr.log
```

runtime preview log：

```text
D:\ps_copy\p7\trunk\GameClient\Client-fight-roguelike-migration\temp\preview-logs\runtime-preview-20260630-153623.log
```

启动期批量编译证据：

```text
[runtime-preview] asset-db:script-sync:collect:done durationMs=847 count=3051
[runtime-preview] asset-db:script-compile:start count=3051
[runtime-preview] pack-target:build:start target=editor
[runtime-preview] pack-target:build:done target=editor durationMs=23225
[runtime-preview] pack-target:build:start target=preview
[runtime-preview] pack-target:build:done target=preview durationMs=36054
[runtime-preview] asset-db:done durationMs=132374
[runtime-preview] preview:ready durationMs=179929
```

这次启动没有再出现 startup 阶段每个 `.ts` 单独触发一次 `compileScripts([script])` 的 3051 次 build；启动脚本 import 已按 batch 延后到 `afterStartDB()` 的一次 full compile。

建立 last-good output 后，合法 `TestApi.ts` refresh 返回：

```json
{
  "ok": true,
  "refreshId": "runtime-refresh-1",
  "target": "db://assets/tests/TestApi.ts",
  "reason": "endpoint",
  "changedAssetCount": 1,
  "scriptCompile": {
    "status": "done",
    "durationMs": 1
  },
  "durationMs": 494
}
```

last-good preview import-map 检查：

```json
{
  "prerequisite": "./chunks/6d/6d8fd2b0177941b032ddc0733af48a561fb60657.js",
  "hasScope": true,
  "required": 3032
}
```

重新临时引入非法语法：

```ts
window.TestRefresh() = function (){
```

refresh endpoint 返回 `ok:false`，且没有继续暴露缺 scope 的坏 output：

```json
{
  "ok": false,
  "refreshId": "runtime-refresh-2",
  "target": "db://assets/tests/TestApi.ts",
  "scriptCompile": {
    "status": "failed",
    "error": "Script compile failed: assets\\tests\\TestApi.ts:2047:0 Invalid left-hand side in assignment expression.",
    "diagnostic": {
      "phase": "build",
      "message": "Invalid left-hand side in assignment expression.",
      "location": {
        "filePath": "D:\\ps_copy\\p7\\trunk\\GameClient\\Client-fight-roguelike-migration\\assets\\tests\\TestApi.ts",
        "relativeFilePath": "assets\\tests\\TestApi.ts",
        "assetUrl": "db://assets/tests/TestApi.ts",
        "line": 2047,
        "column": 0
      },
      "codeFrame": "  2045 |     return clear_tank_guide_test_session(true);\n  2046 | }\n> 2047 | window.TestRefresh() = function (){\n       | ^\n  2048 |     console.log(\"refresh\")",
      "outputState": "lastGoodDueToFailure"
    }
  },
  "outputState": "lastGoodDueToFailure"
}
```

失败后 import-map 再次检查仍保持 last-good scope：

```json
{
  "prerequisite": "./chunks/6d/6d8fd2b0177941b032ddc0733af48a561fb60657.js",
  "hasScope": true,
  "required": 3032
}
```

stdout 可见具体 target、脚本、行列和 message：

```text
[runtime-preview] pack-target:build:failed target=editor file=D:\ps_copy\p7\trunk\GameClient\Client-fight-roguelike-migration\assets\tests\TestApi.ts:2047:0 message=Invalid left-hand side in assignment expression.
[runtime-preview] pack-target:build:failed target=preview file=D:\ps_copy\p7\trunk\GameClient\Client-fight-roguelike-migration\assets\tests\TestApi.ts:2047:0 message=Invalid left-hand side in assignment expression.
```

浏览器验证：

1. 打开 `http://127.0.0.1:9632/`，初始 title 为 `Cocos Creator - Client-fight-roguelike-migration`，console 无 `SystemJS Error#8`。
2. 临时引入非法 `TestApi.ts` 后点击页面 `Refresh` 按钮。
3. 页面出现 `#runtime-preview-compile-error-panel`，内容包含：

```text
assets\tests\TestApi.ts:2047:0
Invalid left-hand side in assignment expression.
> 2047 | window.TestRefresh() = function (){
Current change was not applied. Preview keeps last good scripts.
```

4. 页面正文不包含 `__unresolved_0`，console 没有 `Unable to resolve bare specifier '__unresolved_0'`。本项目仍有既有 `[Physics] PhysicsSystem initDefaultMaterial() Failed to load builtinMaterial.` error，它与本 issue 无关。
5. 恢复合法 `TestApi.ts` 后再次点击 `Refresh`，错误面板消失，页面仍不包含 `__unresolved_0`。

P7 source 恢复状态：

```text
backup=D:\ps_copy\p7\trunk\GameClient\Client-fight-roguelike-migration\temp\codex-runtime-preview\TestApi.ts.rp-issue-032.backup
current SHA256=E32F25DA2E855CC095442A43C2CF06EB279CAFE948FD43E5061E678A091A3725
backup  SHA256=E32F25DA2E855CC095442A43C2CF06EB279CAFE948FD43E5061E678A091A3725
git status --short -- assets/tests/TestApi.ts => M assets/tests/TestApi.ts
```

`assets/tests/TestApi.ts` 的 `M` 是验证前已有的用户工作区状态；当前文件已恢复到本轮验证前备份内容。

## 2026-06-30 审查后补强

资深审查指出三个需要补强的风险：

1. PackerDriver transaction 的 rollback 如果不在 QuickPack workspace lock 内完成，两个 preview 进程或同一 workspace 的并发 build 仍可能交错写入 records / chunks。
2. 没有 last-good output 的首次启动失败，不能继续返回正常 root HTML 并加载 runtime scripts；页面必须明确展示当前没有可用脚本产物。
3. 启动期 diagnostic 不能继续显示 `phase=build target=unknown`，应归一为 `phase=startup target=preview`。

对应实现：

- `PackTarget._executeBuild()` 在同一个 QuickPack workspace lock 内执行 backup、build、prerequisite integrity gate、rollback 和 `loadCache()`，避免 rollback 与另一个 build 的 record / chunk 写入交错。
- `src/runtime-preview/server/runtime-preview-server.ts` 在 `startupCompileFailure.outputState === "noUsableOutput"` 时，root `/` 返回最小错误页，不注入 import-map 和 runtime scripts。
- `src/core/launcher.ts` 在 `programming:inspection:report-only source=asset-db:script-compile:error` 分支中，优先从已捕获的 `asset-db:script-compile:error` 行恢复脚本路径、行列和 message；只有没有该行时才退到 artifact inspection error。因此 no-usable-output 页面展示的是脚本编译失败，而不是后续 `main-record.json` / preview target 目录缺失。
- `src/core/assets/manager/asset-db.ts` 启动期脚本同步失败统一输出 `phase=startup target=preview`。
- no-usable-output 状态不是永久 sticky，但清除有产物验证门槛：`POST /__runtime-preview/refresh` 或 root `--refresh-on-reload` 成功后，必须继续通过 preview programming output inspection，才会清除 `startupCompileFailure`；root `--refresh-on-reload` 会先尝试 refresh，再决定是否继续显示 no-usable-output 错误页。
- 如果 root `--refresh-on-reload` 在仍有 startup no-usable-output 状态时得到新的编译失败，错误页优先展示本次 reload refresh 的脚本、行列、message 和 code frame，同时保持 `outputState=noUsableOutput`，避免旧 startup error 遮蔽最新问题。
- AssetDB error line fallback 只用于修正脚本路径、行列和 message；如果 `scripting.getLastCompileFailure()` 已有 Babel `codeFrame`，页面仍保留该 rich diagnostic。

新增 / 更新验证：

```text
vitests/suites/runtime-preview/packer-driver-output-transaction.test.ts
  - keeps rollback and cache reload inside the QuickPack workspace lock

vitests/suites/runtime-preview/runtime-preview-express-server.test.ts
  - noUsableOutput startup failure returns compile-error root page without import-map
  - successful endpoint refresh clears startup noUsableOutput only after output verification
  - successful endpoint refresh keeps startup noUsableOutput when output verification fails
  - refresh-on-reload tries refresh before showing stale startup noUsableOutput, and clears only after output verification
  - refresh-on-reload shows the latest reload compile failure while startup noUsableOutput remains active

vitests/suites/runtime-preview/launcher-runtime-preview.test.ts
  - reports runtime preview script compile errors without blocking preview ready
  - reports programming artifact inspection failures after script compile errors without blocking preview ready
```

launcher 单测中的 no-usable-output 场景已验证 root HTML 包含：

```text
Runtime Preview Compile Error
assets/scripts/Broken.ts:2047:0
synthetic-error
Current change was not applied. Preview has no usable script output.
```

并确认该 HTML 不包含 `type="systemjs-importmap"`。
