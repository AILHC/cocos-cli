# Build Extension Hook 事实记录（2026-06-12）

## 背景

本记录用于约束后续是否支持项目内 `extensions/build-ex` 的判断。当前只记录已经从 `cocos-cli` 源码、现有文档和本地检索得到的事实，不把测试失败或临时环境现象反推为 production 默认策略。

## 已确认事实

1. CLI 已有项目构建入口。
   - 命令入口在 `src/commands/build.ts`，命令名为 `build`，要求传入 `--project` 和 `--platform`。
   - 命令最终调用 `CocosAPI.buildProject()`，再进入 `Launcher.build()`。
   - `Launcher.build()` 会先执行项目 import，再调用 `builder.init(platform)` 和 `builder.build(platform, options)`。

2. CLI 已有 builder hook 执行机制。
   - `BuildTask` 的主流程会执行 `onBeforeBuild`、`onBeforeInit`、`onAfterInit`、`onBeforeBuildAssets`、`onAfterBuildAssets`、`onBeforeCompressSettings`、`onAfterCompressSettings`、`onBeforeCopyBuildTemplate`、`onAfterCopyBuildTemplate`、`onAfterBuild`。
   - `BundleManager` 还会执行 bundle 相关 hook，例如 `onBeforeBundleInit`、`onAfterBundleInit`、`onBeforeBundleDataTask`、`onAfterBundleDataTask`、`onBeforeBundleBuildTask`、`onAfterBundleBuildTask`。
   - `runPluginTask()` 在 `options.preview` 为真时会跳过构建 plugin hook，因此 runtime preview settings 不能作为 normal build hook 已执行的证明。

3. 当前 builder platform package 的扫描范围不是游戏项目目录。
   - `PluginManager` 的 `pluginRoots` 只包含：
     - `join(__dirname, '../platforms')`，即 CLI 内置平台目录。
     - `join(GlobalPaths.workspace, 'packages/platforms')`，即 `cocos-cli` workspace 下的 `packages/platforms`。
   - 当前没有发现扫描 `<projectRoot>/packages/platforms` 或 `<projectRoot>/extensions` 作为 builder hook 来源的 production 代码。

4. 当前 platform package 注册字段为 `contributes.builder`。
   - `getRegisterInfo()` 读取 `package.json` 后访问 `packageJSON.contributes.builder`。
   - 只有 `builder.register` 为真时才生成 platform register info。
   - `builder.hooks` 会被解析为 hook 模块路径，之后进入 `builderPathsMap`。

5. 当前项目 extension 扫描只覆盖 AssetDB mount。
   - `resolveProjectExtensionAssetDbMounts(projectRoot)` 扫描 `<projectRoot>/extensions/*/package.json`。
   - 该逻辑只读取 `contributions["asset-db"].mount`。
   - 该逻辑会把 extension mount 的 library 放到 `<projectRoot>/library/cli-extensions/<name>`。
   - 当前没有发现它把 `extensions/*` 的 builder hook 注册到 `PluginManager`。

6. CLI hook 调用签名存在 internal / public 差异。
   - internal hook 调用：`func.call(this, this.options, this.result, this.cache, ...args)`。
   - public hook 调用：`func(this.result.rawOptions, this.buildResult, ...args)`。
   - 因此项目内 `build-ex` 是否能原样复用，取决于它实际使用的是公共 `(options, result)` 能力，还是依赖 `Editor.*`、internal result/cache、`this` 上的 builder 对象或 Creator extension 生命周期。

7. 本地检索尚未定位到名为 `build-ex` 的实物插件。
   - 在 `E:\own_space\engines\cocos-cli`、`E:\own_space\engines\cocos-test-projects`、`E:\own_space\cocos_work_lab_38x` 的收窄检索中，只确认到 `ViewStateGroup` extension fixture。
   - 因此当前不能声明 `build-ex` hook 与 CLI hook 完全一致，只能判断现有 CLI 机制与潜在适配边界。

## 待验证项

1. 用当前 `dist/cli.js` 对主测试项目 `E:\own_space\engines\cocos-test-projects` 执行 normal build，确认现有 build pipeline 能否跑通。
2. 如果后续拿到 `extensions/build-ex` 实物，需要读取其 `package.json`、hook 入口和依赖 API，再判断是否可以无适配接入。
3. 若要支持项目 extension hook，需要补充明确设计：扫描范围、字段兼容策略、hook 顺序、错误传播、public/internal 调用语义、测试覆盖和与 runtime preview 的边界。

## 构建验证记录

### 2026-06-12 主测试项目 `web-mobile`

命令：

```powershell
node .\dist\cli.js build --project 'E:\own_space\engines\cocos-test-projects' --platform web-mobile --build-config '.\.codex-tmp\build-hook-probe-web-mobile.json'
```

