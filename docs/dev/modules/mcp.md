# MCP Module

## Responsibility

`src/mcp/` 维护 MCP integration。

## Non-Goals

MCP 模块不直接替代 CLI command、AssetDB、builder 或 runtime preview 的 production 链路。

## Main Entry Points

- `src/mcp/`

## Inputs

输入包括 MCP request、workspace context 和需要暴露给工具调用的 CLI 能力。

## Outputs

输出是 MCP tool/resource 行为和结构化响应。

## Dependencies

依赖 core modules、configuration 和项目上下文。

## Current Constraints

MCP integration 必须复用 core 能力，避免形成与 CLI command 不一致的第二套业务策略。

## Related Evidence

当前没有独立 facts 文档。
