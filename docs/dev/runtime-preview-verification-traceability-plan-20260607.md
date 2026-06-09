# Runtime Preview 验证与溯源执行计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立一套从需求意图推导出来的 runtime preview 验证、真实浏览器验收和 CLI/engine 改动溯源流程，避免再次用错误实现方式推进。

**Architecture:** 计划按验证层级推进：先稳定短链路 Vitest，再修 CLI AssetDB output 与 editor output 对齐，然后用小项目 `E:\own_space\cocos_work_lab_38x` 补真实 server、浏览器运行期监听和集成验收。P6 / feature-c 暂时不参与当前测试和验收，只保留为后续 deferred 场景；CLI 和 engine 改动必须通过 traceability ledger 建立对应关系，每个 engine patch 都要能指向 CLI 行为、测试和验收证据。

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

冻结 editor `library` 和 `temp/programming` 已完成。后续每个测试和实现必须标明它们使用冻结产物的角色：`hard input`、`compatibility baseline`、`test fixture` 或 `not used`。如果某项实现不再使用冻结产物作为判断依据，必须在验收矩阵中写明降级原因，不能默默把 frozen output 变成普通参考。

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
- 不让 CLI server、root template 或自写 glue code 猜测并覆盖 `assets.importBase`、`assets.nativeBase`、bundle config、internal route 或 engine/runtime 已生成的 URL。Creator 3.8.6 `preview-app` 官方源码中的 `assets/general/import` / `assets/general/native` override 是 browser preview bootstrap 事实，可以保留，但 server 必须按该事实服务请求，不能用 URL tail 猜 library。

## 1. 目标验收矩阵

### Task 1: 建立需求意图到测试的验收矩阵

**Files:**

- Create: `docs/dev/runtime-preview-acceptance-matrix-20260607.md`
- Reference: `docs/dev/runtime-preview-intent-boundaries-status-20260607.md`
- Reference: `docs/dev/runtime-preview-cli-design-20260606.md`

- [x] **Step 1: 写验收矩阵文档**

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
- 冻结 editor `library` / `temp/programming` 在每项测试中的角色必须标明为 `hard input`、`compatibility baseline`、`test fixture` 或 `not used`。
- scripting route 由 preview records/chunks 和 `dependScripts` 驱动。
- 小项目 extension asset-db fact check：处理或证明 `ViewStateGroup` 在小项目 runtime 中的触发情况，不硬编码 `view-state-group`。
- 启动反馈和日志可见。
- 编译慢有指标，不用清 cache 掩盖。
- 真实 browser runtime smoke 需要等待稳定窗口。
- 小项目 `E:\own_space\cocos_work_lab_38x` 真实 server / browser integration 验收。
- P6 / feature-c 大项目验收当前为 deferred，不作为当前完成门槛。

- [x] **Step 2: 标注当前测试状态**

必须使用这些状态值：

- `done`
- `partial`
- `unstable`
- `missing`
- `blocked-by-fact-gap`
- `deferred`

当前已知状态至少应包含并保持同步：

- `suites/runtime-preview` full-suite 当前为 `done`；最近证据为 Task 8A 后 `12 files / 40 tests passed`。此前 `settings-generation.test.ts` / real Launcher `/settings.js` 30s timeout 只保留为历史风险，不再作为当前状态。
- `pre-browser-http-smoke.test.ts` 为 `partial`，说明 HTTP smoke 已覆盖但不代表 browser integration。
- browser runtime smoke 为 `missing`。
- 小项目真实 browser integration 验收为 `missing`。
- P6 / feature-c 验收为 `deferred`，不参与当前测试和验收。

- [x] **Step 3: 提交验收矩阵**

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

- [x] **Step 1: 写 ledger 表结构**

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

- [x] **Step 2: 记录当前已知 engine patch**

至少写入：

```markdown
| RP-ENGINE-001 | runtime preview Vitest 和 CLI runtime path 需要 Node.js PAL / host boundary | `needs-review: map exact CLI commits/files/tests before active` | `ec7f8d2161 feat(runtime-preview): add nodejs pal adapter`, `cc.config.json`, `pal/**/nodejs` | engine backup + current 3.8.6 source + engine-source probe | `npm --prefix vitests test -- suites/runtime-preview/engine-source-runtime.probe.test.ts` | needs-review |
```

如果某个 CLI commit 尚不能精确对应，状态必须写 `needs-review`，不能虚构对应关系。

- [x] **Step 3: 后续每个 engine patch 必须补 ledger**

计划中写明规则：

- engine patch 不能只写“适配 runtime preview”。
- 必须说明它对应哪个 CLI 测试或 CLI 行为。
- 没有 CLI commit、CLI test、CLI behavior 三者闭环时，状态不能写 `active`。
- 如果 engine patch 影响非 runtime preview 语义，状态先写 `needs-review`。

- [x] **Step 4: 提交 ledger**

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

- [x] **Step 1: 复现 full-suite 超时**

Run:

```powershell
rtk powershell -NoProfile -Command "`$env:COCOS_CLI_TEST_PROJECT_ROOT='E:/own_space/cocos_work_lab_38x'; `$env:COCOS_CLI_TEST_ENGINE_ROOT='D:/workspace/engines/cocos/3.8.6'; `$env:COCOS_CLI_TEST_EDITOR_LIBRARY_REF='E:/own_space/engines/cocos-cli/.codex-tmp/reference-library/cocos_work_lab_38x-editor-library-20260606'; `$env:COCOS_CLI_TEST_EDITOR_PROGRAMMING_REF='E:/own_space/engines/cocos-cli/.codex-tmp/reference-temp/cocos_work_lab_38x-editor-programming-20260606'; npm --prefix vitests test -- suites/runtime-preview"
```

Current evidence:

- 该问题已复现并归类为真实 engine init 在 full-suite 下的耗时/并发风险，不是功能断言失败。
- Task 4 后 full-suite 证据为 `npm --prefix vitests test -- suites/runtime-preview` 通过，`11 files / 36 tests passed`；Task 8A 后最新 full-suite 证据为 `12 files / 40 tests passed`。

- [x] **Step 2: 判断是功能失败还是并发/timeout 问题**

Run:

```powershell
rtk powershell -NoProfile -Command "`$env:COCOS_CLI_TEST_PROJECT_ROOT='E:/own_space/cocos_work_lab_38x'; `$env:COCOS_CLI_TEST_ENGINE_ROOT='D:/workspace/engines/cocos/3.8.6'; `$env:COCOS_CLI_TEST_EDITOR_LIBRARY_REF='E:/own_space/engines/cocos-cli/.codex-tmp/reference-library/cocos_work_lab_38x-editor-library-20260606'; `$env:COCOS_CLI_TEST_EDITOR_PROGRAMMING_REF='E:/own_space/engines/cocos-cli/.codex-tmp/reference-temp/cocos_work_lab_38x-editor-programming-20260606'; npm --prefix vitests test -- suites/runtime-preview/settings-generation.test.ts"
```

Current evidence:

- 单文件真实 Engine 初始化可通过；历史 30s timeout 已归类为环境耗时风险。

- [x] **Step 3: 实现最小稳定性修复**

Allowed fixes:

- Increase timeout only for real engine init test if timing evidence supports it.
- Move real engine init into a serial suite if parallel suite contention is the cause.
- Avoid duplicate real engine init across tests if current harness supports reuse safely.

Forbidden fixes:

- Do not skip the real engine init test.
- Do not mock `Engine.initEngine()` for this test.
- Do not loosen assertions so the test no longer proves real Windows absolute engine path handling.

- [x] **Step 4: 验证 full-suite**

Run the same full-suite command from Step 1.

Expected:

- 当前最近证据为 Task 8A 后 `12 files / 40 tests passed`；以 full-suite pass、无 skipped real-engine test、无 unexpected timeout 为准。新增测试后不要用旧文件数/用例数判定失败。

- [x] **Step 5: 提交稳定性修复**

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

- [x] **Step 1: 运行当前 consistency 测试**

Run:

```powershell
rtk powershell -NoProfile -Command "`$env:COCOS_CLI_TEST_PROJECT_ROOT='E:/own_space/cocos_work_lab_38x'; `$env:COCOS_CLI_TEST_ENGINE_ROOT='D:/workspace/engines/cocos/3.8.6'; `$env:COCOS_CLI_TEST_EDITOR_LIBRARY_REF='E:/own_space/engines/cocos-cli/.codex-tmp/reference-library/cocos_work_lab_38x-editor-library-20260606'; `$env:COCOS_CLI_TEST_EDITOR_PROGRAMMING_REF='E:/own_space/engines/cocos-cli/.codex-tmp/reference-temp/cocos_work_lab_38x-editor-programming-20260606'; npm --prefix vitests test -- suites/runtime-preview/editor-cli-output-consistency.test.ts"
```

Expected:

