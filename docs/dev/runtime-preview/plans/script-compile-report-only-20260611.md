# Runtime Preview Script Compile Report-Only 计划

记录时间：2026-06-11

本文只定义下一轮修复计划，等待确认后执行。目标是恢复 runtime preview 的核心预览流程：script compile 阶段的可恢复错误必须报告，但不得阻断 server startup、settings build、browser scene load 诊断链路。

## 背景事实

`feature-c` 当前阻断错误：

```text
resolve_error_module_not_found: {"specifier":"@tbmp/mp-cloud-sdk","parentURL":"file:///D:/ps_copy/p6/trunk/Project/GameClient/feature-c/assets/first_screen/thinking_analytics/tdanalytics.mg.cocoscreator.min.js"}
```

该 package 本来不在项目 `node_modules` 中。它来自 platform-only CommonJS 代码，在 browser runtime preview 中不应因为 resolver 找不到就卡死整个预览流程。

当前分支的 `--script-stub` / `runtimePreviewScriptStubs` 方案是错误设计：

- 它把 `@tbmp/mp-cloud-sdk` 写成 runtime preview exact allow-list stub。
- 它依赖 CLI 参数、global import map 和 `/runtime-preview-stubs/*` HTTP route。
- 它不是 Cocos editor / packer-driver 原本处理这类 CommonJS missing bare specifier 的方式。
- 它会把问题从“编译恢复机制”错误地转成“维护业务 package allow-list”。

备份分支事实：

- 参考实现位于 `E:\own_space\tmp-repos\runtime-preview-reference\cocos-cli-backup-runtime-preview-bad-20260606\src\core\scripting\packer-driver\index.ts`。
- 旧实现通过 `installCommonJSBareSpecifierFallback(quickPack, logger)` 包装 `QuickPack._resolve`。
- 当 `moduleType === 'commonjs'` 且 specifier 是 bare specifier 时，如果 resolver 抛错，则生成 `data:text/javascript` fallback module。
- fallback module 只导出 `__cjsMetaURL`，例如：

```js
export const __cjsMetaURL = '@tbmp/mp-cloud-sdk';
```

- 错误不会静默吞掉，会进入 `resolution-detail-map.json`。
- `feature-c` 旧产物 `D:\ps_copy\p6\trunk\Project\GameClient\feature-c\temp\cli\programming\packer-driver\targets - 副本\preview\resolution-detail-map.json` 已记录：

```text
Failed to resolve CommonJS bare specifier "@tbmp/mp-cloud-sdk" ...
Using a CJS meta URL fallback so preview script compilation can continue.
```

当前分支事实：

- `src/core/assets/manager/asset-db.ts` 中 `scripting.compileScripts(changes)` 已经 catch error，并发出 `asset-db:script-compile:error ...`，随后继续 AssetDB startup 流程。
- `src/core/launcher.ts` 又读取 `asset-db:script-compile:error` 并主动 `throw new Error("Runtime preview script compile failed: ...")`。
- 因此当前 fatal 行为不是 AssetDB 必然要求，而是 Launcher 二次升级导致。

## 目标

1. 删除 `--script-stub` 机制。
2. 恢复 packer-driver 层 CommonJS bare specifier fallback。
3. runtime preview script compile error 只报告、不阻断 startup。
4. 保留可见诊断，让 acceptance 可以基于 browser evidence 和 log 判断失败原因。

## 非目标

- 不把任意 missing module 都伪造成可运行 API。
- 不维护项目级、业务级 package allow-list。
- 不修改正常 build 行为。
- 不修改项目 `script.importMap`。
- 不修改 `assets/**/*.meta`。
- 不把 browser runtime error 伪装成成功验收。
- 本计划不恢复备份分支中的 prerequisite script recovery 调用链，例如 `recoverPreviewScriptErrors`、`recoverFailedPrerequisiteScripts`、`tryGetFailedScriptURLForPreviewRecovery()`、`findPrerequisiteImportDependents()`。该链路和 CommonJS bare specifier fallback 是不同机制；如需恢复，必须另写计划。

## 设计裁决

### 1. 删除 `script-stub`

必须删除：

- `src/runtime-preview/script-stubs.ts`
- `preview --runtime --script-stub <specifier>` CLI option
- `Launcher.startRuntimePreview({ scriptStubs })`
- `runtimePreviewScriptStubs`
- `RuntimePreviewContext.scriptStubs`
- `/runtime-preview-stubs/*` route
- `/scripting/import-map-global` 中注入 stub import map 的逻辑
- 所有直接依赖 `@tbmp/mp-cloud-sdk` stub 的测试和文档表述