执行前显式移除了当前 PowerShell 进程内的 `COCOS_CLI_TEST_PROJECT_ROOT`、`COCOS_CLI_TEST_ENGINE_ROOT`、`COCOS_CLI_TEST_EDITOR_LIBRARY_REF`、`COCOS_CLI_TEST_EDITOR_PROGRAMMING_REF`，用于避免测试 override 干扰本次 production-like CLI build。测试项目 `package.json["cocos-cli"].enginePath` 指向 `D:\workspace\engines\cocos\3.8.6`，该路径存在。

结果：

- 进程退出码：`1`。
- 日志文件：`E:\own_space\engines\cocos-test-projects\temp\logs\cocos-20260612082541.log`。
- 输出目录已创建：`E:\own_space\engines\cocos-test-projects\build\codex-build-hook-probe-web-mobile`。
- 构建过程中已执行内置平台 hook：`web-mobile:onAfterInit`、`web-mobile:onAfterBundleInit`。
- 构建失败阶段：`Package scripts`。
- 关键失败原因：`assets/cases/middleware/tiled-map/imported/hexa.tsx`、`assets/resources/tilemap/tile_iso_offset_with_tsx1.tsx`、`assets/resources/tilemap/tile_iso_offset_with_tsx2.tsx` 被 TypeScript 编译链路按脚本解析，报 `TS1109`、`TS1005` 等语法错误。
- 失败发生在 `ScriptBuilder.buildBundleScript()` 内部的 `runStaticCompileCheck(project.path, true, temp/cli/tsconfig.cocos.json)`。
- 本次生成的 `temp/cli/tsconfig.cocos.json` 使用 `include: ["../../assets/**/*", "../../extensions/**/*"]`，没有按 AssetDB importer 或 asset type 过滤。TypeScript 因此会按扩展名把 `assets` 下的 `.tsx` 当作 TSX 源码纳入检查。
- 上述 `.tsx` 文件实际内容是 Tiled tileset XML，`.meta` 中 `importer` 为 `text`，不是 TypeScript/React 源码。
- 单独复跑 `npx tsc --noEmit --project 'E:\own_space\engines\cocos-test-projects\temp\cli\tsconfig.cocos.json' 2>&1 | findstr /i 'assets'`，可复现同一组 `TS1109`、`TS1005` 错误。

该结果只能证明当前 normal build pipeline 已进入并执行了内置 platform hook；不能证明项目 extension build hook 已被扫描或执行。

### 2026-06-12 移除静态检查后复跑 `web-mobile`

源码变更：

- 移除 `ScriptBuilder.buildBundleScript()` 中对 `runStaticCompileCheck(project.path, true, temp/cli/tsconfig.cocos.json)` 的调用。
- 保留后续 `workerManager.runTask('build-script', 'buildScriptCommand', [buildScriptOptions])`，即真实脚本打包流程仍执行。

验证命令：

```powershell
npx tsc -b
node .\dist\cli.js build --project 'E:\own_space\engines\cocos-test-projects' --platform web-mobile --build-config '.\.codex-tmp\build-no-static-check-web-mobile.json'
```

执行 build 前同样显式移除了当前 PowerShell 进程内的 `COCOS_CLI_TEST_PROJECT_ROOT`、`COCOS_CLI_TEST_ENGINE_ROOT`、`COCOS_CLI_TEST_EDITOR_LIBRARY_REF`、`COCOS_CLI_TEST_EDITOR_PROGRAMMING_REF`。

结果：

- `npx tsc -b` 通过，`dist` 已更新。
- build 进程退出码：`1`。
- 日志文件：`E:\own_space\engines\cocos-test-projects\temp\logs\cocos-20260612085447.log`。
- 输出目录已创建：`E:\own_space\engines\cocos-test-projects\build\codex-build-no-static-check-web-mobile`。
- 构建仍失败于 `Package scripts` 38%，但没有再出现 `hexa.tsx`、`tile_iso_offset_with_tsx1.tsx`、`tile_iso_offset_with_tsx2.tsx` 的 `TS1109` / `TS1005` 静态检查错误。
- 新失败发生在真正的 `buildScriptCommand` worker：`assets/cases/localization-editor/script/ChangeLanguage.ts` import `db://localization-editor/l10n`，worker 报 `Could not load db://localization-editor/l10n ... ENOENT: no such file or directory, open 'E:\own_space\engines\cocos-cli\db:\localization-editor\l10n'`。

阶段性结论：

- 移除静态检查后，之前由 broad `temp/cli/tsconfig.cocos.json` 造成的 `.tsx` XML 误判不再阻塞 build。
- normal build 尚未跑通；当前下一个阻塞点是 `db://localization-editor/l10n` 的 db domain / extension mount 解析问题，应作为独立问题分析。

