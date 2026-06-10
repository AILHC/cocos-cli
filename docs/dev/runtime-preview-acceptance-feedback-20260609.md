# Runtime Preview 验收反馈闭环记录（2026-06-09）

本文档只记录验收反馈、事实核查、问题原因、修复决策和当前状态；不替代执行计划，也不作为 route 设计事实来源。

## 1. 反馈范围

验收项目：

- CLI repo：`E:\own_space\engines\cocos-cli`
- 小项目：`E:\own_space\cocos_work_lab_38x`
- engine：`D:\workspace\engines\cocos\3.8.6`
- 当前不使用大项目作为验收输入。

相关提交：

- `e153735 fix runtime preview scene loading`
- `b85815c default runtime preview to webgl`
- `e9ab399 document runtime preview render mode gap`

## 2. 用户反馈与处理状态

| 反馈 | 事实核查 | 当前状态 |
| --- | --- | --- |
| 页面有 scene selector，但选择 scene 后没有加载 | `settings.js` 原先没有按 query `scene` 重新生成 settings，且 provider cache 不区分 scene。 | 已修复并纳入真实 browser 验收。 |
| 应该有默认 scene，不能打开为空 | 小项目 `profiles/v2/packages/preview.json` 的 `general.start_scene` 为 `current_scene`；独立 CLI 没有 editor scene service，不能直接传 `current_scene` 给 builder。 | 已修复为 fallback 到 AssetDB 中 first loadable scene。 |
| 三个复杂场景必须真实加载，并等待一段时间看浏览器日志 | 原先 JsonAsset/resource marker smoke 不代表 scene load。 | 已补真实 CLI browser integration：默认 root、scene selector、3 个复杂 scene，ready 后继续观察稳定窗口。 |
| 手动打开 `?scene=<uuid>` 出现 WebGPU validation error | 自动验收此前显式带 `runtimePreviewRenderType=webgl`，没有覆盖默认无参数入口；无参数时引擎 AUTO 在支持 WebGPU 的浏览器中会选 WebGPU。 | 现象已通过默认 WebGL 止血并补验收；配置推导 renderMode 仍是后续设计项。 |
| renderMode 不是应该读取配置吗 | 项目没有显式 `settings.rendering.renderMode = WEBGL`；配置事实是 `gfx-webgl/gfx-webgl2=true`、`gfx-webgpu=false`、`pipeline=legacy-pipeline`。 | 已记录为设计债：后续应从 URL override、settings、`useWebGPU/gfx-webgpu` 推导。 |
| 编辑器预览没有特殊设置 WebGL，只设置 pipeline | 源码事实支持：pipeline 决定 legacy/custom render pipeline，不直接决定 WebGL/WebGPU backend。 | 已记录，避免把 pipeline 误当 render backend。 |
| 执行 `preview --runtime` 后很久才看到第一条 `Start record log` | 本地探针显示 `import('./src/core/launcher.ts')` 约 10.8s；该日志在 `new Launcher()` 的 `newConsole.record()` 中输出，说明延迟主要发生在 `Launcher` 顶层模块加载和 TS 编译阶段。 | 已记录为 deferred；本轮不处理，等待 CLI startup / Launcher 依赖边界对齐后再设计。 |
| `server:listening` 后只有访问浏览器页面才出现 `engine:init:start` | 原实现是 lazy settings：server 先监听，`/settings.js` 或依赖 settings 的 route 才触发 `ensurePreviewSettingsReady()`，进而初始化 engine / AssetDB / builder。 | 已修复；`Launcher.startRuntimePreview()` 在 server URL 可用后主动输出 `preview:preparing`，生成默认 preview settings，完成后输出 `preview:ready`。真实 CLI 验收改为先 build，再用 `dist/cli.js` 启动并等待 `preview:ready`。 |

## 3. 问题原因

### 3.1 默认 scene 与 scene selector

旧问题不是 preview-app UI 本身，而是服务端输入不完整：

- root entry 没有保证 `/settings.js?scene=<uuid>`。
- `/settings.js` 没有读取 query `scene` 作为 `startScene`。
- `PreviewSettingsProvider` 原先只有单份 cache，切换 scene 后可能复用第一次 settings。
- `current_scene` 是 editor preview 概念，独立 CLI 没有 editor scene service，需要降级到可加载 scene。

修复决策：

- 新增 `preview-scenes.ts` 统一处理 scene list、scene JSON、默认 scene 解析。
- 默认 scene 优先级：URL `scene` > CLI `--scene` > profile `general.start_scene` > first loadable scene。
- settings cache 按 build options 区分，scene 切换会重新生成对应 settings。

### 3.2 资源 404 与 internal library

