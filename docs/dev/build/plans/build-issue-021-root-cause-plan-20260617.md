# BUILD-ISSUE-021 根因修复计划 - 2026-06-17

状态：已执行。本文档前半部分保留原计划，本文节记录执行后事实修订。

## 2026-06-17 执行后修订

本计划已按 `NODEJS adapter` 最小回迁方向执行，并在验证过程中发现第一批“必须改”范围仍不完整。新增事实如下：

- `Launcher.build()` 显式传入 `build-nodejs` 后，CLI normal build runtime 达到 `CC_EDITOR=false`、`CC_NODEJS=true`、`CC_BUILD=false`、`appendTimeStamp=false`。
- 第一批 asset-manager 与 `game.ts` 分支修复后，`cc.game.init()` 曾卡在 `builtinResMgr.loadBuiltinAssets()`；根因是 3.8.6 `pal/utils.ts` 的 `setTimeoutRAF()` 在 `NODEJS + !EDITOR` 下走到 nodejs adapter 的空 `requestAnimationFrame`。cocos4 对应逻辑为 `EDITOR || NODEJS || raf === undefined ...`，因此 `pal/utils.ts` 必须纳入修复范围。
- `Query Asset Bundle` 阶段曾失败于 `cc.cclegacy._RF.reset is not a function`；根因是 3.8.6 `cocos/core/data/utils/requiring-frame.ts` 只在 `EDITOR` 下定义 `_RF.reset`，cocos4 为 `EDITOR || NODEJS`。该文件必须纳入修复范围。
- 反序列化依赖收集曾失败于 `details.assignAssetsBy is not a function`；根因是 3.8.6 `cocos/serialization/deserialize.ts` 只在 `EDITOR || TEST` 下定义 `Details.prototype.assignAssetsBy`，cocos4 为 `EDITOR || NODEJS || TEST`。该文件必须纳入修复范围。
- `Build Assets` 阶段曾失败于 `EditorExtends.serializeCompiled.getRootData(...) is null`。最小复现证明：同一 `Texture2D` 在 `editor-nodejs` 下能序列化为 `{ base, mipmaps }`，在 `build-nodejs` 下序列化为 `instances: [null]`。根因是 3.8.6 texture/image 相关 `_serialize()` 只在 `EDITOR || TEST` 下返回构建需要的数据，cocos4 已扩展到 `NODEJS`。
- 因此，`cocos/asset/assets/image-asset.ts`、`texture-base.ts`、`texture-2d.ts`、`texture-cube.ts`、`render-texture.ts` 以及对应 `*.jsb.ts` 同类分支也必须纳入本计划修复范围；`texture-2d` 同时需要按 cocos4 记录 `ctxForExporting.dependsOn('_textureSource', uuid)`。

最终修复后的验证结果：

- `rtk npm run compiler:engine`：通过。
- `rtk npm run build`：通过。
- 最小 `Texture2D` serialize smoke：`build-nodejs` 下 `rootData` 为 `{ base, mipmaps }`，不再是 `null`。
- 真实 `web-mobile` 自动图集 + 纹理压缩 build：退出码 `0`，`Pack Images success`、`Compress image success`、`Build Assets success` 均完成。
- 真实 `wechatgame` 自动图集 + 纹理压缩 build：退出码 `0`，`Pack Images success`、`Compress image success`、`Build Assets success` 均完成。
- `vitests/suites/build/wechatgame-editor-baseline-parity.test.ts`：通过。
- 输出目录未再出现 `remote/internal/cc.config.json` 或本地 library `?_t=` 读取错误；`appendTimeStamp=false`。

额外执行中发现并修复的 CLI 侧 parity 缺口：

- engine `NODEJS adapter` 修复后，`wechatgame` parity 曾只剩 3 个压缩产物缺失：`13fc3621...pvr`、`86111909...astc`、`f8048f67...pvr`。
- 该差异不来自 build config；候选 `buildConfig_wechatgame-autoatlas-compress.json` 的 `scenes`、`packAutoAtlas`、`skipCompressTexture`、`bundleConfigs`、`packages.wechatgame` 一致。
- 根因是 CLI `src/core/builder/platforms/wechatgame/config.ts` 的 `textureCompressConfig.support` 漏掉 Editor baseline 支持的 `pvrtc_2bits_rgb_a`、`pvrtc_4bits_rgb_a`、`astc_10x10` 等格式，导致 `TextureCompress.getCompressOptions()` 过滤后只剩 `png` fallback。
- 已补齐 `wechatgame` 的 ASTC 10x5/10x10/12x12 与 separate-alpha PVRTC support，并新增 `src/core/builder/test/wechatgame-platform.spec.ts` 覆盖真实 platform config。

最终 review 后追加修复：