- Test passes as diagnostic, but matrix status remains `partial` or `blocked-by-fact-gap` if CLI output or engine internal library output is incomplete.

Current evidence:

- `npm --prefix vitests test -- suites/runtime-preview/editor-cli-output-consistency.test.ts` passed, 4 tests.
- Diagnostic category remains `source-backed-split-library-layout`.

- [x] **Step 2: 写 CLI generation diagnostic**

Add or update test to classify:

- `library/cli/.assets-data.json`
- `library/cli/.assets-info.json`
- `library/cli/.assets-dependency.json`
- engine `editor/library/.internal-data.json`
- engine `editor/library/.internal-info.json`
- engine `editor/library/.internal-dependency.json`
- representative project serialized JSON / native image / atlas
- representative internal TTF / binary files in engine `editor/library`
- `temp/cli/programming/packer-driver/targets/preview/import-map.json`

Expected:

- Test must not treat missing CLI output or missing engine internal library output as success.
- Missing fields must produce explicit diagnostic category.

Current evidence:

- Test verifies current `library/cli` project metadata, engine `editor/library` internal metadata, representative project files, representative internal files, `temp/cli/programming/packer-driver/targets/preview/import-map.json`, and extension output.
- Test anchors this split layout to current output roots and `@cocos/asset-db` record naming behavior by instantiating `AssetDB.prepareStart()`.

- [x] **Step 3: 修生成链或标明阻塞**

If failure is due to skipping `Engine.initEngine()`:

- Fix CLI generation probe to use real editor engine preload.
- Do not patch server resolver to compensate for missing generated files.

If output shape differs from editor:

- Trace to AssetDB source and engine runtime consumption.
- Decide whether CLI output should change or server should handle both source-backed split layout and frozen editor reference layout in tests.

Current decision:

- Do not change CLI generation solely to mimic frozen editor `info1.0.0` metadata names. Current `@cocos/asset-db` writes `.info.json` files, and `src/core/assets/asset-config.ts` explicitly uses `library/cli`, engine `editor/library`, and `library/cli-extensions/*`.
- Runtime preview tests and resolver facts must handle current source-backed split layout plus frozen editor reference layout explicitly; server must not compensate by guessing URL tails or copying frozen output into production.
- Real Launcher `/settings.js` once reproduced the 30s default timeout during full-suite resource contention; `Launcher.startRuntimePreview()` now accepts `settingsTimeoutMs`, and the real Launcher test passes `120_000`. Production default remains `PreviewSettingsProvider`'s 30s unless explicitly overridden.

- [x] **Step 4: 提交 output consistency 进展**

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

- [x] **Step 1: native production mapping**

Use HTTP-base captured ImageAsset native URL as input.

Expected:

- In test-only captured mode, captured native URL resolves.
- In production mode, native request resolves only when bundle config / AssetDB metadata proves native dependency.
- Unproven native tail returns 404.

Current evidence:

- `vitests/suites/runtime-preview/launcher-runtime-preview.test.ts` covers a real engine-captured `ImageAsset` native URL without `capturedRuntimeUrls`.
- `src/runtime-preview/library/resolve-library-request.ts` only authorizes native requests when the bundle config maps the UUID to `cc.ImageAsset`.
- An existing but unconfigured native PNG returns 404.

- [x] **Step 2: pack not-triggered evidence recorded for current small project**

Find or construct a fact-backed bundle config/sample that triggers engine `packManager.load()`.

Allowed:

- 可以构造最小 fixture，但 fixture 的 bundle config、asset UUID、pack entry 和触发 URL 必须由当前 engine source、CLI output 或真实 generated artifact 证明。
- 可以先用 diagnostic test 证明小项目和当前 synthesized resources config 没有 pack 触发事实。

Forbidden:

- Do not write approximate `/assets/.../import/<pack>.json` URL manually.
- Do not hand-write a bundle config only to force a green test.
- Do not treat frozen editor output as the authority for production pack URL mapping.

Expected when a pack trigger exists:

- Captured request has `routeCategory = pack`.
- Resolver maps pack URL by bundle config `packs` fact.

Current evidence:

- Current synthesized resources bundle config has no `config.packs` entries.
- Real Launcher small-project provider `bundleConfigs` are enumerated completely; each served `/assets/<bundle>/config.json` route matches the provider pack summary, and no provider config currently has non-empty `packs`.
- Therefore current stage records `not-triggered-in-current-small-project`; no pack resolver implementation is added without a fact-backed pack URL.

- [x] **Step 3: redirect not-triggered evidence recorded for current small project**

Find or construct a fact-backed `redirect` sample.

Allowed:

- 可以构造最小 fixture，但 redirect source bundle、target bundle、asset UUID 和 generated URL 必须来自 engine source、CLI output 或真实 generated artifact。
- 如果当前小项目没有 redirect fact，先记录 `not-triggered-in-small-project`，不能为了实现 route 而虚构 redirect。

Forbidden:

- Do not manually invent redirect URL shape from old editor preview server or backup implementation.
- Do not use URL tail matching as redirect proof.

Expected when a redirect trigger exists:

- Engine `url-transformer.parse()` redirects to another bundle config.
- Captured URL proves redirected bundle path.
- Resolver uses bundle config redirect fact.

Current evidence:

- Current synthesized resources bundle config has empty `redirect`.
- Real Launcher small-project provider `bundleConfigs` are enumerated completely; each served `/assets/<bundle>/config.json` route matches the provider redirect summary, and no provider config currently has non-empty `redirect`.
- Therefore current stage records `not-triggered-in-current-small-project`; no redirect resolver implementation is added without a fact-backed redirected URL.

- [ ] **Step 4: 小项目 extension asset-db fact check**

当前阶段大项目不参与测试和验收，但小项目 `E:\own_space\cocos_work_lab_38x` 已包含 `extensions\ViewStateGroup\package.json`，且该 package 声明 `contributions["asset-db"].mount.path = "./assets"`。因此本阶段不能忽略 extension asset-db，也不能把通用 extension 语义作为完成门槛。

Current-scope rule:

- 如果小项目 runtime loading 实际触发 `ViewStateGroup` extension library/script/metadata request，必须基于小项目 package、当前 CLI AssetDB source、frozen metadata 和 engine/runtime 请求事实补齐 request-time mapping。
- 如果当前 representative HTTP capture 未触发 extension asset-db request，必须在验收矩阵中记录 `not-triggered-in-current-http-capture` 证据；真实 browser/small-project runtime 未触发只能由后续 browser smoke / integration 证据证明，不能提前推广。
- disabled extension skip、project/global package enable config、`mount.enable` 的完整组合语义 deferred 到后续 extension 专项计划；除非小项目当前事实直接触发这些条件，否则不进入本阶段完成标准。

Current evidence:

- `editor-cli-output-consistency.test.ts` verifies `extensions/ViewStateGroup/package.json` mount input, frozen `.view-state-group-*` metadata, and CLI `library/cli-extensions/view-state-group` output.
- `http-url-capture.probe.test.ts` verifies representative HTTP-base resource capture currently does not trigger `view-state-group` / `cli-extensions` runtime URLs; this is `not-triggered-in-current-http-capture`, not full browser/runtime proof.
- Browser/small-project runtime trigger remains unverified; do not claim generic extension resolver support from this evidence.

Forbidden:

- Do not copy backup resolver-first code.
- Do not hardcode `view-state-group` as a special case.
- Do not add generic extension mount fixtures just to satisfy this step.

Expected:

- Current stage has either a fact-backed `ViewStateGroup` contract from small-project runtime requests, or an explicit `not-triggered-in-small-project` proof.
- Any `view-state-group` handling remains derived from package/AssetDB facts, not a special-case URL rule.
- Generic extension semantics are documented as `deferred`, not `partial` current-stage failure.

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

- [x] **Step 1: SystemJS route**

Verify current CLI programming output path for SystemJS:

- project `temp/programming/preview/systemjs/system.js`
- or CLI `temp/cli/programming/preview/systemjs/system.js`
- or current `ProgrammingFacet` source-defined path.

Expected:

- `/scripting/systemjs/system.js` serves real file.

- [x] **Step 2: macro route**

Verify `cc/userland/macro` target from current static import map.

Expected:

- `/scripting/userland/macro` serves `custom-macro.js` or returns clear diagnostic if missing.

- [x] **Step 3: import-map-global route**

Use current CLI/engine scripting fact, not hardcoded old editor content.

Expected:

- `/scripting/import-map-global` returns import map containing required `cc`, `cc/env`, `cc/userland/macro` entries when current source proves them.

- [x] **Step 4: plugins/script2library route**

Use `PreviewSettingsProvider.scriptRuntimeMap.script2library`.

Expected:

- `/plugins/*` request maps to real compiled script library file.
- Test includes a negative case where unknown plugin/script returns 404.

Current evidence:

- `resolveProgrammingRequest()` serves `/scripting/systemjs/system.js` from current CLI `temp/cli/programming/preview/systemjs/system.js` when available, with frozen/current `projectProgrammingRoot` fallback for fixture compatibility.
- `resolveProgrammingRequest()` serves `/scripting/userland/macro` from current CLI `temp/cli/programming/custom-macro.js` when available, with frozen/current `projectProgrammingRoot` fallback for fixture compatibility.
- `/scripting/import-map-global` returns the current CLI `ProgrammingFacet` static import map contract: `cc -> q-bundled:///virtual/cc.js`, `cc/env`, `cce.env`, `cc/userland/macro -> ./userland/macro`.
- `/plugins/*` resolves through `PreviewSettingsProvider.scriptRuntimeMap.script2library`; only `.js` compiled script files under known programming/library roots are served. Relative paths only try fixed known programming/library candidate roots. No recursive scan or startup preload is introduced.

- [x] **Step 5: 提交 scripting routes**

Run:

```powershell
rtk git add src/runtime-preview vitests/suites/runtime-preview
rtk git commit -m "feat(runtime-preview): serve fact-backed scripting routes"
```

Completed verification:

- `npm --prefix vitests test -- suites/runtime-preview/script-runtime-map.test.ts suites/runtime-preview/http-contract.test.ts`: 2 files / 7 tests passed.
- `npm --prefix vitests test -- suites/runtime-preview`: 11 files / 34 tests passed.
- Senior subagent review: code approved after fixing `cliProgrammingRoot` precedence and `/plugins/*` path boundary; residual docs root conflict fixed before commit.

## 7. Startup diagnostics and logs

### Task 7: 恢复 runtime preview startup diagnostics

**Files:**

- Create or modify: `src/runtime-preview/logging/runtime-preview-logger.ts`
- Modify: `src/core/launcher.ts`
- Modify: `src/runtime-preview/server/runtime-preview-server.ts`
- Test: `vitests/suites/runtime-preview/cli-startup.test.ts`
- Test: `vitests/suites/runtime-preview/launcher-runtime-preview.test.ts`

- [x] **Step 1: 定义日志 contract**

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

- [x] **Step 2: 控制台阶段输出**

At minimum:

- `engine:init:start/done`
- `asset-db:start/done`
- `builder:init:start/done`
- `server:listening`
- settings timeout or error summary

Do not implement a complex progress UI in this task.

- [x] **Step 3: 测试日志文件和控制台摘要**

Expected:

- startup test can assert log file exists.
- log file contains roots and server URL.
- console output includes listening URL.

Current evidence:

- Runtime preview server creates `<project>/temp/preview-logs/runtime-preview-YYYYMMDD-HHMMSS.log`.
- Log file records project root, engine root, library root, programming roots, `server:listening`, and `settings:generation:done durationMs=...`.
- Launcher runtime preview stdout and log file record `server:listening`, `engine:init:start/done`, `asset-db:start/done`, and `builder:init:start/done`.
- `settings:generation:error` is logged with duration and error message if settings generation throws; `/settings.js` request failures also print a console summary.
- Known residual risk: log file name follows the planned `YYYYMMDD-HHMMSS` format, so multiple starts in the same project within one second append to the same file.

Verification:

- `npm --prefix vitests test -- suites/runtime-preview/cli-startup.test.ts suites/runtime-preview/launcher-runtime-preview.test.ts`: 2 files / 5 tests passed.
- Task 7 时 `npm --prefix vitests test -- suites/runtime-preview`: 11 files / 35 tests passed. Task 4 后 full-suite 基线为 11 files / 36 tests passed. 当前 Task 8A 后最新 full-suite 基线为 12 files / 40 tests passed.

- [x] **Step 4: 提交 diagnostics**

Run:

```powershell
rtk git add src/runtime-preview src/core/launcher.ts vitests/suites/runtime-preview
rtk git commit -m "feat(runtime-preview): add startup diagnostics"
```

## 8. 真实 preview server browser smoke

### Task 8A: 确认 preview page / preview-app 事实来源

**Files:**

- Inspect: current CLI source under `src/runtime-preview/**`
- Inspect: current engine source under `D:\workspace\engines\cocos\3.8.6`
- Inspect: old editor preview source under `E:\own_space\tmp-repos\runtime-preview-reference\cocos-cli-backup-runtime-preview-bad-20260606\docs\dev\reference`
- Inspect: backup implementation under `E:\own_space\tmp-repos\runtime-preview-reference\cocos-cli-backup-runtime-preview-bad-20260606`
- Create or modify: `docs/dev/runtime-preview-browser-entry-facts-20260607.md`
- Test: `vitests/suites/runtime-preview/browser-entry-contract.test.ts`
- Modify as needed: `src/runtime-preview/server/runtime-preview-routes.ts`

- [x] **Step 1: 建立 browser entry fact ledger**

Create `docs/dev/runtime-preview-browser-entry-facts-20260607.md` with this table:

```markdown
| Entry / route | Fact source | What it proves | What it does not prove | Status |
| --- | --- | --- | --- | --- |
```

Required rows:

- root preview page route or explicit absence in current CLI.
- old editor preview page / preview-app entry source.
- backup preview page / preview-app entry source.
- current engine/runtime facts consumed by the page, such as `/settings.js`, scripting routes, bundle config and asset manager generated URLs.

Rules:

- engine source and current CLI source are authoritative for runtime URL and route contracts.
- old editor / backup sources can prove historical route names, page boot order and business intent, but cannot prove current URL mapping.
- Historical Task 8A rule: do not create a browser smoke that pretends full preview exists while `/` and `/preview-app/*` are absent. Subsequent Task 8B changes this absence from a long-term `blocked-by-fact-gap` into an implementation requirement: production entry must be added from Creator preview-app source and adapted template.

Current evidence:

- Historical Task 8A evidence recorded CLI root `/` and `/preview-app/*` as implementation gaps before Task 8B.
- At Task 8A time, CLI had active `/settings.js`、bundle config/index、library、programming and scripting routes, but no production browser entry page; Task 8B has since added root `/` and `/preview-app/*`.
- Old editor source and backup implementation prove historical entry names and business intent only; they are not URL mapping authority.

- [x] **Step 2: Define root preview page / preview-app boundary**

Root preview page / preview-app may:

- load `/settings.js`.
- load engine scripts and current CLI scripting routes.
- let engine runtime generate bundle/import/native URLs.
- expose a test-observable ready signal only after real runtime facts are consumed.

Root preview page / preview-app must not:

- assign or overwrite `assets.importBase`, `assets.nativeBase`, `assets.server`, bundle config, internal route, native route, pack route or captured runtime URL from CLI server/template glue. Official Creator preview-app source may keep its `assets/general/import` and `assets/general/native` browser preview bootstrap override.
- contain URL/base/route mapping logic copied from old editor or backup implementation as authority.
- scan `library`, `temp`, `assets` or generated output at startup.
- turn a diagnostic browser harness into production preview page.

Current evidence:

- The boundary is documented in `runtime-preview-browser-entry-facts-20260607.md`.
- Future root page and CLI template glue can only consume current runtime facts; official Creator preview-app source may keep its browser preview bootstrap override, and server routes must support that fact without guessing library URLs.

- [x] **Step 3: Define ready signal ownership**

Classify `window.__RUNTIME_PREVIEW_READY` before implementing browser smoke:

- `production-contract`: set by production preview page after real scene/resource load.
- `test-injection`: injected only by browser test after verifying required HTTP/runtime facts.
- `diagnostic-harness`: set by a dedicated diagnostic page that is explicitly not full scene preview.

Only `production-contract` can satisfy final browser preview completion. `test-injection` or `diagnostic-harness` may support early browser-host/network validation, but acceptance matrix must mark the result as `partial`, not `done`.

Current evidence:

- Current production source has no `window.__RUNTIME_PREVIEW_READY` contract.
- Browser smoke remains blocked until Task 8C proves preview-app required routes and a ready signal is defined.

- [x] **Step 4: Add entry contract test**

Historical Task 8A `browser-entry-contract.test.ts` verified:

- the absence of `/` and `/preview-app/*` was recorded as a Task 8A implementation gap, not as desired contract.
- diagnostic route, if ever added, is named explicitly, such as `/__runtime-preview/browser-smoke`, and is not documented as root preview.
- subsequent Task 8B must change this test to require production root page and `/preview-app/*` success.

Current evidence:

- `vitests/suites/runtime-preview/browser-entry-contract.test.ts` now verifies production root `/` and `/preview-app/index.js` return `200`, `/settings.js` remains active, and official preview-app source may keep `assets/general/import/native` while CLI glue cannot own URL/base mapping.

- [x] **Step 5: Commit browser entry facts**

Run:

