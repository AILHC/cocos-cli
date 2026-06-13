# Runtime Preview Module

## Responsibility

`src/runtime-preview/` 负责 runtime preview app、settings、scene loading、preview-specific orchestration 和 browser error report。它把 CLI 侧 project/engine/AssetDB/builder/scripting/server 能力组合成可浏览器打开的 runtime preview。

## Non-Goals

Runtime preview 不重新计算 script dependency graph，不直接枚举 import 所有 scope chunks，不把 old preview server 的 resolver 复制成 production 默认实现。

## Main Entry Points

- `src/runtime-preview/`
- `src/runtime-preview/preview-app/src/main.ts`
- `src/runtime-preview/server/runtime-preview-server.ts`

## Inputs

输入包括 project context、preview settings、AssetDB/library facts、scripting programming output、scene selection 和 HTTP request。

## Outputs

输出包括 preview HTML、settings route、scene route、asset/library routes、scripting routes、browser error report 和 runtime preview log。

## Dependencies

依赖 launcher、configuration、engine、AssetDB、builder、scripting、scene、server、display 和 Cocos runtime。

## Current Constraints

`preview-app` 在 `cc.game.init()` 后导入 Cocos packer-driver 生成的 `cce:/internal/x/prerequisite-imports`。这是全局项目脚本注册入口，不是 scene dependency preloading。runtime preview 可以验证 programming route 链路，但不应从 chunk 源码反推业务依赖。

## Related Evidence

- `../runtime-preview/facts/architecture.md`
- `../runtime-preview/facts/browser-loading-and-cache-20260611.md`
- `../runtime-preview/README.md`