- `CocosAPI.buildProject()` 和 MCP `BuilderApi.build()` 原先会绕过 `Launcher.build()`，直接调用 `core/builder.build()`；这会导致 API/MCP build 仍停留在已启动进程的 `editor-nodejs` runtime，不能获得 `build-nodejs` 的 `CC_EDITOR=false` 与 `appendTimeStamp=false`。
- 已将 `BuilderApi` 在 `CocosAPI.startup(projectPath)` 后的 build 改为独立 Node 子进程执行 `CocosAPI.buildProject(projectPath, platform, options)`，使 build 入口重新经过 `Launcher.build()` 并获得 build 专用 runtime；未启动 projectPath 的直接调用保留旧 direct fallback。
- MCP decorator registry 注册的是 class prototype，不会自动使用 `CocosAPI._init()` 中创建的 API 实例；因此 `McpMiddleware` 也必须持有 projectPath provider，并在执行 `BuilderApi` tool 时创建带 provider 的真实实例。`start-mcp-server` 与 MCP 测试 helper 已传入当前 projectPath。
- `editor-path-replace.ts` 必须保持 `EDITOR` 分支优先于 `NODEJS` 分支。3.8.6 dev-cli 编译产物同时具备 `NODEJS=true`，但 Editor/preview 场景仍可能通过 `CC_EDITOR=true` 进入 `editor-nodejs`；若先判断 `NODEJS`，会破坏原 Editor `Editor.Message.request('asset-db', 'query-asset-info')` 行为。
- `editor-path-replace.ts` 的异常路径已补齐同 uuid 并发等待队列 drain，避免 `AssetDB.queryAsset()` 异常时 `resolveMap[uuid]` 中的后续 caller 永久等待。
- 已新增 `src/core/builder/test/builder-api-build.spec.ts`，覆盖 `BuilderApi.build()` 在已知 projectPath 时走隔离 build 子进程、临时 options 文件清理，以及经 `McpMiddleware` 的实际 `builder-build` tool 调用也会走隔离子进程。

最终 after-review-fixes 验证：

- `rtk npm test -- src/core/builder/test/builder-api-build.spec.ts src/core/builder/test/wechatgame-platform.spec.ts --runInBand`：通过，2 suites / 9 tests。
- `rtk npm run build`：通过。
- `rtk npm run compiler:engine`：通过。
- 真实 `wechatgame` 自动图集 + 纹理压缩 build：输出 `cli-build-issue-021-current-wechatgame-20260617-after-review-fixes`，退出码 `0`，`Pack Images success`、`Compress image success`、`Build Assets success` 均完成；运行时快照为 `CC_EDITOR=false`、`CC_NODEJS=true`、`appendTimeStamp=false`。
- `vitests/suites/build/wechatgame-editor-baseline-parity.test.ts` 对 after-review-fixes 输出通过。
- after-review-fixes build 日志未命中 `Editor is not defined`、`Read json failed`、`remote/internal/cc.config.json`、`sprite frame can`、`ENOENT.*?_t=`。

仍需后续覆盖：

- runtime preview、scene process、programming facet 尚未完整回归。
- MCP/API startup 已覆盖 build 子进程隔离路径和 MCP middleware tool 调用路径的单元测试，但尚未跑真实 MCP server HTTP 端到端构建。
- 当前 3.8.6 engine worktree 已存在无关 dirty 项：`editor/assets/primitives.fbx.meta`、`.codegraph/`、`editor/library/`，本计划不处理。

## 2026-06-17 修订结论：按 `NODEJS adapter` 最小回迁推进

本节是当前待确认的执行计划；后文保留早期候选方案、验证矩阵和风险记录，作为背景事实。

### 已验证的新事实

- `cc/preload({ editor: false })` 的独立 Node smoke 已验证：`CC_EDITOR=false`、`CC_NODEJS=true`、`CC_BUILD=false`，`AssetDB.queryAsset` 可用，`cc.assetManager.downloader.appendTimeStamp=false`。
- 真实 CLI build 强制 `editor=false` 后没有进入 `Pack Images`，停在 engine 初始化阶段，报 `remote/internal/cc.config.json` 读取失败。
- 该失败链路已闭合：`src/core/engine/index.ts` 初始化时把 `internal` 放入 `remoteBundles`；3.8.6 `builtin-res-mgr.ts` 只在 `EDITOR` 下注册内存版 `internal` bundle；`CC_EDITOR=false` 后缺少该注册，于是 `assetManager.loadBundle('internal')` 走普通 remote bundle 路径。
- 3.8.6 可临时编译 `mode: 'BUILD' + platform: 'NODEJS'`，但产物缺少当前 `cc/preload` 依赖的 `editor/loader` 和 `cc/editor/*` required modules，不适合作为当前最小修复主线。
- 本地 cocos4 不是简单切 `CC_EDITOR=false`，而是把一批原 `EDITOR` 工具链行为扩展到 `NODEJS`，同时避免 `EDITOR_NOT_IN_PREVIEW` 的 timestamp 副作用。

