# Runtime preview Editor parity 设计

## 背景

本设计合并处理 `RP-ISSUE-007` 和 `RP-ISSUE-019`。

- `RP-ISSUE-007`：浏览器脚本加载是否可以并发加速。
- `RP-ISSUE-019`：runtime preview root 页面未按 Editor preview 业务语义使用项目 `preview-template`，默认设备尺寸固定为 `960x640`。

当前 CLI runtime preview 与 Cocos Creator 3.8.6 Editor preview 存在两个关键差异：

1. CLI root `/` 固定渲染 `static/runtime-preview/index.ejs`，没有优先使用 `<project>/preview-template/index.ejs`。
2. CLI `preview` target 使用 `makeTentativePrerequisiteImports()`，生成顺序 `await import(...)` 的 dynamic import 列表。Editor preview 的 `cce:/internal/x/prerequisite-imports` 实际是 `System.register([...deps])` static dependency chunk。

这两个差异应作为同一项 Editor preview parity 工作处理。单独做全并发 dynamic import 不是 Editor parity，只是性能补丁，且可能改变模块求值顺序。

## 已确认事实

主测试项目：`E:\own_space\engines\cocos-test-projects`。

Editor preview URL：`http://localhost:7457/`。

采集证据保存在本地临时目录：

- `.codex-tmp/editor-preview-capture-20260625/localhost_7457_.txt`
- `.codex-tmp/editor-preview-capture-20260625/localhost_7457_settings.js.txt`
- `.codex-tmp/editor-preview-capture-20260625/localhost_7457_scripting_x_import-map.json.txt`
- `.codex-tmp/editor-preview-capture-20260625/prerequisite-imports-chunk.js`
- `.codex-tmp/editor-preview-capture-20260625/resource-timing-evidence.json`

结论：

- Editor root `/` 返回的 HTML 标题为 `Cocos Creator - cocos-test-projects`。
- Editor root `/` 使用项目 `preview-template/index.ejs`。该模板包含 `<%- include(cocosTemplate, {}) %>`，并额外加载 `/test.js`。
- Editor `/settings.js` 返回 `window._CCSettings = ...`，其中 `engine.debug === true`、`platform === "web-desktop"`。
- Editor `/scripting/x/import-map.json` 将 `cce:/internal/x/prerequisite-imports` 映射到 `./chunks/6d/6d8fd2b0177941b032ddc0733af48a561fb60657.js`。
- 该 prerequisite chunk 是 `System.register(["__unresolved_0", ...], ...)` static dependency 形态，未包含 `import(`，依赖 token 数为 `233`。
- 90 秒 browser 采集内没有 same-origin failed request，没有 4xx/5xx response，没有 console error；有 2 条 warning。
- Editor preview 不设置 `window.__RUNTIME_PREVIEW_READY`，因此不能用 CLI preview-app 的 ready marker 判断 Editor preview 是否完成。

## 目标

1. CLI runtime preview root `/` 默认优先使用项目 `<project>/preview-template/index.ejs`。
2. 项目 template 存在时，`cocosTemplate` 仍由 CLI 提供，指向当前适配后的 `static/runtime-preview/script.ejs`。
3. CLI `preview` target 的 `cce:/internal/x/prerequisite-imports` 对齐 Editor preview，使用 static dependency `System.register([...deps])` 形态，而不是顺序 dynamic import。
4. `Default` device 不再固定为 `960x640`，应从当前 preview settings 的 design resolution 或等价 Editor preview 数据派生；缺少事实时才保留 fallback。
5. 继续保留已有 runtime preview route、settings provider、library resolver 和 preview-app 入口语义。

## 非目标

- 不实现全并发 dynamic import。
- 不新增 CLI 专用 opt-in 参数改变 project template 行为。
- 不把项目 `preview-template/script.ejs` 当成当前权威入口，除非补到 Editor 源码或产物事实证明需要这样做。
- 不复制 Editor server 的所有 toolbar、socket、profile、plugin hook 行为。
- 不用 `window.__RUNTIME_PREVIEW_READY` 反向约束 Editor preview。

## 设计

### Root template 选择

新增或调整 root render 逻辑：

1. 若 `<projectRoot>/preview-template/index.ejs` 存在且是文件，则使用该文件作为 root page template。
2. 否则继续使用 `static/runtime-preview/index.ejs`。
3. render data 保持当前 CLI 所需字段：
   - `title`
   - `tip_sceneIsEmpty`
   - `enableDebugger`
   - `settingsJs`
   - `packImportMapURL`
   - `packResolutionDetailMapURL`
   - `cocosTemplate`
   - `cocosToolBar`
   - `devices`
   - `config`
