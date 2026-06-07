# Runtime Preview Architecture Facts

记录时间：2026-06-06

## 事实优先级

1. Engine runtime 源码：`D:\workspace\engines\cocos\3.8.6`
2. CLI AssetDB / builder / scripting 源码：`E:\own_space\engines\cocos-cli`
3. 冻结 editor `library` 和 `temp/programming`
4. 旧版 editor preview server：`E:\own_space\tmp-repos\runtime-preview-reference\cocos-cli-backup-runtime-preview-bad-20260606\docs\dev\reference`
5. 备份分支旧实现

## 基线确认

- CLI branch: `adapter-to-386`
- CLI HEAD: `71b2ad8`
- CLI `origin/main`: `71b2ad8`
- Runtime preview default test port: `127.0.0.1:19530`
- 2026-06-06 验证：`19530` 未发现已存在监听连接。
- Engine branch: `codex/nodejs-adapter-3.8.6`
- Engine HEAD: `a3bd637135`
- 2026-06-06 Preflight：`vitests` 可启动，隔离旧 manifest / 未完成 filesystem probe 草稿后，`engine-source-runtime.probe.test.ts` 通过。

## 已知工作区噪声

`D:\workspace\engines\cocos\3.8.6` 当前存在 `editor/assets/**/*.meta` 修改。这些文件是已知 Creator 运行现场噪声，本任务不把它们作为 runtime-preview 实现事实，也不纳入提交范围。

旧 `src/runtime-preview/manifest/**` 与 `vitests/suites/runtime-preview/manifest-extraction.test.ts` 已在 Task 15 Step 8 删除；当前主线不继续 full-manifest / startup recursive scan 方向。`editor-library-resources-load.probe.test.ts` 已转为 filesystem-base parser probe，覆盖当前 frozen facts 可触发的 JsonAsset、ImageAsset、Texture2D、SpriteFrame、Plist 源资产转换后的 serialized SpriteAtlas 和 Spine SkeletonData；TTFFont、runtime `.plist` parser 与 Spine `.atlas` standalone 为 diagnostic gap。

## 已否定假设

- Editor-generated `library` 不是顶层 `import/`、`native/`、`internal/` 目录布局。
- URL mapping 不能先按目录规则设计。
- Server 不应改变 engine runtime 的 import/native 语义。
- 不能用 extname 猜测 import/native 边界。

## Reference artifacts

- Frozen editor `library`: `E:\own_space\engines\cocos-cli\.codex-tmp\reference-library\cocos_work_lab_38x-editor-library-20260606`
- Frozen editor `temp/programming`: `E:\own_space\engines\cocos-cli\.codex-tmp\reference-temp\cocos_work_lab_38x-editor-programming-20260606`
- Old editor preview server reference: `E:\own_space\tmp-repos\runtime-preview-reference\cocos-cli-backup-runtime-preview-bad-20260606\docs\dev\reference\old_editor_preview_server`
- CLI bad-direction backup worktree: `E:\own_space\tmp-repos\runtime-preview-reference\cocos-cli-backup-runtime-preview-bad-20260606`
- CLI adapter backup worktree: `E:\own_space\tmp-repos\runtime-preview-reference\cocos-cli-backup-adapter-to-386-957f835`
- Engine backup worktree: `E:\own_space\tmp-repos\runtime-preview-reference\engine-backup-current-20260606`

## 事实记录与待验证项

### Engine runtime URL 生成链

证据文件：

- `D:\workspace\engines\cocos\3.8.6\cocos\asset\asset-manager\asset-manager.ts`
- `D:\workspace\engines\cocos\3.8.6\cocos\asset\asset-manager\config.ts`
- `D:\workspace\engines\cocos\3.8.6\cocos\asset\asset-manager\url-transformer.ts`
- `D:\workspace\engines\cocos\3.8.6\cocos\asset\asset-manager\downloader.ts`
- `D:\workspace\engines\cocos\3.8.6\cocos\asset\asset-manager\load.ts`
- `D:\workspace\engines\cocos\3.8.6\cocos\asset\asset-manager\parser.ts`
- `D:\workspace\engines\cocos\3.8.6\cocos\asset\asset-manager\pack-manager.ts`
- `D:\workspace\engines\cocos\3.8.6\cocos\asset\asset-manager\depend-util.ts`
- `D:\workspace\engines\cocos\3.8.6\cocos\asset\asset-manager\utilities.ts`

已确认事实：

1. `assetManager.transformPipeline` 的顺序是 `parse -> replaceOverrideAsset -> combine`。URL 最终生成发生在 `url-transformer.combine()`，不是 preview server 自行决定。
2. `assetManager.init()` 从 `options.importBase` / `options.nativeBase` 或 settings category `assets.importBase` / `assets.nativeBase` 读取全局 base，并去掉结尾 `/` 后保存到 `generalImportBase` / `generalNativeBase`。
3. Bundle config 的结构由 engine `IConfigOption` 定义，关键字段包括 `base`、`name`、`deps`、`importBase`、`nativeBase`、`uuids`、`paths`、`scenes`、`packs`、`versions`、`redirect`、`debug`、`types`、`extensionMap`。
4. `Config.init()` 会保存 `importBase`、`nativeBase`、`base`，并初始化 uuid、path、scene、pack、version、redirect、extensionMap 等 runtime 查询结构。
5. `assetManager.loadBundle()` 把 bundle 请求标记为 `ext = 'bundle'` 和 `__isNative__ = true`，最终由 downloader 的 `bundle` handler 处理。
6. `downloader.downloadBundle()` 对非 URL bundle name 生成 `assets/<bundleName>` 或 `remote/<bundleName>` 基址，然后请求 `<base>/config.json` 和 `<base>/index.js`；如果存在 version，则请求 `config.<version>.json` 和 `index.<version>.js`。`loadBundle()` 是通过 direct URL request 加 `ext = 'bundle'`、`__isNative__ = true` 进入 downloader 的 `bundle` handler，bundle config/index URL 不经过 `url-transformer.combine()`。
7. `url-transformer.combine()` 对没有直接 `url` 的 request，根据 `item.isNative` 选择 base：
   - native：优先 `item.config.base + item.config.nativeBase`，否则 `assetManager.generalNativeBase`
   - import：优先 `item.config.base + item.config.importBase`，否则 `assetManager.generalImportBase`
