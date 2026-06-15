# WeChatGame 平台事实来源清单（2026-06-15）

本文只记录 `wechatgame` 平台重写前已经确认的事实来源、观察结果、事实边界和待验证项。本文不记录实现方案，不登记问题状态，也不把推断写成已验证事实。

## 事实来源边界

### Creator platform extension

来源目录：

`E:\own_space\engines\cocos-cli\.codex-tmp\creator-386-app-asar-extract\modules\platform-extensions\extensions\wechatgame`

已确认内容：

- `package.json`：
  - `name: "wechatgame"`。
  - `title: "i18n:wechatgame.title"`。
  - `version: "1.0.4"`。
  - `contributions.builder: "./dist/build.js"`。
  - `contributions.program.properties.wechatDevtools` 注册微信开发者工具路径配置。
  - `contributions.messages.run.methods` 指向 `run`。
- `@types/index.d.ts`：
  - `IOptions` 包含 `appid`、`buildOpenDataContextTemplate`、`orientation`、`separateEngine`、`highPerformanceMode`、`subpackages`、`wasmSubpackage`、`localSeparateEngine`。
  - `ITaskOption.packages.wechatgame` 使用上述 `IOptions`。
- `i18n/en.js`、`i18n/zh.js`：
  - 包含微信小游戏标题、`separateEngine`、`localSeparateEngine`、`highPerformanceMode`、`wasmSubpackage`、开发者工具路径和运行提示。
- `static/view.html`：
  - 只描述 Editor 构建面板 UI。
  - 涉及 `separateEngine`、`localSeparateEngine`、`highPerformanceMode`。
- `static/cocos/plugin.json`、`static/cocos/signature.json`：
  - 用于微信引擎插件目录的静态基础文件。
- `source/` 目录未提供可读源码文件。

边界说明：

- `static/view.html` 是 Editor UI 事实，不等价于 CLI 参数 schema。
- `contributions.program.wechatDevtools` 是 Editor program manager 事实；CLI 不能直接依赖 `Editor.Profile`。
- `@types/index.d.ts` 可作为平台 option 字段事实，但字段默认值、校验规则和产物布局仍需从其他来源确认。

### `.ccc` deep dump

来源目录：

`E:\own_space\engines\cocos-cli\.codex-tmp\ccc-platform-extensions-deep-20260615-9232\wechatgame`

已确认内容：

- `dist/build.js`：
  - `exports.load` 根据 `Editor.Profile.getConfig("utils", "features.wechat-separation-engine")` 删除或保留 `exports.configs.wechatgame.options.separateEngine`。
  - `exports.configs.wechatgame.verifyRuleMap.separateEngine.func` 校验：当启用 `separateEngine` 且非 debug 时，要求 `Editor.Message.request("engine", "query-engine-info").typescript.type === "builtin"`。
- `dist/main.js`：
  - `exports.methods.run` 查询 `program.query-program-info.wechatDevtools`。
  - 校验微信开发者工具路径存在。
  - macOS 下查找 `Contents/Resources/app.nw/bin/cli` 或 `Contents/MacOS/cli`。
  - Windows 下使用 `cli.bat` 并启用 shell。
  - 运行参数为 `-o <build output> -f cocos`。
- `dist/separate-engine.js`：
  - 旧实现通过 `@cocos/ccbuild` 构建 `platform: "WECHAT"`、`moduleFormat: "system"`、`compress: true`、`split: true`、`nativeCodeBundleMode: "wasm"` 的分离引擎。
  - 读取 `editor/engine-features/render-config.json`，把带 `enginePlugin` 的 feature 选入微信引擎插件。
  - 生成 `meta.json`、`options.json`、`plugin/signature.json`、`plugin/plugin.json`。
- `dist/migrations/*.js`：
  - `1.0.1`：根据 `engine.modules.includeModules` 是否包含 `physics-ammo` 迁移旧 `wasm` 字段。
  - `1.0.2`：迁移 `remoteServerAddress` 到 `common.server`。
  - `1.0.3`：迁移 `startSceneAssetBundle` 到 `common.startSceneAssetBundle`。
  - `1.0.4`：设置 `builder.common.useSplashScreen = true`。
  - `1.0.5`：迁移旧 `enabelWebGL2` 到 `builder.taskOptionsMap.<task>.overwriteProjectSettings.includeModules.gfx-webgl2`。
