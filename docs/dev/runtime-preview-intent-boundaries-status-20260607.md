# Runtime Preview 需求意图、边界与当前状态

记录时间：2026-06-07

## 文档目的

本文只整理用户在 CLI 备份分支阶段提出的 runtime preview 需求意图、必须遵守的边界，以及当前 `adapter-to-386` 分支的实现状态。

本文不把备份分支中的错误实现方式纳入设计。备份分支、旧 editor preview server、旧版编辑器源码只能作为需求意图和 route 行为参考；真正的 URL、settings、library、programming contract 必须由当前 engine source、CLI AssetDB/builder/scripting source、冻结 editor 产物和当前分支测试事实决定。

## 资料来源与优先级

| 优先级 | 来源 | 用途 |
| --- | --- | --- |
| P0 | `D:\workspace\engines\cocos\3.8.6` 当前 engine source | runtime URL 生成、`assetManager`、bundle config、parser/downloader、`editor-path-replace.ts` |
| P0 | 当前 `E:\own_space\engines\cocos-cli` 源码 | AssetDB、builder、scripting、`getPreviewSettings()`、`script2library`、Launcher/server 实现 |
| P1 | 冻结 editor `library` 和 `temp/programming` | editor-generated 产物兼容性基线 |
| P1 | 旧版 editor preview server source | route 名称、settings/script cache、scripting facet、`query-extname` 行为参考 |
| P2 | CLI 备份分支实现与文档 | 用户需求意图、历史问题、可迁移测试思路参考 |

相关现有文档：

- `docs/dev/runtime-preview-mainbase-handoff-20260606.md`
- `docs/dev/runtime-preview-architecture-facts-20260606.md`
- `docs/dev/runtime-preview-cli-design-20260606.md`
- `docs/dev/runtime-preview-old-implementation-review-20260606.md`
- `docs/dev/runtime-preview-reference-library-20260606.md`
- `docs/dev/runtime-preview-reference-temp-programming-20260606.md`

## 需求意图

### 1. 独立 runtime preview 模式

需求意图：

- `cocos preview --runtime` 是独立 runtime preview，不是 editor-like scene preview。
- runtime mode 不启动 MCP。
- runtime mode 不启动 scene RPC。
- runtime mode 不调用 `initScene()`、`Rpc.startup()`、`Scene.Editor.open()`、`Scene.Node.*`、gizmo 或 editor scene service。
- runtime mode 允许初始化 `scripting`、`ProgrammingFacet`、AssetDB、builder，因为这些能力负责 runtime 脚本、import map、library 和 settings。
- 不带 `--runtime` 时，原 editor-like preview 行为应保留。

当前状态：

| 项 | 状态 | 当前事实 |
| --- | --- | --- |
| CLI `--runtime` 分流 | 已实现 | `src/commands/preview.ts` 调用 `Launcher.startRuntimePreview()` |
| 独立 runtime server | 已实现 | `src/runtime-preview/server/runtime-preview-server.ts` |
| 不启动 scene RPC/MCP | 已实现于当前 runtime path | `Launcher.startRuntimePreview()` 没有调用 scene preview 的 `Rpc.startup()` |
| 原 preview 保留 | 已实现 | `startPreview()` 仍保留原流程 |

### 2. 当前阶段以小项目真实验收为主，大项目暂缓

需求意图：

- 当前测试和集成验收主要使用小项目 `E:\own_space\cocos_work_lab_38x`。
- 小项目不仅用于短链路 Vitest，也要用于真实 preview server、真实 CLI child process、浏览器日志监听和稳定窗口验收。
- P6 / feature-c 大项目暂时不参与当前测试和验收，不作为当前完成门槛。
- 旧实现阶段曾面向 P6 / feature-c 暴露 extension asset-db、script import map、编译慢、错误可见性、启动日志和 native-only 静态依赖边界；这些仍是后续 deferred 事实来源，但不能混入当前验收条件。

当前状态：