8. `url-transformer.combine()` 的普通资源 URL 形态是 `<base>/<uuid-prefix>/<uuid><version><ext>`；`.ttf` 特例是 `<base>/<uuid-prefix>/<uuid><version>/<__nativeName__>`。
9. `Config._initVersion()` 把 `versions.import` 写入 `assetInfo.ver`，把 `versions.native` 写入 `assetInfo.nativeVer`；因此 import/native 的 hash/version 由 bundle config 区分。
10. 加载边界不是“HTTP 200 即正确”。`load.ts` 中 native request 按 `item.ext` 调 `parser.parse()`，非 native import payload 按 `type = 'import'` 调 `parser.parse()`；`parser.ts` 中 `import`、`.ccon`、`.cconb` 走 `parseImport`，图片、plist 等各有独立 parser。
11. `url-transformer.parse()` 会在 UUID、path、scene 请求中检查 `info.redirect`，并切换到 redirect 指向的 bundle config；因此 shared asset / redirect 不能在 runtime context 和 resolver 中被忽略。
12. 非 native 且 `item.info.packs` 存在时，`packManager.load()` 不直接下载该 asset 自己的 `item.url`，而是取 `packs[0]`，调用 `transform(pack.uuid, { ext: pack.ext, bundle: item.config.name })` 生成 pack 文件 URL，再下载并 unpack。resolver 不能只支持 per-asset uuid URL，还必须支持 `config.packs` 指向的 pack uuid/ext URL。
13. native dependency 的入口来自反序列化 Asset 的 `_nativeDep`。`depend-util.ts` 在 `nativeDependMap.has(asset)` 时输出 `asset._nativeDep`，`utilities.ts#getDepends()` 会把 `info.nativeDep` 带上当前 bundle 后 push 到依赖请求。Texture、SpriteFrame、TTF 等 native 资源 probe 必须覆盖这条链。
14. `assetManager.init()` 除 `importBase/nativeBase` 外还读取 `assets.server`、`assets.bundleVers`、`assets.remoteBundles`，并传给 downloader；这些字段参与 bundle URL 和 versioned config/index URL 决策。
15. `editor-path-replace.ts` 在 `(EDITOR || PREVIEW) && !TEST` 时向 `pipeline` 和 `fetchPipeline` 插入 `replaceExtension`。在 browser preview 语义下（`EDITOR=false`、`PREVIEW=true`、`TEST=false`、`NATIVE=false`），该逻辑会请求相对 URL `/query-extname/<uuid>`，并只在服务端返回扩展名时把非 native import payload 的 `.json` URL 替换为该扩展名。

推导约束：

- preview server 不应根据 URL path 或 extname 自行判断 import/native 语义；`item.isNative`、bundle config、`assetInfo.ver/nativeVer` 和 engine transform pipeline 才是 runtime URL 语义来源。
- fact-backed on-demand server 可以服务 `/assets/<bundle>/config.json`、`/assets/<bundle>/index.js`、以及 runtime 生成的 import/native URL；映射目标必须来自 runtime context、AssetDB/library metadata 和 bundle config，而不是固定目录猜测。
- `.ttf` 必须保留 engine 的 `__nativeName__` 特例，否则直接按 uuid 拼文件名会错。
- 后续 `resources.load` probe 必须覆盖 import payload parser 和 native parser，不能只测 URL 字符串。
- `resources.load` probe 分为 filesystem-base 和 HTTP-base：filesystem-base 只验证 engine downloader/parser 与产物兼容；HTTP-base 使用 `serverURL/settings/bundleConfigs` 捕获 preview server route contract 所需 runtime URLs。
- 后续 runtime context / resolver 必须同时覆盖 per-asset import URL、pack import URL、nativeDep URL、redirect bundle 关系和 bundle version。
- `/query-extname/<uuid>` 是 current engine preview 分支的事实，但它的职责是 import payload 扩展名替换（例如 `.cconb`），不是 import/native 目录或文件类型猜测的依据。

待验证：

- CLI builder 生成的 preview `bundleConfigs` 字段是否与上述 `IConfigOption` 完全一致。
- Frozen editor `library` metadata 如何映射到 `uuids`、`paths`、`types`、`extensionMap`、`versions.import`、`versions.native`。
- `SpriteFrame`、`Texture2D`、TTF、Plist、Spine 在 frozen sample 中分别经由哪些 `item.ext` 和 parser。

### CLI AssetDB library 生成链

证据文件：
- `src/core/assets/utils.ts`
- `src/core/assets/asset-config.ts`
- `src/core/assets/manager/query.ts`
- `src/core/assets/manager/asset-db.ts`
- `src/core/assets/asset-handler/assets/javascript.ts`
- `src/core/builder/index.ts`
- `src/core/builder/worker/builder/manager/asset.ts`
- `src/core/builder/worker/builder/manager/asset-library.ts`
- `src/core/builder/worker/builder/asset-handler/bundle/bundle.ts`
- `src/core/builder/worker/builder/asset-handler/bundle/index.ts`
- `src/core/builder/worker/builder/asset-handler/bundle/utils.ts`
- `src/core/builder/@types/public/build-result.ts`