- `dist/hooks.ccc`：
  - 当前确认没有业务逻辑。

边界说明：

- `.ccc` dump 只证明这些函数体存在，不证明原始 TS 模块结构、import 列表、默认 option 配置完整可恢复。
- `dist/separate-engine.js` 是 Creator extension 的旧实现事实，不等于 CLI 应直接复制该实现。
- migration 依赖 `Editor.Profile`，是否需要在 CLI 支持旧 profile 迁移，需要另行确认。

### Engine source

来源目录：

`D:\workspace\engines\cocos\3.8.6`

已确认内容：

- `templates/wechatgame/`：
  - 包含 `background.png`、`cocos-script.ejs`、`first-screen.ejs`、`game.ejs`、`game.json`、`logo.png`、`patch.json`、`project.config.json`、`slogan.png`。
  - `game.json` 默认包含 `deviceOrientation: "portrait"`、`openDataContext: ""` 和 `networkTimeout`。
  - `project.config.json` 默认包含 `miniprogramRoot`、`compileType: "game"`、`appid`、`projectname` 等微信开发者工具项目配置。
  - `game.ejs` 中会 `require("./web-adapter")`、加载 `first-screen`、include `cocosTemplate`、读取 `importMap`、注册 `plugin:` 和 `project:` handler，并最终加载 `applicationJs`。
  - `cocos-script.ejs` 负责 `polyfillsBundleFile` 和 `systemJsBundleFile` 的 `require()`。
- `bin/adapter/minigame/wechat/`：
  - 包含 `engine-adapter.js`、`engine-adapter.min.js`、`web-adapter.js`、`web-adapter.min.js`。
- `platforms/minigame/platforms/wechat/`：
  - 包含微信小游戏 wrapper 源码，如 `wrapper/builtin/*`、`wrapper/engine/*`、`wrapper/unify.js`。
- `editor/engine-features/render-config.json`：
  - 多个 engine feature 带 `enginePlugin` 标记。
  - 本轮抽取到的 `enginePlugin` feature 包括 `base`、`gfx-webgl`、`gfx-webgl2`、`3d`、`2d`、`rich-text`、`mask`、`graphics`、`ui-skew`、`ui`、`particle`、`intersection-2d`、`primitive`、`profiler`、`geometry-renderer`、`particle-2d`、`audio`、`video`、`webview`、`tween`、`terrain`、`light-probe`、`tiled-map`、`spine-3.8`、`spine-4.2`、`dragon-bones`。

边界说明：

- engine template 是微信小游戏产物模板事实。
- engine adapter 是运行时适配事实。
- `render-config.json` 是 separate engine 选择 engine plugin feature 的事实来源之一。
- engine source 不直接说明 CLI 平台 hook 应在哪个生命周期写入哪些文件。
- 曾核对 `D:\workspace\engines\cocos\3.8.6` 与 `E:\own_space\engines\3.8.6` 的关键文件 SHA256 一致，包括 `templates/wechatgame/game.ejs`、`game.json`、`project.config.json`、`editor/engine-features/render-config.json`、`bin/adapter/minigame/wechat/web-adapter.js`、`engine-adapter.js`；正式记录以 `D:\workspace\engines\cocos\3.8.6` 为准。

### CLI 当前能力

来源代码：

- `src/core/builder/worker/builder/manager/build-template.ts`
- `src/core/builder/manager/plugin.ts`
- `src/core/builder/worker/builder/stage-task-manager.ts`
- `src/core/builder/worker/builder/asset-handler/script/separate-engine.ts`
- `src/core/builder/share/bundle-utils.ts`
- `src/core/builder/share/texture-compress.ts`

已确认内容：

- `BuildTemplate` 支持项目级构建模板：
  - 根目录为项目下 `build-templates`。
  - 查找优先级为 `build-templates/<taskName>`、`build-templates/<platform>`、`build-templates/common`。
  - `findFile(relativeUrl)` 可查找用户覆盖文件。
  - `initUrl(relativeUrl, name)` 可登记由 hook 特殊处理的模板文件。
  - `copyTo(dest)` 会复制用户模板，并移除已通过 `initUrl()` 登记的模板源文件。
- `PluginManager` 支持内置平台目录注册：
  - 内置平台目录为 `src/core/builder/platforms`。
  - 平台通过 `config.ts`、`hooks.ts` 注册。