保留原则：

- `/scripting/import-map-global` 仍应提供 Cocos preview 所需的基础 imports，例如 `cc`、`cc/env`、`cc/userland/macro`。
- 不再有 runtime preview package allow-list。

### 2. 恢复 CommonJS bare specifier fallback

在 `src/core/scripting/packer-driver/index.ts` 恢复备份分支机制：

- 给每个 `QuickPack` target 安装 resolver wrapper。
- wrapper 调用原始 `_resolve`。
- 原始 `_resolve` 成功：返回原始结果。
- 原始 `_resolve` 失败：
  - 如果 `moduleType === 'commonjs'` 且 specifier 是 bare specifier：返回 fallback module resolution。
  - 否则重新抛出原始错误。

fallback module 二元规则：

| 条件 | 行为 |
| --- | --- |
| `moduleType === 'commonjs'` 且 `specifier` 是 bare specifier | 生成 `data:text/javascript` module，导出 `__cjsMetaURL`，记录 error message，compile 继续 |
| relative specifier，例如 `./local` | 不 fallback，重新抛错 |
| ESM import 缺失 | 不 fallback，重新抛错 |
| JSON module 缺失 | 不 fallback，重新抛错 |
| resolver private API `_resolve` 不存在 | 记录 warning，不安装 fallback |

bare specifier 判定必须复用 Cocos programming package 的既有实现：

```ts
import { isBareSpecifier } from '@cocos/creator-programming-common/lib/specifier';
```

不得重新手写一套 bare specifier 规则。测试至少覆盖：

| Specifier | 预期 |
| --- | --- |
| `@scope/pkg` | bare |
| `@scope/pkg/subpath` | bare |
| `pkg` | bare |
| `pkg/subpath` | bare |
| `./local` | non-bare |
| `../local` | non-bare |
| `/abs/path` | non-bare |
| `C:/abs/path` | non-bare |
| `file:///x.js` | non-bare |
| `node:fs` | non-bare |
| `q-bundled:///virtual/cc.js` | non-bare |
| `cce:/internal/x/cc` | non-bare |

fallback source：

```ts
const source = `
export const __cjsMetaURL = '${escapedSpecifier}';
`;
```

该 source 不是业务 API mock。它只让 CommonJS loader 的 `require("<specifier>")` 保留可见 meta URL，使编译产物能继续生成；运行时如果代码真正调用该平台 API，应由 browser runtime diagnostics 暴露。

### 3. Launcher compile error report-only

`src/core/launcher.ts` 不得再执行：

```ts
throw new Error(`Runtime preview script compile failed: ${assetDbScriptCompileErrorLine}`);
```

改为：

- 记录 `asset-db:script-compile:error` 原始事件。
- 输出唯一固定 report-only event：

```text
asset-db:script-compile:report-only source=asset-db:script-compile:error
```

- 继续执行 `inspectRuntimePreviewProgrammingArtifacts()`。
- 如果后续 settings build、route、browser 失败，由对应阶段诊断记录。

边界：

- `builder:init` 失败仍 fail-fast。
- `settings:build` 失败仍 fail-fast，因为没有 settings 浏览器无法启动正确 scene。
- programming artifact 缺失如果会导致 server 无法服务核心 script route，需要按现有规则报告；是否 fail-fast 由对应函数现有 contract 决定，本计划不扩大。

### 4. Diagnostics 和验收语义

`preview:ready` 表示 CLI startup 和 settings warm-up 完成，不表示 script compile 完全无错误。

如果存在 script compile report-only 错误：

- `preview:ready` 可以出现。
- log 必须保留 `asset-db:script-compile:error`。
- log 必须保留 `asset-db:script-compile:report-only source=asset-db:script-compile:error`。
- browser evidence / server log / `resolution-detail-map.json` 负责说明后续 runtime 是否可用。

strict acceptance 仍然要求：

- `pageErrors.length === 0`
- `unhandledRejections.length === 0`
- 同源 `failedRequests.length === 0`
- 同源 `badResponses.length === 0`
- `console.error` 为空

因此 report-only 不是验收放水；它只是避免 CLI startup 在 browser 诊断前提前死亡。

## 实施步骤

### Step 1：测试先行，覆盖备份 fallback 行为

新增或恢复测试文件：

```text
vitests/suites/runtime-preview/preview-script-recovery.test.ts
```

测试用例：