源码事实：
- `libArr2Obj(asset)` 以 `asset.meta.files` 为输入，输出 `asset.library + extname` 或 `resolve(asset.library, extname)`；`queryAssetInfo()` 和 `queryAssetProperty('library')` 暴露的是这个转换结果。
- CLI AssetDB 当前默认 project db library 是 `<project>/library/cli`，internal db library 是 `<engine>/editor/library`；同时会扫描 `<project>/extensions/*/package.json` 的 `contributions.asset-db.mount`，把 extension mount 注册到 `<project>/library/cli-extensions/<name>`。冻结 editor reference library 是 editor 产物 `<project>/library`，只能作为对照产物，不能直接等同当前 CLI 默认输出目录。
- AssetDB export 对 `.json` / `.cconb` 作为 import payload 处理，其他非 `.___` 扩展写入 native path；这与 engine runtime 的 import/native 语义有关，但 server 仍不能仅靠 extname 猜测请求类型。
- `src/core/builder/worker/builder/manager/asset.ts#getLibraryJSON()` 读取 `asset.library + '.json'`；`outputAssetJson()` 在已有 `instance` 分支保留 `asset.library` 特殊路径，注释说明不能直接拼 uuid，`ttf` 这类资源存在子目录特殊形态。无 `instance` 分支仍输出到 `uuid.substr(0, 2)/uuid.json`。
- `asset-library.ts#getAssetLibraryFiles()` 对 `meta.files` 使用 `file.startsWith('.') ? asset.library + file : join(asset.library, file)`；request-time resolver 必须保留这种 per-asset 文件集合关系，但 production startup 不得因此全量扫描 library。
- `src/core/assets/manager/asset-db.ts` 在 db 启动后批量同步所有 `cc.Script`，因为 CLI preview 没有 Editor broadcast；脚本变更通过 `scripting.compileScripts(changes)` 进入 `temp/programming`。
- `src/core/assets/asset-handler/assets/javascript.ts` 在普通 script import/update/delete 以及 plugin script transform 后调用或影响 `compileScripts()`，plugin global 脚本会保存 `.js` 到 library。
- `src/core/assets/manager/query.ts` 的 `dependScripts` / `dependedScripts` 来自 AssetDB `dataMap[uuid].value.dependScripts`，脚本依赖验证必须从 `.assets-data.json` 或 AssetDB query 样本建立，不能只检查 chunks 是否存在。
- `src/core/builder/index.ts#getPreviewSettings()` 是当前 CLI preview settings / `script2library` / `bundleConfigs` 的事实源：它设置 `buildOptions.preview = true`，创建 `BuildTask`，调用 `buildTask.getPreviewSettings()`，并返回 `settings`、`script2library`、`bundleConfigs`。
- `BuildTask#getPreviewSettings()` 只运行 `dataTasks` 和 `settingTasks`；`data-task/asset_bundle` 在 `options.preview` 下执行 `bundleManager.initAsset()` 后直接 return，不运行 `bundleManager.bundleDataTask()`。
- `TaskBase#runPluginTask()` 在 `options.preview` 下直接 return；因此 preview settings 链不执行正常 build/plugin hooks，不能把正常 build hook 修改后的产物直接当成 preview settings 输入。
- `initBundleShareAssets()` 在 `options.preview` 下直接 return。因此 preview `bundleConfigs` 不能被当作完整 build artifact contract：`packs`、shared asset `redirect`、group/bin 产物和完整 import/native copy 关系可能需要由 runtime context、AssetDB library、engine runtime 事实补齐或显式验证。
- `script2library` 的 key 来自源码原样行为 `removeDbHeader(asset.url).replace(/.ts$/, '.js')`，value 来自 `asset.library + '.js'`；这是 CLI 源码中的 script route/library 映射事实，不应被重新解释成通用 extension 替换规则。
- builder bundle config 类型 `IBundleConfig` 包含 `importBase`、`nativeBase`、`name`、`deps`、`uuids`、`paths`、`scenes`、`packs`、`versions`、`redirect`、`debug`、`types`、`encrypted`、`isZip`、`zipVersion`、`extensionMap`、`hasPreloadScript`、`dependencyRelationships`。
- bundle build 的 `copyAssetFile()` 是正常 build 输出资源时使用的规则，不是 preview settings 自身会生成的产物。它仍提供重要事实：正常 build 复制 asset 文件时从 `asset.library` 和 `meta.files` 出发，`.json` 被排除在 native copy 外，非 json native source 使用 `asset.library + extname` 或 `join(asset.library, extname)`；相对路径通过 `getLibraryDir(source)` 保留 font 等特殊资源路径。

实现约束：
- `RuntimePreviewContext` 的 startup state 只能包括 roots、providers 和 bounded cache handles；AssetDB query/library metadata、per-uuid serialized JSON/native-like files、`temp/programming` preview target、`script2library` 或等价 script runtime map 是 data sources，必须通过 provider lazy 读取。
- resolver 不能假设 editor library 是顶层 `import/`、`native/`、`internal/` 布局；冻结 reference 显示它是 uuid/hash bucket 布局。
- settings 生成必须优先复用或等价复现 `getPreviewSettings()` 的事实链；但 HTTP contract 不能把 preview `bundleConfigs` 直接当作完整 runtime artifact contract。缺失的 `packs`、`redirect`、native/import file mapping、extension mount mapping 必须由 runtime context/resolver 与源代码事实显式补齐或标为待验证。
- 脚本验证必须覆盖 `dependScripts`，并把 AssetDB data 中的 script uuid 连接到 programming index / script route，而不是只验证 `System.register` chunk 存在。

### RuntimePreview data sources 与 startup state

RuntimePreview data sources 包括：
- AssetDB query asset info/data，包括 project、internal、extension asset-db mount。
- 当前 CLI 源码事实：`asset.library`、`asset.meta.files`、`dataManager.dataMap[uuid].value.dependScripts`、`getPreviewSettings()` 返回的 `settings` / `script2library` / preview `bundleConfigs`。
- 冻结产物 / AssetDB 持久化事实：`library` metadata，如 `.assets-data.json`、`.assets-info1.0.0.json`、`.assets-dependency.json`。
- 冻结产物 / AssetDB 持久化事实：internal metadata，如 `.internal-data.json`、`.internal-info1.0.0.json`、`.internal-dependency.json`。
- per-uuid serialized JSON / native-like library files。
- `projectProgrammingRoot/packer-driver/targets/preview/import-map.json`。
- `projectProgrammingRoot/packer-driver/targets/preview/main-record.json`。
- `projectProgrammingRoot/packer-driver/targets/preview/assembly-record.json`。
- `projectProgrammingRoot/packer-driver/targets/preview/chunks/**`。
- `cliProgrammingRoot/preview/systemjs/system.js` 或 current CLI scripting source 确认的等价 output，来自 CLI `ProgrammingFacet#_buildSystemJs()`。
- `projectProgrammingRoot/custom-macro.js` 或等价 `cc/userland/macro` 来源；`ProgrammingFacet` 的 static import map 声明 `cc/userland/macro -> ./userland/macro`。

`projectProgrammingRoot` 的 production contract 是 project 的 `temp/programming` 目录；测试环境变量 `COCOS_CLI_TEST_EDITOR_PROGRAMMING_REF` 指向冻结 `temp` reference 根，创建 `RuntimePreviewContext` 时必须显式传入其下的 `programming` 目录。

RuntimePreviewContext startup state 只能包括：
- `projectRoot`
- `engineRoot`
- `projectLibraryRoot`
- `internalLibraryRoot`
- `projectProgrammingRoot`
- `cliProgrammingRoot`
- test-only `editorLibraryRef` / `editorProgrammingRef`
- `PreviewSettingsProvider`
- `AssetMetadataProvider`
- `ProgrammingProvider`
- bounded caches with explicit capacity / invalidation

Context constructor 禁止读取全量 `.assets-data.json`、全量 `.assets-info1.0.0.json`、全部 chunks 或递归枚举 `library/temp`。

### P6 engine-source Vitest 参考方案

参考路径：`F:\ps_copy\p6\trunk\Project\GameClient\Client-ai_master\tests`。这是本机 optional reference，缺失时以 current engine source 和本项目 harness 为准。

