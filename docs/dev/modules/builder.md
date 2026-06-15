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

## Project Extension Builder Hooks

CLI normal build 支持项目内 Editor-like build extension host：

- 扫描范围：`<projectRoot>/extensions/*/package.json`。
- 支持 schema：`contributions.builder`，值为 builder entry 相对路径或可由 Node resolve 的路径。
- 不支持 schema：`contributes.builder` 不作为 project extension schema 处理；该字段仍属于 CLI platform package 语义。
- builder entry 读取 `configs["*"]` 与 `configs[platform]`，平台配置覆盖通配配置，数组字段按替换处理。
- hook path 相对 builder entry 所在目录解析，支持 `./hooks`、`./hooks.js` 等 Node require 常见形式。
- project extension hook 始终以 public hook 签名执行：`(options, result, ...args)`。
- internal platform hook 仍以 `this/options/result/cache` 形式执行；project extension package name 与既有 builder package 冲突时 hard fail，避免误判为 internal。
- hook 顺序：内置 platform hook 保持在前，project extension hook 使用 package name + extension root 稳定排序。
- option 合并：extension builder option 默认值会补入 `options.packages[extensionName]`，但不覆盖 build config 或项目保存配置中的值。
- 错误策略：public hook 未设置 `throwError` 时，错误记录但不阻塞，也不触发 `onError`；设置 `throwError = true` 或 internal hook 抛错时阻塞构建。
- fatal build error 会触发已注册 hook 的 `onError`；public `onError` 会收到第三个 `error` 参数。

边界：

- CLI 不内置具体项目 extension 的业务发布逻辑，例如 SDK 注入、hotupdate、cfg merge、混淆、字体替换、资源删除或 `.meta` 改写。
- build output 级业务应由项目 extension hook 自己实现，CLI 只提供 host、配置、生命周期、错误传播和输出目录访问能力。
- `assetHandlers`、`Editor.Message`、AssetDB mutation、源资产或 `.meta` 写入不属于当前 MVP；如真实迁移需要，应单独设计 Editor facade / AssetDB API / unsupported 策略。

## Related Evidence

- `../facts/scripting-generated-modules.md`
- `../build/README.md`
- `../build/issues.md`
- `../build/facts/meta-library-editor-parity-20260613.md`
- `../../superpowers/specs/2026-06-13-cocos-config-editor-owned-runtime-merge-design.md`
- `../../superpowers/plans/2026-06-13-meta-library-editor-parity.md`
- `../runtime-preview/archive/old-implementation-review-20260606.md`