### 2026-06-12 使用项目 `profiles/v2/packages/web-mobile.json` 相关配置复跑

用户确认主测试项目可用 Creator profile `profiles\v2\packages\web-mobile.json` 构建成功，输出目录为 `E:\own_space\engines\cocos-test-projects\build\web-mobile`。

本地验证到的配置事实：

- 配置文件存在：`E:\own_space\engines\cocos-test-projects\profiles\v2\packages\web-mobile.json`。
- `__version__` 为 `1.0.1`。
- `builder.common.platform` 为 `web-mobile`。
- `builder.common.outputName` 为 `web-mobile`。
- `builder.common.buildPath` 为 `project://build`。
- `builder.common.scenes` 数量为 `8`。
- `builder.common.startScene` 为 `92ccbdcc-cf70-4f2f-842b-edbaf0a215f6`。
- 文件包含 `builder.taskOptionsMap`。

当前 CLI 对 `--build-config` 的读取事实：

- `src/commands/build.ts` 只执行 `readJSONSync(options.buildConfig)`，然后将读取结果与命令行 `options` 做 `Object.assign()`。
- 该逻辑没有识别 Creator profile schema 中的 `builder.common` / `builder.taskOptionsMap`，也没有把 `builder.common` flatten 成 build options。
- 因此，直接传入 `--build-config E:\own_space\engines\cocos-test-projects\profiles\v2\packages\web-mobile.json` 只能表示 CLI 可以读取 JSON，不能表示它按 Editor profile 语义使用了该配置。

CLI build task common options 的事实来源是 `src/core/builder/share/builder-config.ts` 中的 `commonOptionConfigs` 和 `src/core/builder/@types/public/options.ts` 中的 `IBuildCommonOptions` / `IBuildTaskOption`。当前可确认的 common build 字段包括：

- `platform`
- `name`
- `polyfills`
- `buildScriptTargets`
- `server`
- `sourceMaps`
- `experimentalEraseModules`
- `startSceneAssetBundle`
- `bundleConfigs`
- `buildPath`
- `debug`
- `mangleProperties`
- `inlineEnum`
- `md5Cache`
- `md5CacheOptions`
- `mainBundleIsRemote`
- `mainBundleCompressionType`
- `useSplashScreen`
- `bundleCommonChunk`
- `skipCompressTexture`
- `packAutoAtlas`
- `startScene`
- `outputName`
- `taskName`
- `scenes`
- `overwriteProjectSettings`
- `nativeCodeBundleMode`
- `wasmCompressionMode`
- `binGroupConfig`

`web-mobile` 平台专属 package options 的事实来源是 `src/core/builder/platforms/web-mobile/config.ts` 和 `src/core/builder/platforms/web-mobile/type.ts`。当前可确认字段包括：

- `packages["web-mobile"].useWebGPU`
- `packages["web-mobile"].orientation`
- `packages["web-mobile"].embedWebDebugger`

`profiles/v2/packages/web-mobile.json` 中可与 CLI 字段直接对应的字段：

| Creator profile 路径 | CLI build option 路径 | 字段名是否一致 | 语义判断 |
| --- | --- | --- | --- |
| `builder.common.polyfills` | `polyfills` | 一致 | 对得上，`web-mobile` 默认也会把 `polyfills.asyncFunctions` 设为 `true`。 |
| `builder.common.buildPath` | `buildPath` | 一致 | 对得上，`project://build` 是 CLI common 默认值。 |
| `builder.common.outputName` | `outputName` | 一致 | 对得上，用于输出目录名。 |
| `builder.common.mainBundleCompressionType` | `mainBundleCompressionType` | 一致 | 对得上，`web-mobile` 支持 `none`、`merge_dep`、`merge_all_json`。 |
| `builder.common.platform` | `platform` | 一致 | 对得上，值为 `web-mobile`。 |
| `builder.common.scenes` | `scenes` | 一致 | 基本对得上，CLI 只声明 `url` / `uuid`；profile 中部分 scene 额外带 `bundle`，属于 profile 扩展信息。 |
| `builder.common.startScene` | `startScene` | 一致 | 对得上，CLI 后续会按 uuid 或 url 查找 start scene asset。 |
| `builder.common.sourceMaps` | `sourceMaps` | 一致 | 对得上，profile 中为 boolean `true`，CLI 类型允许 `boolean | "inline"`。 |
| `builder.common.md5Cache` | `md5Cache` | 一致 | 对得上。 |
| `builder.common.useSplashScreen` | `useSplashScreen` | 一致 | 对得上。 |
| `builder.common.bundleConfigs` | `bundleConfigs` | 一致 | 基本对得上，CLI 声明包含 `root`、`name`、`output` 等；profile 中 `resources` 额外带 `uuid`。 |
| `builder.taskOptionsMap.<taskId>.useWebGPU` | `packages["web-mobile"].useWebGPU` | 叶子字段一致，路径不一致 | 语义对得上，但需要 adapter 移动到 `packages["web-mobile"]`。 |
| `builder.taskOptionsMap.<taskId>.orientation` | `packages["web-mobile"].orientation` | 叶子字段一致，路径不一致 | 语义对得上，取值 `auto` 在 CLI 支持范围内。 |
| `builder.taskOptionsMap.<taskId>.embedWebDebugger` | `packages["web-mobile"].embedWebDebugger` | 叶子字段一致，路径不一致 | 语义对得上。 |

