# Runtime Preview Mainbase Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `adapter-to-386` 的干净基线上重新设计并实现 `runtime-preview`，让 CLI 的 AssetDB、`library`、`temp/programming` 产物按 Cocos Creator 3.8.x engine runtime 的真实加载语义运行。

**Architecture:** 采用 fact-driven、on-demand preview server。URL 由 engine runtime 和 CLI `settings/bundleConfigs/script2library` 事实决定；server 只按请求即时解析到 `library` / internal library / `temp/programming` 文件，不在启动时扫描整个产物树，也不自创 URL 规则。

**Tech Stack:** TypeScript、Node.js、PowerShell、Vitest、jsdom、Cocos Creator 3.8.6 engine source、`@cocos/asset-db`、`@cocos/ccbuild`、`@cocos/lib-programming`、SystemJS。

---

## 目标边界

这次目标不是修单个 `404`、单个 `settings.js` 报错，也不是把旧实现搬回当前分支。

最终要达到：

- CLI runtime preview 能用真实 engine runtime 加载资源、脚本和 bundle config。
- 开发反馈以 Vitest/headless/HTTP contract 为主，浏览器只作为最后集成 smoke。
- URL 到文件路径的转换由源码事实和产物事实推导，不由先验目录规则决定。
- 旧实现只作为业务意图和可复用片段来源，必须经过分类和验证。
- 生产启动路径必须性能优先：禁止启动时全量扫描 `library`、`temp` 或构建几十万文件级别索引；需要按请求 lazy resolve。

## 执行策略

执行方式采用“主线顺序推进 + 关键节点只读 review”。不要一开始并行拆生产实现；本任务的主要风险在事实链、URL 来源、产物边界和性能边界，过早并行会把未经验证的 URL/路径假设写进代码。

### 提交策略

后续执行必须小步提交，避免把架构、测试、修复和文档堆成一个不可 review 的大变更。

- 每个 task 或独立 verification gap 完成后提交一次；同一提交必须有清晰单一主题。
- 测试先行或测试同步：如果改 production runtime route，必须在同一提交或前一个提交里包含对应 failing/passing test。
- 文档更新可以和对应事实/验证代码同提交；纯计划修正可以独立提交。
- 每次提交前至少运行与改动直接相关的 `vitests` 子集；跨 route/settings/startup 的改动必须运行 `npm --prefix vitests test -- --passWithNoTests`。
- 关键 review gate 前必须提交干净 checkpoint，再派子代理 review；review 发现的问题按 Critical/Important 拆小提交修。

Task 15 建议提交点：

1. `docs: record runtime preview review gate gaps`：当前 review 结果、Task 15 和提交策略。
2. `test: add real preview settings and cli output checks`：Task 15 Step 1-2。
3. `fix: make runtime preview asset routes production fact-backed`：Task 15 Step 3-4。
4. `test: expand runtime preview asset url capture and resources probes`：Task 15 Step 5-6。
5. `test: cover launcher runtime preview startup smoke`：Task 15 Step 7。
6. `chore: remove legacy manifest draft and rename pre-browser smoke`：Task 15 Step 8。

### 阶段顺序

1. Preflight：先检查 `git status`、当前未跟踪文档、旧 `src/runtime-preview/manifest/**` 草稿和早期 `vitests/**` 草稿。旧实现必须先分类为 `事实可复用`、`业务意图保留`、`实现方式废弃`、`待源码验证`，不能直接继续旧 `manifest` 方向。
2. Task 1-5：只做事实闭环和旧实现分类，不写生产代码。
3. Task 7：实现最小 `RuntimePreviewContext` / resolver 边界，只做 roots/providers/bounded caches、path traversal、防 startup scan、programming 已知文件读取；禁止 asset import/native URL mapping。
4. Task 8/8.5：建立真实 engine source Vitest harness，只 mock host boundary。
5. Task 9 -> 9.5 -> 9.75：先做 editor/CLI output consistency，再做 filesystem-base parser probe，最后做 HTTP-base URL capture probe。只有 Task 9.75 捕获的 HTTP URLs 可以进入 HTTP contract。
6. Task 10-12：实现 script map、`PreviewSettingsProvider`、fact-backed HTTP contract。Task 12 只能消费 engine transform 或 Task 9.75 captured URLs，不能手写近似 asset URL。
7. Task 13-14：接 CLI startup，先 HTTP smoke，再 browser smoke。浏览器只作为最终集成验证。

### Review gate

- Task 8.5 后：派资深子代理只读 review engine-source harness，重点看 `PREVIEW=true`、`TEST=false`、P6 optional reference 是否被误用。
- Task 9.75 后：派资深子代理只读 review HTTP URL capture，重点看 captured URLs 是否来自真实 HTTP-base engine runtime，而不是 filesystem-base probe 或手写 URL。
- Task 12 后：派资深子代理只读 review HTTP contract / route architecture，重点看 route 是否按 `Engine-required`、`Observed/conditional`、`Diagnostic/reference-only` 分层，production startup 是否仍无全量 scan。
- 任何需要修改 `D:\workspace\engines\cocos\3.8.6` 前：必须暂停，写出 engine patch 事实依据、影响范围和替代方案，并等待用户确认。

### 2026-06-07 Review gate 结果

当前 `vitests` 能通过，但资深子代理 review 判定测试/验证链路尚未按计划闭环，不能继续进入 browser integration 或扩展功能。必须先补下面的验证 gap：

- Critical：production `preview --runtime` 启动不会传入 `capturedRuntimeUrls`，但 `resolveLibraryRequest()` 没有 `allowedRequestPaths` 时拒绝所有 asset import/native request。当前 HTTP contract 只验证 injected route context，不能证明真实 CLI server 能服务 representative asset URL。
- Important：`editor-cli-output-consistency.test.ts` 还没有真实验证 CLI AssetDB output，只验证 active/frozen editor library，并把 `cli-output-not-generated-yet` 当作通过状态。
- Important：filesystem-base `resources.load` probe 只覆盖 `JsonAsset`，Image/Texture/SpriteFrame 仍是 `todo`，TTF、Plist/AutoAtlas、Spine 也未覆盖。
- Important：HTTP-base capture 只捕获 `query-extname` 和一个 JsonAsset import URL，没有 native dependency、pack、redirect bundle 等 route facts。
- Important：`http-contract.test.ts` 手写 injected `settings/bundleConfigs/script2library`，没有消费 Task 11 的真实 output。
- Important：`settings-generation.test.ts` 全部使用 mocked `loadPreviewSettings`，真实 `getPreviewSettings()` E2E 和 normal build boundary 尚未验证。
- Important：`cli-startup.test.ts` 直接调用 `startRuntimePreviewServer()`，没有覆盖 `PreviewCommand -> Launcher.startRuntimePreview() -> server` 的真实命令链。
- Minor：`browser-smoke.test.ts` 当前实际是 pre-browser HTTP smoke，应改名避免误判。
- Minor：`src/runtime-preview/manifest/**` 旧 recursive `walkFiles()` 草稿仍在，虽然未被 production import，但应删除或迁到 test-only/reference，避免后续误用。

结论：Task 8/8.5 的 `PREVIEW=true`、`TEST=false` 方向正确；Task 10 的 `dependScripts -> programming records/chunk` 连接基本有效。但 Task 9、9.5、9.75、11、12、13 必须补验证后才能继续。

### 禁止提前执行

- 禁止在 Task 9.75 前实现 asset import/native route mapping。
- 禁止把 filesystem-base `resources.load` probe 捕获到的路径当成 HTTP route contract。
- 禁止把 frozen editor `library` / `temp/programming` 复制到 production 作为 workaround。
- 禁止 browser smoke 先于 Vitest/headless/HTTP contract。

## 事实优先级

