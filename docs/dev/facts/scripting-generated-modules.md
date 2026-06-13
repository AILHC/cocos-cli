# Scripting Generated Modules Facts

本文记录 script compilation、packer-driver 和 generated prerequisite modules 的可验证事实。它不替代 `../modules/scripting.md` 的正式模块说明。

## Source Generators

`src/core/scripting/packer-driver/prerequisite-imports.ts` 定义 `cce:/internal/x/prerequisite-imports` 的 source-level generator：

- `prerequisiteImportsModURL`：模块 URL，值为 `cce:/internal/x/prerequisite-imports`。
- `makePrerequisiteImportsMod()`：生成 static import template。
- `makeTentativePrerequisiteImports()`：生成 dynamic import request list，并按顺序尝试导入。

## Packer Driver Target Output

`src/core/scripting/packer-driver/index.ts` 负责把 generated prerequisite module 写入 packer-driver module loader：

- `_tentativePrerequisiteImportsMod` 控制使用 static import template 还是 tentative dynamic import template。
- `prerequisiteImportsModURL` 是写入和更新 memory module 的稳定 URL。
- `src/core/scripting/packer-driver/target-policy.ts#shouldUseTentativePrerequisiteImportsMod()` 当前条件是 `target.isEditor === true || targetId === 'preview'`。
- 真实 runtime 行为必须以当前 target policy 和重新生成后的 output 为准。

## Builder Bundle Prerequisite Modules

`src/core/builder/worker/builder/asset-handler/script/build-script.ts` 还会生成 bundle 侧 prerequisite module：

- `virtual:///prerequisite-imports/${bundle.id}`
- 该 module 属于 bundle script build output。
- 它不能和 runtime preview 的 global `cce:/internal/x/prerequisite-imports` 混为同一个入口。

## Observed Generated Shapes

### Static dependency array

历史 runtime preview 记录显示，`preview` target 曾生成 `System.register([...大量静态依赖...], ...)`，`execute` 为空。该形态会在 SystemJS 实例化阶段暴露大量 dependencies，可能造成大项目浏览器资源压力。

相关记录：

- `../runtime-preview/acceptance/feedback-20260609.md`

### Dynamic import in execute

历史 runtime preview 记录显示，`targets/editor` 中同名 prerequisite chunk 是 `System.register([], ...)`，在 `execute` 内通过 `_context.import("__unresolved_N")` 顺序 `await`。当前 policy 中，`target.isEditor === true` 和 `targetId === 'preview'` 都会使用 tentative prerequisite imports。

相关记录：

- `../runtime-preview/acceptance/feedback-20260609.md`
- `../runtime-preview/handoff/handoff-20260610.md`

## Evidence Links

- `../modules/scripting.md`
- `../modules/builder.md`
- `../runtime-preview/acceptance/feedback-20260609.md`
- `../runtime-preview/handoff/handoff-20260610.md`
- `../runtime-preview/facts/browser-loading-and-cache-20260611.md`

## Interpretation Rules

- 区分 source template 和 packed output。
- 区分 historical output 和 current served output。
- 本地 `temp/programming` 可能是旧产物，不能不经重新生成就代表当前服务。
- 判断当前 runtime 行为必须以当前服务实际请求到的 chunk 为准。
- 不用 regex 从 chunk 源码反推业务语义；业务语义应来自 records、import-map、AssetDB metadata 和 Cocos runtime 行为。
