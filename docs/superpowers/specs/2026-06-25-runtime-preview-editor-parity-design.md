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

本轮采集证据保存在本地临时目录：

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

这些 `.codex-tmp` 文件只是当前设计输入，不是最终验收文档。实现完成前必须把可复现的 Editor / CLI 对比证据沉淀到 `docs/dev/runtime-preview/facts/`，并记录：

- Cocos Creator 版本和项目路径。
- 采集命令或脚本入口。
- root HTML 是否来自项目 `preview-template/index.ejs`。
- `/settings.js` 中 `engine.debug`、`engine.platform` 和 design resolution 相关字段。
- `import-map.json#imports["cce:/internal/x/prerequisite-imports"]`。
- prerequisite chunk path、hash、dependency count、是否包含 sequential dynamic import pattern。
- browser/network evidence 中 same-origin failed request、4xx/5xx、console/page error 计数。

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

实现必须覆盖以下负例：

- 项目没有 `preview-template/index.ejs` 时，fallback 到 CLI 内置 `static/runtime-preview/index.ejs`。
- 项目存在 `preview-template/script.ejs` 时，该文件不应接管当前 CLI boot script。
- 项目 `preview-template/index.ejs` 存在但 EJS render 失败时，返回 500，并在 runtime preview log 中记录 template absolute path 和 error message。

### Prerequisite imports policy

将 `preview` target 从 tentative dynamic import policy 改为 static prerequisite imports policy：

- `shouldUseTentativePrerequisiteImportsMod('preview', { isEditor: false })` 应返回 `false`。
- `target.isEditor === true` 的行为必须被测试锁住。当前任务只改变 `preview` target；若实现发现 `editor` target 也必须改变，需要先补事实并更新本设计。
- `makePrerequisiteImportsMod()` 继续生成 source-level static imports，由 packer-driver 输出为 `System.register([...deps])` chunk。

验收重点不是 source template 字符串，而是生成后的 preview import-map 和 prerequisite chunk：

- 必须读取当前 CLI 生成的 `<project>/temp/cli/programming/packer-driver/targets/preview/import-map.json` 和对应 chunk，不能只读 frozen editor reference 或 source template。
- `import-map.json#imports["cce:/internal/x/prerequisite-imports"]` 存在。
- 对应 chunk 不包含 `await import(` 或 request list。
- 对应 chunk 包含 `System.register([...])` static dependency 数组。
- `System.register` dependency 数量与 chunk scope 中 `__unresolved_N` 映射数量一致；主测试项目允许额外断言等于当前 Editor 采集的 `233`，但如果项目脚本变化，应以重新采集的 Editor baseline 为准。

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
   - fixture project 的 `preview-template/index.ejs` 带唯一 marker，并包含 `<%- include(cocosTemplate, {}) %>`。
   - 断言 `/` 返回该 marker。
   - 断言 `/` 包含 `System.import("/preview-app/index.js")` 或等价 CLI boot script。
   - fixture project 同时存在 `preview-template/script.ejs` 且带唯一 marker；断言该 marker 不出现在 root HTML。
   - 覆盖无项目 `preview-template/index.ejs` 时 fallback 到 `static/runtime-preview/index.ejs`。
   - 覆盖项目 template render 失败时 `/` 返回 500，并在 runtime preview log 中包含 template absolute path 和 error message。

2. `preview-prerequisite-imports-policy.test.ts`
   - 更新 `preview` target 断言：不再使用 tentative prerequisite imports。
   - 明确断言 `editor` target 当前行为保持已确认事实；如果实现需要改变 `editor` target，必须先更新事实和设计。
   - 增加 fixture 或 focused compile 验证：preview target 生成的 prerequisite chunk 是 static dependency 形态。

3. 设备尺寸测试
   - settings 中存在 `screen.designResolution` 或等价 resolution 字段时，`devices.Default` 使用该宽高。
   - settings 缺少 design resolution 时，优先使用 `static/runtime-preview/devices/devices.json` 中的 default device。
   - 只有前两者都不可用时，才允许 fallback 到 `960x640`。

4. CLI preview 产物级 prerequisite 测试
   - 读取当前 CLI 生成的 `<project>/temp/cli/programming/packer-driver/targets/preview/import-map.json`。
   - 解析 `imports["cce:/internal/x/prerequisite-imports"]` 指向的 chunk。
   - 断言 chunk 匹配 `System.register([...], ...)`。
   - 断言 chunk 不包含 `await import(`、`() => import(`、`const requests`、`for (const request`。
   - 断言 dependency count 与 import-map scope 中 unresolved mapping count 一致。

5. Editor parity smoke
   - 对主测试项目生成 CLI runtime preview output 后，抓取 `/`、`/settings.js`、`/scripting/x/import-map.json` 和 prerequisite chunk。
   - 保存 evidence JSON。
   - 断言 root 使用项目 template marker。
   - 断言 boot script 仍来自 CLI `script.ejs`。
   - 断言 `settings.engine.debug === true`、`settings.engine.platform === "web-desktop"`。
   - 断言 prerequisite static deps 与重新采集的 Editor preview 事实一致。