4. `cocosTemplate` 始终指向 CLI 适配后的 `static/runtime-preview/script.ejs`。
5. `cocosToolBar` 始终指向 CLI 适配后的 `static/runtime-preview/toolbar.ejs`。

这样与已确认 Editor 行为一致：项目 `index.ejs` 可定制页面结构，但核心 boot script 仍由当前 runtime preview server 提供。

### Prerequisite imports policy

将 `preview` target 从 tentative dynamic import policy 改为 static prerequisite imports policy：

- `shouldUseTentativePrerequisiteImportsMod('preview', { isEditor: false })` 应返回 `false`。
- `target.isEditor === true` 的行为需单独确认。当前任务只以 Editor browser preview 的真实 output 为事实来源；若 Editor target 当前仍依赖 tentative policy，应避免扩大修改范围。
- `makePrerequisiteImportsMod()` 继续生成 source-level static imports，由 packer-driver 输出为 `System.register([...deps])` chunk。

验收重点不是 source template 字符串，而是生成后的 preview import-map 和 prerequisite chunk：

- `import-map.json#imports["cce:/internal/x/prerequisite-imports"]` 存在。
- 对应 chunk 不包含 `await import(` 或 request list。
- 对应 chunk 包含 `System.register([...])` static dependency 数组。

### Device 默认尺寸

`Default` device 的来源改为：

1. 优先从 `PreviewSettingsProvider.getPreviewSettings()` 的 screen/design resolution 数据派生。
2. 若 settings 中没有可用 design resolution，再使用 `static/runtime-preview/devices/devices.json` 中的 default device。
3. 最后 fallback 才使用当前硬编码 `Default: 960x640`。

该逻辑应集中在 root render 层或一个小 helper 中，不应散落到 template。

### 错误处理

- 项目 `preview-template/index.ejs` 渲染失败时，返回明确 500，并记录 template path 和 error message；不要静默 fallback 到 CLI 内置模板，否则会掩盖项目模板错误。
- 项目 template 不存在时才 fallback 到 CLI 内置模板。
- settings 读取失败沿用现有 runtime preview settings error 行为，不在本设计中扩大处理。

### 测试

需要新增或调整以下测试：

1. `browser-entry-contract.test.ts`
   - 覆盖项目 `preview-template/index.ejs` 优先于 CLI 内置 `index.ejs`。
   - 覆盖项目 `preview-template/script.ejs` 存在时，`cocosTemplate` 仍使用 CLI 内置 `script.ejs`。
   - 覆盖项目 template 渲染失败时返回错误，而不是静默 fallback。

2. `preview-prerequisite-imports-policy.test.ts`
   - 更新 `preview` target 断言：不再使用 tentative prerequisite imports。
   - 增加 fixture 或 focused compile 验证：preview target 生成的 prerequisite chunk 是 static dependency 形态。

3. 设备尺寸测试
   - settings 中存在 design resolution 时，`devices.Default` 使用该尺寸。
   - settings 缺少 design resolution 时，fallback 行为稳定。

4. Editor parity smoke
   - 对主测试项目生成 CLI runtime preview output 后，抓取 `/`、`/settings.js`、`/scripting/x/import-map.json` 和 prerequisite chunk。
   - 断言 root template、settings debug、prerequisite static deps 与 Editor preview 事实一致。

## 风险

- 从 sequential dynamic import 改回 static dependency 可能重新暴露大项目一次性加载大量 deps 的资源压力。但这是 Editor preview 当前事实，且主测试项目 Editor 采集显示同源请求正常。
- `target.isEditor === true` 的 policy 若和 `preview` 共用同一 helper，修改时可能影响 editor target 产物。实现计划中必须先锁定调用点和测试范围。
- 项目 template 渲染错误直接 500 可能比旧行为更显性，但这是正确行为。静默 fallback 会隐藏项目配置问题。

## 验收标准

完成后，以下条件必须同时成立：

- CLI root `/` 在主测试项目中使用 `preview-template/index.ejs`。
- CLI root `/` 仍通过 CLI `script.ejs` 启动 `/preview-app/index.js`。
- CLI preview target 的 prerequisite chunk 为 static `System.register([...deps])`，不再是 sequential dynamic import request list。
- 主测试项目 CLI preview 的脚本加载不再表现为逐个 `await System.import()` 长链。
- 相关 Vitest focused tests 通过。
- 文档回填 `docs/dev/runtime-preview/issues.md`：
  - `RP-ISSUE-007` 从 `deferred` 更新为当前处理结果。
  - `RP-ISSUE-019` 从 `open` 更新为当前处理结果。