已确认 harness 决策：
- P6 可作为“真实 engine source + host boundary mocks”的测试结构参考，不能照搬业务测试语义。
- Runtime preview probe 必须使用 browser preview 语义：`EDITOR=false`、`PREVIEW=true`、`TEST=false`、`WEB=true`。
- `cc` entry 不允许为了拿一个 class 而 re-export 大范围目录 index；当前主线只 re-export `asset-manager/index.ts` 以及 probe 已确认需要的精确 asset class 模块：`Asset`、`JsonAsset`、`ImageAsset`、`Texture2D`、`SpriteFrame`、`SpriteAtlas`、`TTFFont`、`SpineSkeletonData`。
- Host boundary mock 只能位于 DOM、canvas、PAL、native external artifact 层；不能 mock `assetManager`、`resources`、`Bundle`、`parser`、`factory`、`Asset`、`JsonAsset` 等 Cocos public API。
- `pal/wasm` 在测试中解析 `external:` 到 engine `native/external` 并读取真实 artifact；不能返回空 `ArrayBuffer` 掩盖需要 wasm 的加载分支。
- meshopt ASM/WASM 当前未接入真实 decoder factory；如果 sample 触发 meshopt，测试必须明确失败并要求补 artifact mapping，不能用 `supported=false` 表示“不需要”。

2026-06-06 Task 8.5 review 修复：
- 收窄 `vitests/shared/cocos-cc-source-entry.ts`，移除 `game/index.ts`、`asset/assets/index.ts`、`2d/assets/index.ts` 大范围 re-export。
- `setup-engine-env.ts` 启动时安装 null canvas context，作为 DOM/canvas host boundary。
- `pal-wasm.ts` 改为读取 engine `native/external` 下真实 external artifact。
- `meshopt-decoder-*.ts` 改为 artifact boundary 未接入时显式失败，不再静默返回可通过状态。

### CLI preview settings 生成链

当前补充事实：
- `src/core/engine/index.ts` 在 engine init 时，如果传入 `serverURL`，会查询 internal asset list，并在 `overrideSettings.assets` 中设置 `importBase`、`nativeBase`、`remoteBundles: ['internal', 'main'].concat(bundles)`、`server: info.serverURL`。
- 因此 runtime-preview startup 的 server URL 不是普通日志字段，它会进入 engine settings/runtime asset base 语义。`startRuntimePreview()` 必须在构建 settings/HTTP contract 时保留这个关系。

性能与边界约束：
- `PreviewSettingsProvider` 可以复用或等价调用 `getPreviewSettings()`，但必须证明没有执行正常 build output copy、plugin build hooks、全量 asset copy 或完整 build pipeline。
- settings generation 必须记录耗时，并在超过配置预算时输出明确诊断。
- 可以在 server startup 后后台预热，也可以在第一次 `/settings.js` 前 lazy 生成；两种模式都不能递归扫描 `library/temp` 或复制 build artifacts。

### Old editor preview server route 对照

证据文件：
- `E:\own_space\tmp-repos\runtime-preview-reference\cocos-cli-backup-runtime-preview-bad-20260606\docs\dev\reference\old_editor_preview_server\server.js`
- `E:\own_space\tmp-repos\runtime-preview-reference\cocos-cli-backup-runtime-preview-bad-20260606\docs\dev\reference\old_editor_preview_server\Facet.js`
- `E:\own_space\tmp-repos\runtime-preview-reference\cocos-cli-backup-runtime-preview-bad-20260606\docs\dev\reference\old_editor_preview_server\FacetInstance.js`
- `E:\own_space\tmp-repos\runtime-preview-reference\cocos-cli-backup-runtime-preview-bad-20260606\docs\dev\reference\old_editor_preview_server\simulator.js`
- `E:\own_space\tmp-repos\runtime-preview-reference\cocos-cli-backup-runtime-preview-bad-20260606\docs\dev\reference\old_editor_preview_server\myps.ts`
- `E:\own_space\tmp-repos\runtime-preview-reference\cocos-cli-backup-runtime-preview-bad-20260606\docs\dev\reference\old_editor_preview_server\preview_ctrl.ts`

优先级说明：
- `server.js`、`Facet.js`、`FacetInstance.js`、`simulator.js` 是旧版 Creator preview server 的主要行为事实。
- `myps.ts` 和 `preview_ctrl.ts` 是旧实现痕迹，可用于理解业务意图和历史方案，但不能覆盖 engine runtime 与当前 CLI AssetDB/builder 事实。

| Route | Old editor 行为 | 新 runtime-preview 处理 |
| --- | --- | --- |
| `/settings.js` | 调 `Editor.Message.request("preview","generate-settings",{ type:"browser", startScene })`，缓存 `script2library` 与 `bundleConfigs`，返回 `window._CCSettings = ...` | 必须基于 CLI `getPreviewSettings()` / runtime context 生成等价 settings，不能手写不完整 settings |
| `/settings.json` | 调 `generate-settings`，type 为 `game-view`，缓存 `gameviewBundleConfigs` | 仅在 runtime 或测试需要时实现；行为必须从 settings 事实链派生 |
| `/scene/*.json` | `current_scene` 走 `scene/query-scene-json`；uuid scene 走 `asset-db/query-asset-info` 并发送 `library[".json"]` | CLI 下应从 AssetDB/runtime context 找 scene serialized JSON，不依赖 Editor.Message |
| `/assets/*/config.json` | 从 `bundleConfigs` 按 `name` 查找并返回 config | 从 Task 11 settings/bundle config 输出返回 context-derived config |
| `/assets/*/index.js` | bundle 存在时返回 `generateDummyScript(bundleName)` | 只有 engine `loadBundle()` 需要该入口时才实现，内容必须匹配 engine bundle load 行为 |
| `/remote/*/config.json` | 从 `gameviewBundleConfigs` 按 `name` 查找并返回 config | 若支持 remote bundle，必须由 engine `remoteBundles` / `assets.server` / bundle config 事实驱动 |
| `/remote/*/index.js` | remote bundle 存在时返回 dummy bundle script | 同 `/assets/*/index.js`，不能独立发明规则 |
| `/assets/*/import/*` | 取请求尾部，映射到 `Editor.Project.path/library`；不存在则回退 builtin internal library | 新实现只能通过 runtime context/on-demand resolver 映射 runtime 实际 URL 到文件，不能硬编码 editor library 目录规则 |
| `/assets/*/native/*` | 与 import route 相同映射策略 | 同上；native URL 是否成立由 engine/bundle config/asset nativeDep 决定 |
| `/remote/*/import/*` | 与 assets import route 相同映射策略 | 同上，并需保留 remote bundle 基础路径语义 |
| `/remote/*/native/*` | 与 assets native route 相同映射策略 | 同上 |
| `/plugins/*` | 使用 `script2library` 查找脚本 library 文件；若未缓存则重新 `generate-settings` | 使用 programming resolver / script runtime map / `script2library` 等价映射提供脚本产物 |
| `/scripting/import-map-global` | `Facet.getGlobalImportMap()` 返回静态 import map，包含 `cc`、`cc/env`、`cce.env`、`cc/userland/macro` | 使用 CLI/engine source 与冻结 `temp/programming` 事实生成或服务等价 import map |
| `/scripting/x/*` | `Facet.loadPackResource()` 通过 `QuickPackLoader.loadAny()` 返回 json 或 chunk 文件 | 使用 preview target `import-map.json`、records、chunks 建立 programming index，不能用 chunk regex 推业务语义 |
| `/scripting/systemjs/*` | 从 `temp/programming/preview/systemjs/system.js` 服务 SystemJS | 使用冻结 `temp/programming` 与 CLI scripting 事实定位 |
| `/scripting/userland/macro` | 服务 `<project>/temp/programming/custom-macro.js` | 从 project temp programming 定位，缺失时给明确诊断 |
| `/scripting/engine/*` | 从 `ProgrammingFacet.engineRoot` 服务 engine 文件，缺 `.js` 时补后缀重试 | 使用 engine root/build/cache 事实，不猜测无证路径 |
| `/missing-asset/*` | 调 `asset-db/query-missing-asset-info` 返回 missing asset 信息 | 可作为诊断 route，但不应参与正常加载路径 |
| `/query-extname/*` | 查询 asset info，若存在 `.cconb` 返回 `.cconb` | current engine `editor-path-replace.ts` 在 `PREVIEW && !TEST` 下会请求该 route；新实现应按 AssetDB/library 事实返回 import payload extension，但不能用它替代 import/native 映射 |

