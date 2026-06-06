# Runtime Preview Old Implementation Review

记录时间：2026-06-06

## 分类标准

| 分类 | 含义 |
| --- | --- |
| 事实可复用 | 与 engine / CLI AssetDB / old editor / frozen artifact 事实一致，可迁移为新实现输入或测试样本 |
| 业务意图保留 | 目标正确，但实现方式需要重写 |
| 实现方式废弃 | 与已确认事实冲突，不能迁移 |
| 待源码验证 | 当前证据不足，不能下结论 |

## CLI old implementation

| 文件/符号 | 分类 | 原因 | 后续动作 |
| --- | --- | --- | --- |
| `src/commands/preview.ts` 的 `--runtime` / `--host` / `--port` / `--scene` / `--open` | 业务意图保留 | 旧实现提供 CLI 入口和参数形态，符合当前目标的启动入口；但具体 startup 顺序要按当前 `adapter-to-386`、`GlobalPaths.enginePath`、runtime context/settings/HTTP-base URL capture 链重写 | 新实现保留命令意图，测试覆盖 startup 参数、日志、端口释放 |
| `src/core/launcher.ts#startRuntimePreview()` | 业务意图保留 | 旧实现记录 project/engine/host/port/scene，启动 server 后把 `engineServerUrl` 传给 `this.import(..., { serverURL })`，再初始化 engine、AssetDB、builder；当前 CLI engine 会用 `serverURL` 设置 `overrideSettings.assets.server`、`importBase`、`nativeBase`、`remoteBundles` | 重新实现为：解析 project/engine/library/programming -> 建立 runtime context 和 `PreviewSettingsProvider` -> 启动 HTTP -> 用 server URL 初始化 engine/settings -> 短链路测试；不能依赖旧 resolver |
| `src/runtime-preview/runtime-preview-logger.ts` | 事实可复用 | 日志写入 `<project>/temp/preview-logs/runtime-preview-*.log`，记录 startup stage，符合诊断需求 | 可迁移简化版本，确保日志包含 project root、engine root、library root、programming root、server URL |
| `src/runtime-preview/core-adapter.ts#getRuntimePreviewSettings()` | 业务意图保留 | 通过 current CLI `getPreviewSettings()` 获取 `settings`、`script2library`、preview `bundleConfigs`，方向正确 | 新实现必须同时记录 preview `bundleConfigs` 的限制：不等于完整 build artifact contract |
| `src/runtime-preview/runtime-preview-state.ts` | 业务意图保留 | 缓存 settings、按 scene 切换、暴露 `getBundleConfig()` / `getScriptLibrary()`，符合 server 状态模型 | 可保留缓存意图；缓存对象应换成 `RuntimePreviewContext` provider handles、bounded caches 和 settings outputs |
| `runtime-preview-state.ts` 强制 `settings.rendering.renderMode = WEBGL` | 待源码验证 | 旧实现为避免 AUTO 选择 WebGPU，但这属于 runtime 行为策略，不是 engine/CLI 事实 | 在 browser smoke 或 engine-source probe 中验证是否仍需要；未验证前不写入核心 contract |
| `runtime-preview.middleware.ts#/settings.js` | 业务意图保留 | 返回 `window._CCSettings = ...` 与 old editor route 一致 | 保留 route contract；settings 来源换成 Task 11 outputs |
| `runtime-preview.middleware.ts#/scene/*.json` | 事实可复用 | 通过 AssetDB query 找 scene 的 `library[".json"]`，与 old editor 和 CLI `asset.library` 事实一致 | 纳入 conditional route；要求 scene JSON 路径来自 AssetDB/runtime context，并由 captured request 或明确需求触发 |
| `runtime-preview.middleware.ts#/assets/*/config.json` | 业务意图保留 | 从 cached `bundleConfigs` 按 bundle name 返回 config，符合 engine `loadBundle()` 入口 | 新实现必须从 `PreviewSettingsProvider` / settings 派生 config，并补齐 preview config 缺失项或标待验证 |
| `runtime-preview.middleware.ts#/assets/*/index.js` dummy System.register | 业务意图保留 | old editor 也有 dummy bundle script；engine `loadBundle()` 会请求 bundle index | 内容必须以 engine `downloader` / `loadBundle()` 行为验证；不能只因为旧实现存在就迁移 |
| `runtime-preview.middleware.ts#resolveLibraryFile()` | 实现方式废弃 | 按 `<project>/library`、`COCOS_CLI_INTERNAL_LIBRARY`、uuid directory fallback 和请求尾部猜文件；这是 resolver-first/path guessing，不是 fact-backed request-time resolution | 禁止迁移；改为 `HTTP-base captured runtime URL -> route fact source -> on-demand resolver -> absolute artifact path` |
| `runtime-preview.middleware.ts#getPreviewImportReplacementExt()` 和 `/query-extname/*` | 实现方式废弃 | 用图片扩展、`.cconb`、`.bin` 猜 import replacement，和“不靠 extname 决定 import/native”原则冲突 | 仅作为旧兼容痕迹记录；测试应覆盖 import/native negative cases |
| `runtime-preview.middleware.ts#/remote/internal/cc.config.json` 手写 internal config | 实现方式废弃 | 手写 `importBase/nativeBase/uuids/paths/packs/versions/redirect`，来源不是 `getPreviewSettings()` / engine config / runtime context，容易漏 `extensionMap`、`zipVersion`、`dependencyRelationships` 等字段 | internal bundle config 必须由 settings / engine / AssetDB 事实生成 |
| `runtime-preview.middleware.ts#/remote/internal/(import|native)` 返回文件路径字符串 | 实现方式废弃 | 旧代码 `res.status(200).send(file)`，不是 `sendFile()`，且 mapping 仍来自 resolver-first | 不迁移 |
| `runtime-preview.middleware.ts#/plugins/*` | 业务意图保留 | 通过 `script2library` 找项目脚本 library 文件，与 CLI `getPreviewSettings()` 事实一致 | 新实现用 script manifest / programming index 提供，并测试 `dependScripts` |
| `runtime-scripting.middleware.ts#/scripting/import-map-global` | 事实可复用 | 通过 `ProgrammingFacet#getGlobalImportMap()` 提供 `cc`、`cc/env`、`cc/userland/macro` 等 static import map | 保留 route 意图；由 `ProgrammingProvider` lazy 提供 static import map 与 custom macro |
| `runtime-scripting.middleware.ts#/scripting/x/*` | 事实可复用 | 通过 `ProgrammingFacet#loadPackResource()` 服务 packer-driver json/chunk，与 old editor `QuickPackLoader` 行为一致 | 新实现基于 `projectProgrammingRoot` preview target 和 `ProgrammingProvider` lazy 读取 |
| `runtime-scripting.middleware.ts#/scripting/systemjs/*` | 事实可复用 | 从 `facet.systemJsHomeDir` 服务 SystemJS，当前 CLI `Facet` 输出在 `temp/cli/programming/preview/systemjs` | 纳入 `cliProgrammingRoot` / `ProgrammingProvider` 输入 |
| `runtime-scripting.middleware.ts#/scripting/userland/macro` | 业务意图保留 | old editor 和当前 CLI `ProgrammingFacet` 的 static import map 都包含 `cc/userland/macro`，来源应是 `temp/programming/custom-macro.js` 或等价 programming source | 作为 programming route contract；缺失时给明确诊断 |
| `runtime-scripting.middleware.ts#/scripting/engine/*` | 业务意图保留 | 服务 engine 文件和 dev-cli preview target 文件，方向正确 | 路径来源必须来自 engine root、engine build/cache、programming target，不允许无证 fallback 扩张 |
| `runtime-scripting.middleware.ts#/engine_external/` | 待源码验证 | 旧实现服务 `external:` engine native external 资源，旧测试覆盖 wasm；是否进入新 contract 取决于当前 engine runtime 是否实际请求 | 在 engine-source/HTTP-base URL capture/browser smoke 中观察实际请求；需要时由 engine root provider 服务 |
| `runtime-scripting.middleware.ts#/src/effect.bin` | 待源码验证 | 旧实现服务 `<project>/temp/cli/asset-db/effect/effect.bin`；它可能影响 EffectAsset/runtime shader 资源 | 在资源加载 probe 中验证 EffectAsset 是否请求；若需要，纳入 runtime context data source |
| `runtime-scripting.middleware.ts#/scripting/polyfills/*` | 业务意图保留 | 旧实现服务 `@cocos/build-polyfills` preview bundle，old editor 也有 polyfills route | 保留 route 意图，具体文件来源需从当前 dependency/package 解析 |
| `/settings.json`、`/remote/*/config.json`、`/remote/*/index.js` | 待源码验证 | old editor 明确有 game-view settings 和 remote bundle route；old CLI bad implementation 只覆盖了 `/remote/internal/*` | 是否支持 game-view/remote bundle 由 engine settings、`assets.server`、`remoteBundles`、bundle config 事实决定 |
| `engine-capability.ts` | 业务意图保留 | 检查 `bin/.cache/dev-cli/web/import-map.json`、`bundled/index.js`、`bin/adapter/nodejs/*` 等 engine prerequisite | 新实现保留 prerequisite check，但路径列表需与当前 `D:\workspace\engines\cocos\3.8.6` 实际产物验证 |
| `preview-app/src/main.ts` 手写 `assets.importBase = 'assets/general/import'` / `nativeBase = 'assets/general/native'` | 实现方式废弃 | 覆盖 engine/settings 的 import/native base，和“URL 由 settings + bundle config + HTTP-base runtime fact 决定”冲突 | 不迁移；browser UI 只能消费 settings，不能篡改 asset base |
| `preview-app/src/main.ts#assetManager.loadWithJson()` 加载 current scene | 业务意图保留 | 最终浏览器 smoke 需要加载当前 scene，但不是短链路验证的第一入口 | 最后集成测试保留场景加载意图；短链路用 engine-source/resources.load/HTTP contract 先验证 |
| `runtime-preview.middleware.ts#/missing-asset/*` 和 `/preview-error` | 业务意图保留 | 旧实现用于缺失资源诊断和浏览器错误回传，不参与正常加载路径 | 可保留为诊断 route；不能作为资源加载成功的替代验证 |

