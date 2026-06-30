# Runtime Preview Compile Error Visibility and Output Safety Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 `RP-ISSUE-032`，让 runtime preview 在脚本编译失败时明确展示具体脚本、行列和 code frame，同时保证失败 build 不污染上一份可用 programming output。

**Architecture:** 分三层处理：`core/scripting` 负责结构化编译错误和 last failure state；`runtime-preview` refresh/server/browser UI 负责错误传播与展示；`packer-driver` 负责 build 失败时不提交半成品 records，并在失败后恢复 QuickPack 内存状态。产物安全以 target 级 transaction 和 prerequisite integrity gate 为边界，不做全量 `temp/cli/programming` 复制。

**Tech Stack:** TypeScript, Vitest, Node.js fs/path APIs, Cocos `PackerDriver`, `@cocos/creator-programming-quick-pack@1.7.15`, runtime preview Express routes, SystemJS preview app.

---

## Context

用户反馈：

- 修改 P7 `assets/tests/TestApi.ts` 后点击 runtime preview `Refresh`，浏览器报 `Unable to resolve bare specifier '__unresolved_0'`。
- 用户需要知道具体哪个脚本、哪一行哪一列、什么编译错误；不能只显示“失败”。
- 当前启动 preview 和点击 Refresh 时，控制台缺少清晰的编译状态和错误定位。

已确认事实：

- `TestApi.ts` 当前存在非法语法：

```ts
window.TestRefresh() = function (){
```

- Babel/QuickPack 报错为：

```text
Invalid left-hand side in assignment expression. (2047:0)
```

- QuickPack 失败链路：

```text
prerequisite entry _inspect() creates moduleRecord and addChunk(... imports={})
_link() imports TestApi.ts
TestApi.ts parse throws
_link() exits before chunk.imports = chunkImports
QuickPack.build() catch still save()
assembly-record prerequisite chunk imports={}
import-map misses prerequisite scope
browser SystemJS cannot resolve __unresolved_0
```

现有事实文档：

- `docs/dev/runtime-preview/issues.md` 中 `RP-ISSUE-032`
- `docs/dev/runtime-preview/facts/prerequisite-scope-missing-after-refresh-20260630.md`

## Review Corrections

资深 reviewer 对本计划做了对抗性审查，以下修正是执行前的硬约束：

1. output transaction 不能使用未等待的异步备份。records 备份必须在 QuickPack build 前同步完成；chunk 备份必须在 `addChunk()` 覆盖前同步完成，或改成 staging workspace 原子提交。本计划采用同步、按文件备份，不复制整个 programming root。
2. transaction 只保护上一份 output，不能修复已经污染的 output。P7 验收必须拆成两条：先建立已验证的 last-good output，再引入语法错误验证 rollback；另测 already-bad / no last-good output 时页面进入 `noUsableOutput`。
3. failure state 不能只覆盖 `compileScripts()`；`postCompileScripts()` 和所有 `PackerDriver.build()` 入口都必须记录结构化 failure，并带 generation/taskId，避免旧失败污染新 refresh。
4. `refreshTarget()` catch、`waitForIdle()` catch、last failure state、`verifyProgrammingOutput()` catch 都必须进入同一个结构化 failure path，不能把 compile/build error 归类为 skipped。
5. prerequisite integrity gate 必须抽成纯 helper `verifyPrerequisiteImportMapIntegrity(recordsRoot)`，不能从 packer-driver 反向依赖 launcher 私有函数。
6. `PackTarget` ready / `pack-build-end` 不能在 transaction 和 integrity gate 成功前发出。失败必须保持 target not ready，并发出明确 failed event。
7. P7 验收修改 `TestApi.ts` 必须保存原内容并在 `finally` 恢复，最终记录 `git status` / diff，不能只说“不提交”。

## File Structure

### New Files

- `src/core/scripting/compile-error-diagnostics.ts`
  - 定义结构化脚本编译错误类型。
  - 从 Babel / QuickPack / generic Error 中提取 `filePath`、`line`、`column`、`message`、`codeFrame`、`stackSummary`。
  - 格式化 stdout / page 展示文本。

- `src/core/scripting/test/compile-error-diagnostics.test.ts`
  - 覆盖 Babel syntax error、QuickPack wrapped error、generic error、code frame trimming。

- `vitests/suites/runtime-preview/runtime-refresh-compile-error.test.ts`
  - 覆盖 refresh 失败 payload、last-good 状态、stdout contract 的短链路。

- `vitests/suites/runtime-preview/packer-driver-output-transaction.test.ts`
  - 覆盖 QuickPack build 失败后 records 不污染、失败后下一次成功不受坏内存影响。

### Modified Files

- `src/core/scripting/index.ts`
  - `ScriptManager` 记录 last compile failure。
  - `compileScripts()` 失败时设置 failure，成功时清理。
  - `waitForIdle()` 在 pending promise settled 后检查 last failure。
  - 新增 `getLastCompileFailure()` / `clearLastCompileFailure()`。

- `src/core/assets/manager/asset-db.ts`
  - 启动全量 script sync 失败时输出结构化错误摘要。
  - 不再只 `console.error()` 后让上层无法查询失败状态。

- `src/core/scripting/packer-driver/index.ts`
  - PackerDriver / PackTarget build failure 输出用户可见摘要。
  - 增加 target 级 output transaction。
  - build 失败后恢复磁盘 records 并重新加载 / 重建对应 QuickPack target state。
  - build 成功前执行 prerequisite integrity gate。

- `src/core/launcher.ts`
  - 启动期 stdout 展示 `script-sync`、`script-compile`、`pack-target` 阶段状态。
  - 对启动期 compile failure 区分 `latest` / `lastGoodDueToFailure` / `noUsableOutput`。
  - no usable output 时不要让 root runtime 加载坏 output。

- `src/runtime-preview/refresh/runtime-refresh-coordinator.ts`
  - `RuntimeRefreshResult` 增加结构化 `compileError` 和 `outputState`。
  - refresh 在 `refreshTarget()` / `waitForIdle()` / last failure state / integrity gate 任一失败时返回 `ok:false`。

- `src/runtime-preview/server/runtime-preview-server.ts`
  - root reload refresh 失败时注入或返回明确错误状态。
  - endpoint 返回结构化 compile error payload。

- `src/runtime-preview/server/runtime-refresh-entry-injection.ts`
  - 注入 Refresh UI 的错误面板，显示路径、行列、message、code frame、状态说明。

- `src/runtime-preview/preview-app/src/*`
  - 如当前 Refresh UI 逻辑在注入脚本内，不改 preview app bundle；若已有 preview app 读取状态，则补最小展示。

- `vitests/suites/runtime-preview/launcher-runtime-preview.test.ts`
  - 更新启动期 stdout contract。

- `vitests/suites/runtime-preview/runtime-refresh-coordinator.test.ts`
  - 覆盖 last compile failure 使 refresh `ok:false`。

- `vitests/suites/runtime-preview/runtime-refresh-entry-injection.test.ts`
  - 覆盖页面错误面板展示。

- `vitests/suites/runtime-preview/runtime-refresh-browser.test.ts`
  - 覆盖 browser 点击 Refresh 后不 reload 到坏产物，显示当前修改未生效。

---

## Data Contracts

### Script Compile Diagnostic

Implement in `src/core/scripting/compile-error-diagnostics.ts`:

```ts
export interface ScriptCompileDiagnosticLocation {
    filePath?: string;
    relativeFilePath?: string;
    assetUrl?: string;
    line?: number;
    column?: number;
}

export interface ScriptCompileDiagnostic {
    phase: 'startup' | 'refresh' | 'reload-refresh' | 'build' | 'unknown';
    target?: 'editor' | 'preview' | string;
    message: string;
    name?: string;
    location: ScriptCompileDiagnosticLocation;
    codeFrame?: string;
    stackSummary?: string;
    logFilePath?: string;
    refreshId?: string;
    taskId?: string;
    outputState?: RuntimePreviewOutputState;
}

export type RuntimePreviewOutputState =
    | 'latest'
    | 'lastGoodDueToFailure'
    | 'noUsableOutput';

export interface CreateScriptCompileDiagnosticOptions {
    phase: ScriptCompileDiagnostic['phase'];
    target?: ScriptCompileDiagnostic['target'];
    projectRoot?: string;
    assetUrl?: string;
    logFilePath?: string;
    refreshId?: string;
    taskId?: string;
    outputState?: RuntimePreviewOutputState;
    sourceLoader?: (filePath: string) => string | undefined;
}
```

Required functions:

```ts
export function createScriptCompileDiagnostic(
    error: unknown,
    options: CreateScriptCompileDiagnosticOptions,
): ScriptCompileDiagnostic;

export function formatScriptCompileDiagnosticForConsole(
    diagnostic: ScriptCompileDiagnostic,
): string[];

export function formatScriptCompileDiagnosticSummary(
    diagnostic: ScriptCompileDiagnostic,
): string;
```

Console output format:

```text
script-compile:failed phase=refresh target=preview file=assets/tests/TestApi.ts:2047:0
Invalid left-hand side in assignment expression.
  2046 | }
> 2047 | window.TestRefresh() = function (){
       | ^
  2048 |     console.log("refresh")
current change was not applied; preview keeps last good scripts
```

Rules:

- `codeFrame` max 5 lines.
- `stackSummary` max 8 lines.
- stdout/page show summary + codeFrame only.
- full stack goes to runtime log / existing logger.
- If `filePath` is under `projectRoot`, set `relativeFilePath`.
- If error has `loc`, use it.
- If error message includes `(2047:0)`, use it as fallback only when `loc` is absent.
- If stack includes `file:\D:\...\TestApi.ts`, extract the file path as fallback.

### Runtime Refresh Result Additions

Modify `src/runtime-preview/refresh/runtime-refresh-coordinator.ts`:

