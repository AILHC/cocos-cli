# Runtime Preview Startup Warm-up Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 runtime preview 当前只在浏览器请求 `/settings.js` 后才触发 `engine:init:start` 的启动时机问题，让 CLI 启动真实 server 后主动准备默认 preview settings，并用编译后的 `dist/cli.js` 验证。

**Architecture:** 保持现有 HTTP route 和 URL mapping 不变，warm-up 只发生在 `Launcher.startRuntimePreview()` 拿到 server URL 之后，通过已有 `PreviewSettingsProvider.getPreviewSettings()` 触发真实 `this.import()`、AssetDB、builder init 和 `getPreviewSettings()`。`server:listening` 仍表示 socket 已监听，新增 `preview:preparing` / `preview:ready` / `preview:error` 表示 preview settings 准备状态。

**Tech Stack:** TypeScript, Node.js HTTP server, Cocos CLI `Launcher`, Vitest, Playwright/browser smoke helper, compiled `dist/cli.js` CLI entry.

---

## Scope

本计划只处理启动后主动 warm-up preview settings。`Launcher` 顶层 import 过重导致第一条 `Start record log` 慢的问题已在 `docs/dev/runtime-preview-acceptance-feedback-20260609.md` 记录为 deferred，本计划不修改。

本计划不新增 route，不推测 URL，不扫描 `library` 或 `temp/programming` 全量文件。所有 preview settings、bundle config、script runtime map 仍由现有 `PreviewSettingsProvider` 和 CLI `getPreviewSettings()` 链路产生。

## Files

- Modify: `src/core/launcher.ts`
  - 在 `startRuntimePreview()` 中，server listen 后主动调用 `settingsProvider.getPreviewSettings()`。
  - 输出 `preview:preparing`、`preview:ready`、`preview:error`。
  - 保持 `server:listening` 语义为 socket ready。
- Modify: `vitests/shared/runtime-preview-cli-process.ts`
  - 将真实 CLI child process 从 `node node_modules/tsx/dist/cli.mjs src/cli.ts` 改为 `node dist/cli.js`。
  - 默认等待 `preview:ready`，而不是只等待 `server:listening`。
  - 保留 health request 用于获取 `logFilePath`。
- Modify: `vitests/suites/runtime-preview/small-project-cli-integration.test.ts`
  - 断言 stdout 包含 `preview:preparing`、`engine:init:start/done`、`builder:init:done`、`preview:ready`。
  - 断言 evidence 中记录的 `cliCommand` 指向 `dist/cli.js`，不再出现 `tsx`。
- Modify: `vitests/suites/runtime-preview/launcher-runtime-preview.test.ts`
  - 保留源代码级 launcher 测试，但新增“不请求 `/settings.js` 也会在 `startRuntimePreview()` 内触发 warm-up”的断言。
  - 该测试可以继续直接 import `Launcher`，因为它验证内部 launcher 行为；真实 CLI 验收必须走 `dist/cli.js`。
- Modify: `docs/dev/runtime-preview-acceptance-feedback-20260609.md`
  - 将本问题状态从待修复更新为已修复或部分修复，并记录验证命令。
- Modify: `docs/dev/runtime-preview-verification-traceability-plan-20260607.md`
  - 在 Task 9 / startup diagnostics 段落补充：真实 CLI helper 必须使用 `dist/cli.js`，并等待 `preview:ready`。

## Task 1: 写失败测试和 dist CLI helper 约束

**Files:**
- Modify: `vitests/shared/runtime-preview-cli-process.ts`
- Modify: `vitests/suites/runtime-preview/small-project-cli-integration.test.ts`
- Modify: `vitests/suites/runtime-preview/launcher-runtime-preview.test.ts`

- [ ] **Step 1: 修改真实 CLI process helper 命令**

将 `startRuntimePreviewCliProcess()` 的 `args` 改为：

```ts
const args = [
  join(options.repoRoot, 'dist', 'cli.js'),
  'preview',
  '--project',
  options.projectRoot,
  '--runtime',
  '--host',
  host,
  '--port',
  String(port),
  '--settings-timeout-ms',
  '120000',
];
```

解析 stdout 时保留 `server:listening` URL，同时新增 `previewReady` 标记：

