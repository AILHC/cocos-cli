# BUILD-ISSUE-021 复盘摘要 - 2026-06-17

本文是 `BUILD-ISSUE-021` 的短复盘。本文只做归纳，不引入未记录事实；每条关键结论都标注证据编号。

## 证据索引

- E1：[auto-atlas-texture-compress-editor-cli-parity-20260617.md](auto-atlas-texture-compress-editor-cli-parity-20260617.md) 的 `Clean Rerun` 章节，记录 Editor clean baseline、CLI clean 对照、`Editor is not defined`、`Read json failed`、`?_t=`、`wechatgame` parity 初始失败。
- E2：[auto-atlas-texture-compress-editor-cli-parity-20260617.md](auto-atlas-texture-compress-editor-cli-parity-20260617.md) 的 `Engine NODEJS editor-path-replace patch 验证` 章节，记录只补 `editor-path-replace.ts` 后 `Editor is not defined=0`，但 `ENOENT ... ?_t=` 与自动图集失败仍存在。
- E3：[auto-atlas-texture-compress-editor-cli-parity-20260617.md](auto-atlas-texture-compress-editor-cli-parity-20260617.md) 的 `BUILD-ISSUE-021 根因补充：CC_EDITOR=false 与 cocos4 NODEJS adapter 差异` 章节，记录 `CC_EDITOR=false` smoke、`remote/internal/cc.config.json` 失败链路和 cocos4 对照。
- E4：[auto-atlas-texture-compress-editor-cli-parity-20260617.md](auto-atlas-texture-compress-editor-cli-parity-20260617.md) 的 `BUILD-ISSUE-021 执行验证：build-nodejs-nodejs-adapter-20260617` 章节，记录 engine `NODEJS adapter` 回迁范围、中间失败、`web-mobile` / `wechatgame` 构建结果和 `wechatgame` 3 个压缩产物缺失。
- E5：[auto-atlas-texture-compress-editor-cli-parity-20260617.md](auto-atlas-texture-compress-editor-cli-parity-20260617.md) 的 `Review 后入口修复与最终复验` 章节，记录 `BuilderApi` / MCP 入口问题、`editor-path-replace.ts` 分支顺序问题、after-review-fixes 验证。
- E6：[auto-atlas-texture-compress-editor-cli-parity-20260617.md](auto-atlas-texture-compress-editor-cli-parity-20260617.md) 的 `BUILD-ISSUE-021 产物运行验证补充` 章节，记录 `web-mobile` 浏览器打开和 `wechatgame` 微信开发者工具 CLI 打开验证。
- E7：[build-issue-021-root-cause-plan-20260617.md](../plans/build-issue-021-root-cause-plan-20260617.md) 的 `2026-06-17 执行后修订` 章节，记录执行后事实修订、最终验证和剩余未覆盖范围。
- E8：[issues.md](../issues.md) 中 `BUILD-ISSUE-021` 行，记录 issue 当前状态、修复范围、验证结果和后续风险。

## 需求

让 CLI 在 Cocos Creator 3.8.6 engine 下执行 normal build 时，自动图集与纹理压缩行为对齐 Editor baseline，重点覆盖 `web-mobile` 与 `wechatgame`。[证据: E1, E8]

## 根因

CLI 原本在 dev-cli engine 中以 `NODEJS=true` 运行，但 `preload({ editor: true })` 又把运行态标成 `CC_EDITOR=true`。[证据: E3, E7]

这个混合态触发了两个直接问题：

- `EDITOR` 分支假设存在 Creator Editor 全局服务，例如 `Editor.Message.request()`，CLI build 进程没有该全局对象，表现为 `ReferenceError: Editor is not defined`。[证据: E1, E2, E3]
- `EDITOR_NOT_IN_PREVIEW=true` 导致 downloader 给本地 library URL 追加 `?_t=`，nodejs adapter 按 Windows 文件路径读取时不会剥离 query，最终出现 `ENOENT`。[证据: E1, E2, E3]

本地 cocos4 对照显示，cocos4 不是靠 `fs-utils` 剥离 `?_t=` 解决，而是让 `NODEJS` 继承一组原本只挂在 `EDITOR` 下的工具链能力，同时避免 `EDITOR_NOT_IN_PREVIEW` 的 timestamp 副作用。因此本次修复方向是 CLI normal build 使用 `NODEJS + !EDITOR`，并把 3.8.6 engine 中 normal build 必需的 Editor 工具链行为扩展到 `NODEJS`。[证据: E3, E4, E7]

## 踩过的坑