```ts
import type {
    RuntimePreviewOutputState,
    ScriptCompileDiagnostic,
} from '../../core/scripting/compile-error-diagnostics';

export interface RuntimeRefreshScriptCompileResult {
    status: RuntimeRefreshScriptCompileStatus;
    durationMs: number;
    error?: string;
    diagnostic?: ScriptCompileDiagnostic;
}

export interface RuntimeRefreshResult {
    ok: boolean;
    refreshId: string;
    target: string;
    outputState?: RuntimePreviewOutputState;
    compileError?: ScriptCompileDiagnostic;
    // keep existing fields unchanged
}
```

Canonical diagnostic rule:

- `scriptCompile.diagnostic` is the canonical structured diagnostic for script/build failures.
- `compileError` is an alias for clients that want a top-level field.
- Every test that sets both fields must assert they refer to the same diagnostic payload. Do not allow `compileError.message` and `scriptCompile.diagnostic.message` to diverge.

Failure payload example:

```json
{
  "ok": false,
  "refreshId": "runtime-refresh-4",
  "target": "dirty-set",
  "outputState": "lastGoodDueToFailure",
  "scriptCompile": {
    "status": "failed",
    "durationMs": 12,
    "error": "Invalid left-hand side in assignment expression.",
    "diagnostic": {
      "phase": "refresh",
      "target": "preview",
      "message": "Invalid left-hand side in assignment expression.",
      "location": {
        "filePath": "D:\\ps_copy\\p7\\trunk\\GameClient\\Client-fight-roguelike-migration\\assets\\tests\\TestApi.ts",
        "relativeFilePath": "assets\\tests\\TestApi.ts",
        "assetUrl": "db://assets/tests/TestApi.ts",
        "line": 2047,
        "column": 0
      },
      "codeFrame": "> 2047 | window.TestRefresh() = function (){"
    }
  },
  "compileError": {
    "phase": "refresh",
    "target": "preview",
    "message": "Invalid left-hand side in assignment expression.",
    "location": {
      "relativeFilePath": "assets\\tests\\TestApi.ts",
      "line": 2047,
      "column": 0
    }
  },
  "error": "Script compile failed: assets\\tests\\TestApi.ts:2047:0 Invalid left-hand side in assignment expression."
}
```

---

## Task 1: Structured Compile Error Diagnostics

**Files:**
- Create: `src/core/scripting/compile-error-diagnostics.ts`
- Create: `src/core/scripting/test/compile-error-diagnostics.test.ts`

- [ ] **Step 1: Write failing tests for Babel syntax errors**

Create `src/core/scripting/test/compile-error-diagnostics.test.ts`:

```ts
import {
    createScriptCompileDiagnostic,
    formatScriptCompileDiagnosticForConsole,
    formatScriptCompileDiagnosticSummary,
} from '../compile-error-diagnostics';

describe('compile error diagnostics', () => {
    it('extracts file, line, column and code frame from a Babel syntax error', () => {
        const error = new SyntaxError('Invalid left-hand side in assignment expression. (2047:0)') as SyntaxError & {
            loc?: { line: number; column: number };
            codeFrame?: string;
            filename?: string;
        };
        error.name = 'SyntaxError';
        error.loc = { line: 2047, column: 0 };
        error.filename = 'D:\\ps_copy\\p7\\trunk\\GameClient\\Client-fight-roguelike-migration\\assets\\tests\\TestApi.ts';
        error.codeFrame = [
            '  2045 |     return clear_tank_guide_test_session(true);',
            '  2046 | }',
            '> 2047 | window.TestRefresh() = function (){',
            '       | ^',
            '  2048 |     console.log("refresh")',
        ].join('\\n');

        const diagnostic = createScriptCompileDiagnostic(error, {
            phase: 'refresh',
            target: 'preview',
            projectRoot: 'D:\\ps_copy\\p7\\trunk\\GameClient\\Client-fight-roguelike-migration',
            assetUrl: 'db://assets/tests/TestApi.ts',
            refreshId: 'runtime-refresh-4',
            outputState: 'lastGoodDueToFailure',
        });

        expect(diagnostic.message).toBe('Invalid left-hand side in assignment expression.');
        expect(diagnostic.name).toBe('SyntaxError');
        expect(diagnostic.location.relativeFilePath).toBe('assets\\tests\\TestApi.ts');
        expect(diagnostic.location.assetUrl).toBe('db://assets/tests/TestApi.ts');
        expect(diagnostic.location.line).toBe(2047);
        expect(diagnostic.location.column).toBe(0);
        expect(diagnostic.codeFrame).toContain('window.TestRefresh() = function (){');
        expect(diagnostic.refreshId).toBe('runtime-refresh-4');
        expect(diagnostic.outputState).toBe('lastGoodDueToFailure');
    });

    it('formats concise console lines with current change not applied text', () => {
        const diagnostic = createScriptCompileDiagnostic(new SyntaxError('Invalid left-hand side in assignment expression. (2047:0)'), {
            phase: 'refresh',
            target: 'preview',
            projectRoot: 'D:\\ps_copy\\p7\\trunk\\GameClient\\Client-fight-roguelike-migration',
            assetUrl: 'db://assets/tests/TestApi.ts',
            outputState: 'lastGoodDueToFailure',
        });
        diagnostic.location.relativeFilePath = 'assets\\tests\\TestApi.ts';
        diagnostic.location.line = 2047;
        diagnostic.location.column = 0;
        diagnostic.codeFrame = '> 2047 | window.TestRefresh() = function (){\\n       | ^';

        const lines = formatScriptCompileDiagnosticForConsole(diagnostic);

        expect(lines[0]).toBe('script-compile:failed phase=refresh target=preview file=assets\\tests\\TestApi.ts:2047:0');
        expect(lines).toContain('Invalid left-hand side in assignment expression.');
        expect(lines.join('\\n')).toContain('current change was not applied; preview keeps last good scripts');
    });

    it('creates a summary usable in RuntimeRefreshResult.error', () => {
        const diagnostic = createScriptCompileDiagnostic(new Error('compile failed'), {
            phase: 'reload-refresh',
            target: 'preview',
            assetUrl: 'db://assets/tests/TestApi.ts',
        });
        diagnostic.location.relativeFilePath = 'assets\\tests\\TestApi.ts';
        diagnostic.location.line = 12;
        diagnostic.location.column = 3;

        expect(formatScriptCompileDiagnosticSummary(diagnostic)).toBe(
            'Script compile failed: assets\\tests\\TestApi.ts:12:3 compile failed',
        );
    });
});
```

- [ ] **Step 2: Run the failing diagnostic tests**

Run:

```powershell
rtk pwsh -NoProfile -Command 'npm run test -- src/core/scripting/test/compile-error-diagnostics.test.ts --runInBand'
```

Expected:

```text
Cannot find module '../compile-error-diagnostics'
```

- [ ] **Step 3: Implement diagnostic extraction**

Create `src/core/scripting/compile-error-diagnostics.ts`:

