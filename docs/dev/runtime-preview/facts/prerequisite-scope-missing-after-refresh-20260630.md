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