`profiles/v2/packages/web-mobile.json` 中不能直接作为 CLI build task option 使用的字段：

- `__version__`：profile schema 版本，不是 CLI build task option。
- `builder`：Creator profile 外层命名空间，不是 CLI build task option。
- `builder.common`：字段内容可映射，但当前 CLI 不会自动读取这一层。
- `builder.taskOptionsMap`：字段内容可映射到 platform package options，但当前 CLI 不会自动选择 task id，也不会自动写入 `packages["web-mobile"]`。

因此，字段层面的结论是：`web-mobile.json` 中大多数 build 字段名与 CLI common options 同名，语义基本对得上；`web-mobile` 平台专属字段的叶子字段名和语义也对得上。结构层面的结论是：当前 `--build-config` 不支持 Creator profile wrapper，需要新增 profile adapter 才能等价使用该文件。

若要支持该 profile schema，建议的最小修改方向：

1. 在 `src/commands/build.ts` 或更靠近 builder 的配置加载层增加 `normalizeBuildConfig()`。
2. 当读取到的 JSON 具有 `builder.common` 时，判定为 Creator profile schema。
3. 将 `builder.common` flatten 到 CLI build options 顶层。
4. 根据 `platform` 选择 `builder.taskOptionsMap` 中对应 task；如果只有一个 task，可以作为默认 task；如果有多个 task，必须引入显式参数或规则，不能猜测。
5. 将选中的 task options 写入 `packages[platform]`，例如 `packages["web-mobile"] = { useWebGPU, orientation, embedWebDebugger }`。
6. 丢弃或保留为诊断信息但不传入校验流程的字段：`__version__`、`builder`、task 内部 `__version__`。
7. 复用现有 `pluginManager.checkOptions()` 做最终校验，不绕过 platform package option 校验。

为了尽量贴近用户成功构建时的 `web-mobile` 项目配置，本地改用项目配置系统执行：

```powershell
node .\dist\cli.js build --project 'E:\own_space\engines\cocos-test-projects' --platform web-mobile
```

执行前显式移除了当前 PowerShell 进程内的 `COCOS_CLI_TEST_PROJECT_ROOT`、`COCOS_CLI_TEST_ENGINE_ROOT`、`COCOS_CLI_TEST_EDITOR_LIBRARY_REF`、`COCOS_CLI_TEST_EDITOR_PROGRAMMING_REF`。

结果：

- 进程退出码：`1`。
- 日志文件：`E:\own_space\engines\cocos-test-projects\temp\logs\cocos-20260612095222.log`。
- 输出目录：`E:\own_space\engines\cocos-test-projects\build\web-mobile`。
- 本次输出目录被写入过，但构建失败后只保留了部分产物，不能视为完整成功产物。
- 用户安装 `localization-editor` 后，`db://localization-editor/l10n` 不再是 fatal blocker；`temp/cli/programming/packer-driver/logs/debug.log` 中可见该 domain 解析到 `extensions/localization-editor/static/assets/l10n.ts`。
- 构建仍在 `Package scripts` 阶段失败，新的 fatal blocker 为 `db://automation-framework/runtime/test-framework.mjs` 无法加载：

```text
Could not load db://automation-framework/runtime/test-framework.mjs
ENOENT: no such file or directory, open 'E:\own_space\engines\cocos-cli\db:\automation-framework\runtime\test-framework.mjs'
```

阶段性结论：

- 当前已能确认 `profiles/v2/packages/web-mobile.json` 是有效的 Creator profile 文件。
- 当前不能确认 CLI 的 `--build-config` 已支持该 profile schema；源码事实显示它尚未做 profile flatten / adapter。
- 当前 CLI build 启动 AssetDB 时会创建或更新项目 `library` 下与 CLI AssetDB 相关的目录和文件，例如 `library/cli`、`library/cli-extensions/<extensionName>`，以及 extension 自身需要的 library 记录。因此验证 build 前后应把 `library` 变化视为可能的运行副作用，不能把它当作源码修改。
- 在本地复跑环境中，安装 `localization-editor` 解决了前一个 db domain 缺失问题，但还缺少 `automation-framework` domain / package / mount 来源。用户侧构建成功与本地 CLI 构建失败的差异，需要优先核对 Editor 构建时是否加载了 `automation-framework` 相关 package。

