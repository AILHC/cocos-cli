# Scripting Module

## Responsibility

`src/core/scripting/` 负责把 project scripts 编译为 Cocos runtime 可加载的 programming output，包括 records、import-map 和 chunks。runtime preview 消费这些产物，但不在 preview app 中重新计算脚本依赖图。

## Non-Goals

Scripting 模块不负责 HTTP response cache，不负责 scene JSON 查询，也不把 browser Network waterfall 直接解释为 server 处理模型。

## Main Entry Points

- `src/core/scripting/packer-driver/index.ts`
- `src/core/scripting/packer-driver/prerequisite-imports.ts`
- `src/core/scripting/packer-driver/target-policy.ts`

## Inputs

输入包括 project scripts、AssetDB metadata、build target、engine scripting settings、target policy 和 explicit compile options。

## Outputs

- `targets/<target>/import-map.json`
- `targets/<target>/main-record.json`
- `targets/<target>/chunks/**`
- `cce:/internal/x/prerequisite-imports`

## Dependencies

依赖 AssetDB、builder、engine source、project configuration 和 Cocos scripting/QuickPack 相关 npm packages。

## Prerequisite Imports

`cce:/internal/x/prerequisite-imports` 是全局项目脚本注册入口，不是 scene dependency preloader。runtime preview 在 `cc.game.init()` 后通过 `System.import('cce:/internal/x/prerequisite-imports')` 导入它，之后才进入 scene JSON load。

## Target Policy

当前策略由 `shouldUseTentativePrerequisiteImportsMod(targetId, target)` 决定：`target.isEditor === true || targetId === 'preview'` 时使用 tentative prerequisite imports。正式说明需要区分 `preview` target、`editor` target 和历史产物：

- `preview` target 当前使用 tentative prerequisite imports，避免一次性暴露几千个静态依赖造成浏览器资源压力。
- `editor` target 因 `target.isEditor === true` 使用 tentative prerequisite imports。
- 历史上 `preview` target 曾出现大量 static dependencies，一次性暴露几千个 unresolved dependencies，`feature-c` 这类大项目可能触发浏览器资源耗尽。

## Generated Module Shapes

### Source static import template

`makePrerequisiteImportsMod()` 生成 source-level static imports：

```ts
import "...";
import "...";

export { };
```

### Source tentative dynamic import template

`makeTentativePrerequisiteImports()` 生成 source-level dynamic import request list，并按顺序尝试导入每个 project module。

### Packed `System.register` output

实际 chunk 可能表现为 `System.register([...deps])`，也可能表现为 `System.register([], execute 内 dynamic import)`。判断当前行为时必须区分 source template、packer-driver target policy 和真实生成产物。

## Runtime Preview Relationship

`preview-app` 只导入 generated prerequisite module，不直接遍历 `import-map.json#scopes` 导入所有 chunks。runtime preview 可以验证 prerequisite chunk 引用的 unresolved modules 是否能在 import-map scopes 中找到映射，但业务语义仍来自 records、import-map、AssetDB metadata 和 Cocos runtime 行为。

## Current Constraints

- 不从 chunk regex 反推业务依赖。
- 不在没有等价性验证时把 prerequisite imports 改为全并发。
- 测试可以检查 chunk 形态，但 production 语义必须来自 records、import-map、AssetDB facts。
- 本地 `temp/programming` 可能是旧产物，不能未经重新生成就代表当前服务。

## Related Evidence

- `../facts/scripting-generated-modules.md`
- `../runtime-preview/acceptance/feedback-20260609.md`
- `../runtime-preview/handoff/handoff-20260610.md`
