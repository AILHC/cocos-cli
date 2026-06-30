# Dev 问题台账

本文记录跨模块、产品化和工程治理类问题。normal build 专项问题仍记录在 `build/issues.md`；runtime preview 专项问题仍记录在 `runtime-preview/issues.md`。本文件只记录当前状态和入口，详细事实、计划和验收结果应继续放到对应 `facts/`、`plans/`、`acceptance/` 或专题目录。

## 状态定义

| 状态 | 含义 |
| --- | --- |
| `open` | 已确认需要处理，但尚未进入计划或实现。 |
| `in-progress` | 已有计划或实现正在推进，但未完成验收。 |
| `fixed` | 已有实现、文档或流程变更，并有验证或评审入口。 |
| `deferred` | 记录为后续项，当前阶段不执行。重新纳入前必须更新事实和计划。 |
| `fact-gap` | 事实不足，不能用猜测推进；需要先补源码、产物、用户场景或可重复验证证据。 |

## 当前问题

| ID | 问题 | 状态 | 当前结论 | 事实入口 | 处理方向 |
| --- | --- | --- | --- | --- | --- |
| DEV-ISSUE-001 | 缺少产品级目标、用户场景和用户旅程文档 | `open` | 当前文档偏实现、事实和专项问题，缺少类似 PRD、user story、user journey 的上层说明，导致很难判断 `cocos-cli` 要服务哪些用户、场景、成功标准和优先级。 | 暂无集中事实入口；相关背景分散在 `architecture/`、`modules/`、`runtime-preview/`、`build/` 和用户反馈记录中。 | 先建立产品化文档骨架：目标用户、核心任务、用户旅程、场景清单、成功指标、非目标范围。不得把现有实现反向包装成需求；需要从真实使用场景和已有反馈整理。 |
| DEV-ISSUE-002 | 缺少跨场景、跨项目的性能基线和瓶颈归因体系 | `fact-gap` | 当前已有 runtime preview 局部性能 facts，但缺少按场景和项目维度整理的统一性能矩阵，也缺少启动、AssetDB、script compile、build、browser load、refresh 等链路的系统归因。 | `runtime-preview/facts/reload-cache-performance-20260626.md`、`runtime-preview/facts/runtime-preview-explicit-refresh-performance-20260627.md`、`runtime-preview/facts/feature-c-explicit-refresh-performance-20260627.md`、`runtime-preview/facts/feature-c-watch-refresh-performance-20260627.md`、`runtime-preview/facts/feature-c-script-load-resource-limit-20260625.md`。 | 先定义性能场景矩阵和采样规范，再补不同项目的数据。至少区分项目规模、命令、是否 browser、是否 warm cache、轮次、指标口径、原始 JSON/log 路径、瓶颈链路和可复现命令。不能把小 fixture 结果外推到真实业务项目。 |
| DEV-ISSUE-003 | 临时文件、日志、缓存和诊断产物目录边界混乱 | `fact-gap` | 当前 `temp/`、`.codex-tmp/`、preview logs、CLI cache、project `library`、`temp/programming` 等产物边界不够清晰，需要梳理 ownership、生命周期、是否可删除、是否进 Git、是否影响 Editor/CLI。 | 相关事实分散在 `runtime-preview/issues.md` 的日志、ready state、shared records、shared programming root 等问题，以及 `build/issues.md` 的 shared asset cache 记录中。 | 先做目录和产物清单，按 owner、生成入口、读写方、生命周期、清理策略、Git 策略和风险分类。整理前不得随意移动或清理生成物，避免破坏 Editor / CLI 共享 cache 或现有诊断证据。 |

## 记录规则

- 新增跨模块问题分配 `DEV-ISSUE-xxx`。
- 若问题已经明确属于 normal build 或 runtime preview，应登记到对应专题台账，不重复登记到本文。
- 事实证据必须写入 `facts/` 或专题事实文档；本台账不承载长篇调查过程。
- 处理方案必须说明影响范围：CLI 命令、Editor parity、真实项目、缓存目录、测试/验收层级。
- 涉及性能结论时，必须记录采样命令、项目、engine root、轮次、指标口径和原始数据路径。