迁移边界：
- 旧 editor 的 `/assets/*/import/*`、`/assets/*/native/*`、`/remote/*/import/*`、`/remote/*/native/*` route 是行为参考，不是新实现的路径规则来源。
- 旧 editor 可访问 `Editor.Message`、`Editor.Project`、`Editor.App`、`Editor.Profile`；CLI runtime-preview 必须用 CLI AssetDB、builder、scripting API、engine path 和 runtime context 替代。
- `script2library` 的业务意图必须保留：runtime 请求项目脚本时要落到真实编译产物。
- `generate-settings` 的业务意图必须保留：settings 与 bundle config 是 engine runtime 的加载入口。
- `QuickPackLoader` 的业务意图必须保留：programming preview 的 import map、resolution detail、chunk 由 programming pipeline 产物驱动。
- `myps.ts` 中的 `gulpBuild.buildSettings()` / `gulpBuild.buildConfig()` 和 `preview_ctrl.ts` 中的 bundle middleware 只能作为历史意图，不可覆盖当前 CLI `getPreviewSettings()` 与 engine 3.8.6 runtime 事实。

### Frozen artifact metadata / records 结构

证据文档：
- `docs/dev/runtime-preview-reference-library-20260606.md`
- `docs/dev/runtime-preview-reference-temp-programming-20260606.md`

Frozen editor `library`：
- 来源：`E:\own_space\cocos_work_lab_38x\library`。
- Reference copy：`E:\own_space\engines\cocos-cli\.codex-tmp\reference-library\cocos_work_lab_38x-editor-library-20260606`。
- File count：`1083`。
- Total bytes：`86902048`。
- Layout：uuid/hash bucket，例如 `08/0835f102-5471-47a3-9a76-01c07ac9cdb2/OpenSans-Regular.ttf`。
- Metadata files：`8`。
- Serialized JSON files：`839`。
- Native-like files：`230`。
- Non-JSON files：`236`。
- Metadata 包含 `.assets-data.json`、`.assets-dependency.json`、`.assets-info1.0.0.json`、`.internal-data.json`、`.internal-dependency.json`、`.internal-info1.0.0.json`、`.view-state-group-data.json`、`.view-state-group-info1.0.0.json`。
- 扩展名分布显示 `.json`、`.png`、`.atlas`、`.bin`、`.jpg`、no extension、`.ttf`、`.plist`、`.zip`、`.cconb`、`.mp4` 均存在。
- 已确认样例覆盖 serialized JSON、Texture/Image native-like、TTF native-like、Spine/atlas native-like、Binary native-like。

Frozen editor `temp/programming`：
- 来源：`E:\own_space\cocos_work_lab_38x\temp\programming`。
- Reference copy：`E:\own_space\engines\cocos-cli\.codex-tmp\reference-temp\cocos_work_lab_38x-editor-programming-20260606`。
- File count：`936`。
- Total bytes：`15544837`。
- Preview target files：`466`。
- Editor target files：`466`。
- SystemJS files：`2`。
- 已复制范围只包含 `temp\tsconfig.cocos.json`、`temp\programming\custom-macro.js`、`temp\programming\preview\systemjs\**`、`temp\programming\packer-driver\targets\preview\**`、`temp\programming\packer-driver\targets\editor\**`。
- 明确排除 `temp\programming\packer-driver\logs\**`、`temp\logs\**`、`temp\node.localStorage\**`、`temp\writablePath\**`、`temp\asset-db\**`、`temp\builder\**`、`temp\declarations\**`、`temp\profiles\**`、`temp\scene\**`。
- 关键 preview files 包含 `import-map.json`、`main-record.json`、`assembly-record.json`、`chunks/**`、`programming/preview/systemjs/system.js`、`programming/custom-macro.js`。

实现约束：
- Frozen editor artifacts 是 editor-generated compatibility baseline，不是 production 运行时要复制的输入。
- Runtime preview 可以用这些 reference artifacts 选择 representative tests；production startup 不得扫描 reference 或 project `library/temp` 建立全量 index。
- CLI AssetDB 生成 output 与 frozen editor output 不一致时，必须先判断差异来源，再按 engine preview 消费事实决定是否让 CLI output/adapter 向 editor-generated semantics 靠近。
- `.cconb`、native-like extension、TTF 子目录等只能作为产物事实，不能直接升级为 URL 规则。

