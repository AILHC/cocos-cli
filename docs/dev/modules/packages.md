# Packages Module

## Responsibility

`packages/` 保存 workspace packages，例如 command package、engine package、compiler package 和 CLI types。

## Non-Goals

Packages 模块不替代 `src/` 中的 CLI runtime 入口，也不直接承载 runtime preview 专项事实。

## Main Entry Points

- `packages/cc-module/`
- `packages/cocos-cli-types/`
- `packages/engine/`
- `packages/engine-compiler/`

## Inputs

输入包括 workspace package source、package manifests、build/test configuration 和调用方消费需求。

## Outputs

输出包括 workspace package artifacts、types 和可被主 CLI 或测试消费的包能力。

## Dependencies

依赖 monorepo package manager、TypeScript build 配置和主仓库脚本。

## Current Constraints

Package 行为需要通过 package 自身测试或消费方测试验证，不能只从 runtime-preview 专项推断。

如果用 local package 接管第三方依赖，例如 `@cocos/asset-db`，必须保留原 package name 和现有子路径兼容性，并先用行为测试证明 local mirror 与 registry package 等价，再实施定制修改。

## Related Evidence

当前 package 相关 evidence 主要来自 build/AssetDB 专项。后续 package 专项完成后，应补充模块自己的 facts 文档。

- `../build/plans/asset-db-custom-source-20260613.md`
- `../build/facts/meta-library-editor-parity-20260613.md`