1. `createCommonJSBareSpecifierFallbackResolution()` 对 CommonJS bare specifier 返回 `data:` module，source 包含 `export const __cjsMetaURL = '<specifier>';`。
2. fallback messages 为 `level: "error"`，包含原始错误。
3. relative specifier、absolute/file URL、`node:`、`q-bundled:`、`cce:/`、ESM、JSON 不 fallback。
4. scoped package subpath，例如 `@scope/pkg/subpath`，按 `isBareSpecifier` 结果 fallback。

先运行该测试，应失败，原因是当前分支没有这些 helper。

新增 Launcher report-only hermetic 回归测试：

- 模拟 runtime preview diagnostics 收到 `asset-db:script-compile:error durationMs=1 count=1 synthetic-error`。
- 断言进程不退出。
- 断言 stdout / log 保留原始 `asset-db:script-compile:error`。
- 断言 stdout / log 包含唯一固定事件：

```text
asset-db:script-compile:report-only source=asset-db:script-compile:error
```

- 断言后续仍输出 `preview:ready`。
- 该测试不依赖 `feature-c`，必须能在小 fixture 上稳定运行。

### Step 2：恢复 packer-driver fallback

修改：

```text
src/core/scripting/packer-driver/index.ts
```

动作：

- 恢复 helper type 和函数：
  - `createCommonJSBareSpecifierFallbackResolution`
  - `installCommonJSBareSpecifierFallback`
  - 必要的 specifier escaping helper
- `isBareSpecifier` 必须从 `@cocos/creator-programming-common/lib/specifier` 导入。
- 在 `QuickPack` 创建后调用 `installCommonJSBareSpecifierFallback(quickPack, logger)`。
- 不引入任何 `@tbmp/mp-cloud-sdk` special-case。
- 不恢复 `PackerDriverBuildOptions.recoverPreviewScriptErrors`、`PackTargetBuildOptions.recoverFailedPrerequisiteScripts` 或 `target.build({ recoverFailedPrerequisiteScripts })`。这些属于 prerequisite script recovery，不属于本计划。

### Step 3：删除 script-stub 代码路径

修改：

```text
src/commands/preview.ts
src/core/launcher.ts
src/core/scripting/index.ts
src/core/scripting/packer-driver/index.ts
src/runtime-preview/context/runtime-preview-context.ts
src/runtime-preview/programming/resolve-programming-request.ts
src/runtime-preview/server/runtime-preview-routes.ts
src/runtime-preview/server/runtime-preview-server.ts
vitests/shared/runtime-preview-cli-process.ts
vitests/scripts/runtime-preview-feature-c-diagnose.ts
```

删除：

```text
src/runtime-preview/script-stubs.ts
```

测试调整：

- 删除 `--script-stub` 参数相关测试。
- 删除 `/runtime-preview-stubs/tbmp-mp-cloud-sdk.js` route 测试。
- 删除 `@tbmp/mp-cloud-sdk` 默认 stub 测试。
- 保留 `/scripting/import-map-global` 基础 import map 测试。

### Step 4：Launcher report-only

修改：

```text
src/core/launcher.ts
```

动作：

- `assetDbScriptCompileErrorLine` 仍记录。
- 删除 fatal throw。
- 增加 report-only event。

唯一事件 contract：

```text
asset-db:script-compile:report-only source=asset-db:script-compile:error
```

测试必须断言该 exact string。

### Step 5：文档同步

修改：

```text
docs/dev/runtime-preview/README.md
docs/dev/runtime-preview/facts/architecture.md
docs/dev/runtime-preview/design/core-flow.md
docs/dev/runtime-preview/plans/core-flow-implementation-20260610.md
docs/dev/runtime-preview/acceptance/feedback-20260609.md
```

删除或更正：

- `@tbmp/mp-cloud-sdk` 是默认 known stub
- exact allow-list
- `--script-stub`
- `/runtime-preview-stubs/*`

新增事实：

- CommonJS bare specifier fallback 是 packer-driver/QuickPack resolver 层恢复机制。
- `resolution-detail-map.json` 是主要诊断输出之一。
- `asset-db:script-compile:error` 在 runtime preview startup 中是 report-only，不是 startup fatal。

## 验证命令

基础验证：

```bat
npm --prefix vitests test -- suites/runtime-preview/preview-script-recovery.test.ts suites/runtime-preview/launcher-runtime-preview.test.ts suites/runtime-preview/script-runtime-map.test.ts suites/runtime-preview/preview-app-route-contract.test.ts suites/runtime-preview/cli-startup.test.ts
npx tsc -p tsconfig.json --noEmit
npm run build
```

feature-c 复测：

```bat
node E:\own_space\engines\cocos-cli\dist\cli.js preview --runtime --project D:\ps_copy\p6\trunk\Project\GameClient\feature-c --host 127.0.0.1 --port 19530
```