结论：根因是 3.8.6 engine 缺少 cocos4 风格的 `NODEJS adapter` 语义；CLI 当前 `editor:true` 只是绕过部分缺口，但引入 `EDITOR_NOT_IN_PREVIEW`。修复应回迁最小必要 `NODEJS` 分支，并让 CLI normal build 显式使用 `NODEJS + !EDITOR` 运行态。

### 修改目标

- CLI normal build 的 engine runtime：`NODEJS=true`、`EDITOR=false`、`EDITOR_NOT_IN_PREVIEW=false`。
- 保留当前 dev-cli `mode: 'EDITOR' + platform: 'NODEJS'` 编译产物，不切 `mode: 'BUILD'`。
- 在 3.8.6 engine source 中补齐 normal build 所需的 `NODEJS` adapter 行为，避免 `CC_EDITOR=false` 后落入普通 runtime 分支。
- 不引入 no-op `Editor.Message`，不在 texture packer 层吞错，不把 `fs-utils` query/hash normalization 当作主修复。

### 计划改动范围

#### CLI 侧

1. `packages/cc-module/src/preload.ts`
   - 将当前 `editor?: boolean` 语义扩展为显式 runtime mode，至少区分 `editor-nodejs` 与 `build-nodejs`。
   - `build-nodejs` 设置 `globalThis.CC_EDITOR=false`，仍保留 `nodeEnv`、nodejs adapter、`AssetDB`、`sharp`、filesystem 等 Node 能力。
   - 保持 `hasPreload` 单例约束；多 mode 验证必须用独立 Node process。

2. `src/core/engine/index.ts`
   - normal build 初始化使用 `build-nodejs`。
   - scene/runtime-preview/programming facet 相关入口暂不默认切换；如果共用 `initEngine()`，需要通过参数显式选择 runtime mode，默认保持现状或由调用方明确传入。
   - `Engine.initEngine()` 默认必须保持 `editor-nodejs`，只能由 `Launcher.build()` 或 builder 专用入口显式传入 `build-nodejs`；禁止通过修改默认值让所有共享入口隐式切换。
   - 为 build runtime 增加常量断言日志或 smoke helper，便于验收 `CC_EDITOR`、`CC_NODEJS`、`EDITOR_NOT_IN_PREVIEW`。

3. 测试与诊断
   - 增加或复用独立 Node process smoke，覆盖 `editor-nodejs` 与 `build-nodejs` 两种初始化。
   - 不提交一次性 `.codex-tmp` 验证脚本，除非需要沉淀为正式测试。

#### 3.8.6 engine source 侧

目标是按 cocos4 事实回迁最小必要集合，不批量照搬。

必须改：

- `cocos/asset/asset-manager/builtin-res-mgr.ts`
  - `if (EDITOR)` 调整为 `if (EDITOR || NODEJS)`，保证 `NODEJS + !EDITOR` 下注册内存版 `BuiltinBundleName.INTERNAL` bundle。

- `cocos/asset/asset-manager/factory.ts`
  - `if (!EDITOR)` 调整为 `if (!EDITOR && !NODEJS)`，避免 Node build 加载 bundle 时误走 `virtual:///prerequisite-imports/<bundle>`。

- `cocos/asset/asset-manager/shared.ts`
  - `references` 调整为 `(EDITOR || NODEJS) ? new Cache<any[]>() : null`，配合依赖引用记录。
  - `assets` 是否从 `EDITOR ? WeakCache : Cache` 扩展到 `NODEJS` 暂不改，除非验证显示与 build 资源生命周期直接相关；cocos4 也只改了 `references`。

- `cocos/asset/asset-manager/utilities.ts`
  - missing asset reporter、reference tracking 的 `EDITOR` 判断扩展为 `(EDITOR || NODEJS)`。

- `cocos/asset/asset-manager/deserialize.ts`
  - `MissingReporter`、missing class/object reporter 分支扩展为 `(EDITOR || NODEJS)`。

- `cocos/asset/asset-manager/url-transformer.ts`
  - override asset 的 editor/preview 直接 uuid 替换逻辑扩展到 `NODEJS`。

- `cocos/asset/asset-manager/editor-path-replace.ts`
  - 保留并整理 `NODEJS` 分支，避免依赖 `Editor.Message`。
  - 以 3.8.6 实测 meta 为准，支持 `files: ['.bin']` 与 `files: ['.cconb']` 两种单文件 CCONB 记录。
  - 若 `importBase` 是 HTTP(S)，可参考 cocos4 的 `/query-extname/<uuid>` 路径；但当前 normal build 本地 library 优先通过 `AssetDB.queryAsset`，网络查询只作为 runtime-preview/scene 兼容路径。

