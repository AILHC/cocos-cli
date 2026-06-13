# Filesystem Module

## Responsibility

`src/core/filesystem/` 维护 filesystem helpers and path utilities。

## Non-Goals

Filesystem 模块不决定 engine、project、library 或 programming 的业务解析策略。

## Main Entry Points

- `src/core/filesystem/`

## Inputs

输入包括 absolute paths、project-relative paths、engine paths 和 generated output paths。

## Outputs

输出包括规范化路径、文件读写辅助和路径判断结果。

## Dependencies

依赖 Node filesystem/path 能力和调用方传入的路径语义。

## Current Constraints

文件系统 helper 不能把测试机缓存、迁移残留或本地临时目录变成 production 默认行为。

## Related Evidence

当前没有独立 facts 文档。