### 2026-06-12 实现 Creator profile adapter 后复跑

源码变更：

- 新增 `src/commands/build-config.ts`，提供 `normalizeBuildConfigData()`。
- `normalizeBuildConfigData()` 在读取到 `builder.common` 时按 Creator profile schema 处理：
  - 将 `builder.common` flatten 到 CLI build options 顶层。
  - 读取 `builder.taskOptionsMap`。
  - 如果只有一个 task，默认使用该 task。
  - 如果有多个 task，要求显式指定 `taskId`，否则抛出错误。
  - 将选中的 task options 写入 `packages[platform]`。
  - 删除 task 内部 `__version__`，不把它传给 platform package option 校验。
- `src/commands/build.ts` 在读取 `--build-config` 后调用 `normalizeBuildConfigData()`，再保留原有“命令行 options 覆盖配置文件同名字段”的行为。
- `src/commands/build.ts` 新增 `--taskId <id>`，用于多 task Creator profile 的显式选择。
- 新增 `tests/commands/build-config.test.ts` 覆盖：
  - 单 task Creator profile flatten。
  - 平铺 CLI build config 不改写。
  - 多 task profile 可通过 `taskId` 选择。
  - 多 task profile 未提供 `taskId` 时抛错。
  - 命令行 `buildPath` / `outputName` 覆盖 Creator profile 中的同名字段。

验证命令：

```powershell
npx jest tests/commands/build-config.test.ts --runInBand
npx tsc -b
node .\dist\cli.js build --project 'E:\own_space\engines\cocos-test-projects' --platform web-mobile --build-config 'E:\own_space\engines\cocos-test-projects\profiles\v2\packages\web-mobile.json'
```

执行 build 前显式移除了当前 PowerShell 进程内的 `COCOS_CLI_TEST_PROJECT_ROOT`、`COCOS_CLI_TEST_ENGINE_ROOT`、`COCOS_CLI_TEST_EDITOR_LIBRARY_REF`、`COCOS_CLI_TEST_EDITOR_PROGRAMMING_REF`。

结果：

- `npx jest tests/commands/build-config.test.ts --runInBand` 通过，`5` 个测试全部通过。
- `npx tsc -b` 通过，`dist` 已更新。
- 直接传入 `profiles\v2\packages\web-mobile.json` 的 build 退出码为 `0`。
- 最新日志文件：`E:\own_space\engines\cocos-test-projects\temp\logs\cocos-20260612104942.log`。
- 日志关键行：
  - `run build task Package scripts success in 22 s`
  - `Build completed successfully for web-mobile in 41 s`
  - `Build Dest: project://build/web-mobile`
- 输出目录：`E:\own_space\engines\cocos-test-projects\build\web-mobile`。
- 输出目录文件统计：`913` 个文件，总大小 `213175443` bytes。

遗留日志噪声：

- 日志中仍有 `ReferenceError: Editor is not defined`。
- 日志中仍有 `Failed to resolve CommonJS bare specifier "@tbmp/mp-cloud-sdk"`，但当前实现会使用 fallback 并继续。
- 日志中仍有多条 `sprite frame can't be load:<uuid>@f9941, will remove it from atlas` 和对应 `Read json failed`，但最终 build 返回 `0`。

阶段性结论：

- 当前 CLI 已能通过 `--build-config E:\own_space\engines\cocos-test-projects\profiles\v2\packages\web-mobile.json` 等价读取该 Creator profile 的 common options 和 `web-mobile` task options，并完成 `web-mobile` 构建。
- 该验证不表示所有 Creator profile schema 都已完全支持；多 task profile 当前要求显式 `--taskId`。
- 该验证不解决默认项目配置路径下 `automation-framework` domain 缺失问题；它只证明用户指定的 `profiles/v2/packages/web-mobile.json` 作为 build config 时可跑通。

### 2026-06-12 增加输出路径覆盖参数并验证浏览器加载

源码变更：

- `src/commands/build.ts` 新增命令行参数：
  - `--buildPath <path>`：覆盖构建输出根目录。
  - `--outputName <name>`：覆盖构建输出文件夹名。
- `mergeBuildConfigData()` 保持“命令行 options 覆盖配置文件同名字段”的语义，因此 `--buildPath` / `--outputName` 会覆盖 `profiles/v2/packages/web-mobile.json` 中的 `builder.common.buildPath` / `builder.common.outputName`。

验证命令：