- `cocos/game/game.ts`
  - `_loadCCEScripts()` 中的 browser preview import 条件需要排除 `NODEJS`，避免 `NODEJS + !EDITOR` 误走 `cce:/internal/x/prerequisite-imports`。
  - `globalThis.cce.Script.init()` 分支需要从 `EDITOR` 扩展到 `(EDITOR || NODEJS)`，保持 cocos4 的 Node 工具链脚本初始化语义。

可能需要改，先不纳入第一批：

- `cocos/asset/assets/asset.ts`
- `cocos/asset/assets/image-asset.ts`
- `cocos/asset/assets/texture-base.ts`
- `cocos/asset/assets/texture-2d.ts`
- `cocos/asset/assets/texture-cube.ts`
- `cocos/2d/assets/sprite-frame.ts`
- `cocos/2d/assets/sprite-atlas.ts`
- `cocos/serialization/*`
- `cocos/core/data/*`
- `cocos/scene-graph/*`

处理策略：第一批改动后若 build 或 parity 仍暴露序列化、uuid 压缩、默认资源标记、scene/prefab 反序列化问题，再按具体栈和 cocos4 对照小步回迁。不能一次性无差别照搬 cocos4，因为 3.8.6 与 cocos4 的 API 和序列化细节可能不同。

暂不改：

- `cocos/video/*`：当前 BUILD-ISSUE-021 的 web-mobile/wechatgame 自动图集链路无直接证据。
- `*.jsb.ts`：首轮目标是 CLI normal build 的 Node/web 构建链路；native/jsb 分支另行验证。
- nodejs `fs-utils.js` query/hash normalization：只有在 `EDITOR_NOT_IN_PREVIEW=false` 后仍出现合法本地 URL query/hash 时，才作为 adapter hardening 单独评估。

### 执行顺序

1. 记录 before 状态
   - CLI `git status --short`。
   - 3.8.6 engine `git status --short`。
   - 记录已有诊断 patch，避免误判为本轮新增。

2. 实现 engine 第一批 `NODEJS` adapter 回迁
   - 只改上面“必须改”的 8 个文件。
   - 每个文件以 cocos4 对照和 3.8.6 当前源码为依据，不做无关格式化。

3. 实现 CLI runtime mode 分离
   - `preload()` 增加显式 mode。
   - normal build 入口传入 `build-nodejs`。
   - 保持其他入口不被隐式切换。

4. 构建验证
   - `rtk npm run compiler:engine`
   - `rtk npm run build`
   - 独立 Node process smoke：`editor-nodejs`
   - 独立 Node process smoke：`build-nodejs`

5. 真实构建验证
   - `web-mobile` 自动图集构建。
   - `wechatgame` 自动图集构建。
   - 统计 `Editor is not defined`、`remote/internal/cc.config.json`、`?_t=`、`Read json failed`、`sprite frame can't be load`、`Pack Images success`。

6. parity 验证
   - 跑 `vitests/suites/build/wechatgame-editor-baseline-parity.test.ts` 或当前项目已有等价 parity 入口。
   - 若仍失败，先按分区和资源列表定位新差异，不继续扩大 `NODEJS` 回迁范围。

7. 关键节点 review
   - engine 第一批回迁后 review 一次。
   - CLI runtime mode 分离后 review 一次。
   - 真实构建和 parity 结果出来后 review 一次。

### 验收条件

- `build-nodejs` smoke：`CC_EDITOR=false`、`CC_NODEJS=true`、`EDITOR_NOT_IN_PREVIEW=false`、`appendTimeStamp=false`。
- 不再出现 `ReferenceError: Editor is not defined`。
- 不再出现 `remote/internal/cc.config.json`。
- 不再出现本地 library 资源路径携带 `?_t=` 导致的 `ENOENT`。
- 自动图集进入并完成 `Pack Images`，`Pack Images success` 与 Editor baseline 对齐。
- `wechatgame` parity 不再因 `assets` 分区计数差异失败；若有新差异，必须登记为新的具体问题。
- scene/runtime-preview/programming facet 没有因 runtime mode 分离发生可复现回归；若尚未完整覆盖，必须在结果中明确 residual risk。

### 停止条件

- `build-nodejs` 下 `requiredModules` 或 `cc/editor/*` 必需模块无法加载，且缺失不是第一批 `NODEJS` adapter 回迁能解释。
- 第一批 engine 回迁后仍在 `internal` bundle 初始化前失败，且失败链路不是已知 `factory/shared/utilities/deserialize/url-transformer/editor-path-replace` 范围。
- CLI 入口无法区分 normal build 与 scene/runtime-preview/programming facet，存在误伤共享初始化的风险。
- 真实构建出现新栈指向 serialization/scene-graph/core-data 大范围 `EDITOR` 依赖，此时停止扩大改动，先补事实与计划。