```ts
import { relative, resolve } from 'path';

export interface ScriptCompileDiagnosticLocation {
    filePath?: string;
    relativeFilePath?: string;
    assetUrl?: string;
    line?: number;
    column?: number;
}

export type RuntimePreviewOutputState =
    | 'latest'
    | 'lastGoodDueToFailure'
    | 'noUsableOutput';

export interface ScriptCompileDiagnostic {
    phase: 'startup' | 'refresh' | 'reload-refresh' | 'build' | 'unknown';
    target?: 'editor' | 'preview' | string;
    message: string;
    name?: string;
    location: ScriptCompileDiagnosticLocation;
    codeFrame?: string;
    stackSummary?: string;
    logFilePath?: string;
    refreshId?: string;
    taskId?: string;
    outputState?: RuntimePreviewOutputState;
}

export interface CreateScriptCompileDiagnosticOptions {
    phase: ScriptCompileDiagnostic['phase'];
    target?: ScriptCompileDiagnostic['target'];
    projectRoot?: string;
    assetUrl?: string;
    logFilePath?: string;
    refreshId?: string;
    taskId?: string;
    outputState?: RuntimePreviewOutputState;
}

type ErrorLike = Error & {
    loc?: { line?: number; column?: number };
    codeFrame?: string;
    filename?: string;
    file?: string;
};

export function createScriptCompileDiagnostic(
    error: unknown,
    options: CreateScriptCompileDiagnosticOptions,
): ScriptCompileDiagnostic {
    const errorLike = error instanceof Error ? error as ErrorLike : undefined;
    const rawMessage = errorLike?.message ?? String(error);
    const message = trimBabelLocationSuffix(rawMessage);
    const filePath = normalizeFilePath(
        errorLike?.filename
        ?? errorLike?.file
        ?? extractFilePathFromStack(errorLike?.stack)
        ?? extractFilePathFromMessage(rawMessage),
    );
    const locationFromMessage = extractLineColumn(rawMessage);
    const line = errorLike?.loc?.line ?? locationFromMessage?.line;
    const column = errorLike?.loc?.column ?? locationFromMessage?.column;

    return {
        phase: options.phase,
        target: options.target,
        message,
        name: errorLike?.name,
        location: {
            filePath,
            relativeFilePath: filePath && options.projectRoot
                ? relative(resolve(options.projectRoot), resolve(filePath))
                : undefined,
            assetUrl: options.assetUrl,
            line,
            column,
        },
        codeFrame: trimCodeFrame(errorLike?.codeFrame ?? createCodeFrameFromSource(filePath, line, column, options.sourceLoader)),
        stackSummary: trimStack(errorLike?.stack),
        logFilePath: options.logFilePath,
        refreshId: options.refreshId,
        taskId: options.taskId,
        outputState: options.outputState,
    };
}

export function formatScriptCompileDiagnosticSummary(diagnostic: ScriptCompileDiagnostic): string {
    const location = formatLocation(diagnostic);
    return `Script compile failed: ${location ? `${location} ` : ''}${diagnostic.message}`;
}

export function formatScriptCompileDiagnosticForConsole(diagnostic: ScriptCompileDiagnostic): string[] {
    const location = formatLocation(diagnostic) || 'unknown';
    const lines = [
        `script-compile:failed phase=${diagnostic.phase} target=${diagnostic.target ?? 'unknown'} file=${location}`,
        diagnostic.message,
    ];
    if (diagnostic.codeFrame) {
        lines.push(...diagnostic.codeFrame.split(/\r?\n/));
    }
    if (diagnostic.outputState === 'lastGoodDueToFailure') {
        lines.push('current change was not applied; preview keeps last good scripts');
    } else if (diagnostic.outputState === 'noUsableOutput') {
        lines.push('current change was not applied; preview has no usable script output');
    }
    if (diagnostic.logFilePath) {
        lines.push(`details: ${diagnostic.logFilePath}`);
    }
    return lines;
}

function formatLocation(diagnostic: ScriptCompileDiagnostic): string {
    const file = diagnostic.location.relativeFilePath
        ?? diagnostic.location.filePath
        ?? diagnostic.location.assetUrl
        ?? '';
    if (!file) {
        return '';
    }
    if (diagnostic.location.line === undefined) {
        return file;
    }
    return `${file}:${diagnostic.location.line}:${diagnostic.location.column ?? 0}`;
}

function trimBabelLocationSuffix(message: string): string {
    return message.replace(/\s+\(\d+:\d+\)$/, '');
}

function extractLineColumn(message: string): { line: number; column: number } | undefined {
    const match = message.match(/\((\d+):(\d+)\)\s*$/);
    if (!match) {
        return undefined;
    }
    return { line: Number(match[1]), column: Number(match[2]) };
}

function normalizeFilePath(value: string | undefined): string | undefined {
    if (!value) {
        return undefined;
    }
    if (/^file:\/\//.test(value)) {
        try {
            return decodeURIComponent(new URL(value).pathname)
                .replace(/^\/([A-Za-z]:\/)/, '$1')
                .replace(/\//g, '\\');
        } catch {
            return value;
        }
    }
    return value.replace(/^file:\\+/, '');
}

function extractFilePathFromMessage(message: string): string | undefined {
    const match = message.match(/([A-Za-z]:\\[^:]+?\.(?:ts|js|tsx|jsx))/);
    return match?.[1];
}

function extractFilePathFromStack(stack: string | undefined): string | undefined {
    if (!stack) {
        return undefined;
    }
    const match = stack.match(/(?:file:\\)?([A-Za-z]:\\[^:\r\n]+?\.(?:ts|js|tsx|jsx))/);
    return match?.[1];
}

function trimCodeFrame(codeFrame: string | undefined): string | undefined {
    if (!codeFrame) {
        return undefined;
    }
    return codeFrame.split(/\r?\n/).slice(0, 5).join('\n');
}

function trimStack(stack: string | undefined): string | undefined {
    if (!stack) {
        return undefined;
    }
    return stack.split(/\r?\n/).slice(0, 8).join('\n');
}

function createCodeFrameFromSource(
    filePath: string | undefined,
    line: number | undefined,
    column: number | undefined,
    sourceLoader: ((filePath: string) => string | undefined) | undefined,
): string | undefined {
    if (!filePath || line === undefined || !sourceLoader) {
        return undefined;
    }
    const source = sourceLoader(filePath);
    if (!source) {
        return undefined;
    }
    const lines = source.split(/\r?\n/);
    const start = Math.max(1, line - 2);
    const end = Math.min(lines.length, line + 2);
    const frame: string[] = [];
    for (let current = start; current <= end; current++) {
        const marker = current === line ? '>' : ' ';
        frame.push(`${marker} ${String(current).padStart(4, ' ')} | ${lines[current - 1] ?? ''}`);
        if (current === line) {
            frame.push(`       | ${' '.repeat(column ?? 0)}^`);
        }
    }
    return frame.join('\n');
}
```

After this implementation, extend the test file with these real-shape cases before considering Task 1 complete:

```ts
it('extracts file path from a QuickPack wrapped stack that contains file URL text', () => {
    const error = new Error('Invalid left-hand side in assignment expression. (2047:0)');
    error.stack = [
        'SyntaxError: file:///D:/ps_copy/p7/trunk/GameClient/Client-fight-roguelike-migration/assets/tests/TestApi.ts: Invalid left-hand side in assignment expression. (2047:0)',
        '    at QuickPack._inspect (quick-pack.ts:441:21)',
    ].join('\n');

    const diagnostic = createScriptCompileDiagnostic(error, {
        phase: 'refresh',
        projectRoot: 'D:\\ps_copy\\p7\\trunk\\GameClient\\Client-fight-roguelike-migration',
    });

    expect(diagnostic.location.relativeFilePath).toBe('assets\\tests\\TestApi.ts');
    expect(diagnostic.location.line).toBe(2047);
    expect(diagnostic.location.column).toBe(0);
});

it('generates a minimal code frame from source file when error has no codeFrame', () => {
    const filePath = 'D:\\project\\assets\\tests\\TestApi.ts';
    const error = new SyntaxError('Invalid left-hand side in assignment expression. (3:0)') as SyntaxError & {
        filename?: string;
        loc?: { line: number; column: number };
    };
    error.filename = filePath;
    error.loc = { line: 3, column: 0 };

    const diagnostic = createScriptCompileDiagnostic(error, {
        phase: 'refresh',
        projectRoot: 'D:\\project',
        sourceLoader: (requested) => requested === filePath
            ? ['const a = 1;', 'function ok() {}', 'window.TestRefresh() = function (){', 'console.log("refresh");'].join('\n')
            : undefined,
    });

    expect(diagnostic.codeFrame).toContain('>    3 | window.TestRefresh() = function (){');
    expect(diagnostic.codeFrame).toContain('| ^');
});
```

This source-loader path is required because real wrapped errors may not carry Babel `codeFrame`.

- [ ] **Step 4: Run diagnostic tests**

Run:

```powershell
rtk pwsh -NoProfile -Command 'npm run test -- src/core/scripting/test/compile-error-diagnostics.test.ts --runInBand'
```

Expected:

```text
PASS src/core/scripting/test/compile-error-diagnostics.test.ts
```

---

## Task 2: Propagate Compile Failure State Through ScriptManager and AssetDB

**Files:**
- Modify: `src/core/scripting/index.ts`
- Modify: `src/core/assets/manager/asset-db.ts`
- Test: `src/core/scripting/test/script-manager.test.ts`
- Test: `vitests/suites/runtime-preview/launcher-runtime-preview.test.ts`

- [ ] **Step 1: Add failing ScriptManager tests**

In `src/core/scripting/test/script-manager.test.ts`, add tests near existing `compileScripts` / `waitForIdle` cases:

```ts
it('records the last compile failure and exposes it after compileScripts rejects', async () => {
    const scriptManager = scripting;
    const error = new SyntaxError('Invalid left-hand side in assignment expression. (2047:0)');
    jest.spyOn(PackerDriver, 'getInstance').mockReturnValue({
        build: jest.fn(async () => { throw error; }),
        busy: jest.fn(() => false),
    } as any);

    await expect(scriptManager.compileScripts()).rejects.toThrow('Invalid left-hand side');

    const failure = scriptManager.getLastCompileFailure();
    expect(failure?.message).toContain('Invalid left-hand side');
    expect(failure?.diagnostic.message).toBe('Invalid left-hand side in assignment expression.');
});

it('clears the last compile failure after a successful compileScripts call', async () => {
    const scriptManager = scripting;
    const instance = {
        build: jest
            .fn()
            .mockRejectedValueOnce(new Error('compile failed'))
            .mockResolvedValueOnce(undefined),
        busy: jest.fn(() => false),
    };
    jest.spyOn(PackerDriver, 'getInstance').mockReturnValue(instance as any);

    await expect(scriptManager.compileScripts()).rejects.toThrow('compile failed');
    expect(scriptManager.getLastCompileFailure()).toBeTruthy();

    await expect(scriptManager.compileScripts()).resolves.toBeUndefined();
    expect(scriptManager.getLastCompileFailure()).toBeNull();
});

it('records delayed postCompileScripts failure and exposes it through waitForIdle', async () => {
    jest.useFakeTimers();
    const scriptManager = scripting;
    const error = new SyntaxError('Invalid left-hand side in assignment expression. (2047:0)');
    jest.spyOn(PackerDriver, 'getInstance').mockReturnValue({
        build: jest.fn(async () => { throw error; }),
        busy: jest.fn(() => false),
    } as any);

    scriptManager.postCompileScripts(1);
    jest.advanceTimersByTime(1);
    await Promise.resolve();

    await expect(scriptManager.waitForIdle({ timeoutMs: 1000, pollMs: 1 })).rejects.toThrow('Invalid left-hand side');
    expect(scriptManager.getLastCompileFailure()?.generation).toBeGreaterThan(0);

    jest.useRealTimers();
});
```

- [ ] **Step 2: Run failing ScriptManager tests**

Run:

```powershell
rtk pwsh -NoProfile -Command 'npm run test -- src/core/scripting/test/script-manager.test.ts --runInBand'
```

Expected:

```text
Property 'getLastCompileFailure' does not exist
```

- [ ] **Step 3: Implement last failure state**

Modify `src/core/scripting/index.ts`:

```ts
import {
    createScriptCompileDiagnostic,
    ScriptCompileDiagnostic,
} from './compile-error-diagnostics';

export interface ScriptCompileFailureState {
    error: unknown;
    message: string;
    diagnostic: ScriptCompileDiagnostic;
    createdAt: number;
    generation: number;
    taskId?: string;
}
```

Add private field to `ScriptManager`:

```ts
private _lastCompileFailure: ScriptCompileFailureState | null = null;
private _compileFailureGeneration = 0;
```

Add a shared recorder:

