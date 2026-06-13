# Engine Module

## Responsibility

`src/core/engine/` 负责 engine root resolution、engine capability handling 和 engine source 约束。

## Non-Goals

Engine 模块不复制 engine build 逻辑，也不把旧 reference output 作为 production 默认事实。

## Main Entry Points

- `src/core/engine/`

## Inputs

输入包括 project config 中的 engine path、CLI 初始化结果、环境变量和 Cocos engine source。

## Outputs

输出包括 resolved engine root、capability check result 和供 AssetDB、builder、runtime preview 使用的 engine paths。

## Dependencies

依赖 configuration、filesystem、project，以及当前 Cocos engine source。

## Current Constraints

Production 行为必须以当前 engine source 和 Cocos npm packages 为事实来源。冻结 editor output 只能作为 compatibility baseline 或 fixture。

## Related Evidence

当前 evidence 主要来自 runtime preview / engine root 专项；后续 engine 专项结束后应补充模块自己的 facts 文档。

- `../runtime-preview/facts/source-meta-editor-baseline-20260611.md`
- `../runtime-preview/plans/engine-root-and-startup-log-fix-20260611.md`