| 优先级 | 来源 | 路径 | 用途 |
| --- | --- | --- | --- |
| P0 | Engine runtime 源码 | `D:\workspace\engines\cocos\3.8.6` | `assetManager`、`Bundle`、`downloader`、`parser`、`url-transformer`、`settings` 的最高权威 |
| P0 | CLI AssetDB / builder / scripting 源码 | `E:\own_space\engines\cocos-cli` | `asset.library`、importer、builder settings、script compile 的最高权威 |
| P1 | 旧版 editor preview server 源码 | `E:\own_space\tmp-repos\runtime-preview-reference\cocos-cli-backup-runtime-preview-bad-20260606\docs\dev\reference` | Creator preview server route、`generate-settings`、scripting facet 的重要行为事实 |
| P1 | 冻结 editor `library` | `E:\own_space\engines\cocos-cli\.codex-tmp\reference-library\cocos_work_lab_38x-editor-library-20260606` | 验证 editor-generated `library` 产物结构 |
| P1 | 冻结 `temp/programming` | `E:\own_space\engines\cocos-cli\.codex-tmp\reference-temp\cocos_work_lab_38x-editor-programming-20260606` | 验证 preview script/import-map/chunk 行为 |
| P2 | CLI 备份分支实现 | `E:\own_space\tmp-repos\runtime-preview-reference\cocos-cli-backup-runtime-preview-bad-20260606`、`E:\own_space\tmp-repos\runtime-preview-reference\cocos-cli-backup-adapter-to-386-957f835` | 业务意图、server 生命周期、CLI 接入、可复用片段 |
| P2 | Engine 备份分支实现 | `E:\own_space\tmp-repos\runtime-preview-reference\engine-backup-current-20260606` | `NODEJS` adapter、PAL、`cc.config.json`、`build-adapter.js` 参照 |

## 明确废弃的旧方向

- 不再把 `library/import/**`、`library/native/**` 当成 editor `library` 的真实布局。
- 不再先设计 `url resolver`，再让源码和产物适配它。
- 不用 extname 猜测 import/native 边界。
- 不把 native-like 文件直接等同 runtime native URL。
- 不 mock Cocos public API 来证明资源加载正确；测试只能 mock IO、DOM、canvas、WebGL 等 host 边界。

## 文件结构

| 路径 | 动作 | 职责 |
| --- | --- | --- |
| `docs/dev/runtime-preview-architecture-facts-20260606.md` | Create | 记录事实优先级、源码证据、旧 editor route 对照、迁移边界 |
| `docs/dev/runtime-preview-old-implementation-review-20260606.md` | Create | 分类旧实现：`事实可复用`、`业务意图保留`、`实现方式废弃`、`待源码验证` |
| `docs/dev/runtime-preview-cli-design-20260606.md` | Create | 单独记录 CLI runtime preview 架构、route 事实来源、性能设计、editor/CLI 产物一致性策略 |
| `src/runtime-preview/context/runtime-preview-context.ts` | Create | 保存 project/engine/library/programming roots、provider handles、bounded cache handles；不直接承担 settings/resolver 生成职责 |
| `src/runtime-preview/library/resolve-library-request.ts` | Create | on-demand 解析 engine 请求尾部到 project/internal/extension library 文件，禁止全量扫描 |
| `src/runtime-preview/programming/resolve-programming-request.ts` | Create | on-demand 读取 preview import-map、records、chunks、SystemJS、custom macro |
| `src/runtime-preview/settings/preview-settings-provider.ts` | Create | 调用或等价封装 CLI `getPreviewSettings()`，缓存 `settings/script2library/bundleConfigs` |
| `src/runtime-preview/server/runtime-preview-server.ts` | Create | HTTP server 生命周期 |
| `src/runtime-preview/server/runtime-preview-routes.ts` | Create | Engine-required routes、captured conditional routes、diagnostic routes 的分层注册；默认不全量复刻 old editor routes |
| `src/runtime-preview/server/serve-on-demand-file.ts` | Create | fact-backed on-demand URL 到真实文件服务 |
| `src/runtime-preview/index.ts` | Create | runtime preview public entry |
| `src/commands/preview.ts` | Modify | 接入 `preview --runtime --host --port --scene` |
| `src/core/launcher.ts` | Modify | 接入 runtime preview 启动 |
| `vitests/package.json` | Create | 独立 Vitest package，保留原 Jest 不动 |
| `vitests/vitest.config.ts` | Create | engine-source test 配置，必须包含 `jsdom` |
| `vitests/shared/fixture-paths.ts` | Create | 读取 `COCOS_CLI_TEST_*`，禁止硬编码本机绝对路径 |
| `vitests/shared/setup-engine-env.ts` | Create | headless DOM/canvas/TextEncoder 环境 |
| `vitests/shared/engine-source.ts` | Create | 引入真实 engine source 的入口和 alias |
| `vitests/suites/runtime-preview/*.test.ts` | Create | context、on-demand resolver、resources.load、script map、HTTP contract、smoke 测试 |

## 环境变量

所有测试必须通过环境变量读取路径：

```powershell
$env:COCOS_CLI_TEST_PROJECT_ROOT='E:\own_space\cocos_work_lab_38x'
$env:COCOS_CLI_TEST_ENGINE_ROOT='D:\workspace\engines\cocos\3.8.6'
$env:COCOS_CLI_TEST_EDITOR_LIBRARY_REF='E:\own_space\engines\cocos-cli\.codex-tmp\reference-library\cocos_work_lab_38x-editor-library-20260606'
$env:COCOS_CLI_TEST_EDITOR_PROGRAMMING_REF='E:\own_space\engines\cocos-cli\.codex-tmp\reference-temp\cocos_work_lab_38x-editor-programming-20260606'
```

测试代码内禁止出现这些绝对路径字面量。

---

### Task 1: 固定基线和事实源

**Files:**
- Read: `docs/dev/runtime-preview-mainbase-handoff-20260606.md`
- Read: `docs/dev/runtime-preview-reference-library-20260606.md`
- Read: `docs/dev/runtime-preview-reference-temp-programming-20260606.md`
- Create: `docs/dev/runtime-preview-architecture-facts-20260606.md`

- [ ] **Step 1: 确认当前 CLI 分支和工作区**

Run:

```powershell
rtk powershell -NoProfile -Command "git -C 'E:\own_space\engines\cocos-cli' branch --show-current; git -C 'E:\own_space\engines\cocos-cli' log --oneline -5; git -C 'E:\own_space\engines\cocos-cli' status --short"
```

Expected:

- Branch is `adapter-to-386`.
- `git rev-parse --short HEAD` is `71b2ad8`, or any deviation is recorded and confirmed against `origin/main` before continuing.
- Untracked docs are acceptable.
- No unrelated source modifications are introduced by this task.
- No existing runtime preview process is listening on `127.0.0.1:19530`.

Also run:

```powershell
rtk powershell -NoProfile -Command "git -C 'E:\own_space\engines\cocos-cli' rev-parse --short HEAD; git -C 'E:\own_space\engines\cocos-cli' rev-parse --short origin/main; Get-NetTCPConnection -LocalPort 19530 -ErrorAction SilentlyContinue | Select-Object LocalAddress,LocalPort,State,OwningProcess"
```

- [ ] **Step 2: 确认 engine 源码路径**

Run:

```powershell
rtk powershell -NoProfile -Command "git -C 'D:\workspace\engines\cocos\3.8.6' branch --show-current; git -C 'D:\workspace\engines\cocos\3.8.6' log --oneline -5; git -C 'D:\workspace\engines\cocos\3.8.6' status --short"
```

Expected:

- Path exists.
- Branch is the current 3.8.6 adaptation branch.
- `editor/assets/**/*.meta` noise, if present, is recorded as runtime-generated noise and not used as implementation evidence.

- [ ] **Step 3: 确认旧 editor preview server reference**

Run:

```powershell
rtk powershell -NoProfile -Command "Get-ChildItem -LiteralPath 'E:\own_space\tmp-repos\runtime-preview-reference\cocos-cli-backup-runtime-preview-bad-20260606\docs\dev\reference\old_editor_preview_server' -File | Select-Object Name,Length"
```

Expected includes:

- `server.js`
- `simulator.js`
- `Facet.js`
- `FacetInstance.js`
- `preview_ctrl.ts`

- [ ] **Step 4: 创建事实文档骨架**

Create `docs/dev/runtime-preview-architecture-facts-20260606.md` with these sections:

```markdown
# Runtime Preview Architecture Facts

记录时间：2026-06-06

## 事实优先级

1. Engine runtime 源码：`D:\workspace\engines\cocos\3.8.6`
2. CLI AssetDB / builder / scripting 源码：`E:\own_space\engines\cocos-cli`
3. 旧版 editor preview server：`E:\own_space\tmp-repos\runtime-preview-reference\cocos-cli-backup-runtime-preview-bad-20260606\docs\dev\reference`
4. 冻结 editor `library` 和 `temp/programming`
5. 备份分支旧实现

## 已否定假设

- editor `library` 不是顶层 `import/`、`native/`、`internal/` 目录布局。
- URL mapping 不能先按目录规则设计。
- server 不应改变 engine runtime 的 import/native 语义。

## 事实记录与待验证项

### Engine runtime URL 生成链

### CLI AssetDB library 生成链

### Old editor preview server route 对照

### Frozen artifact metadata / records 结构

### Runtime preview 实现边界
```