预期：

- 命令不需要 `--script-stub`。
- `asset-db:script-compile:error` 不应导致 process exit。
- 如果 CommonJS fallback 生效，`@tbmp/mp-cloud-sdk` 应进入 `resolution-detail-map.json` 而不是导致 compile throw。
- 应继续输出 `preview:ready`，除非后续 settings build 或更基础的 server startup 阶段失败。

browser 诊断，不作为 strict fail gate：

```bat
set COCOS_CLI_LISTEN_PREVIEW_URL=http://127.0.0.1:19530/?scene=4c721bfe-0b6e-46c2-97f0-644adfdcba31
set COCOS_CLI_LISTEN_READY_TIMEOUT_MS=600000
set COCOS_CLI_LISTEN_STABLE_WINDOW_MS=300000
set COCOS_CLI_LISTEN_EVIDENCE=D:\ps_copy\p6\trunk\Project\GameClient\feature-c\temp\runtime-preview-exact-scene-4c721bfe-browser-evidence.json
npm --prefix E:\own_space\engines\cocos-cli\vitests run listen:preview-url
```

strict acceptance fail gate：

```bat
set COCOS_CLI_FEATURE_C_ENGINE_ROOT=D:/workspace/engines/cocos/3.8.6
set COCOS_CLI_FEATURE_C_PROJECT_ROOT=D:/ps_copy/p6/trunk/Project/GameClient/feature-c
set COCOS_CLI_FEATURE_C_SCENE=4c721bfe-0b6e-46c2-97f0-644adfdcba31
set COCOS_CLI_FEATURE_C_STARTUP_TIMEOUT_MS=600000
set COCOS_CLI_FEATURE_C_READY_TIMEOUT_MS=600000
set COCOS_CLI_FEATURE_C_STABLE_WINDOW_MS=300000
set COCOS_CLI_FEATURE_C_EVIDENCE=D:\ps_copy\p6\trunk\Project\GameClient\feature-c\temp\runtime-preview-feature-c-core-flow-evidence.json
npm --prefix E:\own_space\engines\cocos-cli\vitests run diagnose:feature-c
```

执行计划时必须同时删除 `diagnose:feature-c` 中 `COCOS_CLI_FEATURE_C_SCRIPT_STUBS` 的默认值和传参逻辑。strict acceptance 仍按 browser evidence 判定，不因 CLI `preview:ready` 自动通过。

执行结果：

- `--script-stub` 机制已删除。
- `@tbmp/mp-cloud-sdk` 由 packer-driver / QuickPack CommonJS bare specifier fallback 处理，并写入 `resolution-detail-map.json`。
- `asset-db:script-compile:error` 在 runtime preview startup 中为 report-only，不再阻塞 `preview:ready`。
- `feature-c` 首轮 strict gate 在 browser 阶段暴露 `default-physics-material` 缺失；该问题根因是 internal physics default material 只加入 launch bundle，未进入 `settings.engine.builtinAssets`。
- 修复后 `diagnose:feature-c` 通过：`hasDefaultPhysicsMaterial=true`、`readyTimedOut=false`、`pageErrors=0`、`failedRequests=0`、`badResponses=0`、`strictAcceptanceFailures=0`。

## 风险与边界

- `QuickPack._resolve` 是 private API；备份分支已经使用该方式。当前实现必须在 `_resolve` 不存在时记录 warning，不能崩溃。
- fallback 只覆盖 CommonJS bare specifier，不覆盖 ESM missing import。ESM 缺失如果导致 compile error，Launcher 仍 report-only 继续启动，但不会伪造 ESM module。
- prerequisite script recovery 不在本计划内。不要把 `recoverPreviewScriptErrors` 或 `recoverFailedPrerequisiteScripts` 作为本轮实现的一部分。
- 如果 compile error 导致没有可用 preview `import-map.json` 或核心 chunk，browser 阶段会失败；这是正确诊断结果，不应在 CLI startup 阶段提前终止。
- 当前工作区已有较多 runtime preview 修改和文档重组，执行时必须小步改动，避免混入 `.meta` 或生成缓存。

## 待确认问题

1. 是否接受恢复 `QuickPack._resolve` wrapper 这个 private API 方案，作为与备份分支一致的实现。
2. `asset-db:script-compile:error` report-only 后，`preview:ready` 是否允许在存在 compile error 的情况下输出。本文建议允许，但 strict acceptance 必须继续用 browser evidence 判定。
3. 是否确认本轮不恢复 prerequisite script recovery。本文建议不恢复，避免扩大范围；本轮只恢复 CommonJS bare specifier fallback 和 Launcher report-only。
