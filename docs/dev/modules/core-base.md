# Core Base Module

## Responsibility

`src/core/base/` 维护 core shared base types and services，供 core 子模块复用。

## Non-Goals

Base 模块不承载业务策略，不直接依赖 runtime preview、builder 或 AssetDB 的具体流程。

## Main Entry Points

- `src/core/base/`

## Inputs

输入来自调用方传入的基础类型、上下文和通用服务参数。

## Outputs

输出是 core 层复用的基础能力、类型或 helper。

## Dependencies

应保持对高层业务模块的低耦合。

## Current Constraints

新增 base 能力必须服务多个 core 模块的真实复用需求，不能为了单个专项制造抽象。

## Related Evidence

当前没有独立 facts 文档。
