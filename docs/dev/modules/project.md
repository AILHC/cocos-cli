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

当前 project 相关 evidence 主要来自 configuration、AssetDB、build 或 runtime preview 专项。后续 project 专项完成后，应补充模块自己的 facts 文档。

- `../../superpowers/specs/2026-06-13-cocos-config-editor-owned-runtime-merge-design.md`
