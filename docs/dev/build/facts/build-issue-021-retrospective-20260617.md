# BUILD-ISSUE-021 复盘摘要 - 2026-06-17

本文是 `BUILD-ISSUE-021` 的短复盘。完整事实见 `auto-atlas-texture-compress-editor-cli-parity-20260617.md`，完整计划见 `plans/build-issue-021-root-cause-plan-20260617.md`。

## 需求

让 CLI 在 Cocos Creator 3.8.6 engine 下执行 normal build 时，自动图集与纹理压缩行为对齐 Editor baseline，重点覆盖 `web-mobile` 与 `wechatgame`。

## 根因

CLI 原本在 dev-cli engine 中以 `NODEJS=true` 运行，但 `preload({ editor: true })` 又把运行态标成 `CC_EDITOR=true`。

这个混合态触发了两个直接问题：

- `EDITOR` 分支假设存在 Creator Editor 全局服务，例如 `Editor.Message.request()`，CLI build 进程没有该全局对象。
- `EDITOR_NOT_IN_PREVIEW=true` 导致 downloader 给本地 library URL 追加 `?_t=`，nodejs adapter 按 Windows 文件路径读取时不会剥离 query，最终出现 `ENOENT`。

本地 cocos4 事实表明正确方向不是给单点错误打补丁，而是让 CLI normal build 使用 `NODEJS + !EDITOR`，并把 3.8.6 engine 中 normal build 必需的 Editor 工具链行为扩展到 `NODEJS`。

## 踩过的坑

- 只补 `editor-path-replace.ts` 能消除 `Editor is not defined`，但无法解决 `?_t=` 本地路径读取错误。
- 简单把 `CC_EDITOR=false` 会先暴露 3.8.6 缺少 `NODEJS adapter` 语义：`internal` bundle 会被当成 remote bundle 读取 `remote/internal/cc.config.json`。
- 3.8.6 当前 dev-cli 不能直接切成 cocos4 的 `mode: BUILD + platform: NODEJS`，因为现有 CLI 仍依赖 editor loader 和 `cc/editor/*` modules。
- `pal/utils.ts` 在 `NODEJS + !EDITOR` 下会走 nodejs adapter 的空 `requestAnimationFrame`，导致 `cc.game.init()` 不 resolve。
- `_RF.reset`、`Details.assignAssetsBy`、texture/image `_serialize()` 这些不是初始栈上的问题，但 build 继续推进后都会成为必要 `NODEJS` 分支。
- `wechatgame` parity 后期缺 3 个压缩产物不是 engine 问题，而是 CLI platform support 漏了 separate-alpha PVRTC 与 ASTC 10x/12x。
- `CocosAPI` / MCP build 不能只修 `Launcher.build()`。`BuilderApi.build()` 原先会绕过 `Launcher.build()`，MCP decorator registry 还会把 prototype 当 tool target，所以必须覆盖实际 MCP tool 调用路径。

## 错误路径

- 不应提供 no-op `Editor.Message` facade 来假装成功。
- 不应在 texture packer 层吞掉 sprite frame load failure。
- 不应把 `fs-utils` query/hash normalization 当成本问题主修复；它只能作为后续 hardening。
- 不应修改 `Engine.initEngine()` 默认值，让 scene/runtime-preview/programming facet 隐式切到 `build-nodejs`。
- 不应把测试缓存、旧 resolver record 或脏 `library` 状态反向写入 production 默认策略。

## 成功路径

1. 保持 dev-cli 编译产物为 `mode: EDITOR + platform: NODEJS`。
2. CLI runtime mode 显式拆分为 `editor-nodejs` 与 `build-nodejs`。
3. `Engine.initEngine()` 默认保持 `editor-nodejs`，只有 normal build 路径显式传入 `build-nodejs`。
4. 3.8.6 engine 按 cocos4 对照小步回迁 normal build 必需 `NODEJS` 分支。
5. `editor-path-replace.ts` 保持 `EDITOR` 优先，`NODEJS` 只在 `!EDITOR` 时用 `AssetDB.queryAsset()` 查询 `.cconb/.bin`。
6. API/MCP build 使用隔离 Node 子进程重新进入 `CocosAPI.buildProject()`，避免复用已启动进程的 `editor-nodejs` runtime。
7. `wechatgame` platform support 补齐 Editor baseline 支持的 ASTC 10x/12x 与 separate-alpha PVRTC。
8. 用真实 build、parity test、错误签名计数和目标压缩产物存在性共同验收。

## 关键验证

- `rtk npm run compiler:engine`：通过。
- `rtk npm run build`：通过。
- `rtk npm test -- src/core/builder/test/builder-api-build.spec.ts src/core/builder/test/wechatgame-platform.spec.ts --runInBand`：通过。
- 真实 `web-mobile` build：退出码 `0`，`Pack Images success`、`Compress image success`、`Build Assets success` 均完成。
- 真实 `wechatgame` build：退出码 `0`，`Pack Images success`、`Compress image success`、`Build Assets success` 均完成。
- `vitests/suites/build/wechatgame-editor-baseline-parity.test.ts`：通过。
- `wechatgame` 目标压缩产物 `.pvr/.astc` 均存在。
- `web-mobile` 构建产物已通过本地浏览器实际打开，scene 渲染成功且 console error 为 `0`。
- `wechatgame` 构建产物已通过微信开发者工具 CLI `open --project` 打开成功。

## 剩余风险

- runtime preview、scene process、programming facet 尚未完整回归。
- MCP/API 已覆盖 unit 路径和 middleware tool 调用路径，但真实 MCP server HTTP 端到端 build 尚未跑。
- `*.jsb.ts` 已同步 `NODEJS` 分支，但本轮没有执行 native build/runtime 验证。
