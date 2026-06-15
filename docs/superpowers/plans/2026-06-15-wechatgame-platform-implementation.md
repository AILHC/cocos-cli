# `wechatgame` 平台重写实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 基于当前 CLI builder 架构、Cocos Creator 3.8.6 Editor 解包事实、`D:\workspace\engines\cocos\3.8.6` engine source 和已有平台实现，重写 `wechatgame` 平台，使 CLI 构建出的微信小游戏产物与 Editor 3.8.6 baseline 基本一致，并具备在 WeChat DevTools 中实际运行的条件。

**Architecture:** 新增内置平台包 `src/core/builder/platforms/wechatgame`，复用现有 `PluginManager`、builder hook、`BuildTemplate`、script build、setting/data/postprocess task 和 `buildEngineParam.separateEngineOptions` 管线。实现要还原 dump 出来的 `wechatgame` 业务意图，包括平台 option、模板生成、adapter、subpackage、high performance、separate engine 边界和 run stage 意图，但必须落在 CLI 现有 platform 扩展风格中；不复制 `.ccc` 生成物，不把 Editor runtime API 直接搬进 CLI。

**Tech Stack:** TypeScript, Node.js, Cocos CLI builder, Cocos Creator 3.8.6 engine source, Creator 3.8.6 app.asar extract, EJS, PowerShell, Vitest/Jest。

---

## 当前执行状态（2026-06-15）

- 已进入第一阶段实施；目标已校准为“CLI 构建产物与 Editor 3.8.6 baseline 基本一致，并具备 WeChat DevTools 手工打开运行所需结构”。
- 已完成普通 `wechatgame` 平台注册、schema、平台 hooks、engine template 渲染、adapter 输出、subpackage `game.js` 输出、remote bundle script 布局、CCON `.json/.bin` 输出和 miniGame explicit bundle config 行为隔离。
- 第一阶段 schema/type 只承诺 `appid`、`orientation`、`highPerformanceMode`；`buildOpenDataContextTemplate`、`separateEngine`、`localSeparateEngine`、`subpackages`、`wasmSubpackage` 仍是待验证/待实现的 Editor option 事实。
- 已新增并通过焦点 Jest：
  - `src/core/builder/test/ccon-output.spec.ts`
  - `src/core/builder/test/bundle-output.spec.ts`
  - `src/core/builder/test/wechatgame-platform.spec.ts`
  - `src/core/builder/test/build-script-common-dir.spec.ts`
- 已通过 `npm run build`、真实项目 CLI 构建和 `vitests/suites/build/wechatgame-editor-baseline-parity.test.ts`。
- 未完成项仍包括：项目自定义模板专项测试、`separateEngine`、`localSeparateEngine`、`wasmSubpackage`、`buildOpenDataContextTemplate`、完整 `run` stage、WeChat DevTools 人工运行验收。
- 自动化验证已经覆盖入口引用完整性、adapter SHA256、`game.json/project.config.json/settings` 语义、bundle config 存在性、subpackage root 和分区计数；最终运行仍需人工在 WeChat DevTools 打开 `E:\own_space\engines\cocos-test-projects\build\wechatgame-cli`。

## 文档归属

- Build 专题入口：`docs/dev/build/README.md`
- 事实来源清单：`docs/dev/build/facts/wechatgame-source-inventory-20260615.md`
- 本计划：`docs/superpowers/plans/2026-06-15-wechatgame-platform-implementation.md`

## 执行边界