```ts
private _recordCompileFailure(
    error: unknown,
    options: {
        phase: ScriptCompileDiagnostic['phase'];
        taskId?: string;
        assetUrl?: string;
    },
): ScriptCompileFailureState {
    const diagnostic = createScriptCompileDiagnostic(error, {
        phase: options.phase,
        projectRoot: this._projectPath,
        assetUrl: options.assetUrl,
        taskId: options.taskId,
    });
    const failure = {
        error,
        message: diagnostic.message,
        diagnostic,
        createdAt: Date.now(),
        generation: ++this._compileFailureGeneration,
        taskId: options.taskId,
    };
    this._lastCompileFailure = failure;
    return failure;
}
```

Modify `compileScripts()` to use the shared recorder:

```ts
async compileScripts(assetChanges?: AssetChangeInfo[]): Promise<void> {
    try {
        await PackerDriver.getInstance().build(assetChanges);
        this._lastCompileFailure = null;
    } catch (error) {
        this._recordCompileFailure(error, {
            phase: 'build',
        });
        throw error;
    }
}
```

Add methods:

```ts
getLastCompileFailure(): ScriptCompileFailureState | null {
    return this._lastCompileFailure;
}

clearLastCompileFailure(): void {
    this._lastCompileFailure = null;
}
```

Modify `postCompileScripts()` pending promise block:

```ts
const pendingCompilePromise = PackerDriver.getInstance().build(undefined, currentTaskId || undefined);
this._pendingCompilePromise = pendingCompilePromise;
try {
    await pendingCompilePromise;
    this._lastCompileFailure = null;
} catch (error) {
    this._recordCompileFailure(error, {
        phase: 'build',
        taskId: currentTaskId || undefined,
    });
} finally {
    if (this._pendingCompilePromise === pendingCompilePromise) {
        this._pendingCompilePromise = null;
    }
}
```

Do not rethrow from the delayed timer callback; `waitForIdle()` must observe `_lastCompileFailure` and throw it for callers that need failure propagation.

Modify `waitForIdle()` after the pending loop:

```ts
const failure = this.getLastCompileFailure();
if (failure) {
    throw failure.error instanceof Error ? failure.error : new Error(failure.message);
}
```

- [ ] **Step 4: Make AssetDB startup logs user-visible and structured**

Modify the catch block in `src/core/assets/manager/asset-db.ts`:

```ts
} catch (error) {
    const failure = scripting.getLastCompileFailure?.();
    const diagnostic = failure?.diagnostic ?? createScriptCompileDiagnostic(error, {
        phase: 'startup',
    });
    emitRuntimePreviewAssetDbEvent(`asset-db:script-compile:error durationMs=${Date.now() - startedAt} count=${changes.length} ${formatScriptCompileDiagnosticSummary(diagnostic)}`);
    for (const line of formatScriptCompileDiagnosticForConsole(diagnostic)) {
        emitRuntimePreviewAssetDbEvent(`asset-db:${line}`);
    }
    console.error(error);
}
```

Add imports:

```ts
import {
    createScriptCompileDiagnostic,
    formatScriptCompileDiagnosticForConsole,
    formatScriptCompileDiagnosticSummary,
} from '../../scripting/compile-error-diagnostics';
```

- [ ] **Step 5: Run ScriptManager and launcher tests**

Run:

```powershell
rtk pwsh -NoProfile -Command 'npm run test -- src/core/scripting/test/script-manager.test.ts --runInBand'
rtk pwsh -NoProfile -Command 'npm --prefix vitests run test -- suites/runtime-preview/launcher-runtime-preview.test.ts'
```

Expected:

```text
PASS src/core/scripting/test/script-manager.test.ts
PASS suites/runtime-preview/launcher-runtime-preview.test.ts
```

---

## Task 3: Runtime Refresh Must Return ok:false With Diagnostic

**Files:**
- Modify: `src/runtime-preview/refresh/runtime-refresh-coordinator.ts`
- Modify: `src/runtime-preview/server/runtime-preview-server.ts`
- Test: `vitests/suites/runtime-preview/runtime-refresh-coordinator.test.ts`
- Test: `vitests/suites/runtime-preview/runtime-preview-express-server.test.ts`

- [ ] **Step 1: Add failing coordinator test for swallowed lower-level errors**

In `vitests/suites/runtime-preview/runtime-refresh-coordinator.test.ts`, add:

```ts
it('returns ok:false when last compile failure exists even if waitForIdle resolves', async () => {
    const diagnostic = {
        phase: 'refresh',
        target: 'preview',
        message: 'Invalid left-hand side in assignment expression.',
        location: {
            relativeFilePath: 'assets\\tests\\TestApi.ts',
            line: 2047,
            column: 0,
        },
        codeFrame: '> 2047 | window.TestRefresh() = function (){\\n       | ^',
        outputState: 'lastGoodDueToFailure',
    } as const;
    const coordinator = createRuntimeRefreshCoordinator({
        projectRoot: 'D:\\project',
        refreshTarget: vi.fn(async () => 1),
        waitForIdle: vi.fn(async () => undefined),
        getLastCompileFailure: vi.fn(() => ({
            message: diagnostic.message,
            diagnostic,
            createdAt: Date.now(),
        })),
        invalidateSettings: vi.fn(),
        clearImportReplacement: vi.fn(),
    });

    const result = await coordinator.refresh({ reason: 'endpoint', target: 'db://assets/tests/TestApi.ts' });

    expect(result.ok).toBe(false);
    expect(result.outputState).toBe('lastGoodDueToFailure');
    expect(result.compileError?.location.relativeFilePath).toBe('assets\\tests\\TestApi.ts');
    expect(result.scriptCompile.status).toBe('failed');
    expect(result.scriptCompile.diagnostic?.codeFrame).toContain('window.TestRefresh');
});
```

Also add a failing test for errors thrown directly by `refreshTarget()`:

```ts
it('returns structured compile failure when refreshTarget throws a script compile error', async () => {
    const error = new SyntaxError('Invalid left-hand side in assignment expression. (2047:0)');
    const coordinator = createRuntimeRefreshCoordinator({
        projectRoot: 'D:\\project',
        refreshTarget: vi.fn(async () => { throw error; }),
        waitForIdle: vi.fn(async () => undefined),
        invalidateSettings: vi.fn(),
        clearImportReplacement: vi.fn(),
    });

    const result = await coordinator.refresh({ reason: 'endpoint', target: 'db://assets/tests/TestApi.ts' });

    expect(result.ok).toBe(false);
    expect(result.scriptCompile.status).toBe('failed');
    expect(result.scriptCompile.diagnostic?.message).toBe('Invalid left-hand side in assignment expression.');
    expect(result.error).toContain('Script compile failed');
});
```

- [ ] **Step 2: Run failing coordinator test**

Run:

```powershell
rtk pwsh -NoProfile -Command 'npm --prefix vitests run test -- suites/runtime-preview/runtime-refresh-coordinator.test.ts'
```

Expected:

```text
Object literal may only specify known properties, and 'getLastCompileFailure' does not exist
```

- [ ] **Step 3: Extend coordinator options and result types**

Modify `RuntimeRefreshCoordinatorOptions`:

```ts
import type {
    RuntimePreviewOutputState,
    ScriptCompileDiagnostic,
} from '../../core/scripting/compile-error-diagnostics';

export interface RuntimeRefreshCoordinatorOptions {
    projectRoot: string;
    refreshTarget: (target: string) => Promise<number | null | undefined>;
    waitForIdle: () => Promise<void>;
    getLastCompileFailure?: () => {
        message: string;
        diagnostic: ScriptCompileDiagnostic;
        createdAt: number;
    } | null;
    clearLastCompileFailure?: () => void;
    verifyProgrammingOutput?: () => Promise<void>;
    invalidateSettings: () => void | Promise<void>;
    clearImportReplacement: () => void | Promise<void>;
    dirtyProvider?: RuntimeRefreshDirtyProvider;
    maxDirtyRefreshPasses?: number;
    logger?: { write: (line: string) => Promise<void> | void };
    now?: () => number;
    reloadDedupeMs?: number;
}
```

Extend result types:

```ts
export interface RuntimeRefreshScriptCompileResult {
    status: RuntimeRefreshScriptCompileStatus;
    durationMs: number;
    error?: string;
    diagnostic?: ScriptCompileDiagnostic;
}

export interface RuntimeRefreshResult {
    ok: boolean;
    refreshId: string;
    target: string;
    outputState?: RuntimePreviewOutputState;
    compileError?: ScriptCompileDiagnostic;
    // existing fields remain
}
```

- [ ] **Step 4: Add failure helper in coordinator**

Inside `createRuntimeRefreshCoordinator()`:

```ts
const createCompileFailedResult = (
    refreshId: string,
    target: string,
    reason: RuntimeRefreshReason,
    startedAt: number,
    changedAssetCount: number | null,
    scriptStartedAt: number,
    diagnostic: ScriptCompileDiagnostic,
    patch: RuntimeRefreshResultPatch = {},
): RuntimeRefreshResult => {
    const scriptCompile: RuntimeRefreshScriptCompileResult = {
        status: 'failed',
        durationMs: now() - scriptStartedAt,
        error: diagnostic.message,
        diagnostic,
    };
    return createFailedResult(
        refreshId,
        target,
        reason,
        startedAt,
        changedAssetCount,
        scriptCompile,
        formatScriptCompileDiagnosticSummary(diagnostic),
        {
            ...patch,
            outputState: diagnostic.outputState ?? 'lastGoodDueToFailure',
            compileError: diagnostic,
        },
    );
};
```

Add import:

```ts
import { formatScriptCompileDiagnosticSummary } from '../../core/scripting/compile-error-diagnostics';
```

- [ ] **Step 5: Check last failure after refreshTarget and waitForIdle**

In `runRefresh()`, replace the `refreshTarget()` catch with structured failure:

```ts
try {
    const changed = await options.refreshTarget(target);
    changedAssetCount = typeof changed === 'number' ? changed : null;
} catch (error) {
    const diagnostic = createScriptCompileDiagnostic(error, {
        phase: reason === 'reload' ? 'reload-refresh' : 'refresh',
        projectRoot: options.projectRoot,
        assetUrl: target,
        refreshId,
        outputState: 'lastGoodDueToFailure',
    });
    const result = createCompileFailedResult(
        refreshId,
        target,
        reason,
        startedAt,
        changedAssetCount,
        now(),
        diagnostic,
    );
    await writeResult(result);
    return result;
}
```

In both `runRefresh()` and `runPostRefreshWork()`, after `await options.waitForIdle()`:

```ts
const lastFailure = options.getLastCompileFailure?.();
if (lastFailure) {
    const result = createCompileFailedResult(
        refreshId,
        target,
        reason,
        startedAt,
        changedAssetCount,
        scriptStartedAt,
        {
            ...lastFailure.diagnostic,
            phase: reason === 'reload' ? 'reload-refresh' : 'refresh',
            refreshId,
            outputState: lastFailure.diagnostic.outputState ?? 'lastGoodDueToFailure',
        },
        patch,
    );
    await writeResult(result);
    return { ok: false, result };
}
```

For `runRefresh()` return the result directly instead of `{ ok: false, result }`.

Also run `options.verifyProgrammingOutput?.()` before invalidating settings. Its catch must use the same `createCompileFailedResult()` path, with diagnostic phase `refresh` / `reload-refresh` and message from the integrity error. Do not classify integrity failure as skipped.

- [ ] **Step 6: Run coordinator tests**

Run:

```powershell
rtk pwsh -NoProfile -Command 'npm --prefix vitests run test -- suites/runtime-preview/runtime-refresh-coordinator.test.ts'
```

Expected:

```text
PASS suites/runtime-preview/runtime-refresh-coordinator.test.ts
```

---

## Task 4: Page and Root Reload Error State

**Files:**
- Modify: `src/runtime-preview/server/runtime-preview-server.ts`
- Modify: `src/runtime-preview/server/runtime-refresh-entry-injection.ts`
- Test: `vitests/suites/runtime-preview/runtime-refresh-entry-injection.test.ts`
- Test: `vitests/suites/runtime-preview/runtime-refresh-browser.test.ts`
- Test: `vitests/suites/runtime-preview/runtime-preview-express-server.test.ts`

- [ ] **Step 1: Add failing injection test for compile error panel**

In `vitests/suites/runtime-preview/runtime-refresh-entry-injection.test.ts`, add:

```ts
it('renders compile error details and last-good state in the refresh panel', () => {
    const html = '<html><body><canvas id="GameCanvas"></canvas></body></html>';
    const injected = injectRuntimeRefreshEntry(html, {
        lastRefresh: createRefreshResult({
            ok: false,
            outputState: 'lastGoodDueToFailure',
            error: 'Script compile failed: assets\\tests\\TestApi.ts:2047:0 Invalid left-hand side in assignment expression.',
            scriptCompile: {
                status: 'failed',
                durationMs: 12,
                error: 'Invalid left-hand side in assignment expression.',
                diagnostic: {
                    phase: 'refresh',
                    target: 'preview',
                    message: 'Invalid left-hand side in assignment expression.',
                    location: {
                        relativeFilePath: 'assets\\tests\\TestApi.ts',
                        line: 2047,
                        column: 0,
                    },
                    codeFrame: '> 2047 | window.TestRefresh() = function (){\\n       | ^',
                    outputState: 'lastGoodDueToFailure',
                },
            },
            compileError: {
                phase: 'refresh',
                target: 'preview',
                message: 'Invalid left-hand side in assignment expression.',
                location: {
                    relativeFilePath: 'assets\\tests\\TestApi.ts',
                    line: 2047,
                    column: 0,
                },
                codeFrame: '> 2047 | window.TestRefresh() = function (){\\n       | ^',
                outputState: 'lastGoodDueToFailure',
            },
        }),
    });

    expect(injected).toContain('assets\\\\tests\\\\TestApi.ts:2047:0');
    expect(injected).toContain('Invalid left-hand side in assignment expression.');
    expect(injected).toContain('window.TestRefresh() = function ()');
    expect(injected).toContain('Current change was not applied');
});
```

Add a server test for no usable output:

```ts
it('returns a compile error page instead of runtime HTML when reload refresh fails with no usable output', async () => {
    const refreshResult = createRefreshResult({
        ok: false,
        outputState: 'noUsableOutput',
        error: 'Script compile failed: assets\\tests\\TestApi.ts:2047:0 Invalid left-hand side in assignment expression.',
        scriptCompile: {
            status: 'failed',
            durationMs: 10,
            diagnostic: {
                phase: 'reload-refresh',
                target: 'preview',
                message: 'Invalid left-hand side in assignment expression.',
                location: {
                    relativeFilePath: 'assets\\tests\\TestApi.ts',
                    line: 2047,
                    column: 0,
                },
                codeFrame: '> 2047 | window.TestRefresh() = function (){',
                outputState: 'noUsableOutput',
            },
        },
    });
    const server = await startRuntimePreviewServer(createServerFixtureOptions({
        refreshOnReload: true,
        refreshCoordinator: {
            refresh: vi.fn(async () => refreshResult),
        },
    }));

    const response = await fetch(server.url + '/');
    const html = await response.text();

    expect(html).toContain('Runtime Preview Compile Error');
    expect(html).toContain('assets\\tests\\TestApi.ts:2047:0');
    expect(html).not.toContain('/scripting/x/packer-driver/targets/preview/import-map.json');
});
```

- [ ] **Step 2: Implement panel markup and client rendering**

Modify `src/runtime-preview/server/runtime-refresh-entry-injection.ts` so injected script includes:

```js
function renderRuntimeRefreshCompileError(state) {
  const result = state && (state.lastRefresh || state.refreshOnReloadFailure);
  const diagnostic = result && (result.compileError || (result.scriptCompile && result.scriptCompile.diagnostic));
  if (!diagnostic) return '';
  const loc = diagnostic.location || {};
  const file = loc.relativeFilePath || loc.filePath || loc.assetUrl || 'unknown';
  const line = loc.line == null ? '' : ':' + loc.line + ':' + (loc.column || 0);
  const stateLine = result.outputState === 'lastGoodDueToFailure'
    ? 'Current change was not applied. Preview keeps last good scripts.'
    : result.outputState === 'noUsableOutput'
      ? 'Current change was not applied. Preview has no usable script output.'
      : '';
  return [
    '<div class="runtime-preview-refresh-error">',
    '<div class="runtime-preview-refresh-error-title">Script compile failed</div>',
    '<div class="runtime-preview-refresh-error-file">' + escapeHtml(file + line) + '</div>',
    '<div class="runtime-preview-refresh-error-message">' + escapeHtml(diagnostic.message || result.error || '') + '</div>',
    diagnostic.codeFrame ? '<pre class="runtime-preview-refresh-error-frame">' + escapeHtml(diagnostic.codeFrame) + '</pre>' : '',
    stateLine ? '<div class="runtime-preview-refresh-error-state">' + escapeHtml(stateLine) + '</div>' : '',
    '</div>',
  ].join('');
}
```

Ensure `escapeHtml()` exists in injected script:

```js
function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
```

- [ ] **Step 3: Do not reload page after failed endpoint refresh**

In refresh button client logic inside `runtime-refresh-entry-injection.ts`, ensure:

```js
if (!result.ok) {
  window.__RUNTIME_PREVIEW_REFRESH_STATE__ = {
    lastRefresh: result
  };
  renderRuntimeRefreshState();
  return;
}
window.location.reload();
```

- [ ] **Step 4: Root reload refresh failure**

In `src/runtime-preview/server/runtime-preview-server.ts`, when `refreshOnReload` returns `ok:false`:

```ts
runtimeRefreshState = {
    refreshOnReloadFailure: result,
};
```

If `result.outputState === 'noUsableOutput'`, return a minimal error page instead of normal runtime HTML:

```html
<!doctype html>
<html>
<head><meta charset="utf-8"><title>Runtime Preview Compile Error</title></head>
<body>
<pre id="runtime-preview-startup-error"></pre>
</body>
</html>
```

The error page must include the same file, line, message and code frame.

- [ ] **Step 5: Run server/browser refresh tests**

Run:

```powershell
rtk pwsh -NoProfile -Command 'npm --prefix vitests run test -- suites/runtime-preview/runtime-refresh-entry-injection.test.ts suites/runtime-preview/runtime-preview-express-server.test.ts suites/runtime-preview/runtime-refresh-browser.test.ts'
```

Expected:

```text
PASS suites/runtime-preview/runtime-refresh-entry-injection.test.ts
PASS suites/runtime-preview/runtime-preview-express-server.test.ts
PASS suites/runtime-preview/runtime-refresh-browser.test.ts
```

---

## Task 5: PackerDriver Output Transaction and QuickPack State Recovery

**Files:**
- Modify: `src/core/scripting/packer-driver/index.ts`
- Create or modify: `src/core/scripting/packer-driver/output-transaction.ts`
- Test: `vitests/suites/runtime-preview/packer-driver-output-transaction.test.ts`
- Test: `vitests/suites/runtime-preview/packer-driver-build-state.test.ts`

- [ ] **Step 1: Write failing output transaction test**

Create `vitests/suites/runtime-preview/packer-driver-output-transaction.test.ts`:

```ts
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import {
    createPackerDriverForTest,
    createPackTargetForTest,
} from '../../../src/core/scripting/packer-driver';

describe('packer-driver output transaction', () => {
    it('restores previous records and reloads target state after QuickPack build failure', async () => {
        const root = await mkdtemp(join(tmpdir(), 'rp-output-transaction-'));
        const targetRoot = join(root, 'packer-driver', 'targets', 'preview');
        await mkdir(targetRoot, { recursive: true });
        await writeFile(join(targetRoot, 'import-map.json'), JSON.stringify({
            imports: {
                'cce:/internal/x/prerequisite-imports': './chunks/good/good.js',
            },
            scopes: {
                './chunks/good/good.js': {
                    '__unresolved_0': './chunks/aa/a.js',
                },
            },
        }, null, 2));
        await writeFile(join(targetRoot, 'assembly-record.json'), JSON.stringify({
            chunks: {
                good: {
                    imports: {
                        '__unresolved_0': {
                            resolved: { type: 'chunk', id: 'a' },
                            messages: [],
                        },
                    },
                },
            },
            entries: {
                'cce:/internal/x/prerequisite-imports': 'good',
            },
        }, null, 2));

        let reloaded = false;
        const quickPack = {
            _middleware: {
                workspace: targetRoot,
                mainRecordPath: join(targetRoot, 'main-record.json'),
                assemblyRecordPath: join(targetRoot, 'assembly-record.json'),
            },
            _chunkWriter: {
                _importMapPath: join(targetRoot, 'import-map.json'),
                _importMapPathTemp: join(targetRoot, 'import-map.json.tmp'),
                _resolutionDetailMapPath: join(targetRoot, 'resolution-detail-map.json'),
                _resolutionDetailMapPathTemp: join(targetRoot, 'resolution-detail-map.json.tmp'),
                addChunk: () => 'bad',
            },
            build: async () => {
                await writeFile(join(targetRoot, 'import-map.json'), JSON.stringify({
                    imports: {
                        'cce:/internal/x/prerequisite-imports': './chunks/bad/bad.js',
                    },
                    scopes: {},
                }, null, 2));
                throw new SyntaxError('Invalid left-hand side in assignment expression. (2047:0)');
            },
            loadCache: async () => {
                reloaded = true;
            },
            clear: () => undefined,
        };

        const target = createPackTargetForTest({
            name: 'preview',
            modLo: createMinimalModLo(),
            quickPack,
            quickPackLoaderContext: {} as any,
        });

        const result = await target.build();

        expect(result.err?.message).toContain('Invalid left-hand side');
        expect(JSON.parse(await readFile(join(targetRoot, 'import-map.json'), 'utf8')).scopes['./chunks/good/good.js'].__unresolved_0).toBe('./chunks/aa/a.js');
        expect(reloaded).toBe(true);

        await rm(root, { recursive: true, force: true });
    });
});
```

`createMinimalModLo()` should be defined in this test using the same fake shape as `packer-driver-entry-source-optimization.test.ts`, returning methods required by `createPackTargetForTest`.

- [ ] **Step 2: Run failing output transaction test**

Run:

```powershell
rtk pwsh -NoProfile -Command 'npm --prefix vitests run test -- suites/runtime-preview/packer-driver-output-transaction.test.ts'
```

Expected:

```text
expected import-map scope to remain good, but it was overwritten by the failed build
```

- [ ] **Step 3: Implement output transaction helper**

Create `src/core/scripting/packer-driver/output-transaction.ts`:

```ts
import { copyFileSync, existsSync, mkdirSync, renameSync, rmSync, unlinkSync } from 'fs';
import { createHash } from 'crypto';
import { dirname, join } from 'path';
import { tmpdir } from 'os';

export interface PackerDriverOutputTransaction {
    backup(filePath: string): void;
    markCreated(filePath: string): void;
    commit(): void;
    rollback(): void;
}

export function createPackerDriverOutputTransaction(
    targetRoot: string,
): PackerDriverOutputTransaction {
    const backupRoot = join(tmpdir(), `cocos-cli-pack-tx-${process.pid}-${Date.now()}`);
    const backedUp = new Set<string>();
    const created = new Set<string>();
    const backupPathFor = (filePath: string): string => {
        const hash = createHash('sha1').update(filePath).digest('hex');
        return join(backupRoot, hash);
    };
    const backup = (filePath: string): void => {
        if (backedUp.has(filePath)) {
            return;
        }
        backedUp.add(filePath);
        if (!existsSync(filePath)) {
            created.add(filePath);
            return;
        }
        const backupPath = backupPathFor(filePath);
        mkdirSync(dirname(backupPath), { recursive: true });
        copyFileSync(filePath, backupPath);
    };

    return {
        backup,
        markCreated(filePath: string) {
            if (!backedUp.has(filePath) && !existsSync(filePath)) {
                created.add(filePath);
            }
        },
        commit() {
            rmSync(backupRoot, { recursive: true, force: true });
        },
        rollback() {
            for (const filePath of Array.from(created).reverse()) {
                if (existsSync(filePath)) {
                    unlinkSync(filePath);
                }
            }
            for (const filePath of Array.from(backedUp).reverse()) {
                const backupPath = backupPathFor(filePath);
                if (!existsSync(backupPath)) {
                    continue;
                }
                mkdirSync(dirname(filePath), { recursive: true });
                try {
                    renameSync(backupPath, filePath);
                } catch {
                    copyFileSync(backupPath, filePath);
                }
            }
            rmSync(backupRoot, { recursive: true, force: true });
        },
    };
}
```

This helper is intentionally synchronous because QuickPack chunk writes are synchronous. It backs up only files touched by the build, not the whole programming root. It also tracks files that did not exist before the failed build so rollback can delete newly generated chunk / `.map` / `.tmp` files.

- [ ] **Step 4: Integrate transaction into PackTarget**

In `src/core/scripting/packer-driver/index.ts`, add a method that derives target root from QuickPack middleware:

```ts
private _getQuickPackTargetRoot(): string | undefined {
    return (this._quickPack as any)._middleware?.workspace;
}
```

Wrap `build()` execution:

```ts
public async build(): Promise<BuildResult> {
    if (this._buildPromise) {
        this._logger.debug(`Target(${this._name}) build already in progress, waiting for existing build...`);
        return this._buildPromise;
    }
    this._buildStarted = true;
    const targetName = this._name;
    this._buildPromise = this._executeBuildWithOutputTransaction(targetName);
    try {
        return await this._buildPromise;
    } finally {
        this._buildPromise = null;
    }
}
```

Add:

```ts
private async _executeBuildWithOutputTransaction(targetName: string): Promise<BuildResult> {
    const targetRoot = this._getQuickPackTargetRoot();
    const transaction = targetRoot ? createPackerDriverOutputTransaction(targetRoot) : null;
    this._backupKnownQuickPackOutputs(transaction);
    this._installTransactionHooks(transaction);
    const result = await this._executeBuild(targetName);
    if (result.err) {
        transaction?.rollback();
        await this._reloadQuickPackCacheAfterRollback();
    } else {
        const integrityError = await this._verifyPrerequisiteImportMapIntegrity();
        if (integrityError) {
            result.err = integrityError;
            transaction?.rollback();
            await this._reloadQuickPackCacheAfterRollback();
        } else {
            transaction?.commit();
        }
    }
    return result;
}
```

Implement transaction hooks:

```ts
private _backupKnownQuickPackOutputs(transaction: PackerDriverOutputTransaction | null): void {
    if (!transaction) {
        return;
    }
    const quickPack = this._quickPack as any;
    const middleware = quickPack._middleware;
    const writer = quickPack._chunkWriter;
    for (const filePath of [
        middleware?.mainRecordPath,
        middleware?.assemblyRecordPath,
        middleware?.importMapPath,
        middleware?.resolutionDetailMapPath,
        writer?._importMapPath,
        writer?._importMapPathTemp,
        writer?._resolutionDetailMapPath,
        writer?._resolutionDetailMapPathTemp,
    ]) {
        if (filePath) {
            transaction.backup(filePath);
        }
    }
}

private _installTransactionHooks(transaction: PackerDriverOutputTransaction | null): void {
    if (!transaction) {
        return;
    }
    const quickPack = this._quickPack as any;
    const writer = quickPack._chunkWriter;
    const originalAddChunk = writer?.addChunk?.bind(writer);
    if (originalAddChunk && !writer.__cocosCliTransactionAddChunkWrapped) {
        writer.__cocosCliTransactionAddChunkWrapped = true;
        writer.addChunk = (...args: unknown[]) => {
            const chunkId = writer._generateChunkId?.(args[0], args[1]);
            if (chunkId && writer._calculateChunkCodeFileName) {
                const chunkPath = writer._calculateChunkCodeFileName(chunkId);
                transaction.backup(chunkPath);
                transaction.backup(`${chunkPath}.map`);
            }
            return originalAddChunk(...args);
        };
    }
}
```

If private method names are unavailable in tests, use wrapper tests that verify records first; do not silently remove transaction. Do not use `void transaction.backup(...)` anywhere in the write path.

- [ ] **Step 5: Reload QuickPack state after rollback**

Add:

```ts
private async _reloadQuickPackCacheAfterRollback(): Promise<void> {
    const quickPack = this._quickPack as any;
    if (typeof quickPack.clear === 'function') {
        quickPack.clear();
    }
    if (typeof quickPack.loadCache === 'function') {
        await quickPack.loadCache();
    }
    this._ready = false;
}
```

This is required because restoring disk files alone leaves `_moduleRecords` / `_chunkWriter` memory possibly polluted.

- [ ] **Step 6: Move ready/build-end after transaction success**

Refactor `PackTarget._executeBuild()` so it does not unconditionally set `_ready = true` in `finally`. The state transitions must be:

```text
build start -> QuickPack build -> integrity gate -> transaction commit -> _ready=true -> emit pack-build-end
build start -> QuickPack error/integrity error -> transaction rollback -> reload cache -> _ready=false -> emit pack-build-failed
```

Do not emit `pack-build-end` before rollback / integrity gate finishes. Keep an explicit failed event for stdout and tests:

```ts
eventEmitter.emit('pack-build-failed', { targetName, error: result.err });
```

- [ ] **Step 7: Run transaction tests**

Run:

```powershell
rtk pwsh -NoProfile -Command 'npm --prefix vitests run test -- suites/runtime-preview/packer-driver-output-transaction.test.ts suites/runtime-preview/packer-driver-build-state.test.ts'
```