```powershell
rtk git add docs/dev/runtime-preview-browser-entry-facts-20260607.md vitests/suites/runtime-preview src/runtime-preview
rtk git commit -m "docs(runtime-preview): record browser entry facts"
```

Completed:

- Commit: `efe925c docs(runtime-preview): record browser entry facts`
- Verification: `npm --prefix vitests test -- suites/runtime-preview/browser-entry-contract.test.ts` passed, 1 file / 4 tests.
- Verification: `npm --prefix vitests test -- suites/runtime-preview` passed, 12 files / 40 tests.

Correction for subsequent tasks:

- Task 8A 只能作为“当前分支还没接入 production entry”的历史证据，不能作为长期 contract。
- `Creator 3.8.6 preview-app source + CLI adaptation` 已经由备份分支文档和源码证明是 runtime preview 的核心入口输入。Task 8A 当时的 `/` 和 `/preview-app/*` 404 已由 Task 8B 修复。
- `browser-entry-contract.test.ts` 后续必须改成要求 production entry 存在，而不是保护 404。
- 后续不记录 `app.asar` 重新提取 diff 细节；只记录来源边界：Creator 3.8.6 preview-app 源码为主输入，备份分支中的类型脱离和空 `launchScene` 保护可作为 CLI adaptation reference。

### Task 8B: 接入 Creator preview-app 源码和 root browser entry

**Files:**

- Source input: `E:\own_space\tmp-repos\runtime-preview-reference\cocos-cli-backup-runtime-preview-bad-20260606\src\runtime-preview\preview-app\**`
- Source input: `E:\own_space\tmp-repos\runtime-preview-reference\cocos-cli-backup-runtime-preview-bad-20260606\static\runtime-preview\script.ejs`
- Source input: `E:\own_space\tmp-repos\runtime-preview-reference\cocos-cli-backup-runtime-preview-bad-20260606\static\runtime-preview\toolbar.ejs`
- Source input: `E:\own_space\tmp-repos\runtime-preview-reference\cocos-cli-backup-runtime-preview-bad-20260606\static\runtime-preview\resources\**`
- Create: `src/runtime-preview/preview-app/src/index.ts`
- Create: `src/runtime-preview/preview-app/src/main.ts`
- Create: `src/runtime-preview/preview-app/src/ui.ts`
- Create: `src/runtime-preview/preview-app/@types/type.d.ts`
- Create: `src/runtime-preview/preview-app/tsconfig.json`
- Create: `src/runtime-preview/preview-app/readme.md`
- Create: `workflow/build-runtime-preview-app.js`
- Modify: `package.json`
- Modify as needed: root `tsconfig.json`
- Create or modify: `static/runtime-preview/script.ejs`
- Create or modify: `static/runtime-preview/toolbar.ejs`
- Create or modify: `static/runtime-preview/resources/**`
- Modify: `src/runtime-preview/server/runtime-preview-routes.ts`
- Create as needed: `src/runtime-preview/server/preview-entry-template.ts`
- Test: `vitests/suites/runtime-preview/browser-entry-contract.test.ts`

- [x] **Step 1: 修正 browser entry contract test**

Change `browser-entry-contract.test.ts` so it no longer asserts `/` and `/preview-app/index.js` are 404. The test must first fail until implementation is added.

Required assertions:

- `handleRuntimePreviewRequest(routeContext, '/')` returns `200`.
- root HTML contains `/settings.js`.
- root HTML contains `System.import("/preview-app/index.js")`.
- `handleRuntimePreviewRequest(routeContext, '/preview-app/index.js')` returns `200`.
- response content type for preview-app JS is JavaScript.
- preview-app source may contain the official `assets/general/import` and `assets/general/native` override; the test must not forbid this official source fact.
- test still forbids CLI server/template glue from assigning its own `assets.importBase` / `assets.nativeBase`.

Run:

```powershell
rtk powershell -NoProfile -Command "`$env:COCOS_CLI_TEST_PROJECT_ROOT='E:/own_space/cocos_work_lab_38x'; `$env:COCOS_CLI_TEST_ENGINE_ROOT='D:/workspace/engines/cocos/3.8.6'; `$env:COCOS_CLI_TEST_EDITOR_LIBRARY_REF='E:/own_space/engines/cocos-cli/.codex-tmp/reference-library/cocos_work_lab_38x-editor-library-20260606'; `$env:COCOS_CLI_TEST_EDITOR_PROGRAMMING_REF='E:/own_space/engines/cocos-cli/.codex-tmp/reference-temp/cocos_work_lab_38x-editor-programming-20260606'; npm --prefix vitests test -- suites/runtime-preview/browser-entry-contract.test.ts"
```

Expected:

- FAIL before implementation because `/` and `/preview-app/index.js` are not served yet.

- [x] **Step 2: 迁入 preview-app 源码，不手改编译产物**

Copy from backup source input into current repo:

```text
src/runtime-preview/preview-app/src/index.ts
src/runtime-preview/preview-app/src/main.ts
src/runtime-preview/preview-app/src/ui.ts
src/runtime-preview/preview-app/@types/type.d.ts
src/runtime-preview/preview-app/tsconfig.json
src/runtime-preview/preview-app/readme.md
```

Rules:

- Use source files as implementation input.
- Do not edit `static/runtime-preview/preview-app/*.js` manually.
- Keep the CLI adaptation that detaches builder type imports into `@types/type.d.ts`.
- Keep the empty `launchScene` guard from backup source.
- Do not add browser ready signal in this step.

- [x] **Step 3: 接入 preview-app build script**

Add `workflow/build-runtime-preview-app.js` from backup, and add package script:

```json
"build:runtime-preview-app": "tsc -p src/runtime-preview/preview-app/tsconfig.json && node workflow/build-runtime-preview-app.js"
```

If root `tsconfig.json` compiles `src/**/*.ts`, exclude preview-app source from main CLI CommonJS compilation:

```json
"exclude": [
  "src/runtime-preview/preview-app/**"
]
```

Run:

```powershell
rtk powershell -NoProfile -Command "npm run build:runtime-preview-app"
```

Expected:

- `static/runtime-preview/preview-app/index.js`
- `static/runtime-preview/preview-app/main.js`
- `static/runtime-preview/preview-app/ui.js`
- source maps and `.d.ts` files generated or copied by the build flow.

- [x] **Step 4: 接入 root template 和 `/preview-app/*` route**

Use backup `static/runtime-preview/script.ejs` / `toolbar.ejs` / `resources/**` as adapted browser entry input for this phase. Do not treat it as pure Creator original; it is CLI adapted template.

Implement route behavior:

- `GET /` renders runtime preview HTML.
- `GET /preview-app/*` serves files from `static/runtime-preview/preview-app`.
- `GET /static/runtime-preview/resources/*` or equivalent resource references in the template resolve without startup recursive scan.

Root render data must include:

- `settingsJs`: `/settings.js?scene=<scene>`
- `packImportMapURL`: `/scripting/x/<provider pack import map URL>` when provider exposes it, or a current CLI programming route that is fact-backed.
- `packResolutionDetailMapURL`: `/scripting/x/<provider resolution map URL>` when provider exposes it, or a current CLI programming route that is fact-backed.
- `devices`: a minimal device map sufficient for preview-app UI.

Forbidden:

- Do not implement resource URL mapping in the template.
- Do not let template override `assets.importBase` or `assets.nativeBase`.
- Do not introduce startup scan over `library`, `temp`, `assets`, or generated output.

- [x] **Step 5: 验证 browser entry HTTP contract**

Run:

```powershell
rtk powershell -NoProfile -Command "`$env:COCOS_CLI_TEST_PROJECT_ROOT='E:/own_space/cocos_work_lab_38x'; `$env:COCOS_CLI_TEST_ENGINE_ROOT='D:/workspace/engines/cocos/3.8.6'; `$env:COCOS_CLI_TEST_EDITOR_LIBRARY_REF='E:/own_space/engines/cocos-cli/.codex-tmp/reference-library/cocos_work_lab_38x-editor-library-20260606'; `$env:COCOS_CLI_TEST_EDITOR_PROGRAMMING_REF='E:/own_space/engines/cocos-cli/.codex-tmp/reference-temp/cocos_work_lab_38x-editor-programming-20260606'; npm --prefix vitests test -- suites/runtime-preview/browser-entry-contract.test.ts"
```

Expected:

- PASS.

Then run:

```powershell
rtk powershell -NoProfile -Command "`$env:COCOS_CLI_TEST_PROJECT_ROOT='E:/own_space/cocos_work_lab_38x'; `$env:COCOS_CLI_TEST_ENGINE_ROOT='D:/workspace/engines/cocos/3.8.6'; `$env:COCOS_CLI_TEST_EDITOR_LIBRARY_REF='E:/own_space/engines/cocos-cli/.codex-tmp/reference-library/cocos_work_lab_38x-editor-library-20260606'; `$env:COCOS_CLI_TEST_EDITOR_PROGRAMMING_REF='E:/own_space/engines/cocos-cli/.codex-tmp/reference-temp/cocos_work_lab_38x-editor-programming-20260606'; npm --prefix vitests test -- suites/runtime-preview"
```