- 本计划等待确认；确认前不实现、不运行构建、不移动静态资源。
- 文档使用中文；代码标识符、路径、命令、专业术语保留英文。
- 事实优先级为：当前 CLI 源码、`D:\workspace\engines\cocos\3.8.6` engine source、Creator 3.8.6 app.asar 解包文件、可重复构建产物。
- `.codex-tmp/restored-platforms/wechatgame` 只作为调查产物，不作为可直接复制的源码。
- `dist/hooks.ccc` 已确认没有业务逻辑，实施时不以它作为 hook 行为依据。
- `source/` 无可读源码，平台重写必须基于事实推导和当前 CLI 架构，不做闭源逻辑反混淆搬运。
- 项目自定义模板必须复用 CLI 现有 `BuildTemplate`，并验证 `build-templates/<taskName>`、`build-templates/wechatgame`、`build-templates/common` 的优先级。
- 测试或专项验证可用 `COCOS_CLI_TEST_ENGINE_ROOT=D:\workspace\engines\cocos\3.8.6`；production 默认 engine source 解析不得被测试路径反向污染。
- 自动化验证目标是证明 CLI 产物具备和 Editor baseline 等价的运行条件；最终“能运行”需要人工在 WeChat DevTools 中打开 CLI 产物验证。
- `run` stage 是“自动打开 WeChat DevTools”的便利功能，不等同于“产物可运行”。第一阶段即使暂不实现完整 `run` stage，CLI 构建出的目录也必须能被 WeChat DevTools 手工打开运行。
- 每个阶段完成后先做可重复验证，再进入下一阶段。

## 目标校准

- 不是只生成“结构接近”的小游戏目录。
- 不是只让 normalized diff 可解释。
- 不是把 dump 出来的 JS/TS 代码格式化后直接放进 CLI。
- 是把 dump 代码揭示的真实业务意图映射到 CLI 当前 platform 扩展架构中，并让产物在微信小游戏运行时具备与 Editor baseline 基本一致的启动链、配置语义、资源布局和加载关系。
- 自动化验收必须服务于运行目标：引用完整性、bundle version、adapter 内容、subpackage 布局、settings 语义和入口启动链任何一项错误，都可能导致 WeChat DevTools 中无法运行。

## 已确认事实

- Editor baseline 已由用户提供：
  - 构建产物：`E:\own_space\engines\cocos-test-projects\build\wechatgame`
  - 构建配置：`E:\own_space\engines\cocos-test-projects\buildConfig_wechatgame.json`
- 该 baseline 是 `debug=false`、`buildMode="normal"`、`md5Cache=true`、`sourceMaps=true`、`separateEngine=false`、`highPerformanceMode=true` 的 release/normal 构建。
- `wechatgame` Editor extension `package.json` 声明 `contributions.builder: "./dist/build.js"`、`main: "./dist/main.js"`、`messages.run.methods: ["run"]`。
- 可见 `IOptions` 包含 `appid`、`buildOpenDataContextTemplate`、`orientation`、`separateEngine`、`highPerformanceMode`、`subpackages`、`wasmSubpackage`、`localSeparateEngine`。
- `static/view.html` 只覆盖 Editor UI 中的 `separateEngine`、`localSeparateEngine`、`highPerformanceMode`。
- `static/cocos/plugin.json` 和 `signature.json` 是分离引擎插件静态文件。
- `main.js` 的 `run` 意图是定位 WeChat DevTools CLI 并执行 `cli -o <output> -f cocos`。
- `separate-engine.js` 的业务意图是通过 `@cocos/ccbuild` 构建微信 engine plugin，并写入 `meta.json`、`options.json`、`plugin/plugin.json`、`plugin/signature.json`。
- CLI 已有 `buildEngineParam.separateEngineOptions` 和 `buildSplitEngine` 管线，不应复制 Editor extension 里的老式 `buildCocos` 实现。
- `D:\workspace\engines\cocos\3.8.6\templates\wechatgame` 提供 `game.ejs`、`cocos-script.ejs`、`project.config.json`、`game.json`、`first-screen.ejs`、`patch.json` 和图片资源。
- `D:\workspace\engines\cocos\3.8.6\bin\adapter\minigame\wechat` 提供 `web-adapter.js`、`web-adapter.min.js`、`engine-adapter.js`、`engine-adapter.min.js`。
- CLI `BuildTemplate` 已支持项目级自定义模板，查找顺序为 `build-templates/<taskName>`、`build-templates/<platform>`、`build-templates/common`。
- `SchemaBuildOption` 当前对未知 platform 有 `SchemaOtherPlatformBuildOption` 兜底，但新增 `wechatgame` 专属 schema 仍需要纳入实现决策。
- baseline 根目录包含 `game.js`、`game.json`、`project.config.json`、`web-adapter.js`、`engine-adapter.js`、`first-screen.js`、`application.<hash>.js`、`logo.png`、`slogan.png`。
- baseline release/normal 构建输出的 adapter 文件名是 `web-adapter.js`、`engine-adapter.js`，但 SHA256 确认其内容分别等于 engine source 中的 `web-adapter.min.js`、`engine-adapter.min.js`。
- baseline `game.json` 写入 `deviceOrientation="portrait"`、`iOSHighPerformance=true`，并声明四个 subpackages：`sub-pack-01`、`sub-pack-02`、`subPackage`、`TestBundle`。
- baseline `game.js` 启动链包含 `require('./web-adapter')`、`require('./first-screen')`、`src/polyfills.bundle.<hash>.js`、`src/system.bundle.<hash>.js`、`src/import-map.<hash>.js`、`System.import('./application.<hash>.js')`，并在 `application.init(cc)` 前 `require('./engine-adapter')`。
- baseline 文件分区计数为 `assets=37`、`cocos-js=13`、`remote=447`、`root=9`、`src=11`、`subpackages=4`。