- `customBuildStages` 支持 `run` 这类构建后阶段。
- CLI 已有 `miniGame` bundle 分组和 texture compress 分组。
- CLI 已有通用 `buildSeparateEngine()` / `buildSplitEngine()` separate engine 管线。

边界说明：

- CLI 当前能力只说明有承载点，不说明 `wechatgame` 已实现。
- `BuildTemplate` 支持项目自定义模板，但微信平台需要哪些模板文件通过 `initUrl()` 特殊处理仍需实现和验证。
- `separate-engine.ts` 与 Creator extension 的 `dist/separate-engine.js` 目标相似，但输入参数、缓存路径和 import map 行为需要按 CLI 现有实现验证。

### Editor baseline

来源路径：

- 构建产物：`E:\own_space\engines\cocos-test-projects\build\wechatgame`
- 构建配置：`E:\own_space\engines\cocos-test-projects\buildConfig_wechatgame.json`

已确认配置：

- `platform = "wechatgame"`。
- `debug = false`。
- `buildMode = "normal"`。
- `md5Cache = true`。
- `sourceMaps = true`。
- `packages.wechatgame.orientation = "portrait"`。
- `packages.wechatgame.appid = "wx6ac3f5090a6b99c5"`。
- `packages.wechatgame.separateEngine = false`。
- `packages.wechatgame.highPerformanceMode = true`。

已确认产物：

- 根目录关键文件：
  - `game.js`
  - `game.json`
  - `project.config.json`
  - `web-adapter.js`
  - `engine-adapter.js`
  - `first-screen.js`
  - `application.<hash>.js`
  - `logo.png`
  - `slogan.png`
- 目录分区文件数：
  - `assets = 37`
  - `cocos-js = 13`
  - `remote = 447`
  - `root = 9`
  - `src = 11`
  - `subpackages = 4`
- `game.json`：
  - `deviceOrientation = "portrait"`。
  - `iOSHighPerformance = true`。
  - `subpackages` 包含 `sub-pack-01`、`sub-pack-02`、`subPackage`、`TestBundle`。
- `project.config.json`：
  - `appid = "wx6ac3f5090a6b99c5"`。
  - `compileType = "game"`。
  - `miniprogramRoot = "./"`。
  - `projectname = "test-cases"`。
- `game.js` 启动链：
  - 初始化 `globalThis.__wxRequire = require`。
  - 加载 `./web-adapter`。
  - 加载 `./first-screen`。
  - 加载 `src/polyfills.bundle.<hash>.js`。
  - 加载 `src/system.bundle.<hash>.js`。
  - 加载 `src/import-map.<hash>.js`。
  - 通过 `System.import('./application.<hash>.js')` 加载应用入口。
  - 在 `application.init(cc)` 前加载 `./engine-adapter`。
  - Android 端通过 `GameGlobal.requestAnimationFrame(__initApp)` 延迟初始化。
- `src/settings.<hash>.json`：
  - `engine.platform = "wechatgame"`。
  - `engine.debug = false`。
  - `assets.server = ""`。
  - `assets.remoteBundles = ["resources"]`。
  - `assets.subpackages = []`。
  - `assets.preloadBundles` 包含 `start-scene`、`resources`、`main`。
  - `assets.bundleVers` 包含 `internal`、`main`、`resources`、`start-scene`。
  - `plugins.jsList` 指向项目插件脚本。
  - `scripting.scriptPackages` 指向 `project://src/chunks/bundle.<hash>.js`。
- adapter SHA256：
  - baseline `web-adapter.js` SHA256 为 `1D042C309CA996FD621A63F9989278DD85EF594B2799C173E2D9D487587CF9FF`。
  - engine `web-adapter.min.js` SHA256 为 `1D042C309CA996FD621A63F9989278DD85EF594B2799C173E2D9D487587CF9FF`。
  - baseline `engine-adapter.js` SHA256 为 `5B649B336C4BE870E7D40CAD6B5231623032A77444644E42AF34AD31FD9FD031`。
  - engine `engine-adapter.min.js` SHA256 为 `5B649B336C4BE870E7D40CAD6B5231623032A77444644E42AF34AD31FD9FD031`。

边界说明：

