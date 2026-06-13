# Lib Module

## Responsibility

`src/lib/` 维护 shared helpers outside core subsystem folders。

## Non-Goals

Lib 模块不作为业务策略堆放区，也不绕过 core module 边界。

## Main Entry Points

- `src/lib/`

## Inputs

输入来自调用方传入的通用数据结构、路径、字符串或 runtime context。

## Outputs

输出是复用 helper 的计算结果。

## Dependencies

应尽量保持低层依赖，避免反向依赖高层 command/runtime 模块。

## Current Constraints

只有真实复用需求才应进入 `src/lib/`。单个模块私有逻辑应留在模块内。

## Related Evidence

当前没有独立 facts 文档。