## 待验证问题

- 当前 CLI script build 产物中的 `applicationJs`、`polyfillsBundleFile`、`systemJsBundleFile`、`importMap` 字段名和路径是否能直接满足 `templates/wechatgame/*.ejs`。
- `result.paths`、`result.settings`、bundle 输出结构与微信模板期望路径之间是否存在差异。
- `miniGame` bundle group、压缩组、texture compression、subpackages 在 CLI 内的真实配置入口和 Editor `wechatgame` 选项是否一一对应。
- `buildOpenDataContextTemplate` 在 Creator 3.8.6 的真实产物语义是否需要同时生成 open data context 目录；当前事实不足，不能默认实现。
- `localSeparateEngine` 与 `separateEngine` 在当前 CLI 的 production 语义是否存在等价能力；不能只按 Editor UI 名称推断。
- `run` stage 的 `wechatDevtools` 路径在 CLI 中应来自配置、环境变量还是显式参数；未确认前只实现可测试的路径解析函数或暂缓实现。
- 是否应把 `static/cocos/plugin.json`、`signature.json` 纳入 CLI 仓库静态资源，需确认来源、许可和版本维护策略。
- baseline 中 `subpackages` 的来源需要进一步追到 bundle 配置和 Editor 平台 hook，不能仅由 `game.json` 反推 CLI 默认行为。
- baseline 中 `assets.subpackages=[]` 但 `game.json.subpackages` 非空，需要确认这是微信平台模板层语义还是 settings 层语义差异。
- adapter 规则必须区分“产物文件名”和“内容来源”：baseline release/normal 构建使用非 `.min` 输出文件名，但内容来自 engine 的 `.min.js` 文件。

## 文件职责

- Read: `docs/dev/build/facts/wechatgame-source-inventory-20260615.md`
  - 实施前必须复核事实来源和待验证项。
- Add: `src/core/builder/platforms/wechatgame/index.ts`
  - 导出 `wechatgame` 平台配置。
- Add: `src/core/builder/platforms/wechatgame/config.ts`
  - 定义平台 display options、bundle groups、texture compress groups、`customBuildStages` 和 `buildTemplateConfig`。
- Add: `src/core/builder/platforms/wechatgame/type.ts`
  - 定义 `IWechatGameBuildOptions`、`IWechatGameInternalBuildOptions` 和平台内部中间数据类型。
- Add: `src/core/builder/platforms/wechatgame/hooks.ts`
  - 接入 `onAfterInit`、`onAfterBundleInit`、`onBeforeCompressSettings`、`onBeforeCopyBuildTemplate`、`onAfterBuild` 等平台生命周期。
- Add: `src/core/builder/platforms/wechatgame/utils.ts`
  - 封装 engine template 解析、adapter 解析、EJS 渲染参数、JSON 合并、路径规范化。