| 项 | 状态 | 当前事实 |
| --- | --- | --- |
| 小项目短链路验证 | 部分实现 | `vitests/suites/runtime-preview/**` 已覆盖 frozen library、programming、HTTP contract、pre-browser smoke |
| 小项目真实集成验收 | 未完成 | 当前还没有完成真实 CLI child process + browser runtime smoke + 稳定窗口验收 |
| P6 / feature-c 验证 | deferred | 当前阶段不参与测试和验收；后续重新纳入前必须更新计划和验收矩阵 |
| extension asset-db 语义 | 待重新纳入 | 备份分支曾实现 resolver 和 start order；当前主线还没有把 extension mount 加入新的 request-time resolver 闭环 |
| native-only 静态依赖边界 | deferred | 当前主线未把 CLI fake native module 作为方案；大项目相关错误定位后续再进入验收范围 |

### 3. URL 不能猜，必须由事实决定

需求意图：

- preview server 不能自行创造 runtime URL。
- route 设计必须有事实来源。
- URL 生成由 engine runtime、settings、bundle config、AssetDB/library metadata、programming records 决定。
- 旧 editor preview server 和备份分支只能证明“有这类 route / 业务入口”，不能证明当前 URL mapping 规则。

明确废弃的方式：

- 按请求尾部猜 `<project>/library/**` 文件。
- 按 extname 猜 import/native 边界。
- 手写 internal bundle config。
- 手写 `/remote/internal/*`。
- 在 preview-app 中覆盖 `assets.importBase` / `nativeBase`。
- 根据 editor `library` 的当前 bucket 形态反推通用 URL 规则。

当前状态：

| 项 | 状态 | 当前事实 |
| --- | --- | --- |
| HTTP-base runtime URL capture | 部分实现并验证 | `http-url-capture.probe.test.ts` 捕获真实 engine 生成的 JsonAsset import URL 和 ImageAsset native URL |
| resolver-first/path guessing 删除 | 已实现于当前主线 | 旧 `manifest/**` 和 full-index 方向已删除；当前 `resolveLibraryRequest()` 需要 captured URL 或 bundle config fact |
| pack / redirect URL | 未捕获 | 当前 synthesized bundle config 没有触发 `packs` 和 `redirect` |
| remote bundle URL | 待验证 | route regex 支持 `/remote`，但当前事实链没有完成 remote captured request |

### 4. 冻结 editor `library` 和 `temp/programming` 作为参考产物

需求意图：

- `E:\own_space\cocos_work_lab_38x\library` 是 Creator editor-generated `library` 参考，不提交完整产物。
- `E:\own_space\cocos_work_lab_38x\temp\programming` 中的编辑器代码编译结果也要冻结，但只冻结必要子集。
- CLI AssetDB 生成物与 editor 生成物不一致时，先判断差异来源；若 engine runtime 期望 editor semantics，应优先让 CLI output 或 adapter 靠近 editor semantics。
- 冻结产物只能作为 reference/test fixture，不能复制进 production 作为绕过。

当前状态：

| 项 | 状态 | 当前事实 |
| --- | --- | --- |
| editor `library` 冻结 | 已完成 | `.codex-tmp/reference-library/cocos_work_lab_38x-editor-library-20260606` |
| editor `temp/programming` 冻结 | 已完成 | `.codex-tmp/reference-temp/cocos_work_lab_38x-editor-programming-20260606` |
| reference 文档 | 已完成 | `runtime-preview-reference-library-20260606.md`、`runtime-preview-reference-temp-programming-20260606.md` |
| CLI output 对齐 | 未完成 | 当前文档记录为 `cli-output-incomplete-after-failed-generation`，不能声明 CLI/editor output 一致 |

### 5. 短链路反馈优先，浏览器是最后集成测试

需求意图：

- 当前环境和基线必须能快速验证接下来的实现。
- 不应该每次都打开浏览器等待。
- 先用 Vitest、真实 engine source、frozen artifacts、HTTP contract、pre-browser smoke 验证加载链路。
- 浏览器测试只作为最后集成测试。

当前状态：