```powershell
npx jest tests/commands/build-config.test.ts --runInBand
$env:COCOS_CLI_TEST_ENGINE_ROOT='E:\own_space\engines\3.8.6'; cd vitests; npx vitest run suites/runtime-preview/preview-script-recovery.test.ts
npx tsc -b
node .\dist\cli.js build --project 'E:\own_space\engines\cocos-test-projects' --platform web-mobile --build-config 'E:\own_space\engines\cocos-test-projects\profiles\v2\packages\web-mobile.json' --buildPath 'project://build/codex-cli-output' --outputName 'codex-cjs-fallback-fixed'
```

结果：

- `npx jest tests/commands/build-config.test.ts --runInBand` 通过，`5` 个测试全部通过。
- `vitests/suites/runtime-preview/preview-script-recovery.test.ts` 通过，`14` 个测试全部通过。
- `npx tsc -b` 通过，`dist` 已更新。
- build 进程退出码为 `0`。
- 最新日志文件：`E:\own_space\engines\cocos-test-projects\temp\logs\cocos-20260612131329.log`。
- Build Dest：`project://build/codex-cli-output/codex-cjs-fallback-fixed`。
- 实际输出目录：`E:\own_space\engines\cocos-test-projects\build\codex-cli-output\codex-cjs-fallback-fixed`。
- 输出目录包含 `assets`、`cocos-js`、`remote`、`src`、`application.054e7.js`、`index.337df.js`、`index.html`、`style.f76d1.css`。

浏览器验证：

- 修复前，用 `codex-cjs-fallback-run` 产物打开页面可复现：

```text
Error: Current environment does not provide a require() for requiring '@tbmp/mp-cloud-sdk'.
```

- 当 CommonJS 代码实际执行该 unresolved bare specifier 时，fallback `export const __cjsMetaURL = '@tbmp/mp-cloud-sdk';` 仍会让 CommonJS loader 把 `@tbmp/mp-cloud-sdk` 当作 host module 处理；浏览器环境不存在 host `require()`，因此会报上述错误。
- 曾尝试把普通 build 使用的 Rollup plugin fallback 改为注册一个空 CJS module：

```text
import loader from 'cce:/internal/ml/cjs-loader.mjs';
loader.define(import.meta.url, function (_exports, _require, module) {
    module.exports = {};
});
export const __cjsMetaURL = import.meta.url;
```

- `codex-cjs-fallback-fixed` 产物中已确认 fallback module 包含 `module.exports = {};`，上层 `commonjs-bare-specifier.js` 的 resolve map 仍保留 `@tbmp/mp-cloud-sdk` 键，但目标值改为 fallback module 的 `__cjsMetaURL`。
- 使用 in-app Browser 打开临时静态服务 URL `http://127.0.0.1:6366/?retry=1781270198041`，页面标题为 `Cocos Creator | test-cases`，当前端口过滤后的 warning/error console 日志数量为 `0`，`Current environment does not provide a require()` 数量为 `0`，`@tbmp/mp-cloud-sdk` 相关 error 数量为 `0`。
- 验证过程中曾有一次 in-app Browser tab 进入 `This page crashed`，重开 fresh tab 后同一构建产物正常打开；因此最终结论以 fresh tab 的同端口日志为准。
- 后续复盘确认该空 CJS module 等价于 runtime mock，会把真实缺包分支执行时应暴露的问题隐藏掉；该改法已回退。

阶段性结论：

- `--buildPath` 决定输出根目录，`--outputName` 决定输出文件夹名；两者通过命令行参数覆盖 Creator profile 中的同名字段。
- 当前普通 build 和 runtime preview 的 CommonJS bare specifier fallback 已回退为同一个可见 CJS meta module：只导出原始 specifier 的 `__cjsMetaURL`。
- 该 fallback 只保证 unresolved CommonJS bare specifier 的编译/打包阶段可以继续并记录诊断；如果运行时实际执行缺失平台 SDK 分支，浏览器继续报 `Current environment does not provide a require()` 是合理暴露，不应由 CLI 注入空实现掩盖。

### 2026-06-15 `@tbmp/mp-cloud-sdk` fixture 修正

后续复盘发现，主测试项目中的 `assets/cases/scripting/commonjs-bare-specifier/commonjs-bare-specifier.js` 初版 fixture 与真实 `feature-c` 中的 `tdanalytics.mg.cocoscreator.min.js` 行为不一致：

- 初版 fixture 将 `require("@tbmp/mp-cloud-sdk")` 放在模块顶层，main entry 加载该 CJS facade 时会立即执行。
- 真实 `tdanalytics.mg.cocoscreator.min.js` 中该 `require()` 位于 platform proxy constructor 内，例如 `var e = require("@tbmp/mp-cloud-sdk"); this.cloud = new e.Cloud`；web 启动路径不一定实例化该 proxy。
- 真实文件 `.meta` 的 platform plugin 开关为 `loadPluginInWeb: true`、`loadPluginInNative: true`、`loadPluginInMiniGame: true`，初版 fixture 曾为 `false` 并额外带 `moduleId` / `simulateGlobals`。