- 只补 `editor-path-replace.ts` 能消除 `Editor is not defined`，但无法解决 `?_t=` 本地路径读取错误。[证据: E2]
- 简单把 `CC_EDITOR=false` 会先暴露 3.8.6 缺少 `NODEJS adapter` 语义：`internal` bundle 会被当成 remote bundle 读取 `remote/internal/cc.config.json`。[证据: E3]
- 3.8.6 当前 dev-cli 不能直接切成 cocos4 的 `mode: BUILD + platform: NODEJS`，因为现有 CLI 仍依赖 editor loader 和 `cc/editor/*` modules。[证据: E7]
- `pal/utils.ts` 在 `NODEJS + !EDITOR` 下会走 nodejs adapter 的空 `requestAnimationFrame`，导致 `cc.game.init()` 不 resolve。[证据: E4, E7]
- `_RF.reset`、`Details.assignAssetsBy`、texture/image `_serialize()` 这些不是初始栈上的问题，但 build 继续推进后都会成为必要 `NODEJS` 分支。[证据: E4, E7]
- `wechatgame` parity 后期缺 3 个压缩产物不是 engine 问题，而是 CLI platform support 漏了 separate-alpha PVRTC 与 ASTC 10x/12x。[证据: E4, E7]
- `CocosAPI` / MCP build 不能只修 `Launcher.build()`。`BuilderApi.build()` 原先会绕过 `Launcher.build()`，MCP decorator registry 还会把 prototype 当 tool target，所以必须覆盖实际 MCP tool 调用路径。[证据: E5]

## 错误路径

- 不应提供 no-op `Editor.Message` facade 来假装成功；真实根因是 runtime 语义不完整，而不是缺一个空全局对象。[证据: E1, E3, E7]
- 不应在 texture packer 层吞掉 sprite frame load failure；CLI clean 对照显示 sprite frame load failure 与自动图集产物差异直接相关，吞错会掩盖产物不一致。[证据: E1]
- 不应把 `fs-utils` query/hash normalization 当成本问题主修复；cocos4 对照显示其 `downloader.ts` 与 nodejs `fs-utils.js` 不是靠该路径解决 `?_t=`。[证据: E3, E7]
- 不应修改 `Engine.initEngine()` 默认值，让 scene/runtime-preview/programming facet 隐式切到 `build-nodejs`；本轮明确保留默认 `editor-nodejs`，只由 build 路径显式选择。[证据: E4, E5, E7]
- 不应把测试缓存、旧 resolver record 或脏 `library` 状态反向写入 production 默认策略；事实文档记录了测试项目和 engine worktree 的 dirty state，并将其作为诊断背景而非 production 策略来源。[证据: E1, E7]

## 成功路径

1. 保持 dev-cli 编译产物为 `mode: EDITOR + platform: NODEJS`。[证据: E3, E7]
2. CLI runtime mode 显式拆分为 `editor-nodejs` 与 `build-nodejs`。[证据: E4, E5, E7]
3. `Engine.initEngine()` 默认保持 `editor-nodejs`，只有 normal build 路径显式传入 `build-nodejs`。[证据: E4, E5, E7]
4. 3.8.6 engine 按 cocos4 对照小步回迁 normal build 必需 `NODEJS` 分支。[证据: E3, E4, E7]
5. `editor-path-replace.ts` 保持 `EDITOR` 优先，`NODEJS` 只在 `!EDITOR` 时用 `AssetDB.queryAsset()` 查询 `.cconb/.bin`。[证据: E5, E7]
6. API/MCP build 使用隔离 Node 子进程重新进入 `CocosAPI.buildProject()`，避免复用已启动进程的 `editor-nodejs` runtime。[证据: E5]
7. `wechatgame` platform support 补齐 Editor baseline 支持的 ASTC 10x/12x 与 separate-alpha PVRTC。[证据: E4, E7]
8. 用真实 build、parity test、错误签名计数和目标压缩产物存在性共同验收。[证据: E4, E5, E7]

## 关键验证

- `rtk npm run compiler:engine`：通过。[证据: E4, E5, E7]
- `rtk npm run build`：通过。[证据: E4, E5, E7]
- `rtk npm test -- src/core/builder/test/builder-api-build.spec.ts src/core/builder/test/wechatgame-platform.spec.ts --runInBand`：通过，2 suites / 9 tests。[证据: E5]
- 真实 `web-mobile` build：退出码 `0`，`Pack Images success`、`Compress image success`、`Build Assets success` 均完成。[证据: E4, E7]
- 真实 `wechatgame` build：退出码 `0`，`Pack Images success`、`Compress image success`、`Build Assets success` 均完成。[证据: E4, E5, E7]
- `vitests/suites/build/wechatgame-editor-baseline-parity.test.ts`：通过。[证据: E4, E5, E7]
- `wechatgame` 目标压缩产物 `.pvr/.astc` 均存在。[证据: E4]
- `web-mobile` 构建产物已通过本地浏览器实际打开，scene 渲染成功且 console error 为 `0`。[证据: E6]
- `wechatgame` 构建产物已通过微信开发者工具 CLI `open --project` 打开成功。[证据: E6]

## 剩余风险

- runtime preview、scene process、programming facet 尚未完整回归。[证据: E5, E7, E8]
- MCP/API 已覆盖 unit 路径和 middleware tool 调用路径，但真实 MCP server HTTP 端到端 build 尚未跑。[证据: E5, E7]
- `*.jsb.ts` 已同步 `NODEJS` 分支，但本轮没有执行 native build/runtime 验证。[证据: E4, E7]