```ts
let previewReady = false;

const listeningMatch = /\[runtime-preview\] server:listening (http:\/\/[^\s]+)/.exec(stdout);
if (listeningMatch) {
  url = listeningMatch[1];
}
previewReady = stdout.includes('[runtime-preview] preview:ready');
```

`tryResolve()` 条件改为必须同时满足 `url` 和 `previewReady`：

```ts
if (settled || resolving || !url || !previewReady) {
  return;
}
```

timeout 文案改为等待 `preview:ready`：

```ts
`Timed out waiting for runtime preview CLI preview:ready after ${startupTimeoutMs}ms.\nstdout:\n${stdout}\nstderr:\n${stderr}`
```

- [ ] **Step 2: 补小项目真实 CLI 验收断言**

在 `small-project-cli-integration.test.ts` 中，`startRuntimePreviewCliProcess()` 返回后新增：

```ts
expect(`${cli.command} ${cli.args.join(' ')}`).toContain('dist\\cli.js');
expect(`${cli.command} ${cli.args.join(' ')}`.replace(/\\/g, '/')).not.toContain('/tsx/');
expect(cli.stdout).toContain('[runtime-preview] preview:preparing');
expect(cli.stdout).toContain('[runtime-preview] engine:init:start');
expect(cli.stdout).toContain('[runtime-preview] engine:init:done');
expect(cli.stdout).toContain('[runtime-preview] builder:init:done');
expect(cli.stdout).toContain('[runtime-preview] preview:ready');
```

- [ ] **Step 3: 补 Launcher warm-up 行为测试**

在 `launcher-runtime-preview.test.ts` 中调整现有 real Launcher 测试或新增测试：`startRuntimePreview()` 返回后，不主动请求 `/settings.js`，直接断言 stdout 已包含 warm-up 阶段日志。保留 health request，因为 health 不触发 settings。

预期断言：

```ts
expect(stdout).toContain('[runtime-preview] server:listening ');
expect(stdout).toContain('[runtime-preview] preview:preparing');
expect(stdout).toContain('[runtime-preview] engine:init:start');
expect(stdout).toContain('[runtime-preview] engine:init:done');
expect(stdout).toContain('[runtime-preview] asset-db:start');
expect(stdout).toContain('[runtime-preview] asset-db:done');
expect(stdout).toContain('[runtime-preview] builder:init:start');
expect(stdout).toContain('[runtime-preview] builder:init:done');
expect(stdout).toContain('[runtime-preview] preview:ready');
```

- [ ] **Step 4: 运行目标测试确认失败**

先编译 preview app 和 CLI：

```powershell
rtk powershell -NoProfile -Command "npm run build"
```

运行测试：

```powershell
rtk cmd /c "set COCOS_CLI_TEST_PROJECT_ROOT=E:/own_space/cocos_work_lab_38x&& set COCOS_CLI_TEST_ENGINE_ROOT=D:/workspace/engines/cocos/3.8.6&& set COCOS_CLI_TEST_EDITOR_LIBRARY_REF=E:/own_space/engines/cocos-cli/.codex-tmp/reference-library/cocos_work_lab_38x-editor-library-20260606&& set COCOS_CLI_TEST_EDITOR_PROGRAMMING_REF=E:/own_space/engines/cocos-cli/.codex-tmp/reference-temp/cocos_work_lab_38x-editor-programming-20260606&& npm --prefix vitests test -- suites/runtime-preview/launcher-runtime-preview.test.ts suites/runtime-preview/small-project-cli-integration.test.ts"
```

Expected: 失败。失败点应为缺少 `preview:ready` 或 CLI helper 等不到 `preview:ready`，证明测试覆盖当前问题。

## Task 2: 实现主动 warm-up

**Files:**
- Modify: `src/core/launcher.ts`

- [ ] **Step 1: 在 server listen 后主动生成 preview settings**

在 `server.startupLogLines.forEach(...)`、`server:listening` 和 `scene=...` 输出后，增加：

