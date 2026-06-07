# Runtime Preview 验证与溯源执行计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立一套从需求意图推导出来的 runtime preview 验证、真实浏览器验收和 CLI/engine 改动溯源流程，避免再次用错误实现方式推进。

**Architecture:** 计划按验证层级推进：先稳定短链路 Vitest，再修 CLI AssetDB output 与 editor output 对齐，然后补真实 server、浏览器运行期监听、P6 / feature-c 验收。CLI 和 engine 改动必须通过 traceability ledger 建立对应关系，每个 engine patch 都要能指向 CLI 行为、测试和验收证据。

**Tech Stack:** TypeScript, Vitest, Node.js HTTP server, Cocos Creator 3.8.6 engine source, cocos-cli AssetDB/builder/scripting, Playwright or equivalent browser automation, project `library` and `temp/programming` artifacts.

---

## 0. 执行原则

### 0.1 事实顺序

所有实现和测试必须按以下事实顺序判断：

1. 当前 engine source：`D:\workspace\engines\cocos\3.8.6`。
2. 当前 CLI source：`E:\own_space\engines\cocos-cli`。
3. 冻结 editor `library` 和 `temp/programming`。
4. 旧 editor preview server source。
5. CLI 备份分支实现和文档。

备份分支只能提供需求意图、route 名称、历史问题和测试启发，不能作为 URL mapping、library resolver、settings 或 bundle config 的权威。

### 0.2 提交规则

不要求每个小 step 都提交。提交边界按“可独立回滚、可独立验证、语义完整”判断：

- 文档事实或计划更新完成后提交。
- 一个测试层级新增并通过后提交。
- 一个实现模块和对应测试通过后提交。
- engine patch 和 CLI patch 尽量分开提交，但必须在 traceability ledger 中建立对应关系。
- 不把多个未相关的修复堆成一个提交。

### 0.3 禁止方向

- 不通过 full manifest / startup recursive scan 建 URL index。
- 不按 URL tail 猜 library 文件。
- 不按 extname 猜 import/native 语义。
- 不手写 internal bundle config。
- 不用 frozen editor output 替代 production output。
- 不用 mock Cocos public API 证明 engine runtime loading 成功。
- 不用打开浏览器瞬间无错误作为验收通过。

## 1. 目标验收矩阵

### Task 1: 建立需求意图到测试的验收矩阵

**Files:**

- Create: `docs/dev/runtime-preview-acceptance-matrix-20260607.md`
- Reference: `docs/dev/runtime-preview-intent-boundaries-status-20260607.md`
- Reference: `docs/dev/runtime-preview-cli-design-20260606.md`

- [ ] **Step 1: 写验收矩阵文档**

文档必须包含以下列：

```markdown
| 需求意图 | 验收层级 | 通过条件 | 证据文件/测试 | 当前状态 |
| --- | --- | --- | --- | --- |
```

至少覆盖这些需求意图：

- 独立 `preview --runtime`，不启动 scene RPC/MCP/editor scene service。
- URL 由 engine runtime/settings/bundle config 生成，server 不猜 URL。
- `settings.js` 来自 CLI `getPreviewSettings()` 或等价封装。
- `library` 与 `temp/programming` 使用真实产物事实。
- scripting route 由 preview records/chunks 和 `dependScripts` 驱动。
- extension asset-db 支持，不硬编码 `view-state-group`。
- 启动反馈和日志可见。
- 编译慢有指标，不用清 cache 掩盖。
- 真实 browser runtime smoke 需要等待稳定窗口。
- P6 / feature-c 大项目验收。

- [ ] **Step 2: 标注当前测试状态**

必须使用这些状态值：

- `done`
- `partial`
- `unstable`
- `missing`
- `blocked-by-fact-gap`

当前已知状态至少应包含：

- `suites/runtime-preview` full-suite 当前为 `unstable`，原因是 full-suite 下 `settings-generation.test.ts` 曾 30s timeout，但单文件通过。
- `pre-browser-http-smoke.test.ts` 为 `partial/done`，它不代表 browser integration。
- browser runtime smoke 为 `missing`。
- P6 / feature-c 验收为 `missing`。