Expected:

```text
PASS suites/runtime-preview/packer-driver-output-transaction.test.ts
PASS suites/runtime-preview/packer-driver-build-state.test.ts
```

---

## Task 6: Prerequisite Integrity Gate Before Success

**Files:**
- Modify: `src/core/scripting/packer-driver/index.ts`
- Create: `src/core/scripting/packer-driver/prerequisite-integrity.ts`
- Test: `vitests/suites/runtime-preview/packer-driver-output-transaction.test.ts`
- Test: `vitests/shared/runtime-preview-prerequisite-evidence.ts`

- [ ] **Step 1: Add failing integrity test**

In `vitests/suites/runtime-preview/packer-driver-output-transaction.test.ts`, add:

```ts
it('treats missing prerequisite import-map scope as build failure', async () => {
    const target = createPackTargetForTest({
        name: 'preview',
        modLo: createMinimalModLo(),
        quickPack: createQuickPackThatWritesBrokenPrerequisiteImportMap(),
        quickPackLoaderContext: {} as any,
    });

    const result = await target.build();

    expect(result.err?.message).toContain('prerequisite scope is missing');
});
```

- [ ] **Step 2: Implement pure integrity helper**

Create `src/core/scripting/packer-driver/prerequisite-integrity.ts`:

```ts
import { readFile } from 'fs/promises';
import { join } from 'path';

interface RuntimePreviewImportMap {
    imports?: Record<string, string>;
    scopes?: Record<string, Record<string, string>>;
}

export async function verifyPrerequisiteImportMapIntegrity(recordsRoot: string): Promise<void> {
    const importMapPath = join(recordsRoot, 'import-map.json');
    const importMap = JSON.parse(await readFile(importMapPath, 'utf8')) as RuntimePreviewImportMap;
    const prerequisiteChunk = importMap.imports?.['cce:/internal/x/prerequisite-imports'];
    if (!prerequisiteChunk) {
        throw new Error('Runtime preview programming output is inconsistent: prerequisite import is missing.');
    }
    if (!/^\.\/chunks\/[^/]+\/[^/]+\.js$/.test(prerequisiteChunk)) {
        throw new Error(`Runtime preview programming output is inconsistent: invalid prerequisite chunk ${prerequisiteChunk}.`);
    }
    const prerequisiteScope = importMap.scopes?.[prerequisiteChunk];
    if (!prerequisiteScope) {
        throw new Error('Runtime preview programming output is inconsistent: prerequisite import scope is missing.');
    }

    const chunkPath = join(recordsRoot, prerequisiteChunk.replace(/^\.\//, ''));
    const chunkSource = await readFile(chunkPath, 'utf8');
    const requiredSpecifiers = Array.from(new Set(chunkSource.match(/__unresolved_\d+/g) ?? []));
    for (const specifier of requiredSpecifiers) {
        const chunkImport = prerequisiteScope[specifier];
        if (typeof chunkImport !== 'string' || !/^\.\/chunks\/[^/]+\/[^/]+\.js$/.test(chunkImport)) {
            throw new Error(`Runtime preview programming output is inconsistent: prerequisite scope is missing ${specifier}.`);
        }
    }
}
```

Then call it from `PackTarget`:

```ts
private async _verifyPrerequisiteImportMapIntegrity(): Promise<Error | null> {
    const targetRoot = this._getQuickPackTargetRoot();
    if (!targetRoot || this._name !== 'preview') {
        return null;
    }
    try {
        await verifyPrerequisiteImportMapIntegrity(targetRoot);
        return null;
    } catch (error) {
        return error instanceof Error ? error : new Error(String(error));
    }
}
```

Do not import `src/core/launcher.ts` from packer-driver. The helper must be pure and only read `import-map.json` plus the prerequisite chunk.

Add tests for:

- missing `cce:/internal/x/prerequisite-imports`;
- invalid prerequisite chunk path;
- missing `scopes[prerequisiteChunk]`;
- scope exists but lacks `__unresolved_0`;
- chunk file missing.

- [ ] **Step 3: Run integrity tests**

Run:

```powershell
rtk pwsh -NoProfile -Command 'npm --prefix vitests run test -- suites/runtime-preview/packer-driver-output-transaction.test.ts suites/runtime-preview/preview-prerequisite-imports-policy.test.ts'
```

Expected:

```text
PASS suites/runtime-preview/packer-driver-output-transaction.test.ts
PASS suites/runtime-preview/preview-prerequisite-imports-policy.test.ts
```

---

## Task 7: Startup Console Contract

**Files:**
- Modify: `src/core/launcher.ts`
- Modify: `src/core/scripting/packer-driver/index.ts`
- Test: `vitests/suites/runtime-preview/launcher-runtime-preview.test.ts`

- [ ] **Step 1: Add failing stdout contract test**

In `vitests/suites/runtime-preview/launcher-runtime-preview.test.ts`, add:

```ts
it('prints script compile failure file, line, code frame and last-good state to stdout', async () => {
    const result = await runRuntimePreviewLauncherFixture({
        scriptCompileEvents: [
            'asset-db:script-sync:collect:start',
            'asset-db:script-sync:collect:done durationMs=1 count=3051',
            'asset-db:script-compile:start count=3051',
            'asset-db:script-compile:failed phase=startup target=preview file=assets\\tests\\TestApi.ts:2047:0',
            'asset-db:Invalid left-hand side in assignment expression.',
            'asset-db:> 2047 | window.TestRefresh() = function (){',
            'asset-db:       | ^',
            'asset-db:current change was not applied; preview keeps last good scripts',
        ],
    });

    expect(result.stdout).toContain('[runtime-preview] asset-db:script-sync:collect:start');
    expect(result.stdout).toContain('[runtime-preview] asset-db:script-compile:start count=3051');
    expect(result.stdout).toContain('[runtime-preview] asset-db:script-compile:failed phase=startup target=preview file=assets\\tests\\TestApi.ts:2047:0');
    expect(result.stdout).toContain('window.TestRefresh() = function ()');
    expect(result.stdout).toContain('current change was not applied; preview keeps last good scripts');
});
```

- [ ] **Step 2: Ensure PackerDriver target logs user-visible start/failed**

Use a single stdout event schema. Source prefixes such as `asset-db:` may identify the emitter, but the core event names must stay consistent:

```text
script-compile:start count=<n>
script-compile:done durationMs=<ms> count=<n>
script-compile:failed phase=<phase> target=<target> file=<path:line:column>
pack-target:build:start target=<editor|preview>
pack-target:build:done target=<editor|preview> durationMs=<ms>
pack-target:build:failed target=<editor|preview> file=<path:line:column> message=<message>
```

`PackTarget._executeBuild()` already emits `pack-build-start`; do not add a second start event. Instead, make launcher translate existing `pack-build-start` into:

```text
[runtime-preview] pack-target:build:start target=preview
```

On failure, emit or log a structured failure payload:

```ts
const diagnostic = createScriptCompileDiagnostic(error, {
    phase: 'build',
    target: targetName,
});
eventEmitter.emit('pack-build-failed', { targetName, diagnostic });
this._logger.error(`Target(${targetName}) build failed. ${formatScriptCompileDiagnosticSummary(diagnostic)}`);
```

Launcher should consume `pack-build-failed` so stdout contains:

```text
[runtime-preview] pack-target:build:failed target=preview file=assets/tests/TestApi.ts:2047:0 message=Invalid left-hand side in assignment expression.
```

- [ ] **Step 3: Run launcher stdout tests**

Run:

```powershell
rtk pwsh -NoProfile -Command 'npm --prefix vitests run test -- suites/runtime-preview/launcher-runtime-preview.test.ts'
```

Expected:

```text
PASS suites/runtime-preview/launcher-runtime-preview.test.ts
```

---

## Task 8: Real P7 Validation

**Files:**
- Modify: `docs/dev/runtime-preview/facts/prerequisite-scope-missing-after-refresh-20260630.md`
- Modify: `docs/dev/runtime-preview/issues.md`

- [ ] **Step 1: Build dist**

Run from `E:\own_space\engines\cocos-cli`:

```powershell
rtk pwsh -NoProfile -Command 'npm run compile'
```

Expected:

```text
✅ Schema 文件已生成
```

- [ ] **Step 2: Clear test env for production-style P7 run**

Run:

```powershell
rtk pwsh -NoProfile -Command '$ErrorActionPreference="Stop"; Remove-Item Env:COCOS_CLI_TEST_PROJECT_ROOT -ErrorAction SilentlyContinue; Remove-Item Env:COCOS_CLI_TEST_ENGINE_ROOT -ErrorAction SilentlyContinue; Remove-Item Env:COCOS_CLI_TEST_EDITOR_LIBRARY_REF -ErrorAction SilentlyContinue; Remove-Item Env:COCOS_CLI_TEST_EDITOR_PROGRAMMING_REF -ErrorAction SilentlyContinue; node E:\own_space\engines\cocos-cli\dist\cli.js preview --runtime --project D:\ps_copy\p7\trunk\GameClient\Client-fight-roguelike-migration --host 127.0.0.1 --port 9632 --watch-assets --refresh-on-reload'
```

Expected startup stdout includes compile state and, if `TestApi.ts` is still invalid:

```text
[runtime-preview] asset-db:script-compile:start count=
[runtime-preview] script-compile:failed phase=startup target=preview file=assets\tests\TestApi.ts:2047:0
[runtime-preview] Invalid left-hand side in assignment expression.
[runtime-preview] current change was not applied; preview keeps last good scripts
```

- [ ] **Step 3: Preserve P7 source and record current dirty state**

Before editing P7 source, run:

```powershell
rtk pwsh -NoProfile -Command '$project="D:\ps_copy\p7\trunk\GameClient\Client-fight-roguelike-migration"; git -C $project status --short; $file=Join-Path $project "assets\tests\TestApi.ts"; $backup=Join-Path $project "temp\codex-runtime-preview\TestApi.ts.rp-issue-032.backup"; New-Item -ItemType Directory -Force -Path (Split-Path $backup) | Out-Null; Copy-Item -LiteralPath $file -Destination $backup -Force; Write-Output "backup=$backup"'
```