```ts
emitRuntimePreviewEvent('preview:preparing');
try {
    await settingsProvider.getPreviewSettings(options.scene ? { startScene: options.scene } : undefined);
    emitRuntimePreviewEvent('preview:ready');
} catch (error) {
    diagnostics.stageError('preview', error);
    emitRuntimePreviewEvent(`preview:error ${error instanceof Error ? error.message : String(error)}`);
    throw error;
}
```

注意：

- 这会复用已有 `ensurePreviewSettingsReady()`，不会新增第二套初始化流程。
- 没有 `options.scene` 时传 `undefined`，让 `getPreviewSettings()` 和现有默认 scene 解析链路处理默认场景。
- error 必须抛出，让 CLI 进程以失败退出，不能让浏览器首访才暴露。

- [ ] **Step 2: 保持 route 层 lazy cache 行为**

不修改 `runtime-preview-routes.ts`。warm-up 后 `/settings.js` 仍通过同一个 `settingsProvider` 返回已缓存的 active result 或按 query scene 生成新 result。

- [ ] **Step 3: 运行 Launcher 目标测试**

```powershell
rtk cmd /c "set COCOS_CLI_TEST_PROJECT_ROOT=E:/own_space/cocos_work_lab_38x&& set COCOS_CLI_TEST_ENGINE_ROOT=D:/workspace/engines/cocos/3.8.6&& set COCOS_CLI_TEST_EDITOR_LIBRARY_REF=E:/own_space/engines/cocos-cli/.codex-tmp/reference-library/cocos_work_lab_38x-editor-library-20260606&& set COCOS_CLI_TEST_EDITOR_PROGRAMMING_REF=E:/own_space/engines/cocos-cli/.codex-tmp/reference-temp/cocos_work_lab_38x-editor-programming-20260606&& npm --prefix vitests test -- suites/runtime-preview/launcher-runtime-preview.test.ts"
```

Expected: pass，并且 stdout/log file 包含 `preview:preparing`、`preview:ready`。

## Task 3: dist CLI build 和真实小项目验收

**Files:**
- Modify: `vitests/shared/runtime-preview-cli-process.ts`
- Modify: `vitests/suites/runtime-preview/small-project-cli-integration.test.ts`

- [ ] **Step 1: 编译 dist**

```powershell
rtk powershell -NoProfile -Command "npm run build"
```

Expected:

- `dist/cli.js` 存在。
- `static/runtime-preview/preview-app/index.js` 存在。
- build exit code 为 0。

- [ ] **Step 2: 运行真实 CLI 小项目验收**

```powershell
rtk cmd /c "set COCOS_CLI_TEST_PROJECT_ROOT=E:/own_space/cocos_work_lab_38x&& set COCOS_CLI_TEST_ENGINE_ROOT=D:/workspace/engines/cocos/3.8.6&& set COCOS_CLI_TEST_EDITOR_LIBRARY_REF=E:/own_space/engines/cocos-cli/.codex-tmp/reference-library/cocos_work_lab_38x-editor-library-20260606&& set COCOS_CLI_TEST_EDITOR_PROGRAMMING_REF=E:/own_space/engines/cocos-cli/.codex-tmp/reference-temp/cocos_work_lab_38x-editor-programming-20260606&& npm --prefix vitests test -- suites/runtime-preview/small-project-cli-integration.test.ts"
```

Expected:

- helper 启动命令为 `node <repo>/dist/cli.js preview --runtime ...`。
- helper 等到 `preview:ready` 后才返回。
- 默认 root、scene selector、三个复杂 scene 真实 browser smoke 通过。
- browser console/page/network 无错误。
- runtime preview server log 无 `settings:generation:error`、`browser:preview-error`、`UnhandledPromiseRejection`、`route:error`、`RuntimePreviewRequestBodyTooLarge`。

- [ ] **Step 3: 运行 runtime-preview 目标套件**

```powershell
rtk cmd /c "set COCOS_CLI_TEST_PROJECT_ROOT=E:/own_space/cocos_work_lab_38x&& set COCOS_CLI_TEST_ENGINE_ROOT=D:/workspace/engines/cocos/3.8.6&& set COCOS_CLI_TEST_EDITOR_LIBRARY_REF=E:/own_space/engines/cocos-cli/.codex-tmp/reference-library/cocos_work_lab_38x-editor-library-20260606&& set COCOS_CLI_TEST_EDITOR_PROGRAMMING_REF=E:/own_space/engines/cocos-cli/.codex-tmp/reference-temp/cocos_work_lab_38x-editor-programming-20260606&& npm --prefix vitests test -- suites/runtime-preview"
```

