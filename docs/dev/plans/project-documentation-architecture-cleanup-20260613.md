# Project Documentation Architecture Cleanup Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `docs/dev` 从专项记录集合整理成全项目架构入口、模块正式文档、事实证据和过程记录分层清晰的文档体系。

**Architecture:** 顶层 `docs/dev/README.md` 提供阅读路径；`architecture/` 描述跨模块结构和文档规则；`modules/` 描述当前模块职责、入口、输出、依赖和约束；`facts/` 保存可验证事实；`decisions/` 保存长期设计取舍；`plans`、`acceptance`、`handoff`、`archive` 保留过程记录。本轮先让所有当前 `src` 顶层目录和 `src/core` 子模块都有正式登记，再把 `scripting` 做成完整样板模块，并把 `runtime-preview` 中已确认的跨模块事实链接回正式位置。

**Tech Stack:** Markdown 文档、PowerShell 验证命令、`rg`、现有 `docs/dev` 文档体系。

---

## Scope

本计划覆盖整个 `cocos-cli` 项目的开发文档结构，不只覆盖 `runtime-preview`。当前源码登记范围包括 `src/api`、`src/commands`、`src/core`、`src/display`、`src/i18n`、`src/lib`、`src/mcp`、`src/runtime-preview`、`src/server`、`src/tests`，以及 `src/core/assets`、`src/core/base`、`src/core/builder`、`src/core/configuration`、`src/core/engine`、`src/core/filesystem`、`src/core/project`、`src/core/scene`、`src/core/scripting`、`src/core/test`。本轮只修改文档，不修改 production code，不修改测试。

本计划不大规模搬迁历史文档，不删除 `archive`、`acceptance`、`handoff` 的过程上下文。历史记录保持原貌，只补充指向正式文档的链接。

## Target File Structure

新增：

```text
docs/dev/README.md
docs/dev/architecture/overview.md
docs/dev/architecture/module-map.md
docs/dev/architecture/documentation-policy.md
docs/dev/modules/README.md
docs/dev/modules/api.md
docs/dev/modules/commands.md
docs/dev/modules/core-base.md
docs/dev/modules/configuration.md
docs/dev/modules/display.md
docs/dev/modules/engine.md
docs/dev/modules/filesystem.md
docs/dev/modules/i18n.md
docs/dev/modules/launcher.md
docs/dev/modules/lib.md
docs/dev/modules/mcp.md
docs/dev/modules/project.md
docs/dev/modules/scene.md
docs/dev/modules/scripting.md
docs/dev/modules/runtime-preview.md
docs/dev/modules/server.md
docs/dev/modules/asset-db.md
docs/dev/modules/builder.md
docs/dev/modules/tests.md
docs/dev/facts/scripting-generated-modules.md
docs/dev/decisions/README.md
```

修改：

```text
docs/dev/runtime-preview/README.md
docs/dev/runtime-preview/facts/browser-loading-and-cache-20260611.md
docs/dev/runtime-preview/acceptance/feedback-20260609.md
docs/dev/runtime-preview/handoff/handoff-20260610.md
docs/dev/runtime-preview/issues.md
```

不修改：

```text
src/**
vitests/**
docs/dev/runtime-preview/archive/**
docs/dev/runtime-preview/plans/**
```

## Task 1: 建立 `docs/dev` 总入口

**Files:**

- Create: `docs/dev/README.md`

- [ ] **Step 1: 创建总入口文档**

写入：