- 该 baseline 可作为第一阶段 oracle，但不能直接推出所有 CLI 默认行为。
- `game.json.subpackages` 与 `settings.assets.subpackages` 的差异仍需解释，不能只按字段名推断。
- baseline release 构建使用 `web-adapter.js`、`engine-adapter.js` 文件名，没有使用 `.min.js` 文件名；但上述 SHA256 证明其内容分别来自 engine source 的 `.min.js` 文件。
- `separateEngine = false`，因此该 baseline 不验证微信 engine plugin 产物。
- `buildOpenDataContextTemplate = ""`，因此该 baseline 不验证 open data context 产物。
- 该配置没有提供 `wechatDevtools` 路径，因此该 baseline 不验证 `run` stage。

### CLI wechatgame 第一阶段实现验证

来源代码：

- `src/core/builder/platforms/wechatgame/`
- `src/core/builder/worker/builder/asset-handler/bundle/`
- `src/core/builder/worker/builder/utils/cconb.ts`
- `src/core/builder/worker/builder/manager/asset-library.ts`
- `src/core/builder/worker/builder/tasks/data-task/script.ts`
- `src/api/builder/schema.ts`

验证输入：

- Editor baseline：`E:\own_space\engines\cocos-test-projects\build\wechatgame`
- CLI 输出目录：`E:\own_space\engines\cocos-test-projects\build\wechatgame-cli`
- 构建配置：`E:\own_space\engines\cocos-test-projects\buildConfig_wechatgame.json`
- engine source：`D:\workspace\engines\cocos\3.8.6`

已确认实现事实：

- `wechatgame` 已注册为 CLI built-in builder platform。
- `SchemaWechatGamePackages` 第一阶段只公开已实现字段：`appid`、`orientation`、`highPerformanceMode`。
- `buildOpenDataContextTemplate`、`separateEngine`、`subpackages`、`wasmSubpackage`、`localSeparateEngine` 是 Creator Editor/dump 中可见的 option 事实；当前 CLI 不把它们作为已支持 production 行为暴露。
- 第一阶段实际落地的业务行为是普通微信小游戏构建：
  - `appid` 写入 `project.config.json`。
  - `orientation` 写入 `game.json.deviceOrientation` 和 `settings.screen.orientation`。
  - `highPerformanceMode` 写入 `game.json.iOSHighPerformance`。
  - `game.js`、`first-screen.js`、`game.json`、`project.config.json` 使用 engine `templates/wechatgame` 渲染。
  - `web-adapter.js`、`engine-adapter.js` 输出文件名不带 `.min`，release 内容来自 engine source 的 `.min.js`。
  - remote bundle script 通过 `moveRemoteBundleScript` 移入 `src/bundle-scripts/resources`，与 Editor baseline 的 `src` 目录布局一致。
  - `settings.assets.subpackages` 在压缩前清空，微信 `game.json.subpackages` 由 bundle/subpackage 事实生成。
  - subpackage 根目录输出 `game.js`，当前内容与 baseline 一致为 `console.log('ejs: no script in subPackage.')`。
- CCON 产物策略：
  - 默认仍保持历史 `.cconb` 输出，避免影响未显式声明的平台。
  - `wechatgame` 在 `onBeforeBundleInit` 中设置 `assetSerializeOptions.exportCCON = true` 且 `assetSerializeOptions.useCCONB = false`。
  - 对应 bundle config 的 `extensionMap` 为 `.ccon`。
  - `.ccon` 实际落盘为同名 `.json` preface 加 `.bin` chunk；该规则来自 engine `encodeCCONJson()` 与 `downloader.downloadCCON()` 的加载约定。
- explicit `bundleConfigs` 的 miniGame 特殊输出策略已限定在 `platformType === "miniGame"`，避免把 wechat/minigame 的 remote/subpackage 规则扩散到 web/native。
- script common chunk 目录由 `resolveBuildScriptCommonDir()` 保护平台已有配置；未提供时仍回退到 `src/chunks`。

已执行自动化验证：

- Jest focus tests：
  - `src/core/builder/test/ccon-output.spec.ts`
  - `src/core/builder/test/bundle-output.spec.ts`
  - `src/core/builder/test/wechatgame-platform.spec.ts`
  - `src/core/builder/test/build-script-common-dir.spec.ts`