2026-06-06 Task 9 consistency 结果：
- `E:\own_space\cocos_work_lab_38x\library` 与 frozen editor `library` 的 `.assets-data.json`、`.internal-data.json` key set 一致。
- 代表性 editor output 文件在 active project library 与 frozen reference 中均存在：serialized JSON、PNG、TTF 子目录、Spine atlas、binary native-like。
- `E:\own_space\cocos_work_lab_38x\temp\programming\packer-driver\targets\preview\import-map.json` 与 frozen editor programming reference 均存在。
- 2026-06-07 轻量 CLI AssetDB generation probe 后，`E:\own_space\cocos_work_lab_38x\library\cli` 与 `E:\own_space\cocos_work_lab_38x\temp\cli\programming` 已存在，但 generation 进程最终失败，当前只能分类为 `cli-output-incomplete-after-failed-generation`，不是 CLI/editor output 已一致。
- 当前 CLI output 诊断：`library/cli/.assets-data.json` 与 `.assets-dependency.json` 存在；`.assets-info1.0.0.json`、`.internal-data.json`、`.internal-info1.0.0.json`、`.internal-dependency.json` 缺失；representative 文件中 PNG 与 atlas 存在，serialized JSON、TTF 子目录文件、binary native-like sample 缺失；`temp/cli/programming/packer-driver/targets/preview/import-map.json` 存在。
- 轻量 generation probe 的失败链路：不经过 `Engine.initEngine()` 时，AssetDB importer 会缺少真实 `cc.JsonAsset`、`ImageAsset`、`SpriteAtlas` 等 constructors，后续还会缺 `cc/mods-mgr`。因此真实 CLI AssetDB/settings 链路不能跳过 editor engine preload。

2026-06-06 Task 9.5 filesystem-base parser probe 结果：
- 真实 engine `resources.load()` 可通过 frozen editor library 加载 `JsonAsset`，进入 engine downloader/parser/factory 链路。
- 2026-06-07 补充：真实 engine `resources.load(ImageAsset)` 可通过 frozen editor library 加载 ImageAsset native dependency，并触发 `.png` native file download；该验证使用 frozen library request-time file index，仅属于 filesystem-base parser probe，不输出 HTTP route contract。
- 该 probe 使用 filesystem `importBase/nativeBase`，不输出 HTTP route contract。
- 2026-06-07 Step 6 补充：已启用 Texture2D / SpriteFrame dependency chain；host IO 必须从 frozen PNG 读取 width/height 并注入 jsdom `Image`，否则 SpriteFrame 反序列化会因图片尺寸为 0 触发 rect 越界并超时。
- 2026-06-07 Step 6 补充：已启用 Plist 源资产转换后的 serialized `SpriteAtlas` 样本，验证 `resources.load(SpriteAtlas)` 可加载该 serialized import JSON；该 case 没有下载 `.plist`，不能声明 runtime `.plist` parser 已覆盖。
- 2026-06-07 Step 6 补充：已启用 Spine `sp.SkeletonData` `.json` 样本，验证当前 frozen Spine 数据可由真实 engine source 反序列化。
- Spine `.atlas` standalone 当前只能作为 diagnostic：frozen `.atlas` asset 与 `sp.SkeletonData` 共用同一个 resources path，engine `Config.getInfoWithPath(path, Asset)` 对 `cc.Asset` base type 会匹配到 `sp.SkeletonData`；除非有独立 resources path 或更具体 asset type，否则不能用 `resources.load(path, Asset)` 精确证明 `.atlas` standalone parser。
- TTFFont 当前只能作为 diagnostic：frozen library 存在 4 个 serialized `cc.TTFFont` 和 4 个 native TTF 文件，但 `.assets-info1.0.0.json` / `.assets-data.json` 没有 `assets/resources` 映射，不能构造真实 `resources.load(TTFFont)` 入口。

2026-06-06 Task 9.75 HTTP-base URL capture 结果：
- 通过本地 HTTP fixture、HTTP `base/importBase/nativeBase` 和真实 engine `resources.load(JsonAsset)` 捕获 runtime URL。
- 已捕获 `/query-extname/e62d10c9-29b9-4d53-833b-5769b524b759`，来源为 current engine `editor-path-replace.ts`。
- 已捕获 `/assets/resources/import/e6/e62d10c9-29b9-4d53-833b-5769b524b759.json`，来源为 engine `url-transformer.combine()` 对 `resources.load('test_area_edge_graphic/Season_1', JsonAsset)` 的 HTTP-base import URL 生成。
- 2026-06-07 补充：已通过真实 engine `resources.load(ImageAsset)` 捕获 ImageAsset native URL，`routeCategory = native`，`expectedArtifactKind = native-image`；捕获过程由 engine runtime 发起请求，fixture server 只按收到的 native request tail 服务 frozen library 文件。
- 当前 pack / redirect HTTP-base URL 未捕获；诊断原因是当前 synthesized resources bundle config 没有 `config.packs` 与 `redirect` entries。后续触发条件是找到或构造能让 engine `packManager.load()` 或 redirect asset info 产生 runtime request 的 frozen sample / bundle config fact，不允许用手写近似 URL 替代。
- 该 HTTP-base captured URL 可以作为 Task 12 HTTP contract 输入；filesystem-base probe URL 仍不能作为 HTTP route contract。
- Captured URL fixture 已抽到 `vitests/shared/http-url-capture.ts`，字段包含 `url`、`routeCategory`、`sourceOperation`、`expectedArtifactKind`、`probe`。
- HTTP capture fixture 服务文件时不使用 `walkFiles()` / `byRuntimeUrl` full index；它只按当前 HTTP request tail 做 path normalization、bucket 文件存在性检查和 direct file read。`walkFiles()` 仍只属于 filesystem-base parser probe 的 reference index helper，不得进入 production resolver。

2026-06-06 Task 10 script/import-map/dependScripts 结果：
- `vitests/suites/runtime-preview/script-runtime-map.test.ts` 已验证 frozen editor `temp/programming` 中的 `import-map.json`、`main-record.json`、`assembly-record.json` 可通过 `/scripting/x/packer-driver/targets/preview/*` 按需读取。
- `import-map.json` 中引用的 `./chunks/**.js` 可转换为 `/scripting/x/packer-driver/targets/preview/chunks/**.js` 并由 `resolveProgrammingRequest()` 按请求解析到真实文件。
- 至少一个 import-map 引用 chunk 包含 `System.register`；该检查只用于确认 chunk 形态，不用于解析模块业务语义。
- `.assets-data.json` 中 scene/prefab 的 `value.dependScripts` 指向 project script asset uuid；当前已验证范围只覆盖 frozen project asset scripts 的 `db://assets/**/*.ts`，不覆盖 `db://internal`、extension mount、plugin/global scripts 或 `script2library`。
- project script asset 的 `db://assets/**/*.ts` 可按 `projectRoot/assets/**` 转换成 frozen import-map 中实际存在的 `file:///.../assets/**/*.ts` module URL。
- 该 module URL 同时出现在 `import-map.json#imports`、`main-record.json#modules` 和 `assembly-record.json#entries`；`main-record.modules[moduleUrl].mTimestamp.uuid` 与 `dependScripts` 中的 script uuid 一致，`chunkId` 对应 `assembly-record.chunks[chunkId]` 和 import-map chunk 文件名。
- `findDependScriptModuleLinks()` 只消费传入的 AssetDB/library metadata 与 preview records，不扫描全部 `chunks/**`，也不从 chunk 源码中推导业务依赖。