Expected:

```text
backup=D:\ps_copy\p7\trunk\GameClient\Client-fight-roguelike-migration\temp\codex-runtime-preview\TestApi.ts.rp-issue-032.backup
```

All later P7 source edits must be wrapped in a `try/finally` style script that restores this backup.

- [ ] **Step 4: Verify already-bad / no usable output behavior**

The current P7现场 may already have a polluted `import-map.json`. Do not expect rollback to repair it automatically.

Run:

```powershell
rtk pwsh -NoProfile -Command '$r=Invoke-WebRequest -UseBasicParsing -Uri http://127.0.0.1:9632/ -SkipHttpErrorCheck; "status=$($r.StatusCode)"; $r.Content.Substring(0,[Math]::Min(1000,$r.Content.Length))'
```

Expected if existing output is already bad:

```text
status=200
Runtime Preview Compile Error
assets\tests\TestApi.ts:2047:0
Invalid left-hand side in assignment expression
```

The root page must not load runtime scripts in `noUsableOutput`. If it serves normal runtime HTML while `import-map` is known bad, validation fails.

- [ ] **Step 5: Establish a verified last-good output**

Temporarily fix `TestApi.ts`:

```powershell
rtk pwsh -NoProfile -Command '$project="D:\ps_copy\p7\trunk\GameClient\Client-fight-roguelike-migration"; $file=Join-Path $project "assets\tests\TestApi.ts"; $text=Get-Content -Raw -LiteralPath $file; $text=$text.Replace("window.TestRefresh() = function (){","(window as any).TestRefresh = function (){"); Set-Content -LiteralPath $file -Value $text -Encoding UTF8'
```

Trigger refresh:

```powershell
rtk pwsh -NoProfile -Command '$r=Invoke-WebRequest -UseBasicParsing -Method Post -Uri http://127.0.0.1:9632/__runtime-preview/refresh -ContentType application/json -Body "{""target"":""db://assets/tests/TestApi.ts""}"; $r.Content'
```

Expected:

```json
{ "ok": true, "outputState": "latest" }
```

Verify last-good import-map:

```powershell
rtk pwsh -NoProfile -Command '$mapPath="D:\ps_copy\p7\trunk\GameClient\Client-fight-roguelike-migration\temp\cli\programming\packer-driver\targets\preview\import-map.json"; $j=Get-Content -Raw -LiteralPath $mapPath | ConvertFrom-Json; $pr=$j.imports."cce:/internal/x/prerequisite-imports"; $has=[bool]$j.scopes.PSObject.Properties[$pr]; "prerequisite=$pr"; "hasScope=$has"'
```

Expected:

```text
hasScope=True
```

- [ ] **Step 6: Reintroduce syntax error and verify HTTP refresh failure payload**

Reintroduce the invalid line:

```powershell
rtk pwsh -NoProfile -Command '$project="D:\ps_copy\p7\trunk\GameClient\Client-fight-roguelike-migration"; $file=Join-Path $project "assets\tests\TestApi.ts"; $text=Get-Content -Raw -LiteralPath $file; $text=$text.Replace("(window as any).TestRefresh = function (){","window.TestRefresh() = function (){"); Set-Content -LiteralPath $file -Value $text -Encoding UTF8'
```

In a second shell:

```powershell
rtk pwsh -NoProfile -Command '$r=Invoke-WebRequest -UseBasicParsing -Method Post -Uri http://127.0.0.1:9632/__runtime-preview/refresh -ContentType application/json -Body "{""target"":""db://assets/tests/TestApi.ts""}"; $r.Content'
```

Expected JSON:

```json
{
  "ok": false,
  "outputState": "lastGoodDueToFailure",
  "scriptCompile": {
    "status": "failed",
    "diagnostic": {
      "location": {
        "relativeFilePath": "assets\\tests\\TestApi.ts",
        "line": 2047,
        "column": 0
      }
    }
  }
}
```

- [ ] **Step 7: Verify import-map remains last-good and is not polluted**

Run:

```powershell
rtk pwsh -NoProfile -Command '$mapPath="D:\ps_copy\p7\trunk\GameClient\Client-fight-roguelike-migration\temp\cli\programming\packer-driver\targets\preview\import-map.json"; $j=Get-Content -Raw -LiteralPath $mapPath | ConvertFrom-Json; $pr=$j.imports."cce:/internal/x/prerequisite-imports"; $has=[bool]$j.scopes.PSObject.Properties[$pr]; "prerequisite=$pr"; "hasScope=$has"'
```

Expected:

```text
hasScope=True
```

- [ ] **Step 8: Browser validation**

Use the existing browser validation helper or manual browser:

1. Open `http://127.0.0.1:9632`.
2. Click `Refresh`.
3. Confirm the page displays:
   - `assets\tests\TestApi.ts:2047:0`
   - `Invalid left-hand side in assignment expression`
   - `window.TestRefresh() = function ()`
   - `Current change was not applied`
4. Confirm DevTools console does not show `Unable to resolve bare specifier '__unresolved_0'`.

- [ ] **Step 9: Restore P7 source and verify recovery**

Restore the original file:

```powershell
rtk pwsh -NoProfile -Command '$project="D:\ps_copy\p7\trunk\GameClient\Client-fight-roguelike-migration"; $file=Join-Path $project "assets\tests\TestApi.ts"; $backup=Join-Path $project "temp\codex-runtime-preview\TestApi.ts.rp-issue-032.backup"; Copy-Item -LiteralPath $backup -Destination $file -Force; git -C $project status --short'
```

If the original file was invalid before validation, do not claim recovery from syntax fix. If the original was valid, trigger Refresh and expect:

```text
refresh ok=true
outputState=latest
browser has no __unresolved_0 error
```

If the original was invalid, keep the issue validation result limited to error visibility and output safety; record that business source remains invalid.

- [ ] **Step 10: Update facts and issue state**

Update `docs/dev/runtime-preview/facts/prerequisite-scope-missing-after-refresh-20260630.md` with:

- exact command;
- log file path;
- already-bad/no-usable result;
- last-good establishment result;
- failed refresh response JSON excerpt;
- import-map scope check;
- browser result;
- P7 source restore status and final `git status --short`.

Keep `RP-ISSUE-032` `open` until P7 validation passes. Mark `fixed` only after the real project validation and focused tests pass.

---

## Verification Matrix

Run focused tests:

```powershell
rtk pwsh -NoProfile -Command 'npm run test -- src/core/scripting/test/compile-error-diagnostics.test.ts src/core/scripting/test/script-manager.test.ts --runInBand'
rtk pwsh -NoProfile -Command 'npm --prefix vitests run test -- suites/runtime-preview/runtime-refresh-coordinator.test.ts suites/runtime-preview/runtime-refresh-entry-injection.test.ts suites/runtime-preview/runtime-refresh-browser.test.ts suites/runtime-preview/runtime-preview-express-server.test.ts suites/runtime-preview/launcher-runtime-preview.test.ts suites/runtime-preview/packer-driver-output-transaction.test.ts suites/runtime-preview/packer-driver-build-state.test.ts suites/runtime-preview/preview-prerequisite-imports-policy.test.ts'
```

Run TypeScript build check:

```powershell
rtk pwsh -NoProfile -Command 'npx tsc -b --pretty false'
```

Build `dist` before P7 validation:

```powershell
rtk pwsh -NoProfile -Command 'npm run compile'
```

Real project validation:

```powershell
rtk pwsh -NoProfile -Command 'Remove-Item Env:COCOS_CLI_TEST_PROJECT_ROOT -ErrorAction SilentlyContinue; Remove-Item Env:COCOS_CLI_TEST_ENGINE_ROOT -ErrorAction SilentlyContinue; Remove-Item Env:COCOS_CLI_TEST_EDITOR_LIBRARY_REF -ErrorAction SilentlyContinue; Remove-Item Env:COCOS_CLI_TEST_EDITOR_PROGRAMMING_REF -ErrorAction SilentlyContinue; node E:\own_space\engines\cocos-cli\dist\cli.js preview --runtime --project D:\ps_copy\p7\trunk\GameClient\Client-fight-roguelike-migration --host 127.0.0.1 --port 9632 --watch-assets --refresh-on-reload'
```

## Acceptance Criteria

- Startup stdout shows script collect, compile start, target build start, and compile failure details.
- Refresh endpoint returns `ok:false` for `TestApi.ts` syntax error even if lower layers caught the error internally.
- Refresh page shows script path, line, column, message, code frame, and “current change was not applied”.
- Failed refresh does not reload runtime into broken `import-map`.
- Failed QuickPack build does not persist missing prerequisite scope.
- Failed QuickPack build recovers in-memory QuickPack state before next refresh.
- If no last-good output exists, root page does not load runtime scripts and shows compile error.
- After syntax fix, P7 refresh returns `ok:true`, `outputState=latest`, and browser has no `__unresolved_0` error.

## Self-Review

Spec coverage:

- 错误可见性：Tasks 1, 2, 4, 7 cover stdout and page display.
- 失败传播：Task 3 covers `ok:false` even when lower layers caught errors.
- 产物安全：Tasks 5 and 6 cover rollback, memory state recovery and integrity gate.
- 性能边界：Task 5 uses target-level file backup, not full programming root copy.
- 真实项目验收：Task 8 covers P7 production-style validation.

Placeholder scan:

- No `TBD`, `TODO`, or “add appropriate error handling” placeholders.
- Every task has concrete files, commands and expected results.

Type consistency:

- `ScriptCompileDiagnostic`, `RuntimePreviewOutputState`, `RuntimeRefreshResult.compileError`, and `RuntimeRefreshScriptCompileResult.diagnostic` are consistently named across tasks.