## Old CLI test harness

| 文件/断言 | 分类 | 原因 | 后续动作 |
| --- | --- | --- | --- |
| `src/runtime-preview/test/preview-command.test.ts`、`launcher-runtime-preview.test.ts` | 业务意图保留 | 覆盖 CLI 参数和 launcher startup 生命周期，方向仍有效 | 迁移到 Vitest startup tests，但断言要更新为 runtime context/settings/serverURL 流程 |
| `runtime-preview.middleware.test.ts` 对 `/settings.js`、scene JSON、bundle config、plugin script 的 route coverage | 业务意图保留 | 覆盖旧 editor 同类 route 的业务入口 | 迁移为 HTTP contract，但 asset 请求必须来自 HTTP-base captured URLs，非 asset entry route 必须来自 settings/runtime facts |
| `runtime-preview.middleware.test.ts` 对 `/query-extname` 返回 `.cconb/.bin/.png` 的断言 | 实现方式废弃 | 固化 extname guessing，与 engine/request-derived mapping 冲突 | 不迁移；改写为 `/query-extname` 只返回 import payload extension 的 narrow contract |
| `runtime-preview.middleware.test.ts` 对 `/remote/internal/cc.config.json` 手写 config 的断言 | 实现方式废弃 | 固化手写 internal config，并缺少完整 `IBundleConfig` 字段 | 不迁移；改为 fact-backed bundle config contract |
| `runtime-preview.middleware.test.ts` 对 resolver-first library path 和 `/remote/internal` 返回路径字符串的断言 | 实现方式废弃 | 固化 `<project>/library` + request tail guessing，且 remote internal route 发送路径字符串 | 不迁移；改为 on-demand resolver + `sendFile` contract |
| `runtime-scripting.middleware.test.ts` 对 `/engine_external/`、`/src/effect.bin`、`/scripting/polyfills/*` 的覆盖 | 待源码验证 | 这些 route 可能是 browser/engine resource contract 的一部分，但必须由当前 engine 请求事实决定 | 作为 route coverage 来源，先在 probe/smoke 中验证是否必要 |
| `runtime-preview-template.test.ts` 对 `/preview-error` 的覆盖 | 业务意图保留 | 浏览器错误回传是诊断能力，不是加载路径 | 可迁移为诊断 route test |