Expected: runtime-preview suite pass。若失败，必须区分本改动回归、既有 compiled serialize 测试问题、环境资源问题，不允许笼统宣称完成。

## Task 4: 文档和提交

**Files:**
- Modify: `docs/dev/runtime-preview-acceptance-feedback-20260609.md`
- Modify: `docs/dev/runtime-preview-verification-traceability-plan-20260607.md`
- Modify: `docs/dev/runtime-preview-startup-warmup-plan-20260609.md`

- [ ] **Step 1: 更新反馈文档状态**

将启动准备时机问题从 `待修复` 更新为 `已修复` 或 `部分修复`，并记录：

- `server:listening` 仍是 socket ready。
- `preview:ready` 是 CLI 启动后主动 warm-up 完成。
- 验证命令使用 `npm run build` + `node dist/cli.js`。

- [ ] **Step 2: 更新 traceability plan**

在 Task 9 小项目 CLI integration 处记录：

- 真实 CLI process helper 不再使用 `tsx src/cli.ts`。
- helper 等待 `preview:ready`，不是只等待 `server:listening`。
- browser smoke 仍保留 ready 后稳定窗口。

- [ ] **Step 3: 检查 diff**

```powershell
rtk git diff -- src/core/launcher.ts vitests/shared/runtime-preview-cli-process.ts vitests/suites/runtime-preview/launcher-runtime-preview.test.ts vitests/suites/runtime-preview/small-project-cli-integration.test.ts docs/dev/runtime-preview-acceptance-feedback-20260609.md docs/dev/runtime-preview-verification-traceability-plan-20260607.md docs/dev/runtime-preview-startup-warmup-plan-20260609.md
```

Expected: diff 只包含本计划相关变更。

- [ ] **Step 4: 小步提交**

```powershell
rtk git add src/core/launcher.ts vitests/shared/runtime-preview-cli-process.ts vitests/suites/runtime-preview/launcher-runtime-preview.test.ts vitests/suites/runtime-preview/small-project-cli-integration.test.ts docs/dev/runtime-preview-acceptance-feedback-20260609.md docs/dev/runtime-preview-verification-traceability-plan-20260607.md docs/dev/runtime-preview-startup-warmup-plan-20260609.md
rtk git commit -m "fix(runtime-preview): warm preview settings on startup"
```

Expected: commit succeeds。

## Self-review

- 需求覆盖：本计划覆盖主动 warm-up、状态日志、dist CLI 验收、真实 browser 稳定窗口；第一条日志慢明确不处理。
- 性能边界：没有新增全量扫描；只提前执行原本首个 `/settings.js` 必然执行的 settings 生成链路。
- 架构边界：route 和 URL mapping 不变；server listen 与 preview ready 语义分离。
- 测试边界：真实 CLI 测试必须先 build，再用 `dist/cli.js`；源代码级 launcher 测试只用于内部行为，不替代真实 CLI 验收。

## Execution Result（2026-06-09）

- 已实现 `Launcher.startRuntimePreview()` 主动 warm-up：`server:listening` 后输出 `preview:preparing`，完成默认 preview settings 后输出 `preview:ready`。
- 已将真实 CLI process helper 改为 `node dist/cli.js preview --runtime ...`，并等待 `preview:ready` 后才返回。
- 已补 Launcher 顺序测试：`engine:init:start` 和 `preview:ready` 必须发生在 `startRuntimePreview()` 返回前。
- `npm run build` 已通过；过程中为既有 generated serialize compiled files 做了最小 TypeScript 类型修正，不改变运行时数据结构。
- `npm --prefix vitests test -- suites/runtime-preview/small-project-cli-integration.test.ts` 已通过，证据文件为 `E:\own_space\cocos_work_lab_38x\temp\runtime-preview-small-project-cli-evidence.json`。
- `npm --prefix vitests test -- suites/runtime-preview` 已通过，15 files / 61 tests passed。