- [ ] **Step 5: 显示事实骨架 diff**

Run:

```powershell
rtk powershell -NoProfile -Command "git diff -- docs/dev/runtime-preview-architecture-facts-20260606.md docs/superpowers/plans/2026-06-06-runtime-preview-mainbase.md --stat"
```

Expected:

- Only docs are changed.
- Do not stage or commit until user confirms.

### Task 2: 建立 engine runtime URL 事实链

**Files:**
- Read: `D:\workspace\engines\cocos\3.8.6\cocos\asset\asset-manager\asset-manager.ts`
- Read: `D:\workspace\engines\cocos\3.8.6\cocos\asset\asset-manager\bundle.ts`
- Read: `D:\workspace\engines\cocos\3.8.6\cocos\asset\asset-manager\url-transformer.ts`
- Read: `D:\workspace\engines\cocos\3.8.6\cocos\asset\asset-manager\downloader.ts`
- Read: `D:\workspace\engines\cocos\3.8.6\cocos\asset\asset-manager\parser.ts`
- Modify: `docs/dev/runtime-preview-architecture-facts-20260606.md`

- [ ] **Step 1: 搜索 engine URL 入口**

Run:

```powershell
rtk rg -n "importBase|nativeBase|config.json|cc.config|url-transformer|transformPipeline|downloader|parser|loadBundle|loadAny|getUuidFromURL" "D:\workspace\engines\cocos\3.8.6\cocos\asset\asset-manager" -g "*.ts"
```

Expected:

- Locate `assetManager.init()` handling of `importBase` and `nativeBase`.
- Locate `Bundle` loading and config consumption.
- Locate URL transform and downloader/parser boundaries.

- [ ] **Step 2: 记录 engine 事实**

Append to `docs/dev/runtime-preview-architecture-facts-20260606.md`:

```markdown
## Engine runtime URL 生成链

证据文件：

- `D:\workspace\engines\cocos\3.8.6\cocos\asset\asset-manager\asset-manager.ts`
- `D:\workspace\engines\cocos\3.8.6\cocos\asset\asset-manager\bundle.ts`
- `D:\workspace\engines\cocos\3.8.6\cocos\asset\asset-manager\url-transformer.ts`

结论：

- `importBase` 和 `nativeBase` 是 engine runtime 初始化和 bundle config 消费的输入。
- runtime 请求 URL 由 settings、bundle config、asset uuid/native info、url-transformer、downloader/parser 共同产生。
- preview server 不能通过 extname 自行决定 import/native 语义，只能服务 runtime 已经决定要请求的 URL。

待验证：

- 具体 bundle config 字段如何表达 import/native/native hash。
- `resources.load` 对 JsonAsset、SpriteFrame、Texture2D、TTF、Plist、Spine 的 downloader/parser 路径。
```

- [ ] **Step 3: 检查是否存在源码证据缺口**

Run:

```powershell
rtk rg -n "importBase|nativeBase|versions|paths|uuids|types|extensionMap|scenes|packs" "D:\workspace\engines\cocos\3.8.6\cocos\asset" -g "*.ts"
```

Expected:

- If a conclusion lacks source evidence, mark it `待验证` instead of writing as final fact.

### Task 3: 建立 CLI AssetDB/library 事实链

**Files:**
- Read: `src/core/assets/utils.ts`
- Read: `src/core/assets/asset-config.ts`
- Read: `src/core/assets/manager/query.ts`
- Read: `src/core/assets/manager/asset-db.ts`
- Read: `src/core/builder/index.ts`
- Read: `src/core/builder/worker/builder/manager/asset.ts`
- Read: `src/core/builder/worker/builder/manager/asset-library.ts`
- Modify: `docs/dev/runtime-preview-architecture-facts-20260606.md`

- [ ] **Step 1: 搜索 `asset.library` 生成和消费**

Run:

```powershell
rtk rg -n "asset\\.library|libraryRoot|libArr2Obj|meta\\.files|saveToLibrary|getLibraryJSON|outputAssetJson|getPreviewSettings|script2library|bundleConfigs|compileScripts|dependScripts" src/core/assets src/core/builder src/core/scripting -g "*.ts"
```

Expected:

- Locate `libArr2Obj()` converting `asset.library + extname`.
- Locate builder warning that output path must use `asset.library` rather than direct uuid拼接.
- Locate script asset changes triggering `compileScripts()`.
- Locate `src/core/builder/index.ts#getPreviewSettings()` or equivalent current-baseline function that returns `settings`、`script2library`、`bundleConfigs`.

- [ ] **Step 2: 记录 CLI 事实**

Append:

```markdown
## CLI AssetDB library 生成链

证据文件：

- `src/core/assets/utils.ts`
- `src/core/assets/manager/query.ts`
- `src/core/builder/worker/builder/manager/asset.ts`
- `src/core/assets/manager/asset-db.ts`

结论：

- AssetDB 的 `asset.library` 是 per-asset library 文件事实。
- `meta.files` 决定 `.json`、native-like 文件等 library 文件集合。
- 某些资源不能直接按 uuid 拼路径，必须尊重 `asset.library`，例如 ttf 这类带子目录的资源。
- script asset 变化必须影响 `temp/programming` 和 `dependScripts`，不能只更新资源 JSON。
- `getPreviewSettings()` 是当前 CLI 生成 preview `settings`、`script2library`、`bundleConfigs` 的必须事实源；新实现不能在未引用该事实链时手写 settings。
```

- [ ] **Step 3: 明确 runtime preview context 输入**

Append:

```markdown
## RuntimePreviewContext 输入

RuntimePreviewContext 必须来自以下事实，但生产启动不得把这些输入递归扫描成全量 URL/file index：

- `projectRoot`、`engineRoot`、project `libraryRoot`、internal library root、`temp/programming` root
- CLI AssetDB query asset info/data
- `library` metadata：`.assets-data.json`、`.assets-info1.0.0.json`、`.assets-dependency.json`
- internal metadata：`.internal-data.json`、`.internal-info1.0.0.json`、`.internal-dependency.json`
- per-uuid `asset.library` 和 `meta.files`
- CLI/builder `getPreviewSettings()` 产生或等价代表的 `settings`、`bundleConfigs`、`script2library`
- `temp/programming/packer-driver/targets/preview/import-map.json`
- `temp/programming/packer-driver/targets/preview/main-record.json`
- `temp/programming/packer-driver/targets/preview/assembly-record.json`
- `temp/programming/packer-driver/targets/preview/chunks/**`

生产 server 只能在 request-time 按 URL tail、bundle config、`script2library`、AssetDB/library metadata 进行 lazy resolve；测试可以扫描冻结样本来生成 representative case，但不能把测试扫描策略迁移到 production startup。
```

### Task 4: 对照旧版 editor preview server

**Files:**
- Read: `E:\own_space\tmp-repos\runtime-preview-reference\cocos-cli-backup-runtime-preview-bad-20260606\docs\dev\reference\old_editor_preview_server\server.js`
- Read: `E:\own_space\tmp-repos\runtime-preview-reference\cocos-cli-backup-runtime-preview-bad-20260606\docs\dev\reference\old_editor_preview_server\simulator.js`
- Read: `E:\own_space\tmp-repos\runtime-preview-reference\cocos-cli-backup-runtime-preview-bad-20260606\docs\dev\reference\old_editor_preview_server\Facet.js`
- Read: `E:\own_space\tmp-repos\runtime-preview-reference\cocos-cli-backup-runtime-preview-bad-20260606\docs\dev\reference\old_editor_preview_server\FacetInstance.js`
- Modify: `docs/dev/runtime-preview-architecture-facts-20260606.md`

- [ ] **Step 1: 提取 old editor routes**

Run:

```powershell
rtk rg -n "url: '/settings|url: '/assets|url: '/remote|url: '/plugins|url: '/scripting|generate-settings|script2library|bundleConfigs|loadPackResource|getGlobalImportMap|query-asset-info" "E:\own_space\tmp-repos\runtime-preview-reference\cocos-cli-backup-runtime-preview-bad-20260606\docs\dev\reference\old_editor_preview_server" -g "*.js" -g "*.ts"
```

Expected:

- Routes include `/settings.js`, `/settings.json`, `/scene/*.json`, `/assets/*/import/*`, `/assets/*/native/*`, `/remote/*/import/*`, `/remote/*/native/*`, `/assets/*/config.json`, `/assets/*/index.js`, `/plugins/*`, `/scripting/x/*`, `/scripting/import-map-global`, `/scripting/engine/*`.

- [ ] **Step 2: 记录 route 对照表**

Append:

```markdown
## Old editor preview server route 对照

| Route | Old editor 行为 | 新 runtime-preview 处理 |
| --- | --- | --- |
| `/settings.js` | 调 `Editor.Message.request("preview","generate-settings")`，缓存 `script2library` 和 `bundleConfigs` | 必须基于 CLI/builder `getPreviewSettings()` 或等价事实生成 settings，不能手搓不完整 settings |
| `/assets/*/config.json` | 从 `bundleConfigs` 按 bundle name 返回 config | 从 runtime context 缓存的真实 `bundleConfigs` 返回 |
| `/assets/*/index.js` | bundle 存在时返回 dummy bundle script | 只有 engine runtime 需要该入口时才实现，内容必须与 engine bundle load 行为匹配 |
| `/assets/*/import/*` | 请求尾部映射到 `Project/library` 或 builtin internal library | 新实现只能按 engine/settings/bundle config 已产生的 runtime URL 做 request-time resolve，不硬编码目录假设 |
| `/assets/*/native/*` | 请求尾部映射到 `Project/library` 或 builtin internal library | 同上 |
| `/plugins/*` | 用 `script2library` 查脚本 library 文件 | 新实现应由 CLI `script2library` / preview programming records 提供 |
| `/scripting/import-map-global` | `Facet.getGlobalImportMap()` | 使用冻结 `temp/programming` 和 CLI scripting 事实生成 |
| `/scripting/x/*` | `Facet.loadPackResource()` 返回 json 或 chunk | 使用 preview target `import-map.json`、records、chunks 实现 |
| `/scripting/engine/*` | 从 engine dist root 服务文件 | 使用 engine build/cache 事实，不猜路径 |
```

- [ ] **Step 3: 标注不能直接继承的旧行为**

Append:

```markdown
## Old editor 行为迁移边界

- 旧 editor 的 `/assets/*/import/*` 和 `/assets/*/native/*` route 是事实参考，但不是新实现的路径规则。
- 旧 editor 可以访问 `Editor.Message` 和 `Editor.Project`；CLI runtime-preview 必须用 CLI AssetDB、builder、scripting API 或 runtime context 替代。
- `script2library` 的业务意图必须保留：脚本请求要能落到真实编译产物。
- `generate-settings` 的业务意图必须保留：settings 和 bundle config 是 runtime 加载入口。
```

### Task 5: Review 旧实现并分类

**Files:**
- Read: `E:\own_space\tmp-repos\runtime-preview-reference\cocos-cli-backup-runtime-preview-bad-20260606\src\runtime-preview/**`
- Read: `E:\own_space\tmp-repos\runtime-preview-reference\cocos-cli-backup-runtime-preview-bad-20260606\src\core\launcher.ts`
- Read: `E:\own_space\tmp-repos\runtime-preview-reference\cocos-cli-backup-adapter-to-386-957f835\src\runtime-preview/**`
- Read: `E:\own_space\tmp-repos\runtime-preview-reference\engine-backup-current-20260606\cc.config.json`
- Read: `E:\own_space\tmp-repos\runtime-preview-reference\engine-backup-current-20260606\pal\**\nodejs\**`
- Create: `docs/dev/runtime-preview-old-implementation-review-20260606.md`

- [ ] **Step 1: 搜索旧 CLI runtime-preview 实现**

Run:

```powershell
rtk rg -n "runtime-preview|RuntimePreview|settings|bundleConfigs|script2library|importBase|nativeBase|resolve|asset|scripting|preview" "E:\own_space\tmp-repos\runtime-preview-reference\cocos-cli-backup-runtime-preview-bad-20260606\src" "E:\own_space\tmp-repos\runtime-preview-reference\cocos-cli-backup-adapter-to-386-957f835\src" -g "*.ts"
```

- [ ] **Step 2: 搜索 engine backup adapter 改动**

Run:

```powershell
rtk rg -n "NODEJS|nodejs|cc\\.config|pal/.*nodejs|build-adapter|ccon|BufferBuilder|encodeCCONBinary|wasm-nodejs" "E:\own_space\tmp-repos\runtime-preview-reference\engine-backup-current-20260606" -g "*.ts" -g "*.js" -g "*.json"
```

- [ ] **Step 3: 创建分类文档**

Create `docs/dev/runtime-preview-old-implementation-review-20260606.md`:

```markdown
# Runtime Preview Old Implementation Review

记录时间：2026-06-06

## 分类标准

| 分类 | 含义 |
| --- | --- |
| 事实可复用 | 与 engine/AssetDB/old editor/reference artifact 事实一致，可迁移 |
| 业务意图保留 | 意图正确，但实现方式需要重写 |
| 实现方式废弃 | 与事实冲突，不能迁移 |
| 待源码验证 | 当前证据不足，不能下结论 |

## CLI old implementation

| 文件/符号 | 分类 | 原因 | 后续动作 |
| --- | --- | --- | --- |

## Engine backup implementation

| 文件/符号 | 分类 | 原因 | 后续动作 |
| --- | --- | --- | --- |
```

- [ ] **Step 4: 写入第一批必须分类项**

At minimum classify:

- CLI preview command and launcher integration.
- Old runtime preview server lifecycle.
- Old settings generation approach.
- Old `/assets/*/import/*` and `/assets/*/native/*` resolver logic.
- Old script serving / `script2library` logic.
- Engine `NODEJS` feature in `cc.config.json`.
- Engine `pal/*/nodejs` files.
- `ccon.ts` internal exports.
- `scripts/build-adapter.js` changes.

Expected:

- Resolver-first or extname-guessing code is classified as `实现方式废弃` unless source facts prove otherwise.
- CLI startup lifecycle can be `业务意图保留` even if implementation is rewritten.

### Task 6: 建立独立 Vitest harness

**Files:**
- Create: `vitests/package.json`
- Create: `vitests/vitest.config.ts`
- Create: `vitests/shared/fixture-paths.ts`
- Create: `vitests/shared/setup-engine-env.ts`
- Create: `vitests/shared/engine-source.ts`

- [ ] **Step 1: 创建 `package.json`**

Create:

```json
{
  "name": "vitests",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "devDependencies": {
    "@vitejs/plugin-vue": "^5.0.0",
    "jsdom": "^24.1.3",
    "tsx": "^4.19.0",
    "typescript": "^5.4.0",
    "vite": "^5.4.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 2: 创建 `fixture-paths.ts`**

Create:

```ts
import { existsSync } from 'node:fs';

export interface RuntimePreviewFixturePaths {
  projectRoot: string;
  engineRoot: string;
  editorLibraryRef: string;
  editorProgrammingRef: string;
}

function requirePath(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  if (!existsSync(value)) {
    throw new Error(`Path from ${name} does not exist: ${value}`);
  }
  return value;
}

export function getFixturePaths(): RuntimePreviewFixturePaths {
  return {
    projectRoot: requirePath('COCOS_CLI_TEST_PROJECT_ROOT'),
    engineRoot: requirePath('COCOS_CLI_TEST_ENGINE_ROOT'),
    editorLibraryRef: requirePath('COCOS_CLI_TEST_EDITOR_LIBRARY_REF'),
    editorProgrammingRef: requirePath('COCOS_CLI_TEST_EDITOR_PROGRAMMING_REF'),
  };
}
```

- [ ] **Step 3: 创建 `vitest.config.ts`**

Create:

```ts
import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    environment: 'jsdom',
    setupFiles: [resolve(root, 'shared/setup-engine-env.ts')],
    include: ['suites/**/*.test.ts'],
    testTimeout: 30000,
  },
  resolve: {
    alias: {
      '@runtime-preview': resolve(root, '../src/runtime-preview'),
      '@shared': resolve(root, 'shared'),
    },
  },
});
```

- [ ] **Step 4: 创建 `setup-engine-env.ts`**

Create:

```ts
import { TextDecoder, TextEncoder } from 'node:util';

Object.assign(globalThis, {
  TextDecoder,
  TextEncoder,
});

HTMLCanvasElement.prototype.getContext = function getContext() {
  return null;
} as typeof HTMLCanvasElement.prototype.getContext;
```

If engine import still fails, add only the missing host boundary named in the failure. Do not add broad mocks for Cocos public APIs.

- [ ] **Step 5: 运行 harness smoke**

Run:

```powershell
rtk powershell -NoProfile -Command "cd 'E:\own_space\engines\cocos-cli'; npm --prefix vitests install; $env:COCOS_CLI_TEST_PROJECT_ROOT='E:\own_space\cocos_work_lab_38x'; $env:COCOS_CLI_TEST_ENGINE_ROOT='D:\workspace\engines\cocos\3.8.6'; $env:COCOS_CLI_TEST_EDITOR_LIBRARY_REF='E:\own_space\engines\cocos-cli\.codex-tmp\reference-library\cocos_work_lab_38x-editor-library-20260606'; $env:COCOS_CLI_TEST_EDITOR_PROGRAMMING_REF='E:\own_space\engines\cocos-cli\.codex-tmp\reference-temp\cocos_work_lab_38x-editor-programming-20260606'; npm --prefix vitests test -- --passWithNoTests"
```

Expected:

- Vitest starts.
- No `jsdom` missing error.
- No hardcoded fixture path inside test code.

### Task 7: Runtime context and on-demand resolver tests first

**Files:**
- Create: `src/runtime-preview/context/runtime-preview-context.ts`
- Create: `src/runtime-preview/library/resolve-library-request.ts`
- Create: `src/runtime-preview/programming/resolve-programming-request.ts`
- Create: `vitests/suites/runtime-preview/on-demand-resolver.test.ts`

- [ ] **Step 1: Write failing on-demand resolver test**

Create `vitests/suites/runtime-preview/on-demand-resolver.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { getFixturePaths } from '@shared/fixture-paths';
import { createRuntimePreviewContext } from '@runtime-preview/context/runtime-preview-context';
import { resolveLibraryRequest } from '@runtime-preview/library/resolve-library-request';
import { resolveProgrammingRequest } from '@runtime-preview/programming/resolve-programming-request';

describe('runtime preview on-demand resolvers', () => {
  it('does not scan artifacts at startup and only resolves fact-backed safe requests', async () => {
    const paths = getFixturePaths();
    const context = createRuntimePreviewContext({
      projectRoot: paths.projectRoot,
      engineRoot: paths.engineRoot,
      projectLibraryRoot: paths.editorLibraryRef,
      projectProgrammingRoot: join(paths.editorProgrammingRef, 'programming'),
    });

    expect(context.startupStrategy).toBe('lazy');
    expect(context.preloadedLibraryFileCount).toBe(0);

    await expect(resolveLibraryRequest(context, '/../secret.json')).resolves.toBeNull();
    await expect(resolveLibraryRequest(context, '/not-captured-route/file.json')).resolves.toBeNull();

    const programming = await resolveProgrammingRequest(context, '/scripting/x/packer-driver/targets/preview/import-map.json');
    expect(programming?.absolutePath.replace(/\\/g, '/')).toMatch(/\/programming\/packer-driver\/targets\/preview\/import-map\.json$/);
  });
});
```

- [ ] **Step 2: Run test and confirm failure**

Run:

```powershell
rtk powershell -NoProfile -Command "$env:COCOS_CLI_TEST_PROJECT_ROOT='E:\own_space\cocos_work_lab_38x'; $env:COCOS_CLI_TEST_ENGINE_ROOT='D:\workspace\engines\cocos\3.8.6'; $env:COCOS_CLI_TEST_EDITOR_LIBRARY_REF='E:\own_space\engines\cocos-cli\.codex-tmp\reference-library\cocos_work_lab_38x-editor-library-20260606'; $env:COCOS_CLI_TEST_EDITOR_PROGRAMMING_REF='E:\own_space\engines\cocos-cli\.codex-tmp\reference-temp\cocos_work_lab_38x-editor-programming-20260606'; npm --prefix vitests test -- suites/runtime-preview/on-demand-resolver.test.ts"
```

Expected:

- FAIL because runtime preview context and on-demand resolvers do not exist.

- [ ] **Step 3: Implement minimal lazy context and resolvers**

Implement only:

- `RuntimePreviewContext` with roots, provider handles, and bounded lazy cache handles.
- no startup recursion over `libraryRoot` or `programmingRoot`.
- `resolveLibraryRequest()` rejects traversal and returns `null` for asset import/native URLs until a captured/fact fixture supplies the request path and expected artifact relationship.
- `resolveProgrammingRequest()` maps known `temp/programming` preview routes to existing files.
- path normalization and traversal protection.

- [ ] **Step 4: Run on-demand resolver test**

Expected:

- PASS.
- No full library/temp scan is implemented in this task.
- No import/native URL mapping or semantic inference is implemented in this task; that starts only after engine transform / HTTP-base probe captures facts.

### Task 8: Engine-source runtime probe

**Files:**
- Create: `vitests/shared/engine-source.ts`
- Create: `vitests/suites/runtime-preview/engine-source-runtime.probe.test.ts`

- [ ] **Step 1: Write failing engine-source probe**

Create:

```ts
import { describe, expect, it } from 'vitest';
import { loadEngineSourceEntry } from '@shared/engine-source';

describe('engine source runtime probe', () => {
  it('loads real engine source entry and exposes asset runtime APIs', async () => {
    const engine = await loadEngineSourceEntry();

    expect(engine.cc).toBeTruthy();
    expect(engine.cc.assetManager).toBeTruthy();
    expect(typeof engine.cc.assetManager.init).toBe('function');
    expect(engine.cc.resources).toBeTruthy();
    expect(typeof engine.cc.resources.load).toBe('function');
    expect(engine.cc.JsonAsset).toBeTruthy();
  });
});
```

- [ ] **Step 2: Implement `loadEngineSourceEntry()` from current facts**

Use the previously inspected P6 scheme only as a testing-pattern reference: Vitest can import real engine source while mocking host boundaries. The actual path resolution and aliases in this task must come from `COCOS_CLI_TEST_ENGINE_ROOT`, current CLI source, and the 3.8.6 engine source.

- alias `cc` to real engine source entry;
- alias `cc/env`;
- provide PAL/host boundary mocks only where engine import requires them;
- do not mock `assetManager`, `resources`, `JsonAsset`, `Prefab`, `Texture2D`, `SpriteFrame`.

- [ ] **Step 3: Run probe**

Expected:

- PASS means test harness can import real engine runtime APIs.
- If a PAL boundary fails, document the exact missing host boundary and add only that boundary mock.
- Vitest `internal:constants` must model runtime preview browser semantics for downstream probes: `EDITOR=false`, `PREVIEW=true`, `TEST=false`, `WEB=true`.
- Verification evidence on 2026-06-06: after `npm ci --ignore-scripts --audit=false --fund=false` inside `vitests`, `on-demand-resolver.test.ts` and `engine-source-runtime.probe.test.ts` must pass under the four `COCOS_CLI_TEST_*` environment variables.

### Task 8.5: 对齐 P6 engine-source Vitest 参考方案

**Files:**
- Read: `F:\ps_copy\p6\trunk\Project\GameClient\Client-ai_master\tests\vitest.config.ts`
- Read: `F:\ps_copy\p6\trunk\Project\GameClient\Client-ai_master\tests\shared\cocos-cc-source-entry.ts`
- Read: `F:\ps_copy\p6\trunk\Project\GameClient\Client-ai_master\tests\shared\cocos-cli-editor-library-adapter.ts`
- Read: `F:\ps_copy\p6\trunk\Project\GameClient\Client-ai_master\tests\shared\setup-engine-env.ts`
- Read: `F:\ps_copy\p6\trunk\Project\GameClient\Client-ai_master\tests\shared\pal-wasm.ts`
- Modify: `vitests/vitest.config.ts`
- Modify: `vitests/shared/cocos-cc-source-entry.ts`
- Modify: `vitests/shared/setup-engine-env.ts`
- Modify: `vitests/shared/pal-*.ts`
- Modify/Create: `vitests/shared/*external*`
- Modify: `docs/dev/runtime-preview-architecture-facts-20260606.md`

- [ ] **Step 1: 写 P6 对齐清单**

在 `docs/dev/runtime-preview-architecture-facts-20260606.md` 增加 “P6 engine-source Vitest 参考方案” 小节，记录：

- P6 使用 `cocos-engine-source-typescript-transform` 编译 engine `.ts`，`experimentalDecorators=true`、`target=ES2015`、`useDefineForClassFields=false`。
- P6 的 `cc` 入口不是手写 mock，而是从 engine `exports/base`、`exports/2d`、`exports/graphics`、`exports/animation`、`exports/ui` 等真实源码 re-export。
- P6 将 `internal:constants`、`internal:native`、`pal/*`、`external:emscripten/*` 作为 host boundary 或 native artifact boundary。
- P6 的 `cocos-cli-editor-library-adapter.ts` 通过真实 `assetManager`、`resources`、engine `downloader` 注册 Node 文件读取 handler，不 mock `resources.load`、`Bundle`、`parser`、`factory`。
- P6 业务测试常量为 `TEST=true`、`PREVIEW=false`；runtime preview probe 必须保留 current engine preview 事实，使用 `PREVIEW=true`、`TEST=false`。复用 P6 harness 结构，不照抄 P6 常量语义。

Expected:

- 每一条 harness 决策都能指向 P6 文件或 current engine source。
- 不得把 P6 的业务测试 mock 直接迁移成 runtime preview 的加载语义。

- [ ] **Step 2: 收敛 `cc` source entry**

按 P6 模式改造 `vitests/shared/cocos-cc-source-entry.ts`：

- 优先从 current engine 的 `exports/*` 或已确认的精确模块入口 re-export。
- 禁止为了拿一个 class 直接 re-export 大范围目录 index，除非已经确认它不会拉入无关 wasm/native/renderer 链。
- 如果引入 `SpriteFrame`、`Texture2D`、Spine、UI 等能力，必须记录它们拉入的额外 engine source / external artifact。
- 不得 mock `assetManager`、`resources`、`Bundle`、`Config`、`parser`、`factory`、`Asset`、`JsonAsset`、`Texture2D`、`SpriteFrame`。

Expected:

- `engine-source-runtime.probe.test.ts` 仍通过。
- 若新增 external/PAL 需求，必须先分类为 host boundary，并写入事实文档。

- [ ] **Step 3: 对齐 external/PAL/DOM host boundary**

按 P6 参考处理 host boundary：

- `external:emscripten/meshopt/*` 可使用 P6 的 `meshopt-decoder-factory.ts` / `external-wasm-url.ts` 模式，或映射 current engine `native/external/emscripten` 中真实 artifact；必须说明选择原因。
- `external:emscripten/spine/*` 优先映射 engine `native/external/emscripten/spine/*` 的真实 `.js` artifact，`.wasm` / `.mem` URL 可按 P6 返回 external URL 字符串。
- `pal/wasm` 优先按 P6 模式实现 `fetchBuffer()` 从 engine `native/external/emscripten` 读取真实 wasm；不得用空实现掩盖需要 wasm 的加载分支。
- `setup-engine-env.ts` 应提供 TextEncoder/TextDecoder、canvas context、document element 等 host 边界；这些只能服务 engine runtime 环境，不得替代资源加载 public API。

Expected:

- Host boundary 清单可审计。
- 所有 stub 都只位于 IO / DOM / PAL / native external 层。

- [ ] **Step 4: 明确 engine 修改门槛**

在计划和事实文档中写明：

- 本阶段默认不修改 `D:\workspace\engines\cocos\3.8.6`。
- 如果 Vitest 引入真实 engine source 或 `resources.load` probe 失败，优先判断是 test harness、host boundary、artifact mapping、CLI runtime context/settings/on-demand resolver 缺口，不能直接提出 engine patch。
- 只有满足以下条件才允许提出 engine 修改：
  - current engine source 证明 runtime preview 必需能力缺失或行为错误；
  - 有稳定失败复现；
  - 已排除 CLI/server/runtime context/test host boundary 问题；
  - 写出 engine patch 的影响范围和替代方案；
  - 等用户确认后再执行。

- [ ] **Step 5: 关键节点审核**

派资深子代理只读审核 Task 8.5：

- P6 参考是否被正确理解；
- `cc` entry 是否过宽或过窄；
- `internal:constants` 是否区分了 P6 business test 语义和 runtime preview 语义；
- external/PAL/DOM stub 是否只限 host boundary；
- 是否存在未经确认的 engine 修改方向。

Expected:

- 审核通过后才能继续 Task 9。
- 若审核指出 Important/Critical 问题，必须先修正计划和 harness。

### Task 9: Frozen editor output vs CLI AssetDB output consistency

**Files:**
- Create: `vitests/suites/runtime-preview/editor-cli-output-consistency.test.ts`
- Modify: `docs/dev/runtime-preview-architecture-facts-20260606.md`
- Modify: `docs/dev/runtime-preview-cli-design-20260606.md`

- [ ] **Step 1: Write representative consistency tests**

The test must compare frozen editor outputs and CLI AssetDB outputs on representative samples, not by scanning every file at production startup:

- `library` metadata files exist and have compatible top-level shapes：`.assets-data.json`、`.assets-info1.0.0.json`、`.assets-dependency.json`。
- internal metadata files exist and have compatible top-level shapes。
- sampled `asset.library` paths from editor metadata exist under frozen editor `library`。
- sampled CLI AssetDB `asset.library` paths exist under CLI/project `library`。
- for matched uuid samples, serialized JSON/native-like file count and `meta.files` semantics are equivalent or the difference is documented。
- `script2library` / `dependScripts` / preview `temp/programming` records can connect a script uuid to a real programming artifact。
- output differences are reported as generated-output shape, runtime URL contract, or test fixture issue.

- [ ] **Step 2: Run test before `resources.load` probe**

Expected:

- PASS for already-compatible shape.
- FAIL with exact uuid/path diagnostics for incompatible CLI-generated output.
- Do not continue to Task 9.5 until incompatibilities are classified or explicitly accepted as test-only gaps.

- [ ] **Step 3: Document divergence handling**

When CLI AssetDB output differs from frozen editor output:

- first identify whether the difference is generated-output shape, runtime URL contract, or test fixture issue;
- prefer editor-generated semantics when engine preview expects editor output;
- implement adaptation through current CLI APIs/output generation where possible;
- do not copy frozen editor files into production as a workaround.

### Task 9.5: Filesystem-base `resources.load` parser probe against frozen editor library

**Files:**
- Create: `vitests/shared/editor-library-bundle.ts`
- Create: `vitests/suites/runtime-preview/editor-library-resources-load.probe.test.ts`
- Modify: `docs/dev/runtime-preview-architecture-facts-20260606.md`

- [ ] **Step 1: Build bundle adapter from metadata**

Implement `editor-library-bundle.ts` so it reads:

- `.assets-data.json`
- `.assets-info1.0.0.json`
- `.assets-dependency.json`
- `.internal-data.json`
- `.internal-info1.0.0.json`

It must output a bundle config compatible with engine `assetManager.loadBundle()` / `resources.load()` expectations.

- [ ] **Step 2: Implement P6-style editor library adapter**

参考 P6 `tests/shared/cocos-cli-editor-library-adapter.ts`，但按本项目 frozen artifact 路径和 runtime preview 语义调整：

- 使用 `COCOS_CLI_TEST_EDITOR_LIBRARY_REF`，不得硬编码项目绝对路径。
- 读取 `.assets-data.json` 查找 `db://assets/resources/*` 资源和 `value.depends` / `dependScripts`。
- 用真实 engine `js.getClassId(ctor)` 填充 bundle config `paths[uuid] = [resourcePath, classId]`，不要手写 class id。
- 用真实 `resources.init()` 注册 `resources` bundle。
- 用真实 engine `downloader.register()` 注册 Node 文件读取 handler；handler 只负责 `.json`、图片、`.atlas`、`.plist`、`.bin`、`.skel` 等文件 IO。
- `assetManager.init()` 的 `importBase/nativeBase` 在本任务中可指向 frozen library root 的 normalized filesystem path；该 probe 只证明 engine downloader/parser 与 frozen editor library 产物兼容，不能作为 HTTP route contract 的 URL 来源。
- 子资源和依赖 uuid 必须从 `.assets-data.json` 的 `value.depends` 递归收集，不能只用 `.assets-info.map`。
- `/query-extname/<uuid>` 如被 current engine preview 分支请求，只能由 AssetDB/library metadata 回答 import payload extension，不能用于 import/native 映射猜测。

Expected:

- Adapter 保留真实 engine `assetManager/resources/Bundle/parser/factory`。
- Adapter 只替换 host IO。

- [ ] **Step 3: Write probe cases**

At minimum cover:

- one `JsonAsset` or serialized `.json`;
- one texture/image path;
- one `SpriteFrame` if metadata exposes it;
- one `.ttf`;
- one `.plist` or AutoAtlas if metadata exposes it;
- one Spine `.atlas`/`.json` pair if metadata exposes it.

- [ ] **Step 4: Run probe**

Expected:

- Real `resources.load` reaches engine downloader/parser.
- Any unsupported host boundary is documented separately.
- Failures are not hidden by replacing Cocos public APIs with mocks.
- The probe uses runtime preview browser semantics, not engine unit-test semantics: `PREVIEW=true` and `TEST=false` intentionally enable current engine `editor-path-replace.ts`.
- If engine requests `/query-extname/<uuid>`, that request is a source-backed preview behavior. The test/server fixture may answer it from AssetDB/library metadata, but must not use it as a replacement for engine/settings/bundle config/request-path derived import/native resolution.
- This filesystem-base probe must not export captured URLs to Task 12; filesystem URLs are not preview server HTTP route facts.
- If a failure suggests changing engine source, stop and apply Task 8.5 Step 4 gate before any engine edit.

### Task 9.75: HTTP-base engine URL capture probe

**Files:**
- Create: `vitests/suites/runtime-preview/http-url-capture.probe.test.ts`
- Modify: `vitests/shared/editor-library-bundle.ts`
- Modify: `docs/dev/runtime-preview-architecture-facts-20260606.md`

- [ ] **Step 1: Write HTTP-base capture probe**

The probe must initialize engine runtime with preview HTTP semantics:

- `serverURL` points to a local in-test HTTP fixture.
- settings and bundle config use HTTP `importBase` / `nativeBase` values produced from the same settings path intended for runtime preview.
- the HTTP fixture records every requested URL and returns files only through the same on-demand resolver interface planned for production.
- no request URL is hand-written except fixed entry routes such as `/settings.js` and bundle `config.json`; asset import/native/pack/redirect URLs must come from engine transform or `resources.load`.

- [ ] **Step 2: Capture representative runtime URLs**

At minimum capture when present:

- import payload URL;
- native dependency URL;
- pack URL;
- redirect bundle URL;
- `/query-extname/<uuid>` request;
- scripting URL if script loading is triggered.

- [ ] **Step 3: Persist captured request facts for Task 12**

The test should expose `capturedRuntimeUrls` as a fixture object for HTTP contract tests. Each captured URL must include:

- original request URL;
- route category;
- source operation, such as `resources.load('...')` or engine transform input;
- expected artifact kind, if known from engine metadata;
- whether the URL came from HTTP-base probe or filesystem-base probe.

Expected:

- Only HTTP-base captured URLs can be used as primary route contract inputs.
- Filesystem-base URLs are rejected as HTTP contract inputs.
- If a representative URL cannot be captured, record the missing source operation and leave that case out with a diagnostic; do not replace it with a guessed URL.

### Task 10: Script/import-map/dependScripts probe

**Files:**
- Create: `vitests/suites/runtime-preview/script-runtime-map.test.ts`
- Modify: `src/runtime-preview/programming/resolve-programming-request.ts`

- [ ] **Step 1: Write script map test**

The test must assert:

- preview `import-map.json` exists;
- chunks referenced by the import map exist;
- `main-record.json` and `assembly-record.json` are readable;
- at least one `System.register` chunk can be located;
- `.assets-data.json` or AssetDB query yields at least one scene/prefab sample with `dependScripts`;
- that `dependScripts` sample is connected to script uuid, `script2library`, or preview programming records.

- [ ] **Step 2: Run test before implementation**

Expected:

- FAIL until `resolveProgrammingRequest()` and its supporting preview programming context expose import map, records, chunks, and module lookup.

- [ ] **Step 3: Implement preview programming resolver/context**

Implementation must not parse chunks with regex for business semantics except to detect `System.register` presence. Prefer JSON records/import-map for module relationships.

### Task 11: Settings and bundle config generation

**Files:**
- Create: `src/runtime-preview/settings/preview-settings-provider.ts`
- Create: `vitests/suites/runtime-preview/settings-generation.test.ts`
- Modify: `docs/dev/runtime-preview-architecture-facts-20260606.md`

- [ ] **Step 1: Write settings tests from CLI, old editor, and engine facts**

The tests must assert:

- settings include the fields consumed by engine runtime;
- bundle configs include `importBase` and `nativeBase` only as engine expects;
- `script2library` or equivalent script runtime map exists for project scripts;
- `src/core/builder/index.ts#getPreviewSettings()` behavior is represented or deliberately delegated to;
- settings generation failure for one asset does not erase unrelated bundle/script data.
- settings generation does not execute normal build output copy, plugin build hooks, full asset copy, or full build pipeline.
- settings generation emits timing diagnostics and fails with a clear timeout diagnostic when it exceeds the configured budget.

- [ ] **Step 2: Implement settings generation**

Use CLI builder/AssetDB APIs where available. If a field is generated manually, document the exact source fact proving it in `docs/dev/runtime-preview-architecture-facts-20260606.md`.

Implementation entry is `PreviewSettingsProvider`; do not create a second settings generator module with overlapping responsibilities.

- [ ] **Step 3: Produce HTTP-consumable outputs**

The task must return or persist these objects for Task 12:

- `settingsJsSource`
- `bundleConfigs`
- `scriptRuntimeMap`
- `assetBaseConfig`
- `capturedRuntimeUrls` from Task 9.75 HTTP-base engine URL capture probe

Expected:

- Task 12 can generate HTTP requests from these outputs and Task 9.75 captured URLs without inventing temporary settings or bundle config.
- Resolvers are assembled by `RuntimePreviewContext` / server route wiring, not returned by `PreviewSettingsProvider`.

### Task 12: Fact-backed on-demand HTTP contract

**Files:**
- Create: `src/runtime-preview/server/runtime-preview-routes.ts`
- Create: `src/runtime-preview/server/serve-on-demand-file.ts`
- Create: `vitests/suites/runtime-preview/http-contract.test.ts`

- [ ] **Step 1: Write HTTP contract tests using Task 11 outputs**

The tests must generate requests from real engine transform output or Task 9.75 HTTP-base captured runtime URLs, not from hand-written `/assets/main/import/foo` assumptions. If a URL cannot be captured yet, the test must explain the missing engine path and skip only that case with a diagnostic; it must not replace it with a guessed URL.

Required assertions:

- `/settings.js` returns JavaScript assigning `window._CCSettings`.
- bundle `config.json` route returns `bundleConfigs` from the runtime context.
- captured import payload URL maps to an existing project/internal library file by request-time resolver.
- captured native dependency URL maps to an existing project/internal library file by request-time resolver.
- captured pack URL and redirect URL cases are covered when Task 9.75 records them.
- import/native route category comes from the request path and engine/bundle config facts, not from extname guessing.
- script route maps through `script2library` or preview programming resolver to a real programming artifact.
- startup does not recursively scan `libraryRoot` or `programmingRoot`; the test should assert the resolver is called per request.
- unknown URL returns `404` with diagnostic context.

- [ ] **Step 2: Implement routes**

Routes may mirror old editor route names only when engine/runtime facts require them. The file lookup must be:

```text
runtime URL -> route fact source -> normalized request tail -> on-demand resolver -> absolute artifact path -> sendFile
```

Do not implement:

```text
runtime URL -> extname guess -> import/native directory guess -> sendFile
startup scan -> global file index -> guessed URL mapping
```

### Task 13: CLI integration

**Files:**
- Create: `src/runtime-preview/index.ts`
- Create: `src/runtime-preview/server/runtime-preview-server.ts`
- Modify: `src/commands/preview.ts`
- Modify: `src/core/launcher.ts`
- Create: `vitests/suites/runtime-preview/cli-startup.test.ts`

- [ ] **Step 1: Write startup test**

Assert:

- `preview --runtime --host 127.0.0.1 --port 19530 --scene <uuid>` starts runtime preview server;
- test startup resolves engine root, project root, library root, and programming root from explicit test injection:
  - `COCOS_CLI_TEST_ENGINE_ROOT`
  - `COCOS_CLI_TEST_PROJECT_ROOT`
  - `COCOS_CLI_TEST_EDITOR_LIBRARY_REF`
  - `COCOS_CLI_TEST_EDITOR_PROGRAMMING_REF`
- production startup resolves engine root from existing `GlobalPaths.enginePath` / project configuration unless an explicit CLI option is added and documented;
- server health route returns 200;
- shutdown releases the port;
- startup logs include project root, engine root, library root, programming root.

- [ ] **Step 2: Implement startup**

Reuse old implementation only for lifecycle patterns that survived Task 5 classification.

### Task 14: Browser smoke as final integration

**Files:**
- Create: `vitests/suites/runtime-preview/browser-smoke.test.ts` or Playwright smoke if Browser plugin is used
- Modify: `docs/dev/runtime-preview-architecture-facts-20260606.md`

- [ ] **Step 1: Start server in background with cleanup**

Use a background process and record PID/log path. Do not leave foreground sessions running.

- [ ] **Step 2: Request smoke endpoints**

Check:

- `/settings.js`
- one bundle config route
- one engine/settings/request-derived serialized JSON URL
- one engine/settings/request-derived native-like URL
- one scripting chunk route

- [ ] **Step 3: Open browser only after HTTP smoke passes**

Expected:

- No startup `settings` failure.
- No representative asset/script `404`.
- Browser smoke is final validation, not the first feedback loop.

---

### Task 15: 补齐 review gate 阻塞验证

**Files:**
- Modify: `vitests/suites/runtime-preview/editor-cli-output-consistency.test.ts`
- Modify: `vitests/suites/runtime-preview/settings-generation.test.ts`
- Modify: `vitests/suites/runtime-preview/http-contract.test.ts`
- Modify/Create: `vitests/suites/runtime-preview/launcher-runtime-preview.test.ts`
- Modify/Create: `vitests/shared/*`
- Modify: `src/runtime-preview/server/runtime-preview-routes.ts`
- Modify: `src/runtime-preview/library/resolve-library-request.ts`
- Modify: `src/core/launcher.ts`

- [ ] **Step 1: 真实 CLI output consistency**

`editor-cli-output-consistency.test.ts` 必须从当前 CLI AssetDB/library/programming output 或可复现的 CLI generation path 取事实，不能再把 `cli-output-not-generated-yet` 当作通过状态。

最低覆盖：

- frozen editor library 与 CLI output 的 `.assets-data.json` / `.assets-info1.0.0.json` shape。
- representative `asset.library`、`meta.files`、`value.dependScripts`。
- frozen `temp/programming` 与 CLI script output 的 `import-map.json`、`main-record.json`、`assembly-record.json`、chunk path。

如果 CLI output 尚未生成或 shape 不一致，测试必须失败或输出明确 diagnostic，并在 facts 文档记录差异分类：`generated-output shape`、`runtime URL contract` 或 `test fixture issue`。

- [ ] **Step 2: 真实 `getPreviewSettings()` E2E**

`settings-generation.test.ts` 必须增加真实/default `PreviewSettingsProvider` 路径验证，覆盖 `getPreviewSettings()` 输出被 provider 消费。mocked `loadPreviewSettings` 只保留用于 timeout/cache 单元测试。

最低覆盖：

- `settings`、`bundleConfigs`、`script2library` 来自真实 CLI preview settings path。
- 证明 preview settings path 不执行 normal build output copy、plugin build hooks、全量 asset copy 或完整 build pipeline。可以通过 source-level instrumentation、spy、diagnostic hook 或 stable side-effect check 实现。
- 真实输出必须可作为 Task 12 HTTP contract input。

- [ ] **Step 3: production asset route fact source**

修正 production `preview --runtime` asset route 事实来源。真实 CLI server 不能依赖 test-only injected `capturedRuntimeUrls` 才能服务 asset URL。

可选设计必须先基于 facts 选择：

- 由真实 `getPreviewSettings()` / `bundleConfigs` / AssetDB metadata 生成精确 allow list。
- 或由 engine HTTP-base capture fixture 产出的 facts 注入到 integration test，而 production route 仍只接受 engine/runtime 已产生的请求。

禁止：

- 根据 URL 形状直接放行所有 `/assets|remote/<bundle>/import|native/<tail>`。
- startup 全量扫描 `library` 或 `temp/programming` 建立全局 URL/file index。

- [ ] **Step 4: HTTP contract 消费真实 outputs**

`http-contract.test.ts` 必须消费 Task 11/15 Step 2 的真实 settings output，以及 Task 9.75/15 Step 5 的 HTTP-base captured runtime URLs。手写 settings/bundleConfigs 只能用于最小 route unit test，不能作为主 contract。

最低覆盖：

- `/settings.js` 来自真实 provider output。
- `/assets/<bundle>/config.json` 来自真实 bundle config。
- captured import/native requests 只来自 HTTP-base engine runtime URL。
- 未捕获但形态相似的 asset/native/remote URL 返回 404。
- production startup 不做 full scan。

- [ ] **Step 5: 扩展 HTTP-base URL capture**

`http-url-capture` 必须覆盖除 JsonAsset import 外的 representative runtime requests：

- native dependency request。
- pack URL，如当前项目/runtime facts 能触发。
- redirect/shared bundle URL，如当前项目/runtime facts 能触发。
- 如果当前项目无法触发某类 URL，必须以 diagnostic skip 记录 source operation 和缺失原因，不能用手写近似 URL 替代。

- [ ] **Step 6: 扩展 filesystem-base `resources.load` parser probe**

`editor-library-resources-load.probe.test.ts` 必须从 frozen editor library 选择 representative samples，覆盖：

- `JsonAsset`。
- ImageAsset / Texture2D / SpriteFrame dependency chain。
- TTF。
- Plist / AutoAtlas。
- Spine `.atlas` / `.json`，如果 frozen 项目存在样本。

失败时优先诊断 test harness、host boundary、artifact mapping、settings/on-demand resolver；不能直接提出 engine patch。

- [ ] **Step 7: 真实 CLI/Launcher startup smoke**

新增或改造 startup 测试，覆盖 `PreviewCommand -> Launcher.startRuntimePreview() -> startRuntimePreviewServer()` 或至少 `Launcher.startRuntimePreview()`。

最低覆盖：

- `preview --runtime --host --port --scene` 参数进入 runtime preview path。
- project root、engine root、library root、programming root 使用 production resolution；测试 env override 只用于 fixture path。
- `/settings.js`、representative asset URL、script route 在真实 server 上可请求。
- 端口释放。

- [ ] **Step 8: 清理测试命名和旧 manifest 草稿**

- 将 `browser-smoke.test.ts` 改名为 `pre-browser-http-smoke.test.ts`，真正 browser/page route 完成后再新增 browser smoke。
- 删除 `src/runtime-preview/manifest/**`，或迁移到 test-only/reference 并保证 production `src/runtime-preview/**` 不可引用旧 full-manifest / recursive `walkFiles()` 方向。

Run:

```powershell
rtk powershell -NoProfile -Command "$env:COCOS_CLI_TEST_PROJECT_ROOT='E:\own_space\cocos_work_lab_38x'; $env:COCOS_CLI_TEST_ENGINE_ROOT='D:\workspace\engines\cocos\3.8.6'; $env:COCOS_CLI_TEST_EDITOR_LIBRARY_REF='E:\own_space\engines\cocos-cli\.codex-tmp\reference-library\cocos_work_lab_38x-editor-library-20260606'; $env:COCOS_CLI_TEST_EDITOR_PROGRAMMING_REF='E:\own_space\engines\cocos-cli\.codex-tmp\reference-temp\cocos_work_lab_38x-editor-programming-20260606'; npm --prefix vitests test -- --passWithNoTests"
```

Expected:

- `vitests` 全量通过。
- 不再有把必须验证的 runtime loading flow 写成 `todo` 后仍算通过的情况；确实无法触发的 native/pack/redirect 用 diagnostic skip 标明原因。
- production `preview --runtime` 真实启动路径能服务 representative settings、asset、script endpoints。

## Completion Criteria

- `docs/dev/runtime-preview-architecture-facts-20260606.md` contains source-backed facts and no unsupported URL assumptions.
- `docs/dev/runtime-preview-cli-design-20260606.md` records CLI runtime preview architecture, route fact sources, performance boundary, and editor/CLI output consistency strategy.
- `docs/dev/runtime-preview-old-implementation-review-20260606.md` classifies old CLI and engine backup implementation.
- `vitests` exists and does not modify the existing Jest setup.
- Tests use `COCOS_CLI_TEST_*` environment variables, not hardcoded local paths.
- Production startup path does not recursively scan `library`、`temp` or build a global URL/file index.
- On-demand resolver, engine-source probe, real editor/CLI output consistency, filesystem-base `resources.load` parser probe, HTTP-base URL capture probe, script map probe, real settings generation, fact-backed HTTP contract, and real CLI/Launcher startup tests pass before browser smoke.
- Browser smoke is run only after short-link tests pass and a root preview page route exists.