## Engine backup implementation

| 文件/符号 | 分类 | 原因 | 后续动作 |
| --- | --- | --- | --- |
| `cc.config.json` 的 `NODEJS` buildTimeConstant | 待源码验证 | backup engine 明确增加 `NODEJS` 常量和 PAL override，但当前 `D:\workspace\engines\cocos\3.8.6` 未确认存在 `NODEJS`、`platforms/nodejs`、`pal/*/nodejs` 事实 | 不能作为当前实现前提；只作为业务意图和可能的后续 engine adapter 方向 |
| `scripts/build-adapter.js#bundleNodejsAdapter()` | 待源码验证 | backup 生成 `bin/adapter/nodejs/engine-adapter.js` 与 `web-adapter.js`，但当前 engine 未确认具备该产物链 | 只作为 engine prerequisite/build 参考，不在 CLI 中复制 engine build 逻辑 |
| `pal/*/nodejs/**` | 待源码验证 | backup nodejs PAL 可解释旧方案意图；当前 engine 未确认存在 | headless test 不能假设 nodejs PAL；缺失 host boundary 时做最小 mock 或先要求 engine 侧事实补齐 |
| `editor/exports/serialization.ts` 导出 `CCON`、`encodeCCONBinary`、`BufferBuilder` 等 | 业务意图保留 | CLI 可能需要解析/生成 CCON/CCONB 测试资源，但是否应走 editor exports 需以当前 engine 源码为准 | 先用 engine runtime downloader/parser 验证 `.ccon/.cconb`；必要时再评估导出 |
| `cocos/serialization/ccon.ts` 中 `parseCCONJson`、`decodeCCONBinary`、`CCON` runtime parser 能力 | 事实可复用 | 当前 engine 与 backup 都暴露这些 `cclegacy.internal` 能力，engine runtime downloader/parser 使用 CCON | 可以作为 `.ccon/.cconb` runtime probe 的事实，但优先通过 public downloader/parser 验证 |
| backup-only `encodeCCONBinary`、`BufferBuilder` internal 暴露 | 待源码验证 | backup 暴露 `encodeCCONBinary`、`BufferBuilder`，当前 engine `D:\workspace\engines\cocos\3.8.6` 未暴露 | 测试不能依赖这些 internal API；需要生成 CCONB 时另找当前源码事实 |