- [ ] **Step 3: 提交验收矩阵**

Run:

```powershell
rtk git add docs/dev/runtime-preview-acceptance-matrix-20260607.md
rtk git commit -m "docs(runtime-preview): add acceptance matrix"
```

Expected:

- 只提交验收矩阵文档。

## 2. CLI / Engine 改动溯源

### Task 2: 建立 traceability ledger

**Files:**

- Create: `docs/dev/runtime-preview-change-traceability-20260607.md`
- Reference: `docs/dev/runtime-preview-intent-boundaries-status-20260607.md`
- Reference: engine repo `D:\workspace\engines\cocos\3.8.6`
- Reference: CLI repo `E:\own_space\engines\cocos-cli`

- [ ] **Step 1: 写 ledger 表结构**

文档必须包含这个表：

```markdown
| ID | 需求/问题 | CLI commit/file | Engine commit/file | 事实来源 | 验证命令 | 当前状态 |
| --- | --- | --- | --- | --- | --- | --- |
```

字段含义：

- `ID`：例如 `RP-ENGINE-001`。
- `需求/问题`：例如 `Vitest 引入真实 engine source 需要 NODEJS PAL host boundary`。
- `CLI commit/file`：对应 CLI 提交或文件。
- `Engine commit/file`：对应 engine 提交或文件。
- `事实来源`：engine source、CLI source、frozen output、旧 editor source、备份分支。
- `验证命令`：必须是可运行命令。
- `当前状态`：`active`、`candidate`、`obsolete`、`needs-review`。

- [ ] **Step 2: 记录当前已知 engine patch**

至少写入：

```markdown
| RP-ENGINE-001 | runtime preview Vitest 和 CLI runtime path 需要 Node.js PAL / host boundary | `vitests/shared/**`, `src/runtime-preview/**` | `ec7f8d2161 feat(runtime-preview): add nodejs pal adapter`, `cc.config.json`, `pal/**/nodejs` | engine backup + current 3.8.6 source + engine-source probe | `npm --prefix vitests test -- suites/runtime-preview/engine-source-runtime.probe.test.ts` | active |
```

如果某个 CLI commit 尚不能精确对应，状态必须写 `needs-review`，不能虚构对应关系。

- [ ] **Step 3: 后续每个 engine patch 必须补 ledger**

计划中写明规则：

- engine patch 不能只写“适配 runtime preview”。
- 必须说明它对应哪个 CLI 测试或 CLI 行为。
- 如果 engine patch 影响非 runtime preview 语义，状态先写 `needs-review`。

- [ ] **Step 4: 提交 ledger**

Run:

```powershell
rtk git add docs/dev/runtime-preview-change-traceability-20260607.md
rtk git commit -m "docs(runtime-preview): add cli engine traceability ledger"
```

Expected:

- 只提交 traceability 文档。

## 3. 稳定短链路测试

### Task 3: 修复 `vitests` full-suite 不稳定

**Files:**

- Inspect: `vitests/suites/runtime-preview/settings-generation.test.ts`
- Inspect: `vitests/vitest.config.ts`
- Inspect: `vitests/shared/fixture-paths.ts`
- Modify as needed: test timeout, test isolation, real Engine init placement

- [ ] **Step 1: 复现 full-suite 超时**

Run:

```powershell
rtk powershell -NoProfile -Command "`$env:COCOS_CLI_TEST_PROJECT_ROOT='E:/own_space/cocos_work_lab_38x'; `$env:COCOS_CLI_TEST_ENGINE_ROOT='D:/workspace/engines/cocos/3.8.6'; `$env:COCOS_CLI_TEST_EDITOR_LIBRARY_REF='E:/own_space/engines/cocos-cli/.codex-tmp/reference-library/cocos_work_lab_38x-editor-library-20260606'; `$env:COCOS_CLI_TEST_EDITOR_PROGRAMMING_REF='E:/own_space/engines/cocos-cli/.codex-tmp/reference-temp/cocos_work_lab_38x-editor-programming-20260606'; npm --prefix vitests test -- suites/runtime-preview"
```

