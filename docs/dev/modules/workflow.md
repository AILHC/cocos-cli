# Workflow Module

## Responsibility

`workflow/` 保存 repository workflow scripts。

## Non-Goals

Workflow scripts 不定义 production runtime 语义，也不应绕过正式 CLI command 和 core module 边界。

## Main Entry Points

- `workflow/commands/`
- `workflow/fixtures/`
- `workflow/lib/`
- `workflow/shared/`

## Inputs

输入包括 repository state、fixtures、脚本参数和 CI/local workflow context。

## Outputs

输出包括辅助生成结果、验证结果或 workflow-specific artifacts。

## Dependencies

依赖 Node/TypeScript 工具链、fixtures 和主仓库脚本。

## Current Constraints

Workflow 中的便利行为不能反向改变 production 默认策略。

## Related Evidence

当前没有独立 facts 文档。后续 workflow 专项结束后应补充模块自己的 facts 文档。