- Add optional after validation: `src/core/builder/platforms/wechatgame/run.ts`
  - 仅承载 WeChat DevTools CLI 路径解析和命令参数纯函数；`hooks.ts` 必须 export/forward `run`，因为 `customBuildStages` 按 hook 名称调用。
- Modify after validation: `src/api/builder/schema.ts`
  - 增加 `SchemaWechatGameBuildOption`，或记录为何继续使用 `SchemaOtherPlatformBuildOption`。
- Modify after validation: `src/core/builder/@types/public/platform-options.ts`
  - 导出 `WechatGameBuildOptions`。
- Modify after validation: `src/core/builder/@types/config-export.ts`
  - 让 `cocos.config.json` 可类型化声明 `wechatgame` 配置。
- Add optional: `static/build-templates/wechatgame/**`
  - 只有确认需要内置 Creator 静态资源且来源可维护时才新增。
- Add tests under existing test organization
  - 实施时先读取 `package.json`、`vitests/package.json` 和既有 builder 测试目录，再选择具体测试文件位置。
- Add: `vitests/suites/build/wechatgame-editor-baseline-parity.test.ts`
  - 承载 Editor baseline parity 的可执行验证入口，读取 baseline env、CLI 输出目录 env 和 normalized diff helper。
- Add optional: `vitests/shared/wechatgame-baseline-parity.ts`
  - 封装 JSON 归一化、路径 hash 归一化、引用完整性检查、分区计数和 SHA256 比较。

## Task 1: 建立失败测试和目标产物基线

- [ ] 读取 `package.json`、`vitests/package.json` 和现有 builder 测试组织，确认单元测试、集成测试命令。
- [ ] 用 `COCOS_CLI_TEST_ENGINE_ROOT=D:\workspace\engines\cocos\3.8.6` 建立最小测试 fixture，确保测试不依赖开发机历史缓存。
- [ ] 增加平台注册失败测试：`pluginManager.getOptionsByPlatform('wechatgame')` 应能返回平台默认配置。
- [ ] 增加普通构建 hook 失败测试：给定最小 `IInternalBuildOptions` 和 mock `IBuildResult`，应生成微信小游戏入口文件、JSON 配置和 adapter 拷贝计划。
- [ ] 增加自定义模板失败测试：当项目存在 `build-templates/wechatgame/game.ejs` 或 taskName 模板时，平台渲染必须优先使用项目模板，并通过 `initUrl()` 避免 raw `.ejs` 被二次复制。
- [ ] 增加 schema 失败测试：`platform: "wechatgame"` 携带 `appid`、`orientation` 等字段时应通过 API 校验，未知字段策略与现有平台一致。

## Task 2: 接入平台注册和类型

- [ ] 新建 `src/core/builder/platforms/wechatgame` 目录，按现有平台包风格导出 `config`、`hooks`、`type`。
- [ ] 在 `config.ts` 中声明 `platform: "wechatgame"`、display options、默认选项和必要 build groups。
- [ ] 按事实文档定义选项边界：第一阶段支持 `appid`、`orientation`、`highPerformanceMode`，并支持当前 baseline 所需的最小 subpackage layout 与 `game.json.subpackages` 生成；`separateEngine` 只做选项透传准备；`buildOpenDataContextTemplate`、`subpackages` 的完整配置语义、`wasmSubpackage` 暂时标记待验证。
- [ ] 修改公开类型导出，让项目配置和 API 调用可引用 `WechatGameBuildOptions`。
- [ ] 修改 `src/api/builder/schema.ts`，新增或明确跳过 `SchemaWechatGameBuildOption`；如果跳过，必须在事实文档补充原因。

## Task 3: 实现 engine template 和 adapter 解析