| 项 | 状态 | 当前事实 |
| --- | --- | --- |
| 独立 `vitests` | 已实现 | `vitests/package.json`，原 Jest 保留不变 |
| 真实 engine source harness | 已实现并验证 | `engine-source-runtime.probe.test.ts` 使用 `PREVIEW=true`、`TEST=false` |
| filesystem-base parser probe | 部分实现并验证 | JsonAsset、ImageAsset、Texture2D、SpriteFrame、serialized SpriteAtlas、Spine SkeletonData 已覆盖 |
| HTTP-base URL capture | 部分实现并验证 | import/native representative URL 已捕获 |
| pre-browser HTTP smoke | 已实现并验证 | `pre-browser-http-smoke.test.ts` 通过 |
| 浏览器集成测试 | 未执行 | 仍未达到进入 browser integration 的条件 |

最近验证状态：

- `npm --prefix vitests test -- suites/runtime-preview` 在补齐环境变量后为 25/26 通过。
- 唯一 full-suite 失败是 `settings-generation.test.ts` 的真实 Engine 初始化用例 30 秒超时。
- 单独运行 `settings-generation.test.ts` 为 5/5 通过，真实 Engine 初始化约 8.5 秒。
- 结论：功能链路不是失败，但 full-suite 存在测试隔离或并发超时稳定性问题。

### 6. 性能边界：禁止启动期全量扫描和 full manifest

需求意图：

- production startup 不得递归扫描 `library`、`temp` 或构建几十万文件级别的全量 URL/file index。
- 可以 lazy 读取 metadata、records、chunks。
- 可以 request-time resolve 当前请求。
- 可以使用 bounded cache，但必须有边界和失效策略。

当前状态：

| 项 | 状态 | 当前事实 |
| --- | --- | --- |
| full manifest 方向 | 废弃并删除 | `src/runtime-preview/manifest/**` 和 manifest extraction 测试已删除 |
| startup 不扫描测试 | 已实现 | `on-demand-resolver.test.ts` 覆盖不扫描和 path traversal |
| request-time resolver | 部分实现 | `resolveLibraryRequest()`、`resolveProgrammingRequest()` 按请求解析 |
| bounded cache | 未实现 | 当前 resolver 仍以直接 `stat/read` 为主，还没有正式 cache/invalidation 设计 |

### 7. settings 必须来自 CLI `getPreviewSettings()` 或等价封装

需求意图：

- `/settings.js` 是 runtime preview 加载入口，不能手写不完整 settings。
- `settings`、`bundleConfigs`、`script2library` 要优先复用 CLI `getPreviewSettings()`。
- `serverURL` 必须进入 engine settings 的 `assets.server`、`importBase`、`nativeBase`、`remoteBundles` 语义。
- settings generation 可以 lazy，但必须记录耗时、timeout 和诊断。

当前状态：

| 项 | 状态 | 当前事实 |
| --- | --- | --- |
| `PreviewSettingsProvider` | 已实现 | `src/runtime-preview/settings/preview-settings-provider.ts` |
| lazy settings | 已实现 | `Launcher.startRuntimePreview()` 启动 server 后才在 `/settings.js` 触发 import/builder/settings |
| `settings.js` route | 已实现 | `runtime-preview-routes.ts` 返回 `window._CCSettings = ...;` |
| 真实 Launcher settings | 部分验证 | `launcher-runtime-preview.test.ts` 真实 Launcher path 通过；full-suite 中 settings 独立用例存在超时不稳定 |
| 完整 production settings 代表性 | 未完成 | 仍需证明真实 `getPreviewSettings()` 输出能覆盖 production preview asset HTTP contract |

### 8. scripting / programming 产物必须由真实 records 驱动

需求意图：

- runtime preview 的 scripting route 要服务 QuickPack / ProgrammingFacet 产物。
- `dependScripts` 必须连接到 programming import-map、main-record、assembly-record、chunks。
- 不能只检查 chunk 中存在 `System.register`。
- 不能用 regex 从 chunk 反推业务语义。

当前状态：

| 项 | 状态 | 当前事实 |
| --- | --- | --- |
| programming resolver | 已实现 | `src/runtime-preview/programming/resolve-programming-request.ts` |
| preview records/chunks 读取 | 已验证 | `script-runtime-map.test.ts` 覆盖 import-map、main-record、assembly-record、chunks |
| `dependScripts` 链路 | 部分验证 | 已覆盖 frozen project asset scripts 的 `db://assets/**/*.ts` |
| internal / extension / plugin/global scripts | 未覆盖 | 当前测试未覆盖 `db://internal`、extension mount、plugin/global scripts 或完整 `script2library` |
| `/scripting/systemjs/*`、`/scripting/userland/macro` | 部分支持 | 当前 resolver 支持 `/scripting/x/*`；SystemJS/macro route 仍需按当前产物路径补齐或验证 |

