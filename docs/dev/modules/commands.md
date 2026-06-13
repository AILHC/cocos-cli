# Commands Module

## Responsibility

`src/commands/` 维护 CLI command definitions and command handlers。它把用户命令解析后的意图传递给 `launcher`、`core` 和具体子系统。

## Non-Goals

Command handler 不直接持有 engine/runtime 全局状态，不在命令层绕过 `launcher` 或 core module 的生命周期管理。

## Main Entry Points

- `src/commands/`
- `src/cli.ts`

## Inputs

输入来自 CLI arguments、project path、环境变量和 command options。

## Outputs

输出包括命令执行结果、终端输出请求、调用 launcher/core 后产生的构建或预览行为。

## Dependencies

依赖 `launcher`、configuration、display、i18n 和具体业务模块。

## Current Constraints

命令层只表达用户意图和参数，不把测试环境 fallback 写成 production 默认策略。

## Related Evidence

当前没有独立 facts 文档。命令行为的专项记录应链接回本模块文档。