- [ ] 在 `utils.ts` 中实现 engine root 读取，优先使用 CLI 现有 engine source 解析链路，测试中只允许通过 `COCOS_CLI_TEST_ENGINE_ROOT` 覆盖。
- [ ] 读取 `D:\workspace\engines\cocos\3.8.6\templates\wechatgame` 的模板清单，不硬编码开发机绝对路径。
- [ ] 实现 `findWechatTemplateFile()`，查找顺序为 `BuildTemplate.findFile()` 优先，然后 engine template fallback。
- [ ] 对需要平台渲染的 `.ejs` 调用 `BuildTemplate.initUrl()`，避免项目模板原文件在 copy template 阶段被复制到产物。
- [ ] 实现 adapter 选择：产物文件名固定为 `web-adapter.js`、`engine-adapter.js`；release/normal baseline 使用 engine source 中 `.min.js` 的内容复制到上述非 `.min` 文件名。
- [ ] 如果 debug 构建 adapter 内容来源无法验证，第一阶段只固定 release/normal baseline 行为，并在待验证项中保留 debug 规则。

## Task 4: 实现普通微信小游戏构建输出

- [ ] 在 `onAfterInit` 或相邻 hook 中初始化微信平台中间状态，包括输出根、模板路径、adapter 路径和 appid/orientation。
- [ ] 在 `onAfterBundleInit` 中设置小游戏 bundle group、资源路径和平台相关构建参数。
- [ ] 在 `onBeforeCompressSettings` 中检查 settings 压缩前需要注入或改写的微信配置，避免后处理阶段再解析压缩产物。
- [ ] 在 `onBeforeCopyBuildTemplate` 中渲染 `game.js`、`cocos-js` 片段、`game.json`、`project.config.json` 和必要首屏模板。
- [ ] 在平台配置或 hook 中明确 `md5CacheOptions` 策略：`game.js` 必须作为 template/replaceOnly 入口参与引用替换，`application.*.js`、`src/import-map.*.js`、`src/polyfills.bundle.*.js`、`src/system.bundle.*.js` 的 hash 文件名必须能回写到 `game.js`。
- [ ] 在 `onAfterBuild` 中复制 `web-adapter`、必要图片、`patch.json` 和其它非 EJS 静态资源。
- [ ] 输出目录结构必须与微信开发者工具可识别结构一致，至少包含 `game.js`、`game.json`、`project.config.json`、adapter 和当前 baseline 的四个 `subpackages/<name>/game.js`。

## Task 5: 支持项目自定义模板

- [ ] 覆盖 `build-templates/wechatgame/game.ejs` 自定义入口模板。
- [ ] 覆盖 `build-templates/common/game.json` 公共模板，并验证平台模板优先级高于 common。
- [ ] 覆盖 `build-templates/<taskName>/project.config.json`，验证 taskName 模板优先级最高。
- [ ] 对 JSON 模板实现结构化 merge 或明确 replace 语义，不能用脆弱字符串拼接。
- [ ] 为 `appid`、`orientation`、`highPerformanceMode` 的模板变量增加测试。

## Task 6: 接入 `separateEngine`，但不复制旧实现

- [ ] 先验证当前 CLI `build-task/script.ts` 如何消费 `options.buildEngineParam.separateEngineOptions`。
- [ ] 将 `separateEngine: true` 映射为 `buildEngineParam.separateEngineOptions`，平台只准备微信目标参数，不直接调用 `@cocos/ccbuild`。
- [ ] 复用 CLI `buildSplitEngine` 产物，生成微信 engine plugin 所需引用关系。
- [ ] 如果需要 `static/cocos/plugin.json`、`signature.json`，先确认是否纳入 `static/build-templates/wechatgame/cocos`；不能从 `.codex-tmp` 临时目录运行时读取。
- [ ] 将 verify 规则写成明确条件：`separateEngine && !debug` 时要求 engine info 中的 TypeScript engine 类型等价于 Editor 的 `builtin`；`debug=true` 或 `separateEngine=false` 时不触发该限制。
- [ ] 为 `separateEngine` 增加单元测试和可选集成测试；集成测试可用 engine root 覆盖，但不能要求真实微信开发者工具。

## Task 7: 处理 `run` stage