2026-06-06 Task 11 settings provider 结果：
- `src/runtime-preview/settings/preview-settings-provider.ts` 只封装 CLI `getPreviewSettings()` 或测试注入的等价 loader，不重新实现 settings 生成。
- Provider 输出 `settings`、`settingsJsSource`、`bundleConfigs`、`scriptRuntimeMap.script2library`、`assetBaseConfig` 和 timing/timeout diagnostics。
- `settingsJsSource` 形态为 `window._CCSettings = ...;`，用于后续 `/settings.js` route。
- `assetBaseConfig` 从 `settings.assets` 或 `settings.overrideSettings.assets` 提取 `importBase`、`nativeBase`、`server`、`remoteBundles`，对应 engine settings consumption 事实。
- 当前测试验证 provider contract、缓存、timeout 和不额外执行 normal build pipeline 的包装边界；尚未声明真实项目调用 `getPreviewSettings()` 已完成端到端验证。
- 后续 Task 12/13 必须继续验证真实 `getPreviewSettings()` 结果能被 HTTP route 消费，且不会触发 normal build output copy、plugin build hooks、全量 asset copy 或完整 build pipeline。

2026-06-06 Task 12 HTTP contract 结果：
- `vitests/suites/runtime-preview/http-contract.test.ts` 消费 `captureJsonAssetHttpRuntimeUrls()` 产生的 HTTP-base captured URL，不手写近似 asset URL。
- `/settings.js` 由 `PreviewSettingsProvider.settingsJsSource` 返回，内容形态为 `window._CCSettings = ...;`。
- `/assets/resources/config.json` 从 `PreviewSettingsProvider.bundleConfigs` 按 bundle name 返回。
- HTTP-base captured import URL `/assets/resources/import/e6/e62d10c9-29b9-4d53-833b-5769b524b759.json` 通过 `resolveLibraryRequest()` 映射到 frozen editor library 中真实 bucket 文件。
- `resolveLibraryRequest()` 必须由 fact source 授权 request。test-only captured mode 只允许 HTTP-base captured URL 集合中的 request；production mode 在没有 `capturedRuntimeUrls` 时，只允许 `bundleConfigs[<bundle>].paths` 明确记录的 import payload uuid。
- allowed request 通过后，resolver 只按当前 request tail 在 project/internal library root 下做 direct `stat`，不扫描 root、不建立全局 URL/file index。
- `/assets/<bundle>/index.js` / `/remote/<bundle>/index.js` 按 engine `downloadBundle()` 事实返回 dummy bundle script；该 route 只在对应 bundle config 存在时返回 200。
- `/query-extname/<uuid>` 只检查 library bucket 中是否存在 `<uuid>.cconb` 或 `<uuid>.ccon`，并返回 import payload extension replacement；普通 `.json` 返回空字符串。该 route 不参与 import/native 判断。
- `/scripting/x/*` 通过 `resolveProgrammingRequest()` 按需读取 `temp/programming` 文件。
- 当前 HTTP contract 覆盖 serialized JsonAsset import URL；native dependency、pack URL、redirect bundle URL 尚未由 HTTP-base probe 捕获，不能声明已验证。

2026-06-06 Task 13 runtime preview startup 结果：
- `src/runtime-preview/server/runtime-preview-server.ts` 提供 `startRuntimePreviewServer()`，负责 HTTP server lifecycle、health route、runtime route dispatch 和 close。
- Health route 为 `/__runtime-preview/health`，返回 project root、engine root、library root、programming root。
- Startup 只构造 `RuntimePreviewContext`、`PreviewSettingsProvider` 和 HTTP server，不递归扫描 `library` 或 `temp/programming`。
- `src/runtime-preview/index.ts` 暴露 runtime preview public entry。
- `Launcher.startRuntimePreview()` 接入 runtime preview server；`preview --runtime --host --port --scene` 启动 runtime server，不打开浏览器。
- 当前 `cli-startup.test.ts` 验证 server lifecycle、health route、settings route、startup roots log 和端口释放；真实 CLI 命令行进程、真实 `getPreviewSettings()` 端到端和 browser smoke 尚未验证。

2026-06-06 Task 14 pre-browser HTTP smoke 结果：
- `vitests/suites/runtime-preview/pre-browser-http-smoke.test.ts` 启动 runtime preview server 并请求代表性端点：`/settings.js`、`/assets/resources/config.json`、HTTP-base captured import URL、`/scripting/x/.../import-map.json` 和一个实际 chunk。
- 该 smoke 在打开浏览器前验证短链路端点可用，仍不声明真实 browser page 已集成通过。
- 当前尚未实现 root preview page route，因此没有打开浏览器；browser smoke 需要在页面入口和真实 `getPreviewSettings()` 端到端完成后再执行。

2026-06-07 资深子代理 review 结果：
- 当前 `vitests` 能通过，但测试/验证链路尚未按计划闭环，不能声明 runtime preview 已完成或继续 browser integration。
- Critical：production `preview --runtime` 不会给 route context 传入 `capturedRuntimeUrls`；而 `resolveLibraryRequest()` 没有 `allowedRequestPaths` 时拒绝所有 asset import/native request。因此 injected HTTP contract 通过不等于真实 CLI server 能服务 representative asset URL。
- Task 9 gap：`editor-cli-output-consistency.test.ts` 还没有真实验证 CLI AssetDB output，只验证 active/frozen editor library，并把 `cli-output-not-generated-yet` 当作通过状态。
- Task 9.5 gap 已推进：filesystem-base `resources.load` parser probe 覆盖 JsonAsset、ImageAsset、Texture2D、SpriteFrame、Plist 源资产转换后的 serialized SpriteAtlas、Spine SkeletonData；TTFFont、runtime `.plist` parser 与 Spine `.atlas` standalone 按 frozen facts 记录 diagnostic gap。
- Task 9.75 gap：HTTP-base capture 只覆盖 `query-extname` 和一个 JsonAsset import URL；native dependency、pack、redirect bundle URL 尚未捕获。
- Task 11 gap：`settings-generation.test.ts` 全部使用 mocked `loadPreviewSettings`；真实 `getPreviewSettings()` E2E 和 normal build boundary 尚未验证。
- Task 12 gap：`http-contract.test.ts` 使用手写 injected `settings/bundleConfigs/script2library`，没有消费真实 Task 11 output。
- Task 13 gap：`cli-startup.test.ts` 直接调用 `startRuntimePreviewServer()`，没有覆盖 `PreviewCommand -> Launcher.startRuntimePreview() -> server` 的真实命令链。
- Minor：`browser-smoke.test.ts` 已改名为 `pre-browser-http-smoke.test.ts`；`src/runtime-preview/manifest/**` 旧 recursive `walkFiles()` 草稿已删除。