```md
# Cocos CLI Development Documentation

本文是 `cocos-cli` 开发文档入口。文档按渐进式披露组织：先读项目架构，再进入模块文档，需要核实时再进入事实记录和过程记录。

## Reading Path

1. 项目整体结构：`architecture/overview.md`
2. 源码模块地图：`architecture/module-map.md`
3. 模块正式文档：`modules/`
4. 可验证事实：`facts/`
5. 设计决策：`decisions/`
6. 专项计划、验收和交接：各主题目录下的 `plans/`、`acceptance/`、`handoff/`

## Document Types

- `architecture/`：跨模块架构、生命周期、数据流和文档维护规则。
- `modules/`：当前模块职责、入口、输出、依赖和边界。
- `facts/`：源码位置、真实产物、命令输出和对比记录。
- `decisions/`：带取舍的长期设计决策。
- `plans/`：某次修改计划。
- `acceptance/`：验收过程和结果。
- `handoff/`：阶段性交接。
- `archive/`：历史记录，不作为当前架构入口。

## Existing Documents

现有顶层主题文档继续保留，并从正式入口登记：

- `design.md`：历史总体设计入口，后续稳定内容逐步回填到 `architecture/` 和 `modules/`。
- `quick-reference.md`：开发速查入口。
- `codegraph-usage.md`：CodeGraph 使用说明。
- `build-extension-hooks-20260612.md`：build extension hooks 专题记录。
- `i18n.md`、`i18n-types-usage.md`：i18n 专题记录，归属 `modules/i18n.md`。
- `build/`、`core/`：已有主题目录，后续按模块归属逐步链接到 `modules/`。
- `runtime-preview/`：runtime preview 专项记录，稳定结论回填到 `modules/runtime-preview.md` 和相关跨模块文档。

## Maintenance Rule

验证和排查时可以先记录在 `facts`、`issues`、`plans` 或 `acceptance`。专项结束后，稳定结论必须回填到 `architecture/` 或 `modules/`，证据链接保留到 `facts/` 或过程文档。
```

- [ ] **Step 2: 验证文件存在**

Run:

```powershell
rtk pwsh -NoProfile -Command "Test-Path '.\docs\dev\README.md'"
```

Expected: `True`

## Task 2: 建立顶层架构文档

**Files:**

- Create: `docs/dev/architecture/overview.md`
- Create: `docs/dev/architecture/module-map.md`
- Create: `docs/dev/architecture/documentation-policy.md`

- [ ] **Step 1: 创建 `architecture/overview.md`**

写入：

```md
# Architecture Overview

`cocos-cli` 负责在 CLI 环境中组织 Cocos project、engine source、AssetDB、builder、HTTP server、runtime preview 等能力。它不直接复制 Editor runtime，而是通过当前 CLI 源码、Cocos engine 源码和相关 npm 包事实建立等价链路。

## Main Subsystems

- API：公开 API export 和外部调用面。
- Commands：CLI command definitions and command handlers。
- Launcher：CLI 命令入口和运行生命周期。
- Configuration：全局配置、项目配置和运行时配置解析。
- Engine：engine root 解析、engine capability 和 engine source 约束。
- Project Config：`projectRoot`、`engineRoot`、resolver records 和环境变量覆盖。
- AssetDB：资源扫描、metadata、library 输出和 query。
- Builder：构建 worker、bundle script、资源和脚本输出。
- Scripting：script compile、packer-driver、records、import-map、chunks。
- Server：HTTP server、middleware、静态/动态响应、cache validators。
- Runtime Preview：browser preview app、settings、scene load、error report。
- Display / i18n / MCP：终端展示、本地化文本和 MCP integration。

## Runtime Boundaries

Production 默认行为必须来自 CLI、Editor、engine 或 Cocos npm 包事实。测试环境可以显式 opt-in，例如 `COCOS_CLI_TEST_ENGINE_ROOT`，但不能反向改变 production 默认策略。
```

- [ ] **Step 2: 创建 `architecture/module-map.md`**

写入：