- [ ] 先记录 CLI 中当前 `customBuildStages` 的参数来源和 `requiredBuildOptions` 行为。
- [ ] 明确 `wechatDevtools` 路径来源：配置文件、环境变量、命令参数三者选一或组合；未确认前不默认扫描本机安装路径。
- [ ] 实现 WeChat DevTools CLI 路径解析函数，Windows 使用 `cli.bat`，其它平台使用 `cli`。
- [ ] `run` stage 只执行 `-o <output> -f cocos`，错误信息必须包含缺失路径和可操作配置项。
- [ ] 为路径解析和命令参数生成增加单元测试；不在 CI 中启动真实微信开发者工具。

## Task 8: Editor parity 与运行验收

- [ ] 固定 Editor baseline 输入：
  - `baselineDir = E:\own_space\engines\cocos-test-projects\build\wechatgame`
  - `baselineConfig = E:\own_space\engines\cocos-test-projects\buildConfig_wechatgame.json`
  - CLI 输出目录使用独立路径，例如 `E:\own_space\engines\cocos-test-projects\build\wechatgame-cli`，禁止覆盖 baseline。
- [ ] 新增可执行 parity 测试入口：
  - 测试文件：`vitests/suites/build/wechatgame-editor-baseline-parity.test.ts`
  - 可选 helper：`vitests/shared/wechatgame-baseline-parity.ts`
  - 必需 env：`COCOS_CLI_WECHATGAME_BASELINE_DIR=E:\own_space\engines\cocos-test-projects\build\wechatgame`
  - 必需 env：`COCOS_CLI_WECHATGAME_BASELINE_CONFIG=E:\own_space\engines\cocos-test-projects\buildConfig_wechatgame.json`
  - 必需 env：`COCOS_CLI_WECHATGAME_OUTPUT_DIR=E:\own_space\engines\cocos-test-projects\build\wechatgame-cli`
  - 必需 env：`COCOS_CLI_TEST_ENGINE_ROOT=D:\workspace\engines\cocos\3.8.6`
- [ ] CLI 构建命令：
  - `rtk pwsh -NoProfile -Command '$env:COCOS_CLI_TEST_ENGINE_ROOT="D:\workspace\engines\cocos\3.8.6"; npm run build; node dist/cli.js build --project "E:\own_space\engines\cocos-test-projects" --platform wechatgame --build-config "E:\own_space\engines\cocos-test-projects\buildConfig_wechatgame.json" --buildPath "E:\own_space\engines\cocos-test-projects\build" --outputName wechatgame-cli'`
  - Expected: CLI 构建成功，输出目录为 `E:\own_space\engines\cocos-test-projects\build\wechatgame-cli`，不修改 `E:\own_space\engines\cocos-test-projects\build\wechatgame`。
- [ ] parity 测试命令：
  - `rtk pwsh -NoProfile -Command '$env:COCOS_CLI_WECHATGAME_BASELINE_DIR="E:\own_space\engines\cocos-test-projects\build\wechatgame"; $env:COCOS_CLI_WECHATGAME_BASELINE_CONFIG="E:\own_space\engines\cocos-test-projects\buildConfig_wechatgame.json"; $env:COCOS_CLI_WECHATGAME_OUTPUT_DIR="E:\own_space\engines\cocos-test-projects\build\wechatgame-cli"; $env:COCOS_CLI_TEST_ENGINE_ROOT="D:\workspace\engines\cocos\3.8.6"; Push-Location vitests; npm run test -- suites/build/wechatgame-editor-baseline-parity.test.ts; Pop-Location'`
  - Expected: 所有结构、JSON 语义、引用完整性、adapter SHA256 和 normalized diff 断言通过。
- [ ] 输入配置验证：
  - `platform` 必须为 `wechatgame`。
  - `debug` 必须为 `false`。
  - `md5Cache` 必须为 `true`。
  - `sourceMaps` 必须为 `true`。
  - `packages.wechatgame.orientation` 必须为 `portrait`。
  - `packages.wechatgame.appid` 必须为 `wx6ac3f5090a6b99c5`。
  - `packages.wechatgame.highPerformanceMode` 必须为 `true`。
  - `packages.wechatgame.separateEngine` 必须为 `false`，第一阶段不得生成 engine plugin 产物。