真实 scene load 暴露了 `assets/general/import/*` 中 `uuid@subid` 的依赖资源请求。

原因：

- preview-app 会按 `general` alias 请求部分 scene dependency。
- 部分资源不在 bundle config paths 中，但存在于 AssetDB metadata 的 `depends`。
- internal default assets 需要 `engineRoot/editor/library/.internal-data.json` 证明。

修复决策：

- `/assets/general/import|native/*` 只允许 AssetDB metadata 证明过的 UUID。
- metadata proof 使用每 root 一次性 `Set` 索引，避免每请求全量扫描。
- 真正返回文件仍只在 project library / `library/cli` / internal library root 中查找。

### 3.3 `localSetLayout` 运行时异常

现象：

- 资源 404 消失后，first scene 进入 engine render pipeline 后报 `Cannot read properties of undefined (reading 'localSetLayout')`。

原因：

- 小项目配置中 `modules.graphics.pipeline = "legacy-pipeline"`。
- 冻结编辑器 preview programming 产物使用 `legacy-pipeline`。
- CLI preview settings 原先绕过项目配置补齐，导致 generated programming/settings 走 `custom-pipeline`。

修复决策：

- `getPreviewSettings()` 复用 `fillIncludeModulesFromProjectConfig()`。
- 仅在 `preview` settings 场景按 `modules.graphics.pipeline` 归一化 `includeModules/customPipeline`，避免扩大普通 build 语义。

### 3.4 WebGPU validation error

用户手动看到的错误包括：

- `The number of uniform buffers ... exceeds the maximum per-stage limit`
- `TextureViewDimension::Cube ... doesn't match ... e2D`
- `Invalid BindGroup`
- `Invalid CommandBuffer`

原因：

- 用户手动打开的是 `?scene=<uuid>`，没有 `runtimePreviewRenderType=webgl`。
- preview-app 无参数时没有覆盖 `renderMode`。
- engine 3.8.6 在 `LegacyRenderMode.AUTO` 下，如果浏览器支持 `navigator.gpu` 且 `!EDITOR`，会选择 WebGPU。
- 当前小项目配置没有启用 WebGPU：`gfx-webgpu=false`，但 AUTO 没有读取这个业务配置语义。

当前修复决策：

- `b85815c` 将 runtime preview 默认 render type 改为 WebGL。
- `runtimePreviewRenderType=webgpu` 保留为显式 opt-in。
- 默认 root 和 scene selector 的真实验收 URL 不再带 `runtimePreviewRenderType=webgl`，用于覆盖手动入口。

当前设计债：

- 这仍是止血策略，不是最终配置推导实现。
- 后续应实现：URL `runtimePreviewRenderType` override > 已存在 `settings.rendering.renderMode` > 项目/平台 `useWebGPU` 或 `gfx-webgpu` 配置 > WebGL fallback。

### 3.5 runtime preview 启动准备时机

现象：

- 执行 `preview --runtime` 后，控制台先出现 `server:listening http://127.0.0.1:<port>`。
- 不访问浏览器页面时，看不到 `engine:init:start`。
- 访问 root 页面后，浏览器请求 `/settings.js`，才触发 `engine:init:start`。

事实核查：

- 当前 `Launcher.startRuntimePreview()` 创建 `PreviewSettingsProvider` 后启动 HTTP server。
- `engine:init:start` 位于 `ensurePreviewSettingsReady()` 触发的 import / builder 初始化链路中。
- `ensurePreviewSettingsReady()` 当前由 `settingsProvider.loadPreviewSettings()` 调用。
- `/settings.js` 是最典型的 settings 触发入口；root HTML 本身不代表 engine/settings 已 ready。

问题判断：

- `server:listening` 只能证明 socket 已监听，不能证明 runtime preview 已准备好。
- 当前 lazy settings 策略会把主要启动成本转移到第一次浏览器访问，导致手动验收和自动验收的状态语义不清。
- 这和当前验收目标不一致：CLI 启动真实 preview server 后，应主动准备默认 scene 的 preview settings，并输出可区分的 preparing / ready 状态。

修复决策：

- 本轮不处理 `Launcher` 顶层依赖加载慢问题。
- 本轮已处理 runtime preview server 启动后的主动准备流程。
- `server:listening` 保留为端口监听日志；新增或调整 `preview:preparing` / `preview:ready` 类状态，避免把 socket ready 误判为 preview ready。
- 测试不再使用 `tsx` 直接执行 TS 源码；需要先编译出 `dist`，再用编译后的 CLI 入口启动真实 runtime preview。

修复结果：

