# Display Module

## Responsibility

`src/display/` 维护 terminal output and display helpers。

## Non-Goals

Display 模块不执行业务逻辑，不决定 command lifecycle，也不隐藏下游错误。

## Main Entry Points

- `src/display/`

## Inputs

输入包括 command 状态、日志事件、错误对象和本地化文本 key。

## Outputs

输出是终端可读文本、状态展示和格式化消息。

## Dependencies

依赖 i18n、command/launcher 状态和基础格式化 helper。

## Current Constraints

显示层应保持事实清晰，不把正在准备、已监听、已 ready 等状态混为同一个概念。

## Related Evidence

- `../runtime-preview/facts/logging-and-ready-state-20260612.md`