6. Browser smoke
   - 主测试项目 CLI preview 必须在 120 秒内到达 CLI ready marker。
   - ready 后保持 10 秒 stable window。
   - stable window 内 `consoleErrors=[]`、`pageErrors=[]`、`failedRequests=[]`、`badResponses=[]`。
   - evidence 记录 `networkRequestCount`、`elapsedReadyMs`、prerequisite deps count。
   - resource timing 或 CDP Network evidence 记录 same-origin chunk requests，且没有 failed request 或 4xx/5xx。

## 风险

- 从 sequential dynamic import 改回 static dependency 可能重新暴露大项目一次性加载大量 deps 的资源压力。但这是 Editor preview 当前事实，且主测试项目 Editor 采集显示同源请求正常。
- `target.isEditor === true` 的 policy 若和 `preview` 共用同一 helper，修改时可能影响 editor target 产物。实现计划中必须先锁定调用点和测试范围。
- 项目 template 渲染错误直接 500 可能比旧行为更显性，但这是正确行为。静默 fallback 会隐藏项目配置问题。

## 验收标准

完成后，以下条件必须同时成立：

### Root/template

- `browser-entry-contract.test.ts` 覆盖并通过：
  - 项目 `preview-template/index.ejs` 优先于 CLI 内置 `index.ejs`。
  - root HTML 包含项目 template marker。
  - root HTML 包含 CLI boot script，能启动 `/preview-app/index.js`。
  - 项目 `preview-template/script.ejs` marker 不出现在 root HTML。
  - 无项目 template 时 fallback 到 CLI 内置 template。
  - 项目 template render 失败时 `/` 返回 500，log 包含 template absolute path 和 error message。

### Device

- settings 含 design resolution 时，`devices.Default` 使用该宽高。
- settings 不含 design resolution 时，`devices.Default` 使用 `static/runtime-preview/devices/devices.json` 的 default device。
- 仅当前两者都不可用时，才允许 `Default: 960x640` fallback。
- 以上三种路径都有自动化测试。

### Prerequisite imports

- `preview-prerequisite-imports-policy.test.ts` 断言：
  - `shouldUseTentativePrerequisiteImportsMod('preview', { isEditor: false }) === false`。
  - `editor` target 行为保持已确认事实，或如果改变，必须有更新后的事实和测试。
- 产物级测试读取当前 CLI output，而不是 frozen editor reference：
  - `<project>/temp/cli/programming/packer-driver/targets/preview/import-map.json`。
  - import-map 指向的 `cce:/internal/x/prerequisite-imports` chunk。
- prerequisite chunk 必须满足：
  - 包含 `System.register([...], ...)` static dependency array。
  - 不包含 `await import(`、`() => import(`、`const requests`、`for (const request`。
  - dependency count 与 import-map scope 中 `__unresolved_N` mapping count 一致。
- 主测试项目可用重新采集的 Editor baseline 校验 dependency count；当前采集值为 `233`，项目脚本变化时必须重新采集，不得硬套旧值。

### Browser/runtime

- 主测试项目 CLI preview browser smoke 在 120 秒内到达 CLI ready marker。
- ready 后 10 秒 stable window 内：
  - `consoleErrors=[]`
  - `pageErrors=[]`
  - `failedRequests=[]`
  - `badResponses=[]`
- evidence JSON 保存：
  - `networkRequestCount`
  - `elapsedReadyMs`
  - prerequisite deps count
  - same-origin chunk request summary
- 若要声明“脚本加载不再是顺序长链”，硬门槛是 chunk source 不含 sequential dynamic import loop；resource timing 只作为辅助证据。

### Editor parity evidence

- 新增或更新 `docs/dev/runtime-preview/facts/...`，记录可复现 Editor / CLI 对比证据：
  - Editor 版本、项目路径、采集命令。
  - Editor root template 来源。
  - Editor `/settings.js` 的关键字段。
  - Editor prerequisite import-map、chunk path、hash、dependency count、chunk shape。
  - CLI 对应字段和产物路径。
  - browser/network 错误计数。
- 不得只引用 `.codex-tmp` 作为最终事实来源。

### 文档状态

- 更新 `docs/dev/runtime-preview/issues.md`：
  - `RP-ISSUE-007` 的状态和结论必须说明本次解决的是 “sequential dynamic import 与 Editor preview static deps 不一致”，不是泛化的“全并发加速”。
  - `RP-ISSUE-019` 的状态和结论必须覆盖 project template、CLI boot script、Default device 三部分。
- 更新 `docs/dev/runtime-preview/acceptance/matrix.md` 中相关 `partial` 项的证据和状态。
- 只有实现、测试、facts、acceptance matrix 都完成后，才能把对应 issue 标为 `fixed`。