Expected:

- Either all pass, or the known failure is `settings-generation.test.ts` timeout.
- Record duration and failure in `docs/dev/runtime-preview-acceptance-matrix-20260607.md`.

- [ ] **Step 2: 判断是功能失败还是并发/timeout 问题**

Run:

```powershell
rtk powershell -NoProfile -Command "`$env:COCOS_CLI_TEST_PROJECT_ROOT='E:/own_space/cocos_work_lab_38x'; `$env:COCOS_CLI_TEST_ENGINE_ROOT='D:/workspace/engines/cocos/3.8.6'; `$env:COCOS_CLI_TEST_EDITOR_LIBRARY_REF='E:/own_space/engines/cocos-cli/.codex-tmp/reference-library/cocos_work_lab_38x-editor-library-20260606'; `$env:COCOS_CLI_TEST_EDITOR_PROGRAMMING_REF='E:/own_space/engines/cocos-cli/.codex-tmp/reference-temp/cocos_work_lab_38x-editor-programming-20260606'; npm --prefix vitests test -- suites/runtime-preview/settings-generation.test.ts"
```

Expected:

- If single file passes, classify as `unstable`, not feature failure.
- If single file fails, stop and debug actual failure.

- [ ] **Step 3: 实现最小稳定性修复**

Allowed fixes:

- Increase timeout only for real engine init test if timing evidence supports it.
- Move real engine init into a serial suite if parallel suite contention is the cause.
- Avoid duplicate real engine init across tests if current harness supports reuse safely.

Forbidden fixes:

- Do not skip the real engine init test.
- Do not mock `Engine.initEngine()` for this test.
- Do not loosen assertions so the test no longer proves real Windows absolute engine path handling.

- [ ] **Step 4: 验证 full-suite**

Run the same full-suite command from Step 1.

Expected:

- `11 files / 26 tests` pass.

- [ ] **Step 5: 提交稳定性修复**

Run:

```powershell
rtk git add vitests docs/dev/runtime-preview-acceptance-matrix-20260607.md
rtk git commit -m "test(runtime-preview): stabilize full suite"
```

Expected:

- Commit includes only test stability changes and matrix status update.

## 4. 真实 CLI AssetDB output consistency

### Task 4: 修复或明确 CLI output 与 editor output 差异

**Files:**

- Inspect: `src/core/assets/asset-config.ts`
- Inspect: `src/core/assets/manager/asset-db.ts`
- Inspect: `src/core/engine/index.ts`
- Inspect: `src/core/builder/index.ts`
- Test: `vitests/suites/runtime-preview/editor-cli-output-consistency.test.ts`
- Docs: `docs/dev/runtime-preview-acceptance-matrix-20260607.md`

- [ ] **Step 1: 运行当前 consistency 测试**

Run:

```powershell
rtk powershell -NoProfile -Command "`$env:COCOS_CLI_TEST_PROJECT_ROOT='E:/own_space/cocos_work_lab_38x'; `$env:COCOS_CLI_TEST_ENGINE_ROOT='D:/workspace/engines/cocos/3.8.6'; `$env:COCOS_CLI_TEST_EDITOR_LIBRARY_REF='E:/own_space/engines/cocos-cli/.codex-tmp/reference-library/cocos_work_lab_38x-editor-library-20260606'; `$env:COCOS_CLI_TEST_EDITOR_PROGRAMMING_REF='E:/own_space/engines/cocos-cli/.codex-tmp/reference-temp/cocos_work_lab_38x-editor-programming-20260606'; npm --prefix vitests test -- suites/runtime-preview/editor-cli-output-consistency.test.ts"
```

Expected:

- Test passes as diagnostic, but matrix status remains `partial` or `blocked-by-fact-gap` if CLI output is incomplete.

- [ ] **Step 2: 写 CLI generation diagnostic**

Add or update test to classify:

- `library/cli/.assets-data.json`
- `library/cli/.assets-info1.0.0.json`
- `library/cli/.internal-data.json`
- representative serialized JSON
- representative native image
- TTF subdirectory file
- binary native-like file
- `temp/cli/programming/packer-driver/targets/preview/import-map.json`

Expected:

- Test must not treat missing CLI output as success.
- Missing fields must produce explicit diagnostic category.

- [ ] **Step 3: 修生成链或标明阻塞**

If failure is due to skipping `Engine.initEngine()`:

- Fix CLI generation probe to use real editor engine preload.
- Do not patch server resolver to compensate for missing generated files.

If output shape differs from editor:

- Trace to AssetDB source and engine runtime consumption.
- Decide whether CLI output should change or server should handle both shapes.

- [ ] **Step 4: 提交 output consistency 进展**

Commit only when one of these is true:

- CLI output generation fixed and tests prove representative consistency.
- Or diagnostic document/test precisely identifies the next source-level blocker.

Commit message:

```powershell
rtk git commit -m "test(runtime-preview): classify cli assetdb output consistency"
```

## 5. Production asset route completion

### Task 5: 补 native / pack / redirect / extension route facts

**Files:**

- Modify as needed: `src/runtime-preview/library/resolve-library-request.ts`
- Modify as needed: `src/runtime-preview/server/runtime-preview-routes.ts`
- Test: `vitests/suites/runtime-preview/http-url-capture.probe.test.ts`
- Test: `vitests/suites/runtime-preview/http-contract.test.ts`
- Test: `vitests/suites/runtime-preview/launcher-runtime-preview.test.ts`

- [ ] **Step 1: native production mapping**

Use HTTP-base captured ImageAsset native URL as input.

Expected:

- In test-only captured mode, captured native URL resolves.
- In production mode, native request resolves only when bundle config / AssetDB metadata proves native dependency.
- Unproven native tail returns 404.

- [ ] **Step 2: pack capture**

Find or construct a fact-backed bundle config/sample that triggers engine `packManager.load()`.

Forbidden:

- Do not write approximate `/assets/.../import/<pack>.json` URL manually.

Expected:

- Captured request has `routeCategory = pack`.
- Resolver maps pack URL by bundle config `packs` fact.

- [ ] **Step 3: redirect capture**

Find or construct a fact-backed `redirect` sample.

Expected:

- Engine `url-transformer.parse()` redirects to another bundle config.
- Captured URL proves redirected bundle path.
- Resolver uses bundle config redirect fact.

- [ ] **Step 4: extension asset-db route**

Use frozen `.view-state-group-data.json` / `.view-state-group-info1.0.0.json` and current CLI AssetDB source to design request-time mapping.

Forbidden:

- Do not copy backup resolver-first code.
- Do not hardcode `view-state-group` as a special case.

Expected:

- Test has a generic extension mount case.
- `view-state-group` is only a fixture instance.

- [ ] **Step 5: 提交 asset route completion**

Commit after each independent route category reaches a tested contract:

```powershell
rtk git commit -m "feat(runtime-preview): serve fact-backed native asset requests"
rtk git commit -m "test(runtime-preview): capture pack and redirect asset urls"
rtk git commit -m "feat(runtime-preview): support extension assetdb library requests"
```

Use only the commit messages that match actual completed work.

## 6. Scripting route completion

### Task 6: 补 SystemJS、macro、import-map-global、plugins/script2library

**Files:**

- Modify: `src/runtime-preview/programming/resolve-programming-request.ts`
- Modify: `src/runtime-preview/server/runtime-preview-routes.ts`
- Test: `vitests/suites/runtime-preview/script-runtime-map.test.ts`
- Test: `vitests/suites/runtime-preview/http-contract.test.ts`

- [ ] **Step 1: SystemJS route**

Verify current CLI programming output path for SystemJS:

- project `temp/programming/preview/systemjs/system.js`
- or CLI `temp/cli/programming/preview/systemjs/system.js`
- or current `ProgrammingFacet` source-defined path.

Expected:

- `/scripting/systemjs/system.js` serves real file.

- [ ] **Step 2: macro route**

Verify `cc/userland/macro` target from current static import map.