- [ ] 根目录结构验证：
  - CLI 输出必须包含 `game.js`、`game.json`、`project.config.json`、`web-adapter.js`、`engine-adapter.js`、`first-screen.js`、`logo.png`、`slogan.png`。
  - CLI 输出必须包含一个且仅一个 `application.*.js`。
  - CLI 输出的 `web-adapter.js` SHA256 必须等于 `D:\workspace\engines\cocos\3.8.6\bin\adapter\minigame\wechat\web-adapter.min.js`。
  - CLI 输出的 `engine-adapter.js` SHA256 必须等于 `D:\workspace\engines\cocos\3.8.6\bin\adapter\minigame\wechat\engine-adapter.min.js`。
- [ ] `game.json` 语义验证：
  - JSON parse 后比较，不做文本格式比较。
  - `deviceOrientation === "portrait"`。
  - `iOSHighPerformance === true`。
  - `subpackages` 必须包含四项：`sub-pack-01`、`sub-pack-02`、`subPackage`、`TestBundle`。
  - 每个 `subpackages[*].root` 必须指向实际存在的 `subpackages/<name>/` 目录。
- [ ] `project.config.json` 语义验证：
  - JSON parse 后比较，不做文本格式比较。
  - `appid === "wx6ac3f5090a6b99c5"`。
  - `compileType === "game"`。
  - `miniprogramRoot === "./"`。
  - `projectname === "test-cases"`。
- [ ] `game.js` 启动链验证：
  - 包含 `require('./web-adapter')`。
  - 包含 `require('./first-screen')`。
  - 包含 `require("src/polyfills.bundle.<hash>.js")`。
  - 包含 `require("src/system.bundle.<hash>.js")`。
  - 包含 `require("src/import-map.<hash>.js").default`。
  - 包含 `System.import('./application.<hash>.js')`。
  - `require('./engine-adapter')` 必须发生在 `application.init(cc)` 前。
  - Android 分支必须通过 `GameGlobal.requestAnimationFrame(__initApp)` 延迟启动。
- [ ] 引用完整性验证：
  - 从 `game.js` 抽取 `require()`、`System.import()`、`importMapUrl` 中的本地路径，确认目标文件存在。
  - 从 `application.*.js` 抽取 `settingsPath`，确认 `src/settings.*.json` 存在。
  - 从 `src/settings.*.json` 抽取 `plugins.jsList` 和 `scripting.scriptPackages`，确认目标文件存在。
  - 从 `assets.bundleVers` 抽取 bundle version，确认 `assets/<bundle>/config.<hash>.json` 或 `remote/<bundle>/config.<hash>.json` 与实际文件一致。
- [ ] 分区和资源布局验证：
  - 根分区至少包含 `root`、`assets`、`cocos-js`、`remote`、`src`、`subpackages`。
  - 对比 baseline 分区文件数：`assets=37`、`cocos-js=13`、`remote=447`、`root=9`、`src=11`、`subpackages=4`。
  - 文件数差异不直接判失败，先分类为 hash 差异、构建链差异、平台 hook 缺失或资源布局错误。
- [ ] subpackages 验证：
  - `subpackages/sub-pack-01/game.js` 存在。
  - `subpackages/sub-pack-02/game.js` 存在。
  - `subpackages/subPackage/game.js` 存在。
  - `subpackages/TestBundle/game.js` 存在。
  - 第一阶段可接受 subpackage `game.js` 内容为 `console.log('ejs: no script in subPackage.')`，但必须记录该内容来自 baseline。
- [ ] `src/settings.*.json` 语义验证：
  - `engine.platform === "wechatgame"`。
  - `engine.debug === false`。
  - `assets.remoteBundles` 包含 `resources`。
  - `assets.subpackages` 在当前 baseline 下必须精确等于空数组 `[]`。
  - `assets.preloadBundles` 包含 `start-scene`、`resources`、`main`。
  - `assets.bundleVers` 中 `internal`、`main`、`resources`、`start-scene` 的 hash 与实际 config/index 文件名一致。
  - `plugins.jsList` 指向文件存在。
  - `scripting.scriptPackages` 指向文件存在。
  - `launch.launchScene` 与 `buildConfig_wechatgame.json` 中的 `startScene` / `scenes` 关系一致。