- `Launcher.startRuntimePreview()` 在 `server:listening` 后立即主动调用 `PreviewSettingsProvider.getPreviewSettings()`。
- `engine:init:start/done`、`asset-db:start/done`、`builder:init:start/done` 发生在 `startRuntimePreview()` 返回前；`launcher-runtime-preview.test.ts` 使用 `AFTER_START` 哨兵验证该顺序。
- `vitests/shared/runtime-preview-cli-process.ts` 已从 `tsx src/cli.ts` 改为 `node dist/cli.js`，并且默认等待 `preview:ready` 后才返回。
- `server:listening` 仍只表示 socket ready；`preview:ready` 才表示默认 preview settings warm-up 完成。

## 4. 验收与证据

已通过命令：

```powershell
npm run build
npm --prefix vitests test -- suites/runtime-preview
```

结果：

- 15 files passed
- 61 tests passed

小项目真实验收覆盖：

- 默认 root：无 `?scene=`、无 `runtimePreviewRenderType`，等待默认 scene ready。
- scene selector：通过真实 `<select id="scene-select">` 切换 scene，等待 reload 后目标 scene ready。
- 三个复杂 scene：
  - `668efa31-4841-4cbc-bbae-33255599d478`：`test_area_edge_graphic`
  - `465d8fb0-d260-4256-a785-651bf2ebf7d1`：`test_dynamic_atlas`
  - `ec470553-bc56-4c2c-91aa-c7016f677e3e`：`test_custom_shader_batch`

证据文件：

- `E:\own_space\cocos_work_lab_38x\temp\runtime-preview-small-project-cli-evidence.json`
- `E:\own_space\cocos_work_lab_38x\temp\preview-logs\runtime-preview-20260609-153629.log`

验收断言：

- `window.__RUNTIME_PREVIEW_READY.scene` 与目标 scene 一致。
- ready 后继续观察稳定窗口。
- browser console errors 为空。
- page errors 为空。
- failed network requests 为空。
- HTTP bad responses 为空。
- runtime preview server log 无 `settings:generation:error`、`browser:preview-error`、`UnhandledPromiseRejection`、`route:error`、`RuntimePreviewRequestBodyTooLarge`。

## 5. 真实 CLI generated output 验收补充

反馈问题：

- 仅验证 frozen editor reference 或 active editor 根产物，不能证明 CLI 自己生成的 `library` / `programming` 没问题。
- 原 `startRuntimePreviewCliProcess()` 总是向真实 CLI child process 注入 `COCOS_CLI_TEST_EDITOR_LIBRARY_REF` / `COCOS_CLI_TEST_EDITOR_PROGRAMMING_REF`，因此小项目集成验收仍带 reference 影响。
- `Launcher.startRuntimePreview()` 在没有 reference env 时默认 `projectLibraryRoot=<project>/library`，而当前 CLI AssetDB project output 是 `<project>/library/cli`；这会让存在 editor 根产物的小项目优先读 `<project>/library`，掩盖 CLI generated output 问题。

修复决策：

- 保留 frozen reference 测试能力，但 helper 只有显式传入 reference 时才注入对应 env；不传时必须删除父进程中的 reference env。
- production 默认 `projectLibraryRoot` 改为 `<project>/library/cli`，与 CLI AssetDB project output 对齐。
- `projectProgrammingRoot` / `cliProgrammingRoot` 继续使用 `<project>/temp/cli/programming`。
- 新增真实 CLI generated output 验收测试，先断言 health/startup root 没有 reference，再启动 browser 加载三个复杂 scene。

新增测试：

- `vitests/suites/runtime-preview/cli-generated-output-integration.test.ts`

已通过命令：

```powershell
npm run build
npm --prefix vitests test -- suites/runtime-preview/cli-generated-output-integration.test.ts
npm --prefix vitests test -- suites/runtime-preview/editor-cli-output-consistency.test.ts
npm --prefix vitests test -- suites/runtime-preview/cli-generated-output-integration.test.ts suites/runtime-preview/editor-cli-output-consistency.test.ts
```

本轮证据：

- CLI command：`node E:\own_space\engines\cocos-cli\dist\cli.js preview --project E:/own_space/cocos_work_lab_38x --runtime --host 127.0.0.1 --port 19601`
- `projectLibraryRoot=E:\own_space\cocos_work_lab_38x\library\cli`
- `projectProgrammingRoot=E:\own_space\cocos_work_lab_38x\temp\cli\programming`
- evidence summary：`E:\own_space\cocos_work_lab_38x\temp\runtime-preview-cli-generated-output-evidence.json`
- server log：`E:\own_space\cocos_work_lab_38x\temp\preview-logs\runtime-preview-20260610-105223.log`