已将 fixture 修正为：

```js
function createBytedanceCloudProxy() {
  const sdk = require('@tbmp/mp-cloud-sdk');
  return new sdk.Cloud();
}

module.exports = {
  createBytedanceCloudProxy,
};
```

同步将 fixture `.meta` 的 `loadPluginInWeb` / `loadPluginInNative` / `loadPluginInMiniGame` 设为 `true`，并移除初版 fixture 额外带入的 `moduleId` / `simulateGlobals`。

复验命令：

```powershell
node ./dist/cli.js build --project E:\own_space\engines\cocos-test-projects --platform web-mobile --build-config E:\own_space\engines\cocos-test-projects\profiles\v2\packages\web-mobile.json --buildPath E:\own_space\engines\cocos-test-projects\build --outputName codex-run-check-fixture-20260615
```

结果：

- build 退出码为 `0`，输出目录为 `E:\own_space\engines\cocos-test-projects\build\codex-run-check-fixture-20260615`。
- 构建日志仍记录 `Failed to resolve CommonJS bare specifier "@tbmp/mp-cloud-sdk"` 并使用 fallback；这是编译/打包期的预期诊断。
- 使用 in-app Browser 打开 `http://127.0.0.1:13332/`，页面标题为 `Cocos Creator | test-cases`，`canvasCount: 1`。
- 浏览器 warning/error 日志中按 `@tbmp`、`mp-cloud-sdk`、`Current environment`、`commonjs-bare-specifier` 过滤后数量为 `0`。
- 同次运行仍存在既有 `.anim` 资源 `assets/main/import/1f/1feeb8bd-de73-436b-bc5a-2f806ede2f16.json` 404，这与本 fixture 修正无关。

回退决策：

- 真实 `tdanalytics.mg.cocoscreator.min.js` 的 `require("@tbmp/mp-cloud-sdk")` 是延迟执行的 platform 分支，不会在 web 启动期必然执行。
- 因此主测试项目 fixture 应对齐真实文件，避免顶层立即 `require()`；CLI 不应为了该错误 fixture 注入 `module.exports = {}` 的 runtime mock。
- 当前已回退 `createCommonJSBareSpecifierFallbackSource()`：普通 build 与 runtime preview 都生成 `export const __cjsMetaURL = '<specifier>';`，保留编译继续和诊断，不模拟缺失 npm 包。
- 回归验证：`$env:COCOS_CLI_TEST_ENGINE_ROOT="E:\own_space\engines\3.8.6"; cd vitests; npx vitest run suites/runtime-preview/preview-script-recovery.test.ts` 通过，`14 tests`。
- CLI 编译验证：`npm run build` 通过，输出只包含既有 circular dependency warning。
- build 复验命令：

```powershell
node ./dist/cli.js build --project E:\own_space\engines\cocos-test-projects --platform web-mobile --build-config E:\own_space\engines\cocos-test-projects\profiles\v2\packages\web-mobile.json --buildPath E:\own_space\engines\cocos-test-projects\build --outputName codex-cjs-visible-meta-20260615
```

- build 退出码为 `0`，输出目录为 `E:\own_space\engines\cocos-test-projects\build\codex-cjs-visible-meta-20260615`；构建日志仍记录 `Failed to resolve CommonJS bare specifier "@tbmp/mp-cloud-sdk"`，这是保留的编译期诊断。
- 使用 in-app Browser 打开 `http://127.0.0.1:13333/?open=1781495718735`，页面标题为 `Cocos Creator | test-cases`，`canvasCount: 1`；warning/error 日志数为 `0`，按 `@tbmp`、`mp-cloud-sdk`、`Current environment`、`require()`、`commonjs-bare-specifier` 过滤后数量为 `0`。

### 2026-06-15 CLI build `.anim` CCON 资源运行时 404

用户反馈：同一主测试项目中，Editor 构建产物运行无资源加载报错，CLI 构建产物运行有资源加载报错。

复现和对比方式：

- Editor 产物目录：`E:\own_space\engines\cocos-test-projects\build\web-mobile`。
- 修复前 CLI 产物目录：`E:\own_space\engines\cocos-test-projects\build\codex-cjs-visible-meta-20260615`。
- 使用同一种 Python 静态服务分别打开两份产物，并通过 CDP Network 事件采集 HTTP 失败请求。

事实：