Expected:

- Full runtime-preview suite passes.

- [x] **Step 6: 关键节点 review 和提交**

Dispatch senior review focused on:

- Whether preview-app is correctly treated as production entry, not diagnostic.
- Whether official preview-app `assets/general/import/native` override is allowed without letting CLI guess URL mapping.
- Whether route implementation avoids startup scans.
- Whether test coverage proves root page and `/preview-app/*` exist.

Commit:

```powershell
rtk git add src/runtime-preview/preview-app workflow/build-runtime-preview-app.js package.json tsconfig.json static/runtime-preview src/runtime-preview/server vitests/suites/runtime-preview/browser-entry-contract.test.ts docs/dev/runtime-preview-verification-traceability-plan-20260607.md
rtk git commit -m "feat(runtime-preview): add preview app browser entry"
```

Completed:

- RED verification: `npm --prefix vitests test -- suites/runtime-preview/browser-entry-contract.test.ts` failed before implementation because `/` returned 404 and `src/runtime-preview/preview-app` was absent.
- Build verification: `npm run build:runtime-preview-app` passed and generated `static/runtime-preview/preview-app`.
- Targeted verification: `npm --prefix vitests test -- suites/runtime-preview/browser-entry-contract.test.ts` passed, 1 file / 5 tests.
- Runtime preview suite: `npm --prefix vitests test -- suites/runtime-preview` passed, 12 files / 41 tests.
- Senior review fix: added encoded backslash traversal coverage and tightened `/preview-app/*` / static resources path resolution to their own subdirectory roots.
- Additional check: `npx tsc -b` still fails in existing `src/core/engine/editor-extends/utils/serialize/compiled/*` type conversions; no Task 8B runtime-preview file was reported in that failure.
- Scope boundary: Task 8B only proves production root `/` and `/preview-app/*`; `/scene-list`、`/scene/<uuid>.json`、`/preview-error`、`/socket.io/socket.io.js`、`assets/general/import/native` resource service remain Task 8C route inventory / required route work.

### Task 8C: 补 preview-app production entry 依赖的 HTTP routes

**Files:**

- Inspect: `src/runtime-preview/preview-app/src/index.ts`
- Inspect: `src/runtime-preview/preview-app/src/main.ts`
- Inspect: `static/runtime-preview/script.ejs`
- Modify: `src/runtime-preview/server/runtime-preview-routes.ts`
- Modify or create: `src/runtime-preview/programming/resolve-programming-request.ts`
- Modify or create: `src/runtime-preview/server/preview-scene-routes.ts`
- Modify or create: `src/runtime-preview/server/preview-error-routes.ts`
- Create: `docs/dev/runtime-preview-preview-app-route-inventory-20260608.md`
- Test: `vitests/suites/runtime-preview/browser-entry-contract.test.ts`
- Test: `vitests/suites/runtime-preview/preview-app-route-contract.test.ts`

- [x] **Step 1: 建立 preview-app route inventory**

After Task 8B migrates preview-app source and static template, inspect current source inputs and record every browser-requested route before writing implementation code:

- `src/runtime-preview/preview-app/src/index.ts`
- `src/runtime-preview/preview-app/src/main.ts`
- `src/runtime-preview/preview-app/src/ui.ts`
- `static/runtime-preview/script.ejs`
- `static/runtime-preview/toolbar.ejs`

Create `docs/dev/runtime-preview-preview-app-route-inventory-20260608.md` with:

```markdown
| Route or request source | Source file | Required by production entry | Fact owner | Implementation status |
| --- | --- | --- | --- | --- |
```

Classification rules:

- `production-entry-required`: requested by migrated preview-app/template and required for normal preview boot.
- `source-owned`: behavior owned by official Creator preview-app source, such as `assets/general/import` and `assets/general/native` bootstrap base.
- `optional-or-deferred`: requested only for optional UI/socket/profile behavior and explicitly safe to no-op or defer.
- `diagnostic-only`: failure/reporting route that must be logged but cannot prove preview completion by itself.

Expected inventory candidates include, but are not limited to:

- `/settings.js`
- `/preview-app/index.js`
- `/scripting/polyfills/bundle.js`
- `/scripting/engine/bin/.cache/dev-cli/web/import-map.json`
- `/scripting/engine/bin/.cache/dev-cli/web/bundled/index.js`
- `/scene-list`
- `/scene/<uuid>.json`
- `/missing-asset/<uuid>`
- `/preview-error`
- `/socket.io/socket.io.js`

The route inventory is the source for Task 8C tests. Do not add a route only because an old implementation had it; record the exact current preview-app/template request first.

Current evidence:

- `docs/dev/runtime-preview-preview-app-route-inventory-20260608.md` records routes requested by migrated `preview-app` source and `static/runtime-preview` template.
- The inventory separates production-entry-required, source-owned, diagnostic-only, optional/deferred, and browser-smoke-only evidence.

- [x] **Step 2: 写 route contract test**

Create `preview-app-route-contract.test.ts` that uses current small-project fixture, `handleRuntimePreviewRequest()` and the inventory from Step 1 to verify `production-entry-required` routes. Initial required routes are expected to include:

- `/scripting/polyfills/bundle.js`
- `/scripting/engine/bin/.cache/dev-cli/web/import-map.json`
- `/scripting/engine/bin/.cache/dev-cli/web/bundled/index.js`
- `/scene-list`
- `/scene/<uuid>.json` when a scene uuid exists in current settings or AssetDB facts
- `/missing-asset/<uuid>`
- `/preview-error`
- `/socket.io/socket.io.js` or explicit no-op socket adaptation if source is changed to make socket optional

Expected before implementation:

- FAIL for routes not yet served.

Current evidence:

- `vitests/suites/runtime-preview/preview-app-route-contract.test.ts` was added and initially failed for missing `/scripting/polyfills/bundle.js` and `/scene-list`.
- The test now covers scripting prerequisite routes, scene-list/scene-json, production `project/library` to current CLI `library/cli` scene output, missing-asset fallback, preview-error POST logging, oversized preview-error payload 413 on the real HTTP server, Socket.IO client file, traversal rejection, and non-preview engine root file rejection.

- [x] **Step 3: 实现 scripting engine 和 polyfills routes**

Use current CLI / engine generated artifacts as source. If an artifact is missing, fail with diagnostic category instead of returning dummy JS.

Rules:

- `/scripting/engine/*` may serve exact files under `engineRoot` only when the path is fact-backed by Creator preview template or current engine build output.
- `/scripting/polyfills/*` must come from current dependency or Creator static artifact, not from an empty placeholder.
- Do not recursively scan engine root at startup.

Current evidence:

- `src/runtime-preview/server/preview-app-required-routes.ts` serves `/scripting/engine/bin/.cache/dev-cli/web/*` from `engineRoot` by request-time root-contained file resolution.
- `/scripting/polyfills/*` resolves from installed `@cocos/build-polyfills` first, with `@editor/build-polyfills` fallback.
- No startup scan is introduced.

- [x] **Step 4: 实现 scene list / scene json routes**

Use AssetDB facts or frozen/current library metadata to find scenes. Do not use P6 / feature-c.

Route semantics:

- `/scene-list` returns `{ scenes: Array<{ uuid, url, name?, bundle? }>, currentScene?: string }`.
- `/scene/<uuid>.json` serves serialized scene JSON from library metadata.
- If current small project has no scene fact, return explicit empty result and document limitation; do not fabricate scene JSON.

Current evidence:

- Current small project has scene facts in `library/cli/.assets-data.json` and frozen editor `.assets-data.json`.
- `/scene-list` reads scene records from project library metadata on demand. When production passes `project/library`, `project/library/cli` is preferred first so the route follows current CLI AssetDB output; explicit frozen editor reference roots still stay valid for reference tests.
- `/scene/<uuid>.json` only serves `<library-root>/<uuid-prefix>/<uuid>.json` when the same metadata proves that uuid is a `.scene`.

- [x] **Step 5: 实现 missing asset / preview error / socket handling**

Route semantics:

- `/missing-asset/<uuid>` returns project AssetDB missing-asset info when available, otherwise `{ uuid, missing: true, source: "runtime-preview-cli" }`.
- `/preview-error` accepts JSON payload and writes to runtime preview log.
- `/socket.io/socket.io.js` either serves real Socket.IO client when server supports it, or preview-app source must be adapted to tolerate missing socket. If adapted, the source change must be explicit and tested.

Current evidence:

- `/missing-asset/<uuid>` returns the explicit CLI fallback object. It is diagnostic-only and not preview success evidence.
- `runtime-preview-server.ts` passes POST method/body into the route handler; `/preview-error` writes POST payloads to `RuntimePreviewLogger`.
- `/socket.io/socket.io.js` serves the real Socket.IO client file from installed dependencies. Live socket event behavior remains browser/integration verification scope.

- [x] **Step 6: 验证 preview-app required route suite**

Run:

```powershell
rtk powershell -NoProfile -Command "`$env:COCOS_CLI_TEST_PROJECT_ROOT='E:/own_space/cocos_work_lab_38x'; `$env:COCOS_CLI_TEST_ENGINE_ROOT='D:/workspace/engines/cocos/3.8.6'; `$env:COCOS_CLI_TEST_EDITOR_LIBRARY_REF='E:/own_space/engines/cocos-cli/.codex-tmp/reference-library/cocos_work_lab_38x-editor-library-20260606'; `$env:COCOS_CLI_TEST_EDITOR_PROGRAMMING_REF='E:/own_space/engines/cocos-cli/.codex-tmp/reference-temp/cocos_work_lab_38x-editor-programming-20260606'; npm --prefix vitests test -- suites/runtime-preview/preview-app-route-contract.test.ts"
```

Expected:

- PASS or explicit diagnostic gap for missing current small-project scene facts.

Then run full runtime-preview suite.

Current evidence:

- Targeted suite passed on 2026-06-08: `vitests/suites/runtime-preview/preview-app-route-contract.test.ts`, 8 tests.
- Full suite passed on 2026-06-08: `npm --prefix vitests test -- suites/runtime-preview`, 13 files / 49 tests.

- [x] **Step 7: 关键节点 review 和提交**

Dispatch senior review focused on route fact sources, performance, no startup scans, and no guessed library URL mapping.

Current evidence:

- Senior subagent review found and confirmed fixes for: engine route overexposure, CLI AssetDB scene source proof, preview-error POST body limit and stable 413 behavior.
- Final review result: no Critical / Important; Task 8C can be committed.

Commit:

```powershell
rtk git add src/runtime-preview vitests/suites/runtime-preview docs/dev/runtime-preview-verification-traceability-plan-20260607.md
rtk git commit -m "feat(runtime-preview): serve preview app required routes"
```

### Task 8D: 实现真实浏览器运行期 smoke harness

**Files:**

- Create: `vitests/suites/runtime-preview/browser-runtime-smoke.test.ts`
- Create or modify: `vitests/shared/browser-runtime-smoke.ts`
- Reuse: production root `/` and `/preview-app/*` from Task 8B
- Reuse: preview-app required routes from Task 8C

- [x] **Step 1: 明确 browser smoke 前置条件**

Browser smoke can run only after:

- full `suites/runtime-preview` is stable.
- real CLI server startup works.
- `/settings.js` works through real provider.
- representative import/native asset routes work.
- scripting SystemJS/import-map/chunk routes work.
- Task 8B proves production root `/` and `/preview-app/*` are served.
- Task 8C proves preview-app required HTTP routes are served or explicitly classified.

Root preview page / preview-app rules:

- It may load `/settings.js`, engine scripts, scripting routes and runtime asset requests.
- Official Creator preview-app source may set `assets/general/import` and `assets/general/native`.
- CLI server/template glue must not invent or overwrite URL mapping.
- Browser smoke opens production root `/`, not a diagnostic route.

- [x] **Step 2: 启动真实 preview server**

Test should start actual runtime preview server path, not only `handleRuntimePreviewRequest()`.

Minimum coverage:

- Small-project browser smoke must cover `Launcher.startRuntimePreview()` or a wrapper that calls it.
- Real CLI child process coverage belongs to Task 9 small-project integration acceptance, not Task 8.
- P6 / feature-c is out of current test and acceptance scope. Do not add P6-specific startup requirements to Task 8.

Expected:

- server listens on `127.0.0.1` random or configured free port.
- test captures server URL.
- server logs startup roots.
- test records PID or server handle.
- test performs graceful shutdown and asserts port release.

- [x] **Step 3: 打开浏览器并监听运行期**

Use Playwright or equivalent browser automation.

Must capture:

- `console` messages
- `pageerror`
- failed network requests
- HTTP status >= 400 for runtime routes
- runtime preview log file

Wait policy:

- Do not pass immediately after page open.
- Browser smoke must define an explicit ready contract before implementation.
- Preferred ready signal: page sets `window.__RUNTIME_PREVIEW_READY = { scene, resources, timestamp }` only after settings, required scripting files, bundle config, representative resources, and scene or resource marker have loaded.
- If scene load is not yet available, use a representative `resources.load` marker and write that limitation into the acceptance matrix.
- Network idle or arbitrary sleep is not a ready signal.
- Minimum stable window: 5 seconds after the explicit ready signal, unless a stronger engine-ready signal is implemented.

- [x] **Step 4: 定义失败条件**

Fail on:

- unhandled page error
- console error not explicitly allowlisted
- missing `/settings.js`
- missing bundle config/index
- missing required scripting file
- missing captured import/native asset
- scene/resource load timeout
- network request to runtime server with 404/500 not explicitly diagnostic

Failure taxonomy:

- `fail-settings`: `/settings.js` missing, malformed, timeout, or wrong server/import/native base.
- `fail-route-contract`: required runtime URL not served or served from unproven source.
- `fail-programming`: SystemJS/import-map/record/chunk/script route missing.
- `fail-engine-adaptation`: engine source/PAL/parser/downloader error independent of project content.
- `fail-browser-host-boundary`: DOM/canvas/WebGL/browser automation environment issue.
- `fail-project-boundary`: project-side native-only static import or unsupported project dependency.
- `fail-timeout`: ready signal or stable window not reached.

- [x] **Step 5: 定义通过证据**

Test output must record:

- server URL
- elapsed startup time
- elapsed browser ready time
- number of network requests
- number of console errors
- loaded scene or representative resource marker
- log file path
- failure taxonomy category if failed
- console/pageerror/network evidence file path if failed

- [x] **Step 6: 提交 browser smoke**

Run targeted verification before commit:

```powershell
rtk powershell -NoProfile -Command "`$env:COCOS_CLI_TEST_PROJECT_ROOT='E:/own_space/cocos_work_lab_38x'; `$env:COCOS_CLI_TEST_ENGINE_ROOT='D:/workspace/engines/cocos/3.8.6'; `$env:COCOS_CLI_TEST_EDITOR_LIBRARY_REF='E:/own_space/engines/cocos-cli/.codex-tmp/reference-library/cocos_work_lab_38x-editor-library-20260606'; `$env:COCOS_CLI_TEST_EDITOR_PROGRAMMING_REF='E:/own_space/engines/cocos-cli/.codex-tmp/reference-temp/cocos_work_lab_38x-editor-programming-20260606'; npm --prefix vitests test -- suites/runtime-preview/browser-runtime-smoke.test.ts"
```

Then run full runtime-preview suite:

```powershell
rtk powershell -NoProfile -Command "`$env:COCOS_CLI_TEST_PROJECT_ROOT='E:/own_space/cocos_work_lab_38x'; `$env:COCOS_CLI_TEST_ENGINE_ROOT='D:/workspace/engines/cocos/3.8.6'; `$env:COCOS_CLI_TEST_EDITOR_LIBRARY_REF='E:/own_space/engines/cocos-cli/.codex-tmp/reference-library/cocos_work_lab_38x-editor-library-20260606'; `$env:COCOS_CLI_TEST_EDITOR_PROGRAMMING_REF='E:/own_space/engines/cocos-cli/.codex-tmp/reference-temp/cocos_work_lab_38x-editor-programming-20260606'; npm --prefix vitests test -- suites/runtime-preview"
```

Commit only after both commands pass or the failure is explicitly recorded as a planned diagnostic gap:

```powershell
rtk git add vitests src/runtime-preview
rtk git commit -m "test(runtime-preview): add browser runtime smoke"
```

Completion evidence (2026-06-08):

