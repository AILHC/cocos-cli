# Runtime preview 运行期资源和脚本变更刷新事实记录

## 结论

当前 runtime preview 在启动准备阶段会执行 AssetDB import，并会触发脚本编译；但 preview server 已经启动并进入 `preview:ready` 后，源码中没有看到面向项目资源目录的常驻 filesystem watcher。直接修改磁盘上的资源或脚本文件，不会自动进入 AssetDB import / script compile 流程。

这意味着运行期热更新能力当前不能假定存在。若需要让改动生效，必须显式走 AssetDB `refresh` / `reimport` / asset operation 路径，或重启 `preview --runtime`。

## 启动阶段行为

- `Launcher.startRuntimePreview()` 创建 `PreviewSettingsProvider`，`settingsProvider.getPreviewSettings()` 会触发 `ensurePreviewSettingsReady()`。
- `ensurePreviewSettingsReady()` 调用 `this.import()`。
- `Launcher.import()` 有 `_import` guard，同一个 `Launcher` 实例只执行一次初始化导入链路。
- `Launcher.import()` 初始化 scripting 和 programming facet 后，调用 `initAssetDB()` / `startAssetDB()`。
- `AssetDBManager.useCache` 默认值为 `false`；普通启动路径走 `_startDirectly()`，再进入 `_startDB()` 和 `db.start()`。
- `@cocos/asset-db` 的 `AssetDB.start()` 会对 `options.target` 执行 `refresh(target)`，扫描资源并调度导入任务。

涉及源码：

- `src/core/launcher.ts`
  - `Launcher.import()`
  - `Launcher.startRuntimePreview()`
  - `ensurePreviewSettingsReady()`
- `src/core/assets/manager/asset-db.ts`
  - `AssetDBManager.useCache`
  - `AssetDBManager.start()`
  - `AssetDBManager._startDirectly()`
  - `AssetDBManager._startDB()`
- `packages/asset-db/libs/asset-db.js`
  - `AssetDB.start()`
  - `AssetDB.refresh()`

## 脚本编译行为

启动 import 中，JavaScript / TypeScript 脚本资源会通过 importer 调用 `scripting.compileScripts(...)`。

AssetDB 启动后还有一段补偿同步逻辑：查询全部 `cc.Script` 资源，构造 `AssetChangeInfo[]`，再批量调用 `scripting.compileScripts(changes)`。这段逻辑用于 CLI preview 没有 Editor Message broadcast 时同步 packer-driver。

涉及源码：

- `src/core/assets/asset-handler/assets/javascript.ts`
  - `JavascriptHandler.importer.import()`
- `src/core/assets/asset-handler/assets/typescript.ts`
  - `TypeScriptHandler.importer.import()`
- `src/core/assets/manager/asset-db.ts`
  - `afterStartDB()`
  - `asset-db:script-sync:collect:*`
  - `asset-db:script-compile:*`

## 运行期变更行为

`startRuntimePreviewServer()` 只创建 Express server 和 HTTP route，没有看到注册 `fs.watch`、`chokidar` 或等价的项目资源目录常驻监听。

`AssetManager` 会监听 AssetDB 的 `added` / `changed` / `deleted` 事件，但这是 AssetDB 内部事件链。只有当外部显式调用 `refresh` / `reimport` / asset operation，把磁盘变化送入 AssetDB 后，这些事件才会触发；普通磁盘文件变化本身不会自动触发。

涉及源码：

- `src/runtime-preview/server/runtime-preview-server.ts`
  - `startRuntimePreviewServer()`
- `src/core/assets/manager/asset.ts`
  - `_onAssetDBCreated()`
  - `_onAssetAdded()`
  - `_onAssetChanged()`
  - `_onAssetDeleted()`
- `src/lib/assets/assets.ts`
  - `refresh()`
- `src/api/assets/assets.ts`
  - `refresh()`
- `src/core/assets/manager/operation.ts`
  - asset operation 后的 refresh 路径

## 待确认问题

1. runtime preview 是否应支持 Editor-like 运行期资源 watch / import / browser reload。
2. 脚本变更的期望行为是只重新编译 packer-driver 产物，还是还要触发 browser 侧 reload / module invalidation。
3. 资源变更后是否需要同步更新 `settings.js`、bundle config、scene route、`/query-extname/*` cache 和 import/native route 命中结果。
4. 若引入 watcher，应明确它与 Editor 正在打开同一项目、共享 `library`、共享或隔离 `temp/programming` 的并发边界。