本轮三场景验收结果：

- `test_area_edge_graphic`：`668efa31-4841-4cbc-bbae-33255599d478`，runtime server request count `246`
- `test_dynamic_atlas`：`465d8fb0-d260-4256-a785-651bf2ebf7d1`，runtime server request count `249`
- `test_custom_shader_batch`：`ec470553-bc56-4c2c-91aa-c7016f677e3e`，runtime server request count `232`

边界：

- 这证明当前小项目三复杂场景在真实 CLI generated `library/cli` 和 `temp/cli/programming` root 下可以通过 browser runtime smoke。
- 这不等于所有资源类型、所有 bundle、所有 extension runtime request 都已覆盖；`editor-cli-output-consistency.test.ts` 仍把 CLI/editor output 差异分类为 `source-backed-split-library-layout`。

### 5.1 settings generation 默认 timeout 修正

记录时间：2026-06-10

反馈问题：

- settings generation 默认设置 timeout 会把合法的慢启动误判为失败。
- runtime preview 首次 settings generation 不是单纯拼接 `settings.js`，它会触发 engine init、AssetDB startup、script compile、builder settings warm-up；默认 timeout 不应作为 production 行为。

修复决策：

- `PreviewSettingsProvider` 默认不设置 timeout，diagnostics 中 `timeoutMs=null`。
- `preview --runtime` 命令不再给 `--settings-timeout-ms` 设置默认值。
- 显式传入 `--settings-timeout-ms <number>` 时仍启用 timeout，用于调用方明确需要失败保护的场景。
- 自动化测试的超时保护应使用测试进程/用例 timeout，而不是 production settings generation 默认 timeout。

状态：`fixed`

## 6. 待修问题：启动日志与早期反馈

记录时间：2026-06-10

### 6.1 日志记录混乱

现象：

- runtime preview 启动时同时存在 stdout、`temp/logs` 通用 CLI 日志、`temp/preview-logs` runtime preview 专用日志。
- stdout 受 `newConsole.record()` 接管，会出现 `[log]`、pino JSON、底层 AssetDB/importer/builder 日志和 runtime preview 状态混杂。
- `active-output` 当前只输出到 stdout，未写入 runtime preview 专用日志。
- runtime preview 专用日志只记录阶段和部分 request/settings 事件，不包含完整资源 import、script compile、底层 importer 失败上下文。

影响：

- 人工验收时很难第一时间判断当前 preview 使用的 `libraryRoot`、`programmingRoot`、server log 文件、启动阶段和失败位置。
- 自动测试可通过 stdout substring 判断，但人工诊断仍需要在多份日志之间来回查找。

修复方向：

- 明确三类日志职责：stdout 只显示人工可读摘要和关键阶段；`temp/preview-logs` 记录 runtime preview 验收主线；`temp/logs` 保留底层全量日志。
- `active-output`、启动阶段、settings 生成、AssetDB 摘要、script compile 摘要应同时写入 runtime preview 专用日志。
- 不在人工摘要中暴露内部实现字段或实现过程术语。

状态：`open`

### 6.2 启动早期无反馈，端口检查后置

现象：

- 执行 `preview --runtime` 后，用户需要等待较久才看到第一条有效 runtime preview 状态反馈。
- 端口冲突检查发生在较晚阶段；如果端口被占用，可能在已经做了一部分初始化后才报错。
- 这会造成“看起来卡住很久，最后才发现端口冲突”的体验。

影响：

- 人工验收无法区分 CLI 是否已开始处理、是否正在初始化、还是卡在端口/配置/engine/AssetDB 阶段。
- 端口冲突属于廉价、确定的前置失败条件，后置检查会浪费启动时间。

修复方向：

- `preview --runtime` 进入命令后立即输出最小启动反馈，包括 project、host、port、engineRoot 解析结果。
- 在启动 engine、AssetDB、builder 之前先做端口可用性检查，端口冲突应快速失败。
- `server:listening` 继续表示 socket ready；`preview:preparing` / `preview:ready` 表示 runtime preview 准备状态，不能混用。

状态：`open`

## 7. 后续建议

1. 将 renderMode 默认策略从“默认 WebGL”收敛为配置推导实现。
2. 为 `useWebGPU=true` 或 `gfx-webgpu=true` 的小型 fixture 增加单独 WebGPU opt-in 验收；不要把 WebGPU 失败和默认 preview 稳定性混为同一 gate。
3. 如果后续要修 WebGPU validation error，应在 engine 侧独立建立最小复现，不能在 runtime preview server 中吞掉或降级错误。
4. 每次修复后继续保持小步提交，提交信息要能对应本记录中的反馈项。
