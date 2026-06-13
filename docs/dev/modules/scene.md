# Scene Module

## Responsibility

`src/core/scene/` 负责 scene query、scene serialized JSON 和 scene 与 AssetDB/library 的集成。

## Non-Goals

Scene 模块不重新实现 AssetDB dependency graph，不直接枚举所有 script chunks，也不决定 browser cache 策略。

## Main Entry Points

- `src/core/scene/`

## Inputs

输入包括 scene uuid、current scene selection、AssetDB query result、library serialized data 和 project context。

## Outputs

输出包括 scene JSON、scene list 和供 runtime preview scene load 使用的数据。

## Dependencies

依赖 AssetDB、project、filesystem 和 runtime preview route layer。

## Current Constraints

Scene 依赖资源归属必须与 bundle config、AssetDB facts 和 CLI flat library 产物一致，不能通过 preview app 强行改 base URL 来掩盖。

## Related Evidence

当前 evidence 主要来自 runtime preview 专项；后续 scene 专项结束后应补充模块自己的 facts 文档。

- `../runtime-preview/facts/architecture.md`
- `../runtime-preview/acceptance/feedback-20260609.md`