## Current workspace draft classification

| 文件/目录 | 分类 | 原因 | 后续动作 |
| --- | --- | --- | --- |
| `src/runtime-preview/manifest/**` | 实现方式废弃 | 旧草稿以 `RuntimePreviewArtifactManifest` / full index 为中心，和计划中的 request-time provider / resolver 边界冲突 | 已在 Task 15 Step 8 删除；后续实现不在此目录继续 |
| `vitests/suites/runtime-preview/manifest-extraction.test.ts` | 实现方式废弃 | 固化 manifest extraction 和全量文件计数；可作为 frozen artifact 事实参考，但不能作为 production 架构测试 | 已在 Task 15 Step 8 删除；由 `editor-cli-output-consistency.test.ts`、`on-demand-resolver.test.ts` 替代 |
| `vitests/shared/engine-source.ts`、`cocos-cc-source-entry.ts`、PAL/external stubs | 待源码验证 | 可能来自 P6 harness 方向，符合真实 engine source 引入目标，但需按 Task 8/8.5 审核 `PREVIEW=true`、`TEST=false` 与 host boundary | Task 8/8.5 重新验证后决定保留或修正 |
| `vitests/shared/editor-library-bundle.ts`、`editor-library-resources-load.probe.test.ts` | 待源码验证 | 方向符合 filesystem-base parser probe，但当前草稿来自旧阶段，需确认无手写 URL、无 mock Cocos public API、无 TypeScript 语法错误 | Task 9.5 重新审查并修正；不能作为 HTTP contract URL 来源 |
| `vitests/package.json`、`vitest.config.ts`、`fixture-paths.ts`、`setup-engine-env.ts` | 业务意图保留 | 独立 Vitest package 和 fixture env 符合目标；配置需按当前 plan 校验 alias、jsdom、host boundary | Task 6/8 继续验证，保留原 Jest 不变 |

## 结论

- 可保留的核心意图：CLI `preview --runtime` 启动、startup 日志、settings route、bundle config route、script route、programming routes、engine prerequisite check、最终 scene browser smoke。
- 必须废弃的核心方式：按请求路径尾部猜 library 文件、按 extname 猜 import/native、手写 internal bundle config、preview-app 覆盖 import/native base。
- 下一阶段实现必须先建立 `RuntimePreviewContext`、providers、`PreviewSettingsProvider` 和 on-demand resolver，再让 HTTP server 只服务 engine/runtime 已发出的 fact-backed request；旧 middleware 只能作为 route coverage 和业务意图参考。