Expected:

- `/scripting/userland/macro` serves `custom-macro.js` or returns clear diagnostic if missing.

- [ ] **Step 3: import-map-global route**

Use current CLI/engine scripting fact, not hardcoded old editor content.

Expected:

- `/scripting/import-map-global` returns import map containing required `cc`, `cc/env`, `cc/userland/macro` entries when current source proves them.

- [ ] **Step 4: plugins/script2library route**

Use `PreviewSettingsProvider.scriptRuntimeMap.script2library`.

Expected:

- `/plugins/*` request maps to real compiled script library file.
- Test includes a negative case where unknown plugin/script returns 404.

- [ ] **Step 5: 提交 scripting routes**

Run:

```powershell
rtk git add src/runtime-preview vitests/suites/runtime-preview
rtk git commit -m "feat(runtime-preview): serve fact-backed scripting routes"
```

## 7. Startup diagnostics and logs

### Task 7: 恢复 runtime preview startup diagnostics

**Files:**

- Create or modify: `src/runtime-preview/logging/runtime-preview-logger.ts`
- Modify: `src/core/launcher.ts`
- Modify: `src/runtime-preview/server/runtime-preview-server.ts`
- Test: `vitests/suites/runtime-preview/cli-startup.test.ts`
- Test: `vitests/suites/runtime-preview/launcher-runtime-preview.test.ts`

- [ ] **Step 1: 定义日志 contract**

Log file:

```text
<project>/temp/preview-logs/runtime-preview-YYYYMMDD-HHMMSS.log
```

Must include:

- project root
- engine root
- library root
- programming root
- server URL
- stage start/done
- settings generation duration
- browser `/preview-error` if route is implemented

- [ ] **Step 2: 控制台阶段输出**

At minimum:

- `engine:init:start/done`
- `asset-db:start/done`
- `builder:init:start/done`
- `server:listening`
- settings timeout or error summary

Do not implement a complex progress UI in this task.

- [ ] **Step 3: 测试日志文件和控制台摘要**

Expected:

- startup test can assert log file exists.
- log file contains roots and server URL.
- console output includes listening URL.

- [ ] **Step 4: 提交 diagnostics**

Run:

```powershell
rtk git add src/runtime-preview src/core/launcher.ts vitests/suites/runtime-preview
rtk git commit -m "feat(runtime-preview): add startup diagnostics"
```

## 8. 真实 preview server browser smoke

### Task 8: 实现真实浏览器运行期验收

**Files:**

- Create: `vitests/suites/runtime-preview/browser-runtime-smoke.test.ts`
- Create or modify: `vitests/shared/browser-runtime-smoke.ts`
- Modify as needed: `src/runtime-preview/server/runtime-preview-routes.ts`
- Modify as needed: root preview page route when factual source is ready

- [ ] **Step 1: 明确 browser smoke 前置条件**

Browser smoke can run only after:

- full `suites/runtime-preview` is stable.
- real CLI server startup works.
- `/settings.js` works through real provider.
- representative import/native asset routes work.
- scripting SystemJS/import-map/chunk routes work.
- root preview page route exists or a factual preview-app entry exists.

- [ ] **Step 2: 启动真实 preview server**

Test should start actual runtime preview server path, not only `handleRuntimePreviewRequest()`.

Expected:

- server listens on `127.0.0.1` random or configured free port.
- test captures server URL.
- server logs startup roots.

- [ ] **Step 3: 打开浏览器并监听运行期**

Use Playwright or equivalent browser automation.

Must capture:

- `console` messages
- `pageerror`
- failed network requests
- HTTP status >= 400 for runtime routes
- runtime preview log file

Wait policy:

- Do not pass immediately after page open.
- Wait for a runtime-ready signal, or wait until required requests complete and then observe a stable window.
- Minimum stable window: 5 seconds after scene/resources load signal, unless a stronger engine-ready signal is implemented.

- [ ] **Step 4: 定义失败条件**

Fail on:

- unhandled page error
- console error not explicitly allowlisted
- missing `/settings.js`
- missing bundle config/index
- missing required scripting file
- missing captured import/native asset
- scene/resource load timeout
- network request to runtime server with 404/500 not explicitly diagnostic

- [ ] **Step 5: 定义通过证据**

Test output must record:

- server URL
- elapsed startup time
- elapsed browser ready time
- number of network requests
- number of console errors
- loaded scene or representative resource marker
- log file path

- [ ] **Step 6: 提交 browser smoke**

Run:

```powershell
rtk git add vitests src/runtime-preview
rtk git commit -m "test(runtime-preview): add browser runtime smoke"
```

## 9. P6 / feature-c 大项目验收

### Task 9: 设计并执行大项目验收

**Files:**

- Create: `docs/dev/runtime-preview-p6-acceptance-20260607.md`
- Reference project: `F:\ps_copy\p6\trunk\Project\GameClient\feature-c`
- Reference tests: `F:\ps_copy\p6\trunk\Project\GameClient\Client-ai_master\tests`

- [ ] **Step 1: 写大项目验收输入**

Document:

- project path
- engine path
- CLI command
- expected port
- expected log paths
- known native-only static import boundary
- extension asset-db domains expected

- [ ] **Step 2: 启动真实 runtime preview**

Run:

```powershell
rtk powershell -NoProfile -Command "Set-Location -LiteralPath 'F:\ps_copy\p6\trunk\Project\GameClient\feature-c'; node 'E:\own_space\engines\cocos-cli\dist\cli.js' preview --runtime --host 0.0.0.0 --port 19530"
```

If the port is occupied:

- identify the process.
- do not kill it without checking whether it is current test server.

- [ ] **Step 3: 收集性能和编译指标**

From packer debug log, collect:

- `Build iteration starts` count
- `Target(editor) build already in progress` count
- `Target(preview) build already in progress` count
- max `Number of accumulated asset changes`
- `script:collect` duration if implemented
- `script:compile` duration if implemented

- [ ] **Step 4: 浏览器运行期观测**

Use the same browser smoke rules as Task 8, but record P6-specific failures separately:

- extension asset-db missing domain
- native-only static import
- CommonJS bare specifier fallback
- tdanalytics-style CJS facade issue
- slow script compile

- [ ] **Step 5: 写验收结论**

Conclusion categories:

- `pass`
- `pass-with-known-project-boundary`
- `fail-cli-runtime-preview`
- `fail-engine-adaptation`
- `fail-project-side-boundary`
- `blocked`

- [ ] **Step 6: 提交大项目验收文档**

Run:

```powershell
rtk git add docs/dev/runtime-preview-p6-acceptance-20260607.md
rtk git commit -m "docs(runtime-preview): record p6 acceptance results"
```

## 10. 最终完成标准

Runtime preview 不能只因为短链路测试通过就标完成。完成标准是：

1. `suites/runtime-preview` full-suite 在完整环境变量下稳定通过。
2. CLI/editor output consistency 有明确结论；若不一致，差异已修复或被事实证明可接受。
3. import、native、pack、redirect、extension asset-db route 都有 fact-backed contract 或明确的未触发证明。
4. scripting route 覆盖 SystemJS、macro、import-map-global、chunks、project script、`script2library`。
5. 启动 diagnostics 和 runtime preview log 可定位 engine、AssetDB、builder、settings、server、browser error。
6. 真实 preview server browser smoke 通过，且观察稳定窗口，不是打开瞬间通过。
7. P6 / feature-c 验收有结论，并能区分 CLI 问题、engine adaptation 问题和项目侧边界。
8. CLI commit 与 engine commit 的 traceability ledger 完整。

## 11. 当前优先级

下一步不应先补浏览器测试。必须先执行：

1. Task 1：验收矩阵。
2. Task 2：CLI/engine traceability ledger。
3. Task 3：稳定 full-suite。

原因：

- 没有验收矩阵，测试会继续从实现倒推。
- 没有 ledger，engine patch 和 CLI patch 后续不可追溯。
- full-suite 不稳定时，浏览器失败无法判断是功能问题还是测试环境问题。