## 目标

让 CLI normal build 在 Cocos Creator 3.8.6 engine 下的自动图集行为对齐 Editor baseline，至少覆盖 `web-mobile` 与 `wechatgame`：

- 不再出现 `ReferenceError: Editor is not defined`。
- 不再出现本地 `library/*.json?_t=...` 被当作文件路径读取导致的 `ENOENT`。
- 自动图集阶段达到 Editor baseline 的 `Pack Images success`，`wechatgame` parity 不再因 `assets` 分区计数不一致失败。
- 修复应解释并收敛 CLI build runtime 的真实语义，而不是继续在单个失败点追加补丁。

## 当前事实

### 3.8.6 CLI runtime 事实

- 当前 CLI 通过 `src/core/engine/index.ts` 调用 `preload({ editor: true })`。
- `packages/cc-module/src/preload.ts` 根据 `editor` 参数设置 `globalThis.CC_EDITOR = true`。
- `packages/engine-compiler/src/core/compiler.ts` 当前用 `platform: 'NODEJS'`、`mode: 'EDITOR'` 编译 dev-cli engine。
- 3.8.6 dev-cli bundle 中 `NODEJS=true`，但 `EDITOR` 运行时会优先读取 `globalThis.CC_EDITOR`。
- `EDITOR_NOT_IN_PREVIEW = EDITOR && !isPreviewProcess`，因此当前 CLI build runtime 实际是 `NODEJS=true`、`EDITOR=true`、`EDITOR_NOT_IN_PREVIEW=true`。
- `updateAdapter()` 已把 `bin/adapter/nodejs/web-adapter.js` 和 `bin/adapter/nodejs/engine-adapter.js` 复制到 `bin/.editor`，所以当前不是“没有用 nodejs adapter”，而是 nodejs adapter 运行在 `EDITOR_NOT_IN_PREVIEW=true` 的混合态下。

### 3.8.6 engine 行为事实

- `D:\workspace\engines\cocos\3.8.6\cocos\asset\asset-manager\editor-path-replace.ts` 原始入口只覆盖 `EDITOR || PREVIEW`，没有 `NODEJS` fallback。
- 原始代码在 `EDITOR` 分支调用全局 `Editor.Message.request('asset-db', 'query-asset-info', uuid)`。
- CLI build 作用域没有满足该调用的全局 `Editor`，所以自动图集加载 sprite frame 时出现 `ReferenceError: Editor is not defined`。
- 诊断性 engine patch 增加 `NODEJS` 分支后，`Editor is not defined` 消失，但自动图集仍失败。
- 剩余失败是 engine downloader 因 `EDITOR_NOT_IN_PREVIEW=true` 追加 `?_t=`，nodejs adapter 的 `fsUtils.fullPathForFilename()` 没有剥离 query/hash，最终 `fs.readJson()` 读取 `*.json?_t=...` 这个不存在的 Windows 文件路径。

### 本地 cocos4 参考事实

- 本地参考仓库：`E:\own_space\engines\cocos4`，当前 `describe` 为 `4.0.0-alpha.20`。
- `E:\own_space\engines\cocos4\cocos\asset\asset-manager\editor-path-replace.ts` 已导入 `NODEJS`，入口为 `(EDITOR || PREVIEW || NODEJS) && !TEST`。
- cocos4 的 `NODEJS` 分支优先使用 `globalThis.AssetDB.queryAsset(uuid)?.meta`，必要时支持通过 `importBase/query-extname/<uuid>` 查询。
- cocos4 的 `downloader.ts` 仍然是 `appendTimeStamp = !!EDITOR_NOT_IN_PREVIEW`，没有靠 downloader 本身特殊识别 `NODEJS`。
- cocos4 的 `platforms/nodejs/engine/fs-utils.js` 也没有剥离 `?_t=`。
- cocos4 的 `scripts/build-cli-minified.js` 使用 `mode: 'BUILD'`、`platform: 'NODEJS'`。
- 因此 cocos4 不是靠 fs-utils 修正 query，而是把 CLI 运行语义定义为 `NODEJS` build/runtime，避免进入 `EDITOR_NOT_IN_PREVIEW=true` 的 Editor browser cache-busting 路径。

## 根因判断

根因不是单个文件缺分支，而是当前 3.8.6 CLI 对 engine runtime 的语义定义不完整：

