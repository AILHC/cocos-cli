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

## 4. 验收与证据

已通过命令：

```powershell
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
- `E:\own_space\cocos_work_lab_38x\temp\preview-logs\runtime-preview-20260609-142020.log`

验收断言：

- `window.__RUNTIME_PREVIEW_READY.scene` 与目标 scene 一致。
- ready 后继续观察稳定窗口。
- browser console errors 为空。
- page errors 为空。
- failed network requests 为空。
- HTTP bad responses 为空。
- runtime preview server log 无 `settings:generation:error`、`browser:preview-error`、`UnhandledPromiseRejection`、`route:error`、`RuntimePreviewRequestBodyTooLarge`。

## 5. 后续建议

1. 将 renderMode 默认策略从“默认 WebGL”收敛为配置推导实现。
2. 为 `useWebGPU=true` 或 `gfx-webgpu=true` 的小型 fixture 增加单独 WebGPU opt-in 验收；不要把 WebGPU 失败和默认 preview 稳定性混为同一 gate。
3. 如果后续要修 WebGPU validation error，应在 engine 侧独立建立最小复现，不能在 runtime preview server 中吞掉或降级错误。
4. 每次修复后继续保持小步提交，提交信息要能对应本记录中的反馈项。