### 9. extension asset-db 不能硬编码，当前先用小项目事实闭环

需求意图：

- 支持项目 `extensions/*/package.json` 中的 `contributions["asset-db"].mount`。
- 支持 disabled extension 跳过。
- 支持 project/global package enable 配置。
- 支持 `mount.enable`。
- 启动阶段必须先收集所有 asset-db domain，再开始资源导入和脚本编译。
- 不硬编码 `view-state-group`，不改项目 import 路径绕过，不伪造空文件掩盖 domain 未注册。

当前状态：

| 项 | 状态 | 当前事实 |
| --- | --- | --- |
| 需求意图 | 保留 | 备份分支文档和测试已明确该需求 |
| 当前主线实现 | 未完成 | 当前 runtime-preview request-time resolver 尚未把 extension mount 纳入 production contract |
| 当前测试 | 未覆盖 | 当前 `vitests` 未覆盖 extension mount URL / metadata / script linkage |
| 后续处理 | 必须重新设计 | 当前阶段先用小项目事实闭环 runtime preview；extension mount 重新纳入时，应基于当前 CLI AssetDB source 与 frozen metadata，而不是迁移旧 resolver-first 代码 |

### 10. 编译慢和启动反馈

需求意图：

- preview 启动时不能长时间无控制台反馈。
- 需要输出 engine init、scripting/packer init、asset-db init/import、script compile、server listen 等关键阶段。
- 导入和编译错误要输出控制台、写 runtime preview log，并保留在 packer / Cocos 原始日志。
- 编译慢需要正式处理，不是只加日志。
- 启动期普通 `.js/.ts` importer 不应逐个触发重复 `compileScripts()`；应在 DB start 后批量同步。

当前状态：

| 项 | 状态 | 当前事实 |
| --- | --- | --- |
| 当前 runtime preview startup log | 部分实现 | `Launcher.startRuntimePreview()` 输出 server startup lines 和 listening URL |
| runtime preview 本地日志 | 当前主线未恢复完整 | 备份分支有 logger；当前主线主要是 console 和测试 server startup lines |
| script batching | 当前主线未纳入 | 备份分支实现过 `beginBatchScriptImport()` 等；当前主线主要聚焦 runtime URL/settings/server |
| 编译慢验证指标 | 未恢复 | 尚未在当前主线记录 `Build iteration starts` 等指标 |

### 11. native-only 静态依赖边界

需求意图：

- `AKNativeVideoPlayer` 这类 native-only 静态 import 不应由 CLI 自动伪造模块。
- CLI 可以增强错误输出和定位。
- 项目代码静态 import native-only 文件时，项目侧应提供 web 可解析结构，或使用明确的平台条件/插件机制。

当前状态：

| 项 | 状态 | 当前事实 |
| --- | --- | --- |
| fake native module | 未采用 | 当前主线没有把 fake native module 作为 runtime preview 方案 |
| 错误可见性 | 未完成 | 当前应先在小项目真实 browser smoke 中建立错误分类和日志证据；P6 / feature-c native-only 边界 deferred |

### 12. 允许必要 engine source 适配

需求意图：

- 不是完全不能改 `D:\workspace\engines\cocos\3.8.6`。
- 可以大胆适配 3.8.6，但必须服务于当前 CLI compiler、真实 `getPreviewSettings()`、runtime preview 加载链路或必要 host boundary。
- 可参考 `engine-backup-current-20260606` 和 `cocos4`，最终实现必须回到 3.8.6 验证。
- 禁止手工复制或伪造 generated cache。

当前状态：

| 项 | 状态 | 当前事实 |
| --- | --- | --- |
| NODEJS PAL adapter | 已实现并提交 | engine commit `ec7f8d2161 feat(runtime-preview): add nodejs pal adapter` |
| engine runtime source harness | 已验证 | `engine-source-runtime.probe.test.ts` 通过 |
| generated cache 伪造 | 未采用 | 当前规则明确禁止手工复制 `bin/.cache/dev-cli/editor/loader.js` |