- CLI 想使用 nodejs adapter 和 Node filesystem 能力，所以编译平台是 `NODEJS`。
- CLI 又通过 `CC_EDITOR=true` 把运行态标记成 Editor not in preview。
- 3.8.6 engine 的 Editor 分支假设存在 Creator Editor 全局服务，例如 `Editor.Message`。
- 同时 Editor-not-preview 模式会启用浏览器 cache-busting timestamp，但 nodejs adapter 按本地文件系统读取，不能把 URL query 当路径组成部分。

这导致两个症状：

- `Editor.Message.request` 缺失：表现为 `ReferenceError: Editor is not defined`。
- `?_t=` 本地路径读取失败：表现为 `Read json failed ... ENOENT` 和 `sprite frame can't be load`。

因此继续只补 `editor-path-replace.ts` 或只在 texture packer 中过滤错误，都不是根治。

## 修复原则

- 先定义 CLI build runtime 的正确语义，再决定代码改动。
- 不在 texture packer 中对 `?_t=`、`Editor.Message` 做特判。
- 不通过 no-op `Editor.Message`、空对象、`true` 返回值伪造成功。
- 不把测试环境缓存、旧 engineRoot、resolver record 残留反向写入 production 默认策略。
- `BUILD-ISSUE-022` 的 `PVRTexTool` 版本不一致单独处理，不混入本计划。
- 当前 3.8.6 `editor-path-replace.ts` 的 `NODEJS` 分支 patch 只作为诊断性验证；最终是否保留，取决于 runtime 策略验证结果。

## 推荐方案

候选主线：把 CLI normal build 的 engine runtime 明确定义为 `NODEJS build runtime`，而不是 `NODEJS + EDITOR` 混合态。

该主线不能简化成“只把 `CC_EDITOR` 设为 `false`”。需要分清两层问题：

- 编译期：当前 3.8.6 dev-cli engine 仍由 `packages/engine-compiler/src/core/compiler.ts` 以 `mode: 'EDITOR'`、`platform: 'NODEJS'` 生成。
- 运行期：当前 `packages/cc-module/src/preload.ts` 又把 `globalThis.CC_EDITOR` 设为 `true`。

因此验证必须拆成两步：先验证现有 `EDITOR` 编译产物下 `CC_EDITOR=false` 是否足以消除混合态副作用；再验证真正 `mode: 'BUILD' + platform: 'NODEJS'` 的 3.8.6 可行性。只有两者的边界清楚后，才能决定最终实现是调整 runtime flag、拆 runtime mode，还是改 engine compiler mode。

核心调整预期如下：

- CLI build 初始化不再无条件设置 `CC_EDITOR=true`，但这只是候选，不是默认结论。
- `preload()` 需要区分调用场景：普通 CLI build 使用 `CC_EDITOR=false`；确实需要 Editor 语义的 scene/editing 流程必须显式 opt-in。
- 保持 `NODEJS=true` 和 nodejs adapter，继续使用 `AssetDB`、`nodeEnv`、filesystem、`sharp` 等 CLI 需要的 Node 能力。
- 对 3.8.6 engine source 参考 cocos4 的 `NODEJS` asset-manager 结构，但以 3.8.6 meta/library 事实为准；`editor-path-replace.ts` 的 `NODEJS` 查询必须同时支持 `files: ['.bin']` 和已确认存在的 `files: ['.cconb']`。
- 不把修改 `fsUtils.fullPathForFilename()` 作为替代根因分析的手段；但如果最终 runtime 仍允许本地 fs URL 携带 query/hash，则 nodejs adapter 做 URL normalization 可以作为合理 hardening，而不应归类为 texture packer 层补丁。

这个方向与本地 cocos4 的设计一致：`NODEJS` 是独立运行环境，不应依赖 `EDITOR_NOT_IN_PREVIEW=true`。但 3.8.6 是否能直接使用 cocos4 的 `mode: 'BUILD' + platform: 'NODEJS'` 还没有证据，必须单独验证。

## 备选方案

### 方案 A：先验证 runtime flag 分离

在当前 `mode: 'EDITOR'`、`platform: 'NODEJS'` 编译产物不变的前提下，调整 `preload()` 和调用点，使 normal build 设置 `CC_EDITOR=false`，同时保留 `NODEJS=true`。

需要验证：

- `requiredModules` 中的 `cc/editor/*` 是否能在 `CC_EDITOR=false` 下正常加载。
- builder serialization、offline mappings、custom-pipeline、material、embedded-player 等 editor extension 模块是否依赖 `EDITOR=true`。
- 自动图集和资源加载链路是否自然消除 `?_t=`。
- `AssetDB.queryAsset` 是否在 `CC_EDITOR=false` 下仍由 CLI 注入并可用。

如果验证通过，只能证明运行期 `CC_EDITOR=true` 是直接触发源；还不能证明已经完全对齐 cocos4，因为编译期仍是 `mode: 'EDITOR'`。

