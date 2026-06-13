# E2E Module

## Responsibility

`e2e/` 保存 end-to-end tests、coverage scripts 和相关说明。

## Non-Goals

E2E 测试不定义 production 默认行为，不替代 unit/integration tests 对具体模块边界的验证。

## Main Entry Points

- `e2e/README.md`
- `e2e/scripts/README.md`
- `e2e/scripts/`

## Inputs

输入包括 built CLI、test workspace、E2E fixtures 和 test runner options。

## Outputs

输出包括 E2E test results、reports 和 coverage reports。

## Dependencies

依赖 package scripts、Node toolchain、测试 workspace 和主 CLI build。

## Current Constraints

`e2e/docs/TYPE-INFERENCE-EXAMPLE.md` 是历史 quick reference 中提到的文件，当前仓库未提供该文件；不能把该文件缺失误判为整个 `e2e/` 目录缺失。

## Related Evidence

- `../../e2e/README.md`
- `../../e2e/scripts/README.md`