```md
# Module Map

| Source Path | Module Doc | Responsibility |
| --- | --- | --- |
| `src/api/` | `../modules/api.md` | Public API surface |
| `src/commands/` | `../modules/commands.md` | CLI commands and command handlers |
| `src/display/` | `../modules/display.md` | Terminal output and display helpers |
| `src/i18n/` | `../modules/i18n.md` | Localization and typed i18n resources |
| `src/lib/` | `../modules/lib.md` | Shared library helpers outside core subsystem folders |
| `src/mcp/` | `../modules/mcp.md` | MCP integration |
| `src/runtime-preview/` | `../modules/runtime-preview.md` | Runtime preview app and preview-specific orchestration |
| `src/server/` | `../modules/server.md` | HTTP server and middleware |
| `src/tests/` | `../modules/tests.md` | Source-level test helpers and fixtures |
| `src/core/launcher.ts` | `../modules/launcher.md` | CLI lifecycle and command orchestration |
| `src/core/assets/` | `../modules/asset-db.md` | AssetDB integration and resource metadata |
| `src/core/base/` | `../modules/core-base.md` | Core shared base types and services |
| `src/core/builder/` | `../modules/builder.md` | Builder worker and build output |
| `src/core/configuration/` | `../modules/configuration.md` | CLI and project configuration |
| `src/core/engine/` | `../modules/engine.md` | Engine root and engine capability handling |
| `src/core/filesystem/` | `../modules/filesystem.md` | Filesystem helpers and path utilities |
| `src/core/project/` | `../modules/project.md` | Project model and project-level state |
| `src/core/scene/` | `../modules/scene.md` | Scene query and scene serialization integration |
| `src/core/scripting/` | `../modules/scripting.md` | Script compilation, packer-driver records/import-map/chunks |
| `src/core/test/` | `../modules/tests.md` | Core test utilities |
```

- [ ] **Step 3: 创建 `architecture/documentation-policy.md`**

写入：

```md
# Documentation Policy

## Stable Documents

`architecture/` and `modules/` describe current architecture. They should not read like investigation logs.

## Evidence Documents

`facts/` contains reproducible facts: source references, generated files, command output, and observed behavior.

## Process Documents

`plans/`, `acceptance/`, `handoff`, and `archive/` preserve context for a specific work period. They can be verbose and date-based.

## End-of-Task Rule

When a task finishes, update stable module or architecture docs with the final conclusion. Keep links to evidence and process docs instead of copying all details.
```

## Task 3: 建立模块文档目录和索引

**Files:**

- Create: `docs/dev/modules/README.md`
- Create: `docs/dev/modules/api.md`
- Create: `docs/dev/modules/commands.md`
- Create: `docs/dev/modules/core-base.md`
- Create: `docs/dev/modules/configuration.md`
- Create: `docs/dev/modules/display.md`
- Create: `docs/dev/modules/engine.md`
- Create: `docs/dev/modules/filesystem.md`
- Create: `docs/dev/modules/i18n.md`
- Create: `docs/dev/modules/launcher.md`
- Create: `docs/dev/modules/lib.md`
- Create: `docs/dev/modules/mcp.md`
- Create: `docs/dev/modules/project.md`
- Create: `docs/dev/modules/scene.md`
- Create: `docs/dev/modules/scripting.md`
- Create: `docs/dev/modules/runtime-preview.md`
- Create: `docs/dev/modules/server.md`
- Create: `docs/dev/modules/asset-db.md`
- Create: `docs/dev/modules/builder.md`
- Create: `docs/dev/modules/tests.md`

- [ ] **Step 1: 创建 `modules/README.md`**

写入：

```md
# Module Documentation

本目录保存 `cocos-cli` 当前模块的正式文档。每个模块文档说明职责、非目标、入口、输入、输出、依赖、当前约束和证据链接。

## Modules

- `api.md`：public API surface。
- `commands.md`：CLI commands and command handlers。
- `launcher.md`：CLI lifecycle and command orchestration。
- `configuration.md`：CLI、project 和 runtime configuration。
- `engine.md`：engine root resolution and engine capability handling。
- `project.md`：project model and project-level state。
- `core-base.md`：core shared base types and services。
- `scripting.md`：script compile、packer-driver、records、import-map、chunks、generated modules。
- `runtime-preview.md`：runtime preview app、settings、scene loading、preview-specific orchestration。
- `server.md`：HTTP server、middleware、response handling、cache validators。
- `asset-db.md`：AssetDB integration、resource metadata、library/query。
- `builder.md`：builder worker、bundle script、build output。
- `scene.md`：scene query and scene serialization integration。
- `filesystem.md`：filesystem helpers and path utilities。
- `display.md`：terminal output and display helpers。
- `i18n.md`：localization and typed i18n resources。
- `mcp.md`：MCP integration。
- `lib.md`：shared helpers outside core subsystem folders。
- `tests.md`：source-level test helpers and fixtures。
```