- Editor 产物 Network 失败请求数为 `0`。
- 修复前 CLI 产物有 3 个唯一资源重复 404：
  - `assets/main/import/1f/1feeb8bd-de73-436b-bc5a-2f806ede2f16.json`
  - `assets/main/import/db/db08659e-08bc-4f54-8872-8f696002de29.json`
  - `assets/main/import/e5/e5b2329c-bc9e-4bc1-8c40-a37ce95caaf1.json`
- 3 个 UUID 分别对应：
  - `assets/cases/animation/Animations/Easing_Linear.anim.meta`
  - `assets/cases/animation/Animations/Easing_Bounce.anim.meta`
  - `assets/cases/animation/Animations/Easing_Sine.anim.meta`
- 当前这 3 个 `.anim.meta` 的 `files` 均为 `[ ".cconb" ]`。
- Editor 产物中，3 个资源输出在 `assets/main/import/*.cconb`，并且 bundle config 的 `extensionMap[".cconb"]` 包含对应 UUID。
- 修复前 CLI 产物中，3 个资源输出在 `assets/main/native/*.cconb`，bundle config 的 `extensionMap` 为空，且这 3 个 UUID 位于 `versions.native`。

根因：

- `src/core/builder/worker/builder/utils/cconb.ts` 的 `hasCCONFormatAssetInLibrary()` 仍使用旧规则：只有 `meta.files === [".bin"]` 才认为是 CCON 资源。
- 但当前 `.anim` importer 已把 library 文件写为 `.cconb`。
- 因此 CLI build 没有走 CCON import 资源输出逻辑，也没有写入 `extensionMap[".cconb"]`；运行时只能按默认 `.json` 后缀请求 import 资源，最终 404。
- 进一步验证时，`BuildAssetLibrary.outputCCONAsset()` 也保留了旧断言 `originalExtname === ".bin"`，需要同步支持 `.cconb`。

修复：

- `hasCCONFormatAssetInLibrary()` 支持单文件 `.bin` 或 `.cconb`。
- `getCCONFormatAssetInLibrary()` 按 `asset.meta.files[0]` 返回真实 library 文件路径。
- `outputCCONAsset()` 输入扩展名允许 `.bin` 和 `.cconb`。
- `outputCCONFormat()` build 输出统一写 `.cconb`，与 `getDesiredCCONExtensionMap()` 和 Editor 产物一致。
- 新增 `vitests/suites/build/cconb-library-detection.test.ts` 覆盖 `.cconb`、历史 `.bin` 和普通 `.json` 三种识别行为。

验证：

```powershell
$env:COCOS_CLI_TEST_ENGINE_ROOT="E:\own_space\engines\3.8.6"
cd vitests
npx vitest run suites/build/cconb-library-detection.test.ts
```

结果：通过，`3 tests`。

```powershell
npm run build
```

结果：通过，输出只包含既有 circular dependency warning。

```powershell
node ./dist/cli.js build --project E:\own_space\engines\cocos-test-projects --platform web-mobile --build-config E:\own_space\engines\cocos-test-projects\profiles\v2\packages\web-mobile.json --buildPath E:\own_space\engines\cocos-test-projects\build --outputName codex-cconb-import-fix2-20260615
```

结果：

- build 退出码为 `0`，输出目录为 `E:\own_space\engines\cocos-test-projects\build\codex-cconb-import-fix2-20260615`。
- 3 个 `.anim` 输出到 `assets/main/import/*.cconb`。
- `assets/main/config.dcd3d.json` 中 `extensionMap[".cconb"]` 包含这 3 个 UUID。
- 这 3 个 UUID 位于 `versions.import`，不再位于 `versions.native`。
- 使用 in-app Browser 打开 `http://127.0.0.1:13335/?net=fix2-178149`，页面标题为 `Cocos Creator | test-cases`，`canvasCount: 1`，CDP Network 失败请求数为 `0`。
- 当前端口 `13335` 只剩 `ShieldNode.tiledLayer` 的既有 warning，无 `download failed` / `status: 404` 错误。

### 2026-06-13 `.meta` 变更来源补充记录

用户补充验证事实：

- 用户已验证此前主测试项目中大量 `.meta` 变更不是 CLI 写入导致。
- 用户已还原主测试项目后，用 Editor 打开项目，Editor 产生了大量 `.meta` 变更，数量约 `2700+`。
- 这批 Editor 打开项目产生的 `.meta` 变更已经由用户提交。

当前边界：

- 上述事实只能排除“此前观察到的大量 `.meta` 变更全部由 CLI build 导致”的判断。
- 当前仍未验证 CLI build 在上述 Editor `.meta` 迁移提交之后是否还会继续改 `.meta`。
- 后续仍需要专项验证：在已包含 Editor `.meta` 迁移提交的干净工作区上运行 CLI build，对比 build 前后 `.meta` 是否有新增变更，以及变更内容是否与 Editor 行为一致。