### 方案 B：验证真正 `BUILD + NODEJS` 编译产物

参考本地 cocos4 的 `scripts/build-cli-minified.js`，验证 3.8.6 是否能用 `mode: 'BUILD'`、`platform: 'NODEJS'` 生成 CLI build 所需产物。

需要验证：

- `cc/editor/serialization`、`cc/editor/offline-mappings`、`cc/editor/custom-pipeline`、`cc/editor/material` 等当前 `requiredModules` 是否仍能导出或有等价替代。
- builder serialization、project extension hook、asset query、custom pipeline、material effect 相关流程是否不依赖 `EDITOR` 编译常量。
- `BUILD=true` 对 asset-manager、deserialize、settings、feature filtering 的影响是否符合 normal build。

如果该方案可行，它比单纯调整 `CC_EDITOR` 更接近 cocos4 的根治方向；如果不可行，需要记录具体阻塞模块，而不是模糊回退。

### 方案 C：拆分 preload 场景

如果 scene/editing 或其他 CLI 子系统确实必须 `CC_EDITOR=true`，则把 `preload()` 从单一 `editor?: boolean` 改成明确的 runtime mode，例如：

- `build-nodejs`
- `editor-nodejs`
- `webview-preview`

normal build 使用 `build-nodejs`，scene/editing、MCP 或 programming 相关流程才使用 `editor-nodejs`。

该方案比简单删除 `editor: true` 更稳，但改动面更大，需要逐个入口确认。

### 方案 D：显式 `editor-nodejs-build` 兼容层

如果 normal build 确实必须保留部分 Editor 编译/运行语义，则定义一个受限 `editor-nodejs-build` runtime，而不是继续依赖隐式混合态。

该 runtime 至少需要显式提供：

- 受限 `Editor.Message.request('asset-db', 'query-asset-info')` facade，委托现有 CLI asset query 能力，不允许 no-op 或伪造空成功。
- nodejs adapter 本地 fs URL normalization，剥离 query/hash 后再读文件。
- 明确关闭或覆盖 `downloader.appendTimeStamp` 的规则，避免 Editor browser cache-busting 泄漏到 Node fs。

该方案不是首选，但比“单点补 adapter”更完整，适合 A/B/C 不能成立时作为低风险兼容路径。

## 执行计划

### 阶段 1：事实补全

1. 在 `docs/dev/build/facts/auto-atlas-texture-compress-editor-cli-parity-20260617.md` 补充本地 cocos4 对照事实，明确使用 `E:\own_space\engines\cocos4@4.0.0-alpha.20`，不再只引用 GitHub 远端。
2. 记录当前 3.8.6 engine patch 状态，标明它是诊断性 patch，不是最终策略确认。
3. 记录当前 CLI 初始化常量快照：`NODEJS`、`EDITOR`、`EDITOR_NOT_IN_PREVIEW`、`PREVIEW`、`BUILD`。

### 阶段 2：无侵入验证 runtime 假设

目标是在改源码前先验证 `CC_EDITOR=false` 是否可行。

1. 新增临时验证入口或用现有测试 harness 启动 engine，但不提交临时代码。
2. 每个 mode 必须使用独立 Node process 执行。不能在同一进程内连续切换，因为 `preload.ts` 有 `hasPreload` 单例保护，且 `CC_EDITOR`、`window`、`cc`、SystemJS module cache 都会污染后续结果。
3. 在同一 3.8.6 engine、同一测试项目下分别运行：
   - current mode：`CC_EDITOR=true`
   - candidate mode：`CC_EDITOR=false`
4. candidate mode 必须检查：
   - `require('cc')` 成功。
   - `requiredModules` 中现有 `cc/editor/*` 模块加载成功，或明确列出失败模块。
   - `globalThis.AssetDB.queryAsset` 可用。
   - `cc.assetManager.downloader.appendTimeStamp === false`。
   - 自动图集 sprite frame 加载不产生 `?_t=` ENOENT。

如果 candidate mode 在模块加载阶段失败，不能继续改默认策略，必须先定位具体 `cc/editor/*` 依赖 `EDITOR=true` 的原因。

### 阶段 2.5：验证 compiler mode 假设

目标是确认 3.8.6 能否真正采用 cocos4 风格的 `mode: 'BUILD' + platform: 'NODEJS'`。

1. 在临时输出目录生成 `BUILD + NODEJS` engine 产物，不覆盖现有 `bin/.cache/dev-cli/editor`。
2. 使用独立 Node process preload 该产物。
3. 检查当前 normal build 所需 `requiredModules` 是否可加载。
4. 若不能加载，记录缺失模块、缺失 export、触发栈和是否存在 3.8.6 可接受替代路径。

### 阶段 3：实现最小根治改动