- `npm run build` 通过。
- CLI 真实项目构建通过，输出目录为 `E:\own_space\engines\cocos-test-projects\build\wechatgame-cli`。
- `vitests/suites/build/wechatgame-editor-baseline-parity.test.ts` 通过。
- CLI 输出与 Editor baseline 的顶层分区文件数已对齐：
  - `assets = 37`
  - `remote = 447`
  - `src = 11`
  - `subpackages = 4`
- CLI 输出 `assets/start-scene/config.*.json` 和 `remote/resources/config.*.json` 的 CCON `extensionMap` 均为 `.ccon`。

验证中观察到但未在第一阶段处理的问题：

- 构建日志仍包含 `@tbmp/mp-cloud-sdk` bare specifier fallback；该问题来自测试项目脚本依赖解析，构建 exit code 为 0。
- 构建日志仍包含 texture packer 链路的 `ReferenceError: Editor is not defined` 和若干 sprite frame library JSON 缺失；这会造成个别 atlas 资源差异，但当前 baseline parity 的运行条件检查已通过。
- WeChat DevTools 已通过手工/CLI 打开进入运行调试阶段；`loadFont:fail no permission` 需按 DevTools/appid/local state 权限问题继续排查。现有自动化只能证明入口、adapter、settings、bundle config、subpackage root 和引用完整性，不能替代人工在微信开发者工具中的运行验证。
- `separateEngine`、`localSeparateEngine`、`wasmSubpackage`、`buildOpenDataContextTemplate`、完整 `run` stage 未纳入第一阶段实现验证。

### 微信开发者工具 CLI 调试事实

事实来源：

- 微信开发者工具安装目录：`E:\programs\微信web开发者工具`
- CLI 入口：`E:\programs\微信web开发者工具\cli.bat`
- 本机 DevTools profile `.ide` 文件：`C:\Users\Nobody\AppData\Local\微信开发者工具\User Data\bc0fe0f1a2b3b6b2c9e20fbe00fe232d\Default\.ide`
- 本机 DevTools HTTP 服务端口：`24017`
- 本机 DevTools local data 目录：`C:\Users\Nobody\AppData\Local\微信开发者工具\User Data\bc0fe0f1a2b3b6b2c9e20fbe00fe232d\WeappLocalData`
- 本机 DevTools log 目录：`C:\Users\Nobody\AppData\Local\微信开发者工具\User Data\bc0fe0f1a2b3b6b2c9e20fbe00fe232d\WeappLog`

已确认 CLI 能力：

- `cli.bat --help` 可列出 `open`、`preview`、`auto-preview`、`auto`、`auto-replay` 等命令。
- `open --project <dir> --port <ide-port> --lang zh` 已能打开 CLI 构建目录。
- 本轮已执行并成功的打开命令：

```powershell
rtk pwsh -NoProfile -Command '& "E:\programs\微信web开发者工具\cli.bat" open --project "E:\own_space\engines\cocos-test-projects\build\wechatgame-cli" --port 24017 --lang zh'
```

- 成功输出包含：

```text
IDE 已启动，HTTP 服务地址 http://127.0.0.1:24017
open
```

- `preview --help` 显示支持 `--qr-format/-f`、`--qr-output/-o`、`--qr-size`、`--info-output/-i`、`--project`、`--port`。
- `auto-preview --help` 显示支持 `--info-output`。
- `auto --help` 显示支持 `--trust-project`、`--test-ticket`、`--ticket` 以及 project/global 选项。

已确认调试边界：

- `auto-preview --project <dir> --info-output <file> --port 24017 --lang zh` 本轮失败在上传阶段：

```text
上传失败：网络请求错误 Failed to fetch
```

- 因此当前环境下 `auto-preview` 不能作为稳定的本地 simulator 运行日志采集方式；它会进入上传/预览链路。
- `auto --project <dir> --trust-project --port 24017 --lang zh` 本轮返回：

```text
Error: Port is not provided
```

- 因此不能把普通 IDE HTTP 服务端口直接等同于 `auto` 命令需要的自动化端口；完整 `auto` 链路还需要确认 `ticket`、自动化服务端口或 DevTools GUI 设置。
- DevTools `open` 会改写被打开项目目录下的 `project.config.json`。本轮观察到 `wechatgame-cli` 被改写为：
  - `appid = "wx54edf05a1615b259"`
  - `projectname = "test-cases-cli"`
