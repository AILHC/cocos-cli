# Project Module

## Responsibility

`src/core/project/` 负责 project model、`projectRoot` 和 project-level state。

## Non-Goals

Project 模块不直接解析脚本 chunk 语义，不直接服务 HTTP routes，也不替代 AssetDB query。

## Main Entry Points

- `src/core/project/`

## Inputs

输入包括 project root、project config、assets 目录、settings 和命令参数。

## Outputs

输出包括 project context、project-level paths 和下游模块需要的 project state。

## Dependencies

依赖 configuration、filesystem、engine 和 AssetDB。

## Current Constraints

路径迁移、旧 resolver record 或本地缓存污染只能作为诊断事实，不能成为 production 默认策略。

## Related Evidence

当前没有独立 facts 文档。project 相关事实应从 configuration、AssetDB 或 runtime preview 专项链接回来。