2026-06-07 Task 15 Step 0/3 局部修复结果：
- 新增 `vitests/suites/runtime-preview/launcher-runtime-preview.test.ts`，先复现 production-like server 不传 test-only `capturedRuntimeUrls` 时 representative HTTP-base captured import URL 返回 404。
- `resolveLibraryRequest()` 增加 production fact source：当没有 `allowedRequestPaths` 时，只允许 `bundleConfigs[<bundle>].paths` 明确记录的 import payload uuid；仍只按当前 request tail 对 project/internal library 做 direct `stat`，不扫描 library root。
- 当测试传入 `capturedRuntimeUrls` 时，resolver 仍执行严格 allow list；未捕获但形态相似的 native/remote URL 继续返回 404。
- captured mode 不再为了 asset route 调 `PreviewSettingsProvider.getPreviewSettings()`；`http-contract.test.ts` 已覆盖 captured asset URL 在 settings generation 会失败时仍可按 captured fact 服务。
- 已验证：`launcher-runtime-preview.test.ts`、`http-contract.test.ts`、`on-demand-resolver.test.ts` 和完整 `npm --prefix vitests test -- --passWithNoTests` 通过。
- 未完成：真实 `Launcher.startRuntimePreview()` 成功启动 / CLI command process、真实 `getPreviewSettings()` E2E、native/pack/redirect HTTP-base capture 仍按 Task 15 后续步骤处理。`resources.load` parser probe 已覆盖当前 frozen facts 可触发的主链路，TTFFont、runtime `.plist` parser 与 Spine `.atlas` standalone 作为 diagnostic gap 保留。

2026-06-07 Task 15 Step 1/2 诊断结果：
- `src/core/engine/index.ts` 在 Windows absolute path 下使用 `import(join(enginePath, 'package.json'))` 会失败；已改为 `fs-extra.readJSON(join(enginePath, 'package.json'))`，避免 ESM/source runner 与 compiled CommonJS 的行为差异。`settings-generation.test.ts` 通过真实 `tsx` child process 验证 `Engine.init(D:\workspace\engines\cocos\3.8.6)` 能读取真实 package version。
- `src/core/launcher.ts` 已将 test engine root 选择收敛为 `getEngineRoot()`，用于 `initEngine()`、`scripting.initialize()`、`startupScene()` 和 `startRuntimePreview()` 的 runtime context；只有同时设置 `COCOS_CLI_TEST_ENGINE_ROOT`、`COCOS_CLI_TEST_PROJECT_ROOT` 且当前 `Launcher.projectPath` 匹配 test project root 时才覆盖 `GlobalPaths.enginePath`，避免测试前半段初始化到错误 engine root，同时降低 env 泄漏影响普通 production 命令的风险。
- 真实 `Launcher.startRuntimePreview()` 已推进到 engine preload 阶段，但当前 engine root 只有 `bin/.cache/dev-cli/web/loader.js`，缺少 `bin/.cache/dev-cli/editor/loader.js`，`cc-module` 的 `EngineLoader.createEngineLoader()` 因此无法加载 `editor/loader`。
- 按当前计划约束，生成或修改 `D:\workspace\engines\cocos\3.8.6\bin\.cache\dev-cli\editor/**` 属于修改 engine root 产物，执行前需要用户确认。确认前不能把真实 `getPreviewSettings()` E2E 或真实 `Launcher.startRuntimePreview()` 声明为完成。
- 已验证：`npm --prefix vitests test -- suites/runtime-preview/editor-cli-output-consistency.test.ts suites/runtime-preview/settings-generation.test.ts` 通过；该通过结果包含明确 blocker 诊断，不等于 Step 1/2 真实闭环已完成。

2026-06-07 Task 15 Step 7 诊断结果：
- `vitests/suites/runtime-preview/launcher-runtime-preview.test.ts` 已新增 child-process `tsx` 诊断测试，真实调用 `new Launcher(projectRoot).startRuntimePreview({ host, port: 0, scene })`。
- 该测试在当前基线下必须失败于 `missing-engine-dev-cli-editor-loader` 事实：`D:\workspace\engines\cocos\3.8.6\bin\.cache\dev-cli\editor\loader.js` 缺失，而 `web/loader.js` 存在。
- 因 blocker 未解除，Step 7 只能确认真实 `Launcher.startRuntimePreview()` 当前到达 engine preload 前置阶段；尚未覆盖成功启动 server 后的 `/settings.js`、representative asset URL、script route 和端口释放。
- `PreviewCommand -> Launcher.startRuntimePreview()` 的 CLI command-process coverage 尚未完成；不能用 `cli-startup.test.ts` 的 direct `startRuntimePreviewServer()` lifecycle 测试替代。

### Runtime preview 实现边界

- URL 由 engine runtime、settings、bundle config、`assetInfo`、`editor-path-replace.ts`、downloader/parser 链路产生；server 不自创 URL。
- Route 名称可参考旧 editor server，但 route 是否存在和如何返回必须有 engine source、CLI source 或产物事实支撑。
- Production startup 只初始化 root paths、server、runtime context、小型 lazy caches；禁止递归扫描 `library`、`temp/programming` 或构建全量 URL/file index。
- Request-time resolver 只能处理 engine/runtime 已发出的请求：normalize request、查 route fact source、按有限候选 path 检查存在性、返回文件或诊断。
- `/query-extname/<uuid>` 只回答 import payload extension，不参与 import/native 语义判断。
- `resources.load` / HTTP contract 失败时，先排查 test harness、host boundary、runtime context、settings、resolver、CLI output shape；确认是 3.8.6 engine source 兼容缺口后，按计划中的 Engine source 适配规则小步修复。
- 当前阶段允许修改 `D:\workspace\engines\cocos\3.8.6` 适配 runtime preview，不再逐项等待确认。参考顺序为 current engine source -> `E:\own_space\tmp-repos\runtime-preview-reference\engine-backup-current-20260606` -> `E:\own_space\engines\cocos4`，最终必须回到 3.8.6 验证。禁止手工复制/伪造 generated loader 或把 generated cache 当成 source patch。