- Editor baseline 中对应值是：
  - `appid = "wx6ac3f5090a6b99c5"`
  - `projectname = "test-cases"`
- 因此打开 DevTools 后的构建目录不能直接作为 parity oracle；需要重新构建后再做 baseline diff。

已确认 `loadFont:fail no permission` 相关事实：

- baseline 与 CLI 输出的字体文件 SHA256 一致：
  - `OpenSans-Regular.ttf`
  - `OpenSans-Italic.ttf`
  - `OpenSans-BoldItalic.ttf`
  - `OpenSans-Bold.ttf`
- baseline 与 CLI 输出的 `assets/internal/config.*.json` 中字体资源 `path`、`type`、native 版本映射一致。
- baseline 与 CLI 输出的 `engine-adapter.js`、`web-adapter.js` SHA256 一致。
- DevTools local data 中，`wechatgame-cli` 项目路径对应的 `project2_E:\own_space\engines\cocos-test-projects\build\wechatgame-cli` hash 为 `0cc73be5a9ed795a59c31b24d6dc71d1`。
- 对应 `localstorage_0cc73be5a9ed795a59c31b24d6dc71d1.json` 中观察到当前 appid 的权限表包含 `loadFont`，其 `state = 0`。
- 当前证据更支持 `loadFont:fail no permission` 是 DevTools/appid/local state 权限问题，而不是 CLI 输出缺字体、字体 config 错误或 adapter 缺失。

建议的人工调试流程：

1. 重新构建 CLI 输出，清除 DevTools 改写 `project.config.json` 后造成的产物污染。
2. 用相同 `appid` 分别打开 Editor baseline 和 CLI 输出，避免把 appid 权限差异误判为构建差异。
3. 使用 `cli.bat open --project <dir> --port <ide-port> --lang zh` 打开目标目录。
4. 如需判断权限状态，查看 `WeappLocalData/hash_key_map_2.json`，找到 `project2_<project-dir>` 对应 hash，再读取 `localstorage_<hash>.json`。
5. 如需追踪 CLI 调用行为，查看 `WeappLog/logs/*.log` 中的 CLI websocket 请求和 DevTools 运行日志。
6. 完成 DevTools 运行验证后，不要直接基于被打开过的输出目录做 parity；先重新构建。

## 推断边界

以下是候选判断，不是已完成实现事实：

- `wechatgame` 可按当前 CLI platform 架构重写。
- `dist/hooks.ccc` 无业务逻辑，因此不是当前事实缺口。
- `separateEngine` 更可能接入 CLI 现有 `buildEngineParam.separateEngineOptions`，而不是直接复制 Creator extension 的 `buildCocos`。
- 项目自定义模板应复用 CLI 的 `BuildTemplate` 机制。

## 待验证项

- DevTools 改写输出目录后，需要重新构建 CLI 输出，再重新执行 baseline parity。
- 使用相同 `appid` 分别打开 Editor baseline 与 CLI 输出，确认 `loadFont` 权限状态是否一致。
- 确认 `auto` 命令所需的自动化端口、`ticket` 或 DevTools GUI 设置，不能直接复用普通 IDE HTTP 服务端口结论。
- 确认 `game.ejs` 所需变量能否由 CLI 当前 `options` / `result.paths` 完整提供。
- 确认 baseline 中 `subpackages` 的来源，区分 bundle 配置、微信平台 hook 和 settings 语义。
- 确认项目 `build-templates/wechatgame` 下的自定义模板覆盖语义：
  - 哪些文件应直接复制。
  - 哪些 `.ejs` 应通过 `initUrl()` 处理后删除模板源。
  - `game.json` / `project.config.json` 是否需要合并必要字段，而非简单覆盖。
- 确认 `wasmSubpackage` 产物布局。
- 确认 `buildOpenDataContextTemplate` / `openDataContext` 生成规则。
- 确认 CLI 中如何获得 `separateEngine` 校验所需的 Creator 正式版本 / builtin engine 事实。
- 确认 `run` 阶段在 CLI 中的配置来源，避免依赖 `Editor.Profile`。

## 非本文范围

- 不登记 `BUILD-ISSUE-*`。
- 不制定实现任务拆分。
- 不承诺 `wechatgame` 已能构建。
- 不把 Creator extension 的 Editor-only API 直接作为 CLI production 默认策略。
