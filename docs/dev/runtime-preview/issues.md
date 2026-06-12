# Runtime Preview 问题台账

本文是 runtime preview 反馈问题和后续事项的唯一索引。详细事实、执行记录和验证证据仍放在对应 `facts/`、`plans/`、`acceptance/` 文档中；本文件只记录当前状态和入口。

## 状态定义

| 状态 | 含义 |
| --- | --- |
| `open` | 当前仍需处理，且属于 runtime preview 当前或后续目标。 |
| `in-progress` | 已有计划或实现正在推进，但未完成验收。 |
| `fixed` | 已有实现和验证证据，当前不再作为待修问题。 |
| `deferred` | 记录为后续项，当前阶段不执行。重新纳入前必须更新计划和验收矩阵。 |
| `fact-gap` | 事实不足，不能用猜测推进；需要先补源码、产物或可重复验证证据。 |
| `archive-only` | 历史问题或旧方案记录，不代表当前裁决。 |

## 当前问题

| ID | 问题 | 状态 | 当前结论 | 事实 / 反馈 | 计划 / 实现 | 验收入口 |
| --- | --- | --- | --- | --- | --- | --- |
| RP-ISSUE-001 | `feature-c` 核心预览流程跑通 | `fixed` | `diagnose:feature-c` strict gate 已通过；source `.meta` parity 不归入该 strict gate。 | [acceptance/feedback-20260609.md](acceptance/feedback-20260609.md) 6.9、6.10 | [plans/core-flow-implementation-20260610.md](plans/core-flow-implementation-20260610.md) | [acceptance/matrix.md](acceptance/matrix.md) |
| RP-ISSUE-002 | `engineRoot` 退化到 CLI 内置路径、启动日志重复 | `fixed` | production `preview --runtime` 通过项目配置 `cocos-cli.enginePath` 解析 engine root；`server:listening` 不重复输出。 | [plans/engine-root-and-startup-log-fix-20260611.md](plans/engine-root-and-startup-log-fix-20260611.md) | `src/core/launcher-engine-root.ts`、`src/core/launcher.ts` | `vitests/suites/runtime-preview/launcher-engine-root.test.ts`、`launcher-runtime-preview.test.ts` |
| RP-ISSUE-003 | 默认启动清理 `programming` cache | `fixed` | 默认遵循 CLI / PackerDriver / QuickPack 原有缓存策略；只有显式 `--clear-programming-cache` 才清理。 | [README.md](README.md) 当前核心规则 | `src/commands/preview.ts`、`src/core/launcher.ts` | `vitests/suites/runtime-preview/launcher-runtime-preview.test.ts` |
| RP-ISSUE-004 | `@tbmp/mp-cloud-sdk` 等 CommonJS bare specifier 缺失导致编译阻塞 | `fixed` | runtime preview 不维护 package allow-list，不保留 `--script-stub`；CommonJS bare specifier resolver 失败由 packer-driver / QuickPack fallback report-only。当前已在主测试项目新增最小 `@tbmp/mp-cloud-sdk` fixture，真实 CLI output 已观察到 `resolution-detail-map.json` fallback 记录。 | [plans/script-compile-report-only-20260611.md](plans/script-compile-report-only-20260611.md)、[plans/integration-fixture-migration-20260612.md](plans/integration-fixture-migration-20260612.md) | packer-driver / QuickPack fallback；Launcher compile error report-only | `vitests/suites/runtime-preview/preview-script-recovery.test.ts`、`vitests/suites/runtime-preview/cli-generated-output-integration.test.ts` |
| RP-ISSUE-005 | `internal` builtin asset 从 engine-level `editor/library` 读取到错误内容 | `fixed` | runtime preview / AssetDB internal library 优先使用项目级 `library`。 | [facts/project-internal-library-20260611.md](facts/project-internal-library-20260611.md) | `src/core/assets/asset-config.ts`、`src/core/launcher.ts` | `vitests/suites/runtime-preview/launcher-runtime-preview.test.ts` |
| RP-ISSUE-006 | Browser file response 没有 HTTP validator，刷新重复下载脚本和资源 | `fixed` | server 已迁移到 Express app；file response 使用 `res.sendFile(..., { dotfiles: "allow" })`，支持 `ETag` / `Last-Modified` / conditional `304`。 | [facts/browser-loading-and-cache-20260611.md](facts/browser-loading-and-cache-20260611.md) | [plans/express-preview-server-migration-20260612.md](plans/express-preview-server-migration-20260612.md) | `vitests/suites/runtime-preview/runtime-preview-express-server.test.ts` |
| RP-ISSUE-007 | 浏览器脚本加载是否可以并发加速 | `deferred` | 当前只记录问题，不执行并发化修改；不能在未确认 Cocos module loading 语义前改加载顺序。 | [facts/browser-loading-and-cache-20260611.md](facts/browser-loading-and-cache-20260611.md) | 无当前计划 | 后续单独计划 |
| RP-ISSUE-008 | source `assets/**/*.meta` 写回需与 Editor 3.8.6 一致 | `open` | CLI / AssetDB importer 可以写回 source `.meta`，但结果必须与 Editor 3.8.6 保持一致；当前只完成 `.anim.meta` 首轮 parity，其他资源类型仍未闭环。 | [facts/source-meta-editor-baseline-20260611.md](facts/source-meta-editor-baseline-20260611.md) | [plans/source-meta-editor-parity-20260611.md](plans/source-meta-editor-parity-20260611.md) | `vitests/suites/runtime-preview/source-meta-editor-parity.test.ts` |
| RP-ISSUE-009 | `.anim` source `.meta` 与 Editor 3.8.6 不一致 | `fixed` | 当前修复范围限制为 `.anim` importer：version 对齐 `2.0.3`，AnimationClip CCON binary 写 `.cconb`。`.cconb` 二进制内容完全一致是独立后续观察。 | [facts/source-meta-editor-baseline-20260611.md](facts/source-meta-editor-baseline-20260611.md) | `src/core/assets/asset-handler/assets/animation-clip.ts` | `vitests/suites/runtime-preview/source-meta-editor-parity.test.ts` |
| RP-ISSUE-010 | `.cconb` 二进制产物未完全对齐 Editor | `deferred` | 目前只记录为独立后续问题，暂不继续追查 Editor 3.8.6 import / serialize 细节。 | [facts/source-meta-editor-baseline-20260611.md](facts/source-meta-editor-baseline-20260611.md) 后续观察 | 无当前计划 | 后续单独验收 |
| RP-ISSUE-011 | 启动早期反馈慢，`Start record log` 之前长时间无输出 | `deferred` | 本地证据指向 `Launcher` 顶层模块加载 / TS 编译成本；当前不处理。 | [acceptance/feedback-20260609.md](acceptance/feedback-20260609.md) 2、6.2 | 无当前计划 | 后续 startup diagnostics |
| RP-ISSUE-012 | 编译慢缺少指标，不能靠清 cache 掩盖 | `open` | 验收矩阵仍标为 missing；需要记录 build iteration、asset changes、script collect / compile 耗时。 | [acceptance/matrix.md](acceptance/matrix.md) | 无当前计划 | 后续 startup diagnostics |
| RP-ISSUE-013 | extension asset-db runtime 触发未完整闭环 | `open` | 历史 `ViewStateGroup` fixture 已抽成主测试项目 `E:\own_space\engines\cocos-test-projects\extensions\ViewStateGroup` 的最小 extension asset-db fixture；CLI output 读取会基于 `library/cli-extensions/view-state-group`。真实 browser/runtime extension trigger 仍未闭环，不能因为 package/input/output 存在就声明 runtime 已触发。 | [acceptance/matrix.md](acceptance/matrix.md)、[plans/integration-fixture-migration-20260612.md](plans/integration-fixture-migration-20260612.md) | [plans/integration-fixture-migration-20260612.md](plans/integration-fixture-migration-20260612.md) | `vitests/suites/runtime-preview/editor-cli-output-consistency.test.ts`、后续 extension integration |
| RP-ISSUE-014 | pack / redirect / remote bundle route 触发未完整闭环 | `open` | 当前没有 fact-backed 触发样本；不能用手写 URL 推进。 | [facts/architecture.md](facts/architecture.md)、[acceptance/matrix.md](acceptance/matrix.md) | 无当前计划 | 后续 engine-source / CLI output capture |
| RP-ISSUE-015 | `design/core-flow.md` 文件内容存在乱码 | `fixed` | 已重写为 UTF-8 中文文档，保留核心流程目标、边界、route 规则、script loading、ready 语义和 strict acceptance。 | [design/core-flow.md](design/core-flow.md) | 文档修复 | [design/core-flow.md](design/core-flow.md) |
| RP-ISSUE-016 | 主测试项目真实 CLI child process 集成验收 | `open` | 主测试项目统一为 `E:\own_space\engines\cocos-test-projects`，用于覆盖核心功能、基础流程、资源类型、AssetDB import、library 产物和 runtime preview 基础能力。`E:\own_space\cocos_work_lab_38x` 只保留为历史 reference / 旧 fixture，不再作为当前主线验收项目。真实 CLI child process 和 CLI generated output 集成测试已切到主测试项目语义；2026-06-12 focused run 可启动真实 CLI，但 browser smoke 仍因 `cc.TiledLayer` / `cc.TiledMap` class missing 与 `console.error(Event)` 失败，`settings.js` 中 `launch.launchScene` 已确认是目标 scene。 | [acceptance/matrix.md](acceptance/matrix.md)、[facts/source-meta-editor-baseline-20260611.md](facts/source-meta-editor-baseline-20260611.md)、[facts/project-internal-library-20260611.md](facts/project-internal-library-20260611.md) | 无当前计划 | `vitests/suites/runtime-preview/main-test-project-cli-integration.test.ts`、`vitests/suites/runtime-preview/cli-generated-output-integration.test.ts` |

## 记录规则

- 新反馈先进入本台账，分配 `RP-ISSUE-xxx`。
- 事实证据写入 `facts/`，不得只写在计划或聊天记录中。
- 执行方案写入 `plans/`，完成后回填本台账状态。
- 验收状态写入 `acceptance/matrix.md`，不要让 matrix 承载问题历史。
- `archive/` 只作为历史参考；除非本台账或 `facts/` 显式引用，否则不代表当前裁决。