## 当前分支实现总览

| 模块 | 当前状态 | 已验证 | 主要缺口 |
| --- | --- | --- | --- |
| CLI command / Launcher | 部分实现 | `launcher-runtime-preview.test.ts` 真实 Launcher path 通过 | startup log、本地日志、小项目真实 CLI child process 集成验收 |
| runtime server/routes | 部分实现 | `cli-startup.test.ts`、`http-contract.test.ts`、`pre-browser-http-smoke.test.ts` 通过 | scene、plugins、remote、SystemJS/macro、import-map-global 等 route 需按事实补齐 |
| `PreviewSettingsProvider` | 部分实现 | 单独 `settings-generation.test.ts` 通过 | full-suite 超时不稳定；真实 production settings contract 未闭环 |
| library resolver | 部分实现 | captured import URL 和 bundle-config-backed import route 通过 | native production mapping、pack、redirect、extension mount、remote |
| programming resolver | 部分实现 | preview records/chunks、project script `dependScripts` 通过 | internal/extension/plugin/global scripts，SystemJS/macro route |
| frozen editor resource parser probe | 部分实现 | JsonAsset、ImageAsset、Texture2D、SpriteFrame、SpriteAtlas、Spine SkeletonData 通过 | TTFFont、runtime `.plist` parser、Spine `.atlas` standalone |
| CLI/editor output consistency | 未完成 | editor output shape 已验证 | CLI output generation 失败后不完整，不能声明一致 |
| browser integration | 未开始 | 无 | 必须等短链路 gap 收敛 |

## 不应再混入计划的错误实现

以下内容属于备份分支或旧草稿中的错误方向，后续计划和代码不能继续复用：

1. production startup 构建 full manifest / full URL index。
2. 递归扫描 `library`、`temp/programming` 建内存索引。
3. 以 URL tail 猜测 library 文件。
4. 以 extname 猜 import/native 语义。
5. 手写 internal bundle config。
6. 手写 `/remote/internal/*`。
7. `preview-app` 覆盖 engine/settings 的 `importBase`、`nativeBase`。
8. 用冻结 editor 产物替代 CLI production 产物。
9. 用 mock Cocos public API 证明 engine resource loading 成功。
10. 为了过测试伪造 engine runtime URL 或 generated cache。

## 后续执行顺序建议

1. 修复 `vitests` full-suite 超时不稳定，让 `suites/runtime-preview` 在完整环境变量下稳定全绿。
2. 做真实 CLI AssetDB output consistency：定位 `library/cli` 与 editor `library` 差异，优先修生成链而不是 server 猜路径。
3. 补 production native URL mapping：从 HTTP-base native capture 和 AssetDB/nativeDep metadata 推导 request-time resolver。
4. 补 pack / redirect capture：找到或构造由 engine source 和 bundle config 事实驱动的 sample，不手写近似 URL。
5. 补 extension asset-db：基于当前 CLI AssetDB source 与 frozen `.view-state-group-*` metadata 重新实现，不迁移旧 resolver-first 代码。
6. 补 scripting route：SystemJS、macro、import-map-global、plugins/script2library 按 current CLI programming source 验证。
7. 补 startup diagnostics：console stage、runtime preview log、packer/Cocos 原始日志关联。
8. 小项目 HTTP smoke 稳定后，再进入浏览器集成测试。
9. 小项目浏览器通过后，先完成小项目真实 CLI child process 集成验收和结论文档；P6 / feature-c 后续是否纳入，需要重新更新计划。

## 当前结论

当前分支已经建立了正确方向的短链路验证框架和部分 runtime preview server 实现，但还不能声明完整 runtime preview 已完成。

已确认的正确方向是：engine runtime 生成 URL，server 做 fact-backed request-time resolution；settings 由 CLI `getPreviewSettings()` 或等价封装提供；programming route 由真实 preview records/chunks 驱动；冻结 editor 产物只作为 reference。

当前最大的未闭环点是：真实 CLI AssetDB output 与 editor output 对齐、production native/pack/redirect/extension mapping、完整 scripting route、本地日志/启动反馈、小项目真实 CLI child process 验收和最终浏览器集成。