- 已实现 `vitests/shared/browser-runtime-smoke.ts`，使用 Chromium DevTools Protocol，不新增 browser automation 依赖。
- 已实现 `vitests/suites/runtime-preview/browser-runtime-smoke.test.ts`；测试打开 production root `/`，等待 `window.__RUNTIME_PREVIEW_READY`，再观察 5 秒稳定窗口。
- ready signal 由 preview-app source 在 `cc.game.init()` 和代表性 `cc.resources.load()` marker 完成后设置。当前 smoke 使用 resource marker，不覆盖 scene load；scene-load 验收仍归 Task 9 / 后续 integration scope。
- smoke 使用 `debug=false` 和 `runtimePreviewRenderType=webgl`，用于聚焦 runtime preview loading，避开 profiler UI 和 WebGPU host variability。测试不再绕过 socket import；`/socket.io/socket.io.js` 由 server 提供显式 no-op ESM socket client，因为独立 CLI runtime preview 没有 editor reload socket service。
- browser smoke 使用 Chrome dynamic DevTools port（`--remote-debugging-port=0`），server 对 `port: 0` 避开 Fetch-forbidden random ports，使 full suite 并发运行时不依赖固定 debug port，也不触发本地 `fetch()` bad-port failure。
- browser smoke 发现并补齐了这些 fact-backed route 支持：
  - `/engine_external/?url=external:*` 映射到 `engineRoot/native/external/*`。
  - `/assets/general/import/*` 和 `/assets/general/native/*` 通过 tail uuid 对照 bundle config 解析，匹配 preview-app `assets/general/*` 行为和旧 preview server wildcard route shape。
  - internal builtin assets 使用 `engineRoot/editor/library`、`.internal-data.json` 和 `cc.config.json` dependent assets。
  - `virtual:///prerequisite-imports/*` registration 覆盖 `projectBundles` 和 `remoteBundles`。
- review 后已收窄 library route authorization：已知 UUID 只能通过真实 bundle name，或已证明的 preview-app `general` alias 到 `resources/internal`；未证明 bundle name 返回 404。
- browser smoke 会写 JSON evidence file，记录 server URL、log path、startup/ready/total elapsed time、request/error count、loaded resource marker；失败时记录 failure taxonomy 和 evidence file path。测试同时断言 server shutdown 后端口释放。
- Verification passed:
  - `npm --prefix vitests test -- suites/runtime-preview/browser-runtime-smoke.test.ts`: 1 test passed.
  - `npm --prefix vitests test -- suites/runtime-preview`: 14 files / 56 tests passed.

## 9. 小项目真实集成验收

### Task 9: 设计并执行小项目真实集成验收

**Files:**

- Create: `docs/dev/runtime-preview-small-project-acceptance-20260607.md`
- Create: `vitests/shared/runtime-preview-cli-process.ts`
- Create: `vitests/suites/runtime-preview/small-project-cli-integration.test.ts`
- Reuse: `vitests/shared/browser-runtime-smoke.ts` after Task 8D
- Acceptance project: `E:\own_space\cocos_work_lab_38x`
- Historical reference only: `F:\ps_copy\p6\trunk\Project\GameClient\Client-ai_master\tests` can be consulted for engine-source Vitest harness shape, but it is not a current execution input, not an acceptance project, and not a required reference for Task 9.

- [ ] **Step 1: 写小项目验收输入**

Document:

- project path
- engine path
- CLI command
- expected port
- expected log paths
- frozen editor `library` reference path
- frozen editor `temp/programming` reference path
- expected settings, library, programming and scripting route categories
- browser ready signal contract

- [ ] **Step 2: 脚本化启动真实 runtime preview**

Do not use a foreground-only command as the acceptance procedure. Implement `vitests/shared/runtime-preview-cli-process.ts` to spawn the CLI process, wait for `server:listening`, collect stdout/stderr/log paths, and shut the process down.

`small-project-cli-integration.test.ts` must call this helper and then reuse the browser smoke helper from Task 8D. If Task 8B / Task 8C has not yet established production root `/`、`/preview-app/*` and preview-app required routes, this test must stay skipped or `blocked-by-fact-gap` with a clear reason in the acceptance document; it must not open a browser and pass by waiting for no immediate error.

Command shape to be wrapped by the script:

```powershell
rtk powershell -NoProfile -Command "Set-Location -LiteralPath 'E:\own_space\cocos_work_lab_38x'; node 'E:\own_space\engines\cocos-cli\dist\cli.js' preview --runtime --host 127.0.0.1 --port 19530"
```

If the port is occupied:

- identify the process.
- do not kill it without checking whether it is current test server.

The script must record:

- CLI child PID
- listening URL
- startup stdout/stderr excerpt
- runtime preview log path
- graceful shutdown result
- port release result

Forbidden:

- Do not treat a manually opened browser as Task 9 evidence.
- Do not use P6 / feature-c as a hidden acceptance project.
- Do not skip browser log/network/pageerror capture when claiming integration pass.

- [ ] **Step 3: 收集性能和编译指标**

From packer debug log, collect:

- `Build iteration starts` count
- `Target(editor) build already in progress` count
- `Target(preview) build already in progress` count
- max `Number of accumulated asset changes`
- `script:collect` duration if implemented
- `script:compile` duration if implemented

- [ ] **Step 4: 浏览器运行期观测**

Use the same browser smoke rules as Task 8, but record small-project integration failures separately:

- missing or malformed `/settings.js`
- failed import/native runtime route
- failed scripting SystemJS/import-map/chunk route
- failed representative resource or scene marker
- browser runtime error after ready signal
- slow startup or script compile

- [x] **Step 4A: 默认场景加载与场景选择加载修复**

本步骤是 Task 9 的当前阻塞项。当前实现已经证明 resource marker smoke 能通过，但这不能代表完整 preview load。必须修复并验证这些行为：

- production root `/` 在没有 `?scene=` 时不能生成空 launch scene。
- 默认 scene 解析顺序必须明确：URL `scene` > CLI `--scene` > project profile `profiles/v2/packages/preview.json` 的 `general.start_scene` > AssetDB scene list 第一个可加载 scene。
- CLI runtime preview 没有 editor scene service，`current_scene` 不能直接传给 builder；在当前独立 CLI 模式下必须解析为 AssetDB scene list 的第一个可加载 scene，并在文档中标注该降级规则。
- `/scene-list.currentScene`、root entry 中的 `/settings.js?scene=...`、`/settings.js?scene=...` 生成的 `window._CCSettings.launch.launchScene` 必须一致。
- `/settings.js` 必须读取 query `scene`，并按 scene 维度生成或缓存 settings；不能复用第一次空 scene settings 导致 UI 选场景后仍加载空场景。
- 场景选择 UI 改变 `<select id="scene-select">` 后，页面 reload 到 `?scene=<uuid>`，再通过 `/settings.js?scene=<uuid>` 加载对应 scene。
- 不允许为此做 startup recursive scan；scene list 只能按请求读取当前 `library/cli`、configured project library 或 frozen reference metadata 中的 `.assets-data.json`。

必须补充测试：

- route/settings contract：默认 root entry 带非空 `settings.js?scene=...`。
- route/settings contract：`/settings.js?scene=<uuid>` 传入 CLI `getPreviewSettings({ startScene })`，且返回 settings 中 `launch.launchScene` 为该 uuid。
- route/settings contract：`/scene-list.currentScene` 与默认 scene 解析一致。
- 小项目真实 CLI browser acceptance：至少 3 个小项目 scene，分别等待 `window.__RUNTIME_PREVIEW_READY.scene`，ready 后继续观察稳定窗口，并断言 browser console/page/network 无错误。
- 小项目真实 CLI browser acceptance：读取 runtime preview server log，断言没有 `settings:generation:error`、`browser:preview-error`、`UnhandledPromiseRejection`、`route:error` 等明确失败信号。
- 小项目真实 CLI browser acceptance：不能只检查浏览器打开瞬间；每个 scene 必须等待 runtime ready，ready 前失败要输出 console、pageerror、network、server log 证据，ready 后仍需观察稳定窗口。

当前小项目可用于三场景验收的候选 scene 来自 `E:\own_space\cocos_work_lab_38x\library\cli\.assets-data.json`，优先选择非空且覆盖图形、动态图集、shader/batch 资源路径的 scene，例如：

- `668efa31-4841-4cbc-bbae-33255599d478`：`db://assets/test_cases/test_custom_graphics/test_area_edge_graphic.scene`
- `465d8fb0-d260-4256-a785-651bf2ebf7d1`：`db://assets/test_cases/test_dynamic_atlas/test_dynamic_atlas.scene`
- `ec470553-bc56-4c2c-91aa-c7016f677e3e`：`db://assets/test_cases/test_custom_shader_batch/test_custom_shader_batch.scene`

如果这三个 scene 任一失败，不能用 JsonAsset smoke 代替；必须按 failure taxonomy 归类为 `fail-route-contract`、`fail-programming`、`fail-engine-adaptation`、`fail-small-project-input` 或 `fail-timeout`。

执行状态（2026-06-09）：