- [ ] normalized diff：
  - 对 JSON 文件使用 parse 后排序 key 的 normalized JSON diff。
  - 对 `game.js` 使用路径 hash 占位符归一化，例如将 `application.<hash>.js` 归一成 `application.<HASH>.js`。
  - 对静态资源、adapter 和图片文件使用 SHA256 比较。
  - 对 source map、bundle JS、资源 hash 文件不做第一阶段逐字节必过条件，除非已确认 CLI 构建链与 Editor 完全同源。
- [ ] 运行条件自动化验收：
  - `game.js` 中所有本地入口引用都能解析到 CLI 输出目录内实际文件。
  - `src/import-map.<hash>.js` 中的映射目标能解析到 `cocos-js`、`src` 或 bundle script 实际文件。
  - `src/settings.<hash>.json` 中的 `assets.bundleVers`、`plugins.jsList`、`scripting.scriptPackages` 均指向实际存在的文件。
  - `game.json.subpackages[*].root` 均指向实际存在的 subpackage 目录，且每个目录有 `game.js`。
  - root、`assets`、`remote`、`src`、`cocos-js`、`subpackages` 的布局满足微信小游戏运行时加载路径，不能只满足文件数。
- [ ] WeChat DevTools 手工验收记录：
  - 用 WeChat DevTools 打开 `E:\own_space\engines\cocos-test-projects\build\wechatgame-cli`。
  - 项目配置识别为小游戏，`appid`、`projectname`、`miniprogramRoot` 与 baseline 语义一致。
  - 编译后没有入口文件缺失、adapter 缺失、settings 缺失、bundle config 缺失、subpackage root 缺失等阻断错误。
  - 首屏流程能进入 `Application` 启动，至少启动到 baseline 的 `launchScene`。
  - 如运行失败，记录 WeChat DevTools 控制台错误、缺失文件路径和与 baseline 的差异归因；不能仅记录“人工测试失败”。
- [ ] 差异记录：
  - 对无法完全一致的字段记录原因：CLI 架构差异、Editor-only 配置、已确认非业务字段或待补实现。
  - 将 baseline 验证摘要追加到 `docs/dev/build/facts/wechatgame-source-inventory-20260615.md` 或新增同主题 facts 文档。

## Task 9: 最终验证和文档回填

- [ ] 运行平台相关单元测试。
- [ ] 运行 builder 相关集成测试或最小构建命令。
- [ ] 运行 typecheck/lint，命令以仓库 `package.json` 和 `vitests/package.json` 为准。
- [ ] 更新 `docs/dev/build/facts/wechatgame-source-inventory-20260615.md`，记录新增事实、实现边界和仍未支持项。
- [ ] 如新增 public API 或配置字段，更新 `docs/dev/modules/builder.md` 或相邻稳定模块文档。
- [ ] 检查 `git diff`，确认没有修改 `.codex-tmp` 生成物、用户项目缓存、资源 `.meta` 或无关文件。

## 第一阶段建议范围

- 先实现普通 `wechatgame` 构建输出、schema/types、自定义模板支持、Editor baseline parity 验证矩阵和 WeChat DevTools 手工运行验收记录。
- `separateEngine` 在普通构建可验证后单独进入第二阶段。
- `run` stage 在明确 `wechatDevtools` 配置来源后单独进入第三阶段；它不阻塞第一阶段“产物可被手工打开运行”的目标。
- 当前 baseline 所需的四个微信 subpackage 目录和 `game.json.subpackages` 纳入第一阶段；`subpackages` 配置项的完整 Editor 语义、`buildOpenDataContextTemplate`、`wasmSubpackage` 暂不纳入第一阶段。

## 暂停点

- 完成本计划记录后暂停，等待确认。
- 确认后优先执行 Task 1 到 Task 5，并用 Task 8 的 Editor parity 与运行验收标准判断是否形成闭环。
- Task 6 和 Task 7 需要在第一阶段结果可验证后再次确认范围。
