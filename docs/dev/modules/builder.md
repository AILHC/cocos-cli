# Builder Module

## Responsibility

`src/core/builder/` 负责 builder worker、bundle script、build output 和构建期资源/脚本组织。

## Non-Goals

Builder 模块不直接承担 preview browser loading 策略，也不绕过 scripting module 生成 programming records。

## Main Entry Points

- `src/core/builder/`
- `src/core/builder/worker/builder/asset-handler/script/build-script.ts`

## Inputs

输入包括 project context、AssetDB metadata、engine source、bundle 配置和 build options。

## Outputs

输出包括 bundle 产物、script build result、bundle index、`virtual:///prerequisite-imports/${bundle.id}` 等构建期虚拟模块。

## Dependencies

依赖 AssetDB、scripting、project、engine、filesystem 和 Cocos build 相关 npm packages。

## Current Constraints

Bundle prerequisite module 是 bundle script loading 的一部分，不能和 runtime preview 的 global `cce:/internal/x/prerequisite-imports` 混为同一个入口。

Normal build 相关问题、事实和实施计划统一从 `../build/README.md` 进入。build 专题中的过程记录不能替代本模块的长期结论；专项完成后，应把稳定行为回填到本文件。

## Related Evidence

- `../facts/scripting-generated-modules.md`
- `../build/README.md`
- `../build/issues.md`
- `../build/facts/meta-library-editor-parity-20260613.md`
- `../../superpowers/specs/2026-06-13-cocos-config-editor-owned-runtime-merge-design.md`
- `../../superpowers/plans/2026-06-13-meta-library-editor-parity.md`
- `../runtime-preview/archive/old-implementation-review-20260606.md`