- [ ] **Step 2: 创建全模块最小正式文档**

每个模块文档必须包含 `Responsibility`、`Non-Goals`、`Main Entry Points`、`Inputs`、`Outputs`、`Dependencies`、`Current Constraints`、`Related Evidence` 八个章节。执行者必须根据下面的最小事实清单写入具体内容，不得留下模板句。

| Module Doc | Main Entry Points | Minimum Content Requirement |
| --- | --- | --- |
| `api.md` | `src/api/` | 记录 public API export 角色；说明它不承载 CLI command lifecycle。 |
| `commands.md` | `src/commands/` | 记录 command handler 入口；说明 command 不直接持有 engine/runtime 全局状态。 |
| `launcher.md` | `src/core/launcher.ts` | 记录 Launcher lifecycle、command orchestration、runtime preview startup 关系。 |
| `configuration.md` | `src/core/configuration/` | 记录 project/global configuration 来源和 production/test override 边界。 |
| `engine.md` | `src/core/engine/` | 记录 engine root resolution、engine capability check、engine source 事实边界。 |
| `project.md` | `src/core/project/` | 记录 project model、projectRoot、project-level state。 |
| `core-base.md` | `src/core/base/` | 记录 core shared base services/types；说明它不承载业务策略。 |
| `asset-db.md` | `src/core/assets/` | 记录 AssetDB startup、query、metadata、library 输出；链接 runtime-preview resource facts。 |
| `builder.md` | `src/core/builder/` | 记录 builder worker、bundle output、`build-script.ts`、bundle prerequisite module。 |
| `scripting.md` | `src/core/scripting/` | 记录 script compile、packer-driver、records、import-map、chunks、generated modules。 |
| `scene.md` | `src/core/scene/` | 记录 scene query、scene serialized JSON 和 AssetDB/library 关系。 |
| `filesystem.md` | `src/core/filesystem/` | 记录 path/filesystem helpers；说明 production policy 不应来自测试缓存状态。 |
| `runtime-preview.md` | `src/runtime-preview/` | 记录 preview app、settings、scene load、error report；说明不重新计算 scripting dependency graph。 |
| `server.md` | `src/server/` | 记录 HTTP server、middleware、file/body response、cache validators。 |
| `display.md` | `src/display/` | 记录 terminal display/output utilities。 |
| `i18n.md` | `src/i18n/`、`docs/dev/i18n.md`、`docs/dev/i18n-types-usage.md` | 记录 localization 和 typed i18n 文档归属。 |
| `mcp.md` | `src/mcp/` | 记录 MCP integration scope。 |
| `lib.md` | `src/lib/` | 记录 shared helpers outside core subsystem folders。 |
| `tests.md` | `src/tests/`、`src/core/test/` | 记录 source-level test helpers and fixtures；说明测试 helper 不能改变 production 默认策略。 |

## Task 4: 把 `scripting` 做成完整样板模块

**Files:**

- Modify: `docs/dev/modules/scripting.md`

- [ ] **Step 1: 写入 `scripting` 正式模块文档**

文档必须覆盖：

- `src/core/scripting/packer-driver`
- `cce:/internal/x/prerequisite-imports`
- `main-record.json`
- `assembly-record`
- `import-map.json`
- `chunks/**`
- `preview` target 与 `editor` target policy
- generated module source template 与 packed output 的区别
- 为什么不能只扫 chunk regex 推导业务语义
- 和 `runtime-preview` 的边界：`preview-app` 只导入 generated prerequisite module，不自己枚举 scope chunks

建议结构：