- 已补 route/settings contract：默认 root entry 带非空 `/settings.js?scene=...`，`/scene-list.currentScene` 与默认 scene 一致，`/settings.js?scene=<uuid>` 会传入 `startScene` 并生成同一 `launch.launchScene`。
- 已补真实 CLI 三场景 acceptance 测试，启动独立 CLI child process，使用小项目 `E:\own_space\cocos_work_lab_38x`，不使用大项目作为验收输入。
- 已修复 first scene 资源 404：`/assets/general/import/*` 支持 AssetDB 依赖证明的 `uuid@subid`，并为真实 CLI server 注入 `engineRoot/editor/library` 作为 internal library root。
- 已定位并修复 `localSetLayout` 运行时异常：小项目 `settings/v2/packages/engine.json` 中 `modules.graphics.pipeline` 为 `legacy-pipeline`，冻结编辑器 preview programming 产物也使用 `legacy-pipeline`；当前 CLI preview settings 原先绕过项目配置补齐，导致 settings 和 generated programming 走 `custom-pipeline`。修复点是让 `getPreviewSettings()` 复用 `fillIncludeModulesFromProjectConfig()`，并仅在 `preview` settings 场景按 `modules.graphics.pipeline` 归一化 `includeModules/customPipeline`，避免扩大普通 build 语义。
- review 后已修复 `--scene` 优先级：`RuntimePreviewContext` 持有 CLI scene，默认解析链路恢复为 URL `scene` > CLI `--scene` > profile > first loadable scene。
- review 后已修复 first loadable 边界：fallback scene 不再只取 metadata 第一条，而是确认 `/scene/<uuid>.json` 对应 library 文件存在。
- review 后已修复 AssetDB fallback proof 性能：`/assets/general/import|native/*` 的 metadata 证明从每请求全量 `depends` 扫描改为每 metadata root 一次性 `Set` 索引。
- review 后已补真实 browser 默认 root 和 scene select 验收：小项目测试先打开无 `?scene=` root 并等待默认 scene ready，再通过真实 `<select id="scene-select">` 触发 scene 切换，等待 reload 后目标 scene ready。
- WebGPU validation error 处理边界：runtime preview 默认 render type 改为 WebGL；`runtimePreviewRenderType=webgpu` 仍保留为显式 opt-in。默认 root 和 scene select 真实验收 URL 不再带 `runtimePreviewRenderType=webgl`，用于覆盖手动打开 `?scene=<uuid>` 的默认路径。
- renderMode 事实记录：当前小项目没有显式 `settings.rendering.renderMode = WEBGL` 配置；项目事实是 `settings/v2/packages/engine.json` 中 `gfx-webgl = true`、`gfx-webgl2 = true`、`gfx-webgpu = false`，并且 `modules.graphics.pipeline = "legacy-pipeline"`。`pipeline` 只决定 legacy/custom render pipeline，不直接决定 WebGL/WebGPU backend。
- engine 调用链事实：browser preview 调用 `cc.game.init()` 后，引擎在 `cocos/gfx/device-manager.ts` 读取 `settings.rendering.renderMode`；当 renderMode 为缺省或 `AUTO` 时，3.8.6 的 `_determineRenderType()` 会在浏览器支持 `navigator.gpu` 且 `!EDITOR` 时选择 WebGPU。这解释了手动打开 `?scene=<uuid>` 时出现 WebGPU validation error，而编辑器预览未必出现同类问题。
- 当前修复状态：`b85815c` 解决的是默认无参数 runtime preview 误入 WebGPU 的现象，已通过默认 root、scene select 和三复杂 scene 验收；但这仍是策略止血，不是最终“配置推导 renderMode”实现。后续应把默认 renderMode 改为：URL `runtimePreviewRenderType` override > 已存在 `settings.rendering.renderMode` > 项目/平台 `useWebGPU` 或 `gfx-webgpu` 配置 > WebGL fallback。
- 验证通过：`npm --prefix vitests test -- suites/runtime-preview`，15 files / 61 tests passed。
- 三场景、默认 root、scene select 真实验收通过，证据文件：`E:\own_space\cocos_work_lab_38x\temp\runtime-preview-small-project-cli-evidence.json`；server log：`E:\own_space\cocos_work_lab_38x\temp\preview-logs\runtime-preview-20260609-142020.log`。验收 scene 为 `test_area_edge_graphic`、`test_dynamic_atlas`、`test_custom_shader_batch`，每个 scene 都等待 `window.__RUNTIME_PREVIEW_READY.scene`，ready 后继续观察稳定窗口，并断言 browser console/page/network 与 runtime preview server log 无错误。

- [ ] **Step 5: 写验收结论**

Conclusion categories:

- `pass`
- `pass-with-known-limitation`
- `fail-cli-runtime-preview`
- `fail-engine-adaptation`
- `fail-small-project-input`
- `blocked`

- [ ] **Step 6: 提交小项目验收文档**

Run:

```powershell
rtk powershell -NoProfile -Command "`$env:COCOS_CLI_TEST_PROJECT_ROOT='E:/own_space/cocos_work_lab_38x'; `$env:COCOS_CLI_TEST_ENGINE_ROOT='D:/workspace/engines/cocos/3.8.6'; `$env:COCOS_CLI_TEST_EDITOR_LIBRARY_REF='E:/own_space/engines/cocos-cli/.codex-tmp/reference-library/cocos_work_lab_38x-editor-library-20260606'; `$env:COCOS_CLI_TEST_EDITOR_PROGRAMMING_REF='E:/own_space/engines/cocos-cli/.codex-tmp/reference-temp/cocos_work_lab_38x-editor-programming-20260606'; npm --prefix vitests test -- suites/runtime-preview/small-project-cli-integration.test.ts"
rtk powershell -NoProfile -Command "`$env:COCOS_CLI_TEST_PROJECT_ROOT='E:/own_space/cocos_work_lab_38x'; `$env:COCOS_CLI_TEST_ENGINE_ROOT='D:/workspace/engines/cocos/3.8.6'; `$env:COCOS_CLI_TEST_EDITOR_LIBRARY_REF='E:/own_space/engines/cocos-cli/.codex-tmp/reference-library/cocos_work_lab_38x-editor-library-20260606'; `$env:COCOS_CLI_TEST_EDITOR_PROGRAMMING_REF='E:/own_space/engines/cocos-cli/.codex-tmp/reference-temp/cocos_work_lab_38x-editor-programming-20260606'; npm --prefix vitests test -- suites/runtime-preview"
rtk git add docs/dev/runtime-preview-small-project-acceptance-20260607.md vitests/shared/runtime-preview-cli-process.ts vitests/suites/runtime-preview/small-project-cli-integration.test.ts
rtk git commit -m "test(runtime-preview): add small project cli integration acceptance"
```

## 10. 最终完成标准

Runtime preview 不能只因为短链路测试通过就标完成。完成标准是：

1. `suites/runtime-preview` full-suite 在完整环境变量下稳定通过。
2. CLI/editor output consistency 有明确结论；若不一致，差异已修复或被事实证明可接受。
3. import、native、pack、redirect route 都有 fact-backed contract 或明确的未触发证明；extension asset-db 只要求对小项目事实闭环，通用 extension enable/disable/global config 语义为 deferred。
4. scripting route 覆盖 SystemJS、macro、import-map-global、chunks、project script、`script2library`。
5. 启动 diagnostics 和 runtime preview log 可定位 engine、AssetDB、builder、settings、server、browser error。
6. 真实 preview server browser smoke 通过，且观察稳定窗口，不是打开瞬间通过。
7. 小项目 `E:\own_space\cocos_work_lab_38x` 真实集成验收有结论，并能区分 CLI 问题、engine adaptation 问题和项目输入边界。
8. CLI commit 与 engine commit 的 traceability ledger 完整。

P6 / feature-c 大项目验收当前为 deferred，不作为本阶段完成标准。后续重新纳入时，必须先更新验收矩阵和本计划。

## 11. 当前优先级

下一步不应直接补 browser smoke。Task 1/2/3/8B 已完成，当前执行顺序必须先把 preview-app production entry 的 required routes 接回主线：

1. Task 8C：按 preview-app/template 实际请求先建立 route inventory，再补 `/scripting/engine/*`、polyfills、scene、missing-asset、preview-error、socket/no-op socket 等 required routes。这是当前最高优先级。
2. Task 4 / Task 5：继续保持 CLI/editor output consistency、pack/redirect/extension runtime trigger 事实闭环；这些不能阻塞 preview-app entry 接入，但会影响 browser smoke 完成度。
3. Task 8D：基于 production root `/` 执行真实 browser smoke，监听 console/pageerror/network，等待 ready 和稳定窗口。
4. Task 9：复用 Task 8D harness，启动真实 CLI child process，对小项目 `E:\own_space\cocos_work_lab_38x` 做集成验收并产出证据。

原因：

- 矩阵、ledger 和 full-suite 稳定性已经建立，继续重复 Task 1/2/3 会浪费执行窗口。
- 之前把 preview-app entry 降级成“待确认事实”是错误执行顺序。preview-app 源码和 static template 是 production entry 主输入，不是 browser smoke 的可选前置。
- 当前最容易偏离的是绕过 preview-app 自己造 diagnostic page，所以必须先接入 production entry，再补 route，再做 browser smoke。
- 当前剩余实现风险主要在 preview-app production entry、required routes、真实 CLI/editor output、pack/redirect/extension fact，不在旧的 full-suite timeout。