若阶段 2 和阶段 2.5 结论支持 runtime flag 分离或 compiler mode 切换，再实现：

1. 调整 `packages/cc-module/src/preload.ts` 的参数语义，避免普通 build 隐式进入 Editor runtime。
2. 调整 `src/core/engine/index.ts` 的 `initEngine()` 调用，normal build 使用 `build-nodejs` 或等价显式模式。
3. 必要时调整 `packages/engine-compiler/src/core/compiler.ts`，但只能在 `BUILD + NODEJS` 验证通过后进行。
4. 保留或整理 3.8.6 engine `editor-path-replace.ts` 的 `NODEJS` 分支，使其只负责 import payload extension 查询，不处理 filesystem query/hash；按 3.8.6 事实支持 `.bin` 与 `.cconb`。
5. 如发现 3.8.6 还缺少 cocos4 已有的必要 `NODEJS` runtime 分支，逐项记录事实后再小步回补，不能批量照搬 cocos4。

若阶段 2 或阶段 2.5 不通过，进入方案 C 或 D：

1. 建立明确 runtime mode。
2. normal build 和 scene/editing 分别选择不同 mode。
3. 对每个 mode 建立常量断言和初始化 smoke test。

只有在 A/B/C 都证明成本过高或风险过大时，才考虑方案 D。

### 阶段 4：验证矩阵

必须执行：

- `rtk npm run compiler:engine`
- `rtk npm run build`
- CLI `web-mobile` 自动图集构建
- CLI `wechatgame` 自动图集构建
- `vitests/suites/build/wechatgame-editor-baseline-parity.test.ts`
- engine preload smoke：normal build mode 的 constants 断言。
- engine preload smoke：scene/editing mode 的 constants 断言。
- runtime preview smoke：至少启动到 server 可响应基础资源和 `/query-extname/<uuid>`。
- scene process smoke：至少覆盖一个 scene load / dump / serialize 入口。
- MCP/API startup smoke：覆盖 `CocosAPI.startup()` 或等价 launcher 初始化入口。
- programming facet smoke：覆盖 `src/core/scripting/programming/Facet.ts` 相关 editor 语义入口，确认没有被 normal build runtime 改动误伤。

必须统计并记录：

- `Editor is not defined`
- `ReferenceError`
- `Read json failed`
- `ENOENT ... ?_t=`
- `sprite frame can't be load`
- `Pack Images start`
- `Pack Images success`
- `assets` 分区计数
- `NodejsAssetDbWarning`
- `CC_EDITOR`
- `CC_NODEJS`
- `CC_BUILD`
- `EDITOR_NOT_IN_PREVIEW`

验收条件：

- `Editor is not defined=0`
- `ENOENT ... ?_t=0`
- `sprite frame can't be load=0`，或剩余项有新的独立原因和 issue 编号
- `Pack Images success` 与 Editor baseline 对齐
- `wechatgame` parity 不再因 `assets` 分区计数失败
- runtime preview、scene process、MCP/API startup、programming facet smoke 不因 runtime mode 调整回归

非本计划验收项：

- `Invalid values chosen` 属于 `BUILD-ISSUE-022`，本计划只记录不作为失败条件。

## 风险与停止条件

停止条件：

- `CC_EDITOR=false` 导致 `cc/editor/*` 必需模块无法加载，且无法通过更明确 runtime mode 隔离。
- `mode: 'BUILD' + platform: 'NODEJS'` 无法导出 normal build 所需模块，且没有 3.8.6 可接受替代。
- `AssetDB.queryAsset` 在 build runtime 中不可用，且没有已存在 CLI asset query 能力可替代。
- 变更会影响 scene editing、runtime preview 或 MCP startup，但缺少可重复验证入口。

主要风险：

- `CC_EDITOR=true` 可能是之前为了兼容某些 `cc/editor/*` 模块而引入，直接取消可能暴露隐藏依赖。
- 3.8.6 与 cocos4 的 `NODEJS` 能力不完全等价，不能直接照搬 cocos4 代码。
- 当前 workspace 和测试项目已有 dirty state，最终验收前需要记录 before 状态，并尽量使用固定输出目录避免污染判断。
- 在同一进程内测试多个 runtime mode 会被 global state 和 module cache 污染，必须用独立 Node process。

## 待确认决策

需要确认是否按推荐方向推进：

- 优先验证方案 A 和方案 B：分别确认 runtime flag 分离与真正 `BUILD + NODEJS` 编译产物的可行性。
- 若 A/B 不成立，再设计方案 C：拆分 build 与 editor-like preload mode。
- 若 C 仍不成立，再评估方案 D：显式 `editor-nodejs-build` 兼容层。
- 不再继续扩大 `editor-path-replace.ts` 单点补丁作为主线。