```md
# Scripting Module

## Responsibility

`scripting` 负责把 project scripts 编译为 Cocos runtime 可加载的 programming output，包括 records、import-map 和 chunks。runtime preview 消费这些产物，但不在 preview app 中重新计算脚本依赖图。

## Main Entry Points

- `src/core/scripting/packer-driver/index.ts`
- `src/core/scripting/packer-driver/prerequisite-imports.ts`
- `src/core/scripting/packer-driver/target-policy.ts`

## Generated Outputs

- `targets/<target>/import-map.json`
- `targets/<target>/main-record.json`
- `targets/<target>/chunks/**`
- `cce:/internal/x/prerequisite-imports`

## Prerequisite Imports

`cce:/internal/x/prerequisite-imports` 是全局项目脚本注册入口，不是 scene dependency preloader。

## Target Policy

当前策略：

- `preview` target 使用 tentative prerequisite imports。
- `editor` target 保持 editor policy。
- 历史上 `preview` target 曾出现大量 static dependencies，一次性暴露几千个 unresolved dependencies，导致浏览器资源压力。

## Generated Module Shapes

### Source static import template

来自 `makePrerequisiteImportsMod()`。

### Source tentative dynamic import template

来自 `makeTentativePrerequisiteImports()`。

### Packed `System.register` output

实际 chunk 可能表现为 `System.register([...deps])` 或 `System.register([], execute 内 dynamic import)`。判断时必须区分 source template、packer-driver target policy 和真实生成产物。

## Runtime Preview Relationship

`preview-app` 在 `cc.game.init()` 后导入 `System.import('cce:/internal/x/prerequisite-imports')`。它不直接遍历 `import-map.json#scopes` 导入所有 chunks。

## Constraints

- 不从 chunk regex 反推业务依赖。
- 不在没有等价性验证时把 prerequisite imports 改为全并发。
- 测试可以检查 chunk 形态，但 production 语义必须来自 records/import-map/AssetDB facts。

## Related Evidence

- `../facts/scripting-generated-modules.md`
- `../runtime-preview/acceptance/feedback-20260609.md`
- `../runtime-preview/handoff/handoff-20260610.md`
```

## Task 5: 新增 generated module 事实证据文档

**Files:**

- Create: `docs/dev/facts/scripting-generated-modules.md`

- [ ] **Step 1: 写入事实证据文档**

文档只写事实和解释规则，不写长篇设计。

必须记录：

- 源码 generator 位置：
  - `src/core/scripting/packer-driver/prerequisite-imports.ts`
  - `makePrerequisiteImportsMod()`
  - `makeTentativePrerequisiteImports()`
- packer-driver 写入位置：
  - `src/core/scripting/packer-driver/index.ts`
  - `_tentativePrerequisiteImportsMod`
  - `prerequisiteImportsModURL`
- builder bundle 侧 virtual prerequisite module：
  - `src/core/builder/worker/builder/asset-handler/script/build-script.ts`
  - `virtual:///prerequisite-imports/${bundle.id}`
- 已记录的历史事实：
  - `feedback-20260609.md` 中 preview 旧 static dependency 形态。
  - `feedback-20260609.md` 中 editor target dynamic import 形态。
  - `handoff-20260610.md` 中当前服务已变成 `System.register([], ...)` dynamic import。
- 注意事项：
  - 本地 temp 目录可能是旧产物，不能不经重新生成就代表当前服务。
  - 判断当前 runtime 行为必须以当前服务实际请求到的 chunk 为准。

建议结构：

```md
# Scripting Generated Modules Facts

## Source Generators

## Packer Driver Target Output

## Builder Bundle Prerequisite Modules

## Observed Generated Shapes

### Static dependency array

### Dynamic import in execute

## Evidence Links

## Interpretation Rules

- 区分 source template 和 packed output。
- 区分 historical output 和 current served output。
- 不用 regex 反推业务语义。
```

## Task 6: 新增 decisions 入口

**Files:**

- Create: `docs/dev/decisions/README.md`

- [ ] **Step 1: 创建 decisions 入口**

写入：

```md
# Architecture Decisions

本目录保存长期设计决策。只有存在明确取舍、替代方案和后果的内容才进入 `decisions/`。

普通事实进入 `../facts/`。当前模块行为进入 `../modules/`。某次执行计划进入 `../plans/` 或主题目录下的 `plans/`。
```

## Task 7: 更新 `runtime-preview` 文档，移除跨模块承载压力

**Files:**

- Modify: `docs/dev/runtime-preview/README.md`

- [ ] **Step 1: 增加跨模块引用**

增加：

```md
## Cross-Module References

- 脚本编译、packer-driver、generated prerequisite module：`../modules/scripting.md`
- HTTP server 和 cache validators：`../modules/server.md`
- Runtime preview 当前模块职责：`../modules/runtime-preview.md`
```

- [ ] **Step 2: 修正过期 cache 表述**

如果该文件仍写着 `body response 不新增 Express ETag` 或 `body response 不新增 Express`，改为当前事实：body response 通过 Express `res.send()` 处理后可生成 body `ETag`，满足条件请求时可以返回 `304`；file response 通过 `sendFile()` 处理，带 `Cache-Control`、`ETag`、`Last-Modified`。

## Task 8: 给历史过程文档加正式文档反向链接

**Files:**

- Modify: `docs/dev/runtime-preview/acceptance/feedback-20260609.md`
- Modify: `docs/dev/runtime-preview/handoff/handoff-20260610.md`
- Modify: `docs/dev/runtime-preview/facts/browser-loading-and-cache-20260611.md`

- [ ] **Step 1: 在相关章节添加链接**

使用从文件当前位置出发的正确相对路径，添加类似文本：

```md
> 稳定结论已整理到 `../../modules/scripting.md`，事实索引见 `../../facts/scripting-generated-modules.md`。
```

路径要求：

- 从 `docs/dev/runtime-preview/acceptance/feedback-20260609.md` 出发：`../../modules/scripting.md`、`../../facts/scripting-generated-modules.md`
- 从 `docs/dev/runtime-preview/handoff/handoff-20260610.md` 出发：`../../modules/scripting.md`、`../../facts/scripting-generated-modules.md`
- 从 `docs/dev/runtime-preview/facts/browser-loading-and-cache-20260611.md` 出发：`../../modules/scripting.md`、`../../facts/scripting-generated-modules.md`

不重写历史记录，不删除当时的判断，不把过程文档改成正式架构文档。

## Task 9: 更新 `runtime-preview/issues.md`

**Files:**

- Modify: `docs/dev/runtime-preview/issues.md`

- [ ] **Step 1: 更新 `RP-ISSUE-007` 链接**

给 `RP-ISSUE-007 浏览器脚本加载是否可以并发加速` 增加正式文档和事实文档链接：

```md
../modules/scripting.md
../facts/scripting-generated-modules.md
```

仅更新 `RP-ISSUE-007` 所在行或该 issue 的说明单元，不重写其他 issue，不删除既有状态和链接。Issue 只保留问题状态、结论摘要和链接，不展开长调查。

## Task 10: 验证文档结构和内容

**Files:**

- Verify: `docs/dev/**`

- [ ] **Step 1: 检查新增文件存在**

Run:

```powershell
rtk pwsh -NoProfile -Command "Get-ChildItem -Path '.\docs\dev' -Recurse -File | Select-Object FullName"
```

Expected: 输出中包含 `docs/dev/README.md`、`docs/dev/architecture/*`、`docs/dev/modules/*`、`docs/dev/facts/scripting-generated-modules.md`、`docs/dev/decisions/README.md`。

- [ ] **Step 2: 检查占位文本**

Run:

```powershell
rtk rg -n "TBD|TODO|待补|占位|当前模块负责什么|src/\\.\\.\\.|Module Name" docs/dev/README.md docs/dev/architecture docs/dev/modules docs/dev/facts/scripting-generated-modules.md docs/dev/decisions
```

Expected: no matches。

- [ ] **Step 3: 检查过期 cache 表述**

Run:

```powershell
rtk rg -n "body response 不新增|不新增 Express ETag" docs/dev/runtime-preview --glob '!plans/**' --glob '!archive/**'
```

Expected: no stale matches。

- [ ] **Step 4: 检查 README 正向 cache 结论**

Run:

```powershell
rtk rg -n "res\\.send\\(\\)|body `ETag`|sendFile\\(\\)" docs/dev/runtime-preview/README.md
```

Expected: 至少出现 body response 和 file response 当前结论。

- [ ] **Step 5: 检查正式文档链接**

Run:

```powershell
rtk rg -n "scripting-generated-modules|modules/scripting|Generated Module" docs/dev
```

Expected: 能看到正式文档和历史文档之间的链接。

- [ ] **Step 6: 检查 markdown 链接目标存在**

Run:

```powershell
rtk pwsh -NoProfile -Command '$files = Get-ChildItem -Path ".\docs\dev" -Recurse -Filter "*.md"; $missing = @(); foreach ($file in $files) { $text = Get-Content -Raw -Path $file.FullName; foreach ($m in [regex]::Matches($text, "\]\(([^)#][^)]+\.md)(?:#[^)]+)?\)")) { $target = $m.Groups[1].Value; if ($target -match "^[a-z]+://") { continue }; $resolved = Join-Path $file.DirectoryName $target; if (-not (Test-Path $resolved)) { $missing += "$($file.FullName) -> $target" } } }; $missing'
```

Expected: no output。

## Task 11: Git diff 自检

**Files:**

- Verify: `docs/dev/**`

- [ ] **Step 1: 查看文档 diff**

Run:

```powershell
rtk git diff -- docs/dev
```

Expected:

- 只改文档。
- 不改 `src/`。
- 不改 `vitests/`。
- 不删除历史上下文。
- `runtime-preview` 中跨模块事实链接到 `modules/scripting.md`。

- [ ] **Step 2: 查看工作区状态**

Run:

```powershell
rtk git status --short
```

执行者必须区分本轮变更和已有变更。当前已知工作区可能存在非本计划变更：

```text
M docs/dev/runtime-preview/issues.md
?? docs/dev/runtime-preview/facts/logging-and-ready-state-20260612.md
?? docs/dev/runtime-preview/plans/ready-url-and-logging-contract-20260612.md
```

不得覆盖或整理这些未纳入本计划的内容，除非它们与本计划的链接更新发生同文件冲突。

## Review Notes

本计划在落文档后经过一次只读技术文档 review。review 发现的主要问题已经纳入当前版本：

- 全项目覆盖不足：已把当前 `src` 顶层目录和 `src/core` 子模块全部登记进 scope、target files 和 `module-map`。
- `launcher.md` 断链：已新增 `docs/dev/modules/launcher.md` 到目标文件结构和 Task 3。
- 现有文档未纳入入口：已在 `docs/dev/README.md` 计划内容中增加 `Existing Documents` 索引。
- 非 `scripting` 模块过于空泛：已为每个模块文档增加 `Main Entry Points` 和最小内容要求。
- cache stale phrase 检查不稳：已改为精确匹配 `body response 不新增` / `不新增 Express ETag`，并增加 README 正向结论检查。
- `issues.md` 修改范围风险：已收窄为仅更新 `RP-ISSUE-007` 所在行或该 issue 的说明单元。
- markdown 断链风险：已增加链接目标存在性检查命令。

## Acceptance Criteria

- 从 `docs/dev/README.md` 能找到全项目文档入口。
- 从 `architecture/module-map.md` 能把 `src/core/scripting`、`src/server`、`src/runtime-preview` 等源码目录映射到正式模块文档。
- `scripting` 的 script compile、generated module、prerequisite imports 有正式模块文档，不再只能靠 `runtime-preview/acceptance` 的日期记录理解。
- `runtime-preview` 文档不再承担 `scripting`、`server`、`AssetDB` 的全部说明。
- 历史事实仍保留，且能反向链接到正式文档。
- 不修改 production code。
- 不修改测试。
- 不删除 `archive`、`acceptance`、`handoff` 中的历史上下文。
