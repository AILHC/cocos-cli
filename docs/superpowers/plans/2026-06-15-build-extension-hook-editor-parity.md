# 项目 build extension hook Editor parity 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 处理 `BUILD-ISSUE-014`：让 CLI normal build 支持项目内 Cocos extension builder hook，并用主测试项目中的裁剪版 `build-ex` fixture 验证 Editor extension builder contract。该计划不迁移 `feature-c/build-ex` 的业务发布逻辑，不重新处理 `wechatgame` 平台 parity。

**Architecture:** CLI 实现一个 Editor-like project extension builder host，而不是内置 `feature-c/build-ex` 业务适配器。抽出项目 extension package discovery，复用给 AssetDB mount 与 builder hook 注册；`PluginManager` 读取 `<projectRoot>/extensions/*/package.json` 的 Editor schema `contributions.builder`，加载 builder entry，注册 `configs["*"]` 与 `configs[platform]` 的 public hooks 和 package options。hook 执行沿用 CLI builder 现有 `runPluginTask()` 生命周期，但项目 extension 必须是 public hook，不得被当作 internal platform hook。裁剪版 `build-ex` fixture 不是空壳，必须用真实 Editor extension builder 结构和最小可审计 output side effects 验证 discovery、配置合并、hook 顺序、错误传播、产物写入和运行结果。

**Tech Stack:** Node.js, TypeScript, Cocos CLI builder, Cocos Creator extension `contributions.builder`, Jest/Vitest, PowerShell, in-app Browser。

---

## 文档归属

- Build 专题入口：`docs/dev/build/README.md`
- 既有 build hook 事实记录：`docs/dev/build-extension-hooks-20260612.md`
- Build 问题台账：`docs/dev/build/issues.md` 中 `BUILD-ISSUE-014`
- `wechatgame` 平台事实：`docs/dev/build/facts/wechatgame-source-inventory-20260615.md`
- Builder 稳定模块文档：`docs/dev/modules/builder.md`
- 本计划：`docs/superpowers/plans/2026-06-15-build-extension-hook-editor-parity.md`

## 执行边界

- 本计划聚焦项目内 build extension hook 接入，不重新调查 `wechatgame` `.ccc` / 平台源码 / 平台 parity。
- `wechatgame` 第一阶段事实已在 `docs/dev/build/facts/wechatgame-source-inventory-20260615.md` 记录；未完成平台高级能力已迁入 `BUILD-ISSUE-012` 和 `BUILD-ISSUE-013`。
- 本计划可以在 hook MVP 通过后用 `wechatgame` 做可选 smoke，但不得把 `wechatgame` 平台 parity 作为本计划交付条件。
- 不把 `feature-c/build-ex` 业务逻辑硬编码进 CLI；CLI 只实现通用 extension builder 接入机制。
- 裁剪版 `build-ex` fixture 只证明 Editor extension builder contract，不证明 `feature-c/build-ex` 业务迁移完成；但 fixture 不能是空壳，必须包含最小真实构建副作用：读取 `options.packages["build-ex"]`、验证 `configs["*"]` 与 `configs[platform]` 合并、写 hook report、写一个非业务 output marker、覆盖受控失败。
- fixture 不得保留 `feature-c` 私有 SDK、cfg 合并、hotupdate manifest、混淆、字体替换、资源删除、`.meta` 源资产改写等业务发布逻辑。
- `feature-c/build-ex` 中可归类为 build output 级的业务逻辑（例如复制文件、改输出目录文件、生成 manifest）应由项目 extension 自身在 hook 中实现；CLI 只提供 hook host、配置、生命周期、错误传播和输出目录访问能力。
- `feature-c/build-ex` 中依赖 `Editor.Message`、AssetDB、源资产或 `.meta` 写入的逻辑不属于本 MVP；若真实迁移需要，后续单独设计 Editor facade / AssetDB API / unsupported 边界，不能在本计划中静默 mock。
- 若 `build-ex` 依赖的 Editor API 在 CLI 中没有等价能力，先记录为不支持、替代实现或后续能力；不允许用静默 mock 掩盖。
- `assetHandlers` 不纳入 MVP 支持范围；必须有明确 unsupported 记录或测试，避免误判为已支持。
- parity 构建输入使用 Editor 导出的完整 `buildConfig_<platform>.json`；`profiles/v2/packages/<platform>.json` 只作为 profile adapter 兼容测试输入。
- 每个实现阶段完成后单独提交；提交信息说明本阶段意图。

## 已确认事实

- 当前 CLI 已有 normal build 入口，并且 build 流程会执行已注册 platform plugin hook。
- 当前 CLI 的 `PluginManager` 扫描 CLI 内置 `src/core/builder/platforms` 和 CLI workspace 下的 `packages/platforms`。
- 当前 production 代码尚未支持扫描 `<projectRoot>/extensions/*` 作为 builder hook 来源。
- 当前项目 extension 扫描主要服务 AssetDB mount，只读取 `contributions["asset-db"].mount`。
- Editor extension `build-ex` 的声明形式是 `package.json` 中 `contributions.builder: "./dist/builder.js"`，不同于 CLI platform package 的 `contributes.builder`。
- `feature-c/extensions/build-ex` 的 `source/builder.ts` 使用 `configs["*"].hooks = "./hooks"`，并声明大量 `build-ex` package options。
- `feature-c/extensions/build-ex/source/hooks.ts` 暴露 `throwError = true`，实现 `onBeforeBuild`、`onBeforeCompressSettings`、`onAfterCompressSettings`、`onAfterBuild`、`onError`、`onBeforeMake`、`onAfterMake`。
- `feature-c/build-ex` 同时包含三类逻辑：项目源资产 / `.meta` 的 `Editor.Message` 操作、build output 的平台注入、热更新 / SDK / 混淆 / cfg 合并等业务发布逻辑。
- 当前 CLI `runPluginTask()` 会 `require` hook 文件；当 hook module 暴露 `throwError` 或 hook 为 internal platform hook 时，hook error 会阻塞构建。
- `BUILD-ISSUE-011` 已确认 parity 输入应使用完整 `buildConfig_<platform>.json`，不能把 `profiles/v2/packages/<platform>.json` 当作标准构建配置。

## 待确认问题

- Editor extension builder 的 `configs["*"].options` 和 `configs[platform].options` 默认值是否在 build 时参与补齐，还是只由 Editor UI/profile 写入。
- 多个 project extension 的排序应如何对齐 Editor：按 extension package 加载顺序、package name 稳定排序，还是按某个显式 priority。
- malformed `package.json`、缺失 builder entry、缺失 hooks 文件时，Editor 是跳过、warning 还是 hard fail；CLI 需要选择明确策略并测试固定。
- `contributes.builder` 是否需要兼容；当前倾向只支持 Editor schema `contributions.builder`，避免把 CLI platform package schema 和项目 extension schema 混用。
- 是否需要提供最小 Editor facade，例如 `Editor.Project.path`；MVP 倾向不提供 facade，fixture 使用公共 `(options, result)` 入参。

## 文件职责

- Read: `docs/dev/build-extension-hooks-20260612.md`
  - 复核历史 hook 事实和 `build-ex` 记录。
- Read: `docs/dev/build/issues.md`
  - 以 `BUILD-ISSUE-014` 为本计划问题入口。
- Read reference only: `docs/dev/build/facts/wechatgame-source-inventory-20260615.md`
  - 只引用 `wechatgame` 已完成事实，不重新执行平台源码调查。
- Read/Modify after approval: `src/core/assets/manager/plugin.ts` 或新增 `src/core/extensions/project-extensions.ts`
  - 抽出 project extension package discovery。
- Read/Modify after approval: `src/core/builder/manager/plugin.ts`
  - 注册项目 extension builder entry、hooks、options。
- Read/Modify after approval: `src/core/builder/worker/builder/manager/task-base.ts` 和具体 `BuildTask` / `BundleManager` 任务
  - 必要时补齐 public hook 调用、排序、错误传播。
- Read/Modify after approval: `src/commands/build-config.ts` 或 builder 配置合并相邻模块
  - 补齐 `packages["build-ex"]`、默认值、profile/buildConfig 合并。
- Test after approval: `src/core/builder/test/*`、`tests/commands/*` 或 `vitests/suites/build/*`
  - 覆盖 discovery、注册、排序、配置、错误传播和真实构建。
- Fixture after approval: `E:\own_space\engines\cocos-test-projects\extensions\build-ex`
  - 放置裁剪后的主测试项目 build extension。

## Task 1: 事实引用校准

- [x] 复核 `docs/dev/build/issues.md` 的 `BUILD-ISSUE-014`，确认本计划只处理项目自定义 builder hook / build extension hook。
- [x] 复核 `docs/dev/build/facts/wechatgame-source-inventory-20260615.md`，记录“`wechatgame` 第一阶段已完成，本计划不重新验证平台源码或平台 parity”。
- [x] 复核 `docs/dev/build-extension-hooks-20260612.md` 中 CLI 当前 hook 机制、`build-ex` 入口和历史构建事实。
- [x] 用 CodeGraph 复核当前 `PluginManager.getHooksInfo()`、`runPluginTask()`、public/internal hook 调用路径。
- [x] 更新 `docs/dev/build-extension-hooks-20260612.md`，只补充与 `BUILD-ISSUE-014` 直接相关的事实；不搬运 `wechatgame` 平台细节。

## Task 2: 失败测试与边界测试

- [x] 新增失败测试：临时 project root 包含 `extensions/test-build-hook/package.json`，声明 `contributions.builder`，当前 CLI 不应注册该 hook。该测试先失败，证明问题存在。
- [x] 新增无 extension 边界测试：项目没有 `extensions/` 时，现有 platform hook 注册顺序和构建行为不变。
- [x] 新增 malformed package 测试：损坏 JSON、缺失 `name`、缺失 `contributions.builder` 的 extension 应按明确策略 warning/跳过或 hard fail。
- [x] 新增缺失 builder entry 测试：`contributions.builder` 指向不存在文件时的错误策略固定。
- [x] 新增缺失 hooks 文件测试：builder entry 存在但 `configs["*"].hooks` 指向不存在文件时的错误策略固定。
- [x] 新增 schema 边界测试：`contributions.builder` 支持；`contributes.builder` 默认不作为 project extension schema 支持，除非后续明确兼容。
- [x] 新增多 extension 排序测试：多个 project extensions 的 hook 顺序稳定，不依赖文件系统枚举。
- [x] 新增同名 extension 测试：两个 extension package name 相同的策略固定为 hard fail 或 deterministic warning/skip。
- [x] 新增 public hook 签名测试：project extension hook 接收 `(options, result, ...args)`，并且 `internal` 语义为 `false`。

## Task 3: Project extension discovery

- [x] 抽出 project extension package discovery，统一扫描 `<projectRoot>/extensions/*/package.json`。
- [x] discovery 层只返回 package metadata、extension root、builder entry、asset-db mount 信息；不执行业务副作用。
- [x] 现有 AssetDB mount 继续只消费 `contributions["asset-db"].mount`，行为不能回归。
- [x] builder hook 只消费 `contributions.builder`，并解析为绝对 builder entry 路径。
- [x] 对 malformed package、缺失 builder entry、重复 name 实现 Task 2 中固定的策略。
- [x] discovery 结果排序使用明确稳定规则，例如 package name + extension root 路径；若 Editor 事实不同，记录差异。

## Task 4: Builder hook 注册与执行语义

- [x] 在 `PluginManager` 或相邻 builder 初始化流程中注册 project extension builder。
- [x] 加载 builder entry，读取 `configs["*"]` 与 `configs[platform]`。
- [x] 解析 hook 文件相对路径，支持 `./hooks`、`./hooks.js` 等 Node require 常见形式。
- [x] 生成的 hook info 必须标记为 public hook，不能因为 package name 命中平台名而误判 internal。
- [x] 明确排序：内置 platform hook 仍优先；项目 extension hook 使用稳定排序；如后续发现 Editor 顺序不同，记录差异并调整。
- [x] `throwError = true` 时 hook 错误阻塞构建，错误信息包含 extension name、hook name、原始错误 message。
- [x] non-fatal hook 错误策略与 Editor 对齐；若无法确认，固定 CLI 策略并记录差异。
- [x] `onError` 触发条件明确：fatal build error 时是否调用、hook 自身错误时是否调用、non-fatal hook error 是否调用，都需要测试覆盖。

## Task 5: Extension builder options 合并

- [x] 支持或明确记录 `configs["*"].options` 与 `configs[platform].options` 默认值合并策略。
- [x] `buildConfig_<platform>.json` 中的 `packages["build-ex"]` 必须进入最终 `options.packages["build-ex"]`。
- [x] 平台特定配置覆盖通配配置的优先级固定并测试。
- [x] 命令行覆盖、完整 buildConfig、extension 默认值之间的优先级固定并测试。
- [ ] `profiles/v2/packages/<platform>.json` 只作为 profile adapter 兼容测试输入，不作为 parity baseline。
- [ ] 若 Editor 默认值只由 UI/profile 写入，CLI 不重复补默认，但必须在事实文档记录依据。

## Task 6: 裁剪版 `build-ex` fixture

- [x] 在主测试项目新增 `extensions/build-ex/package.json`，保留真实 Editor extension 入口结构：`contributions.builder: "./dist/builder.js"`。
- [x] 新增 `dist/builder.js`，保留 `configs["*"]`，并至少增加 `configs["web-mobile"]` 平台特定配置。
- [x] `options` 保留少量代表性字段：字符串、boolean、URL 或版本号，例如 `buildVersion`、`gameDebug`、`hotupdateUrl`；不接入私有 SDK。
- [x] 新增 `dist/hooks.js`，保留 `throwError = true`，实现 `onBeforeBuild`、`onBeforeCompressSettings`、`onAfterBuild`、`onError`。
- [x] fixture 覆盖 extension package name 到 `options.packages["build-ex"]` 的映射。
- [x] fixture 覆盖 `configs["*"]` 与 `configs["web-mobile"]` 的配置合并冲突。
- [x] fixture 覆盖 builder entry 到 hooks 的相对路径解析。
- [x] fixture 的 hook 必须读取 `options.platform`、`options.packages["build-ex"].buildVersion`、`options.packages["build-ex"].gameDebug`、`options.packages["build-ex"].hotupdateUrl`，并把读取结果写入 hook report；缺失时按受控错误路径失败。
- [x] fixture 的 hook 必须在 `result.dest` 下写一个最小非业务 output marker，例如 `build-ex-output-marker.json`，内容只包含 fixture 字段、platform、buildVersion 和 hook 阶段，不包含私有 SDK 或业务发布逻辑。
- [x] fixture 必须包含一个受控失败开关，例如 `options.packages["build-ex"].forceHookError`，用于验证 `throwError = true` 时 CLI build 非 0 退出、错误包含 extension name 和 hook name、`onError` 行为可观测。
- [x] fixture 不写 `.meta`，不写 `library` 顶层 internal JSON，不改项目源资产。
- [x] fixture 不复制 `feature-c` 的 `cc_obfuscated_js.json`、热更新脚本、SDK libs、cfg 合并、字体替换、asset 删除逻辑。
- [ ] `assetHandlers` 不实现；用文档或测试明确 MVP 不支持。

## Task 7: Hook report 与可观测证据

- [x] `onBeforeBuild` 记录 `platform`、`packages["build-ex"]` 关键字段、`result.dest` 可见性和执行顺序。
- [x] `onBeforeCompressSettings` 记录是否可访问 `result.settings.assets`，但不依赖具体 hash。
- [x] `onAfterBuild` 写入输出目录下的 `build-ex-hook-report.json`，并写入 `build-ex-output-marker.json`，验证 extension hook 能影响 build output，但不复制 `feature-c/build-ex` 的业务发布逻辑。
- [x] `onError` 在受控失败用例中记录错误 marker。
- [x] `build-ex-hook-report.json` 固定 schema：
  - `events[]`：hook name、extension name、platform、fatal/non-fatal 标记、顺序号。
  - `optionsSnapshot`：只记录 `platform`、`packages["build-ex"]`、fixture 相关 platform option。
  - `resultShape`：记录 `dest` 是否存在、`settings.assets` 是否可访问、可用 result API key。
  - `writes[]`：记录 hook 写入的相对路径和写入阶段。
  - `errors[]`：记录受控失败 hook name、message、是否触发 `onError`。
- [x] 动态字段白名单：时间戳、绝对路径、hash、随机输出文件名；其它字段必须可与 Editor baseline 对比。

## Task 8: Editor / CLI baseline 验证

- [ ] 参考 Cocos Creator 3.8 官方命令行发布文档：
  - `https://docs.cocos.com/creator/3.8/manual/zh/editor/publish/publish-in-command-line.html`
  - 文档事实：`--project` 指定项目路径，`--build` 指定构建参数；`configPath` 可加载 JSON 参数文件；`platform` 为必填构建平台；`buildPath` 和 `outputName` 可覆盖输出根目录和发布包目录名；退出码 `32/34/36` 分别表示参数非法、构建过程失败、构建成功。
- [ ] 优先用 Cocos Creator 编辑器命令行和完整 `buildConfig_web-mobile.json` 构建主测试项目，作为 `web-mobile` hook baseline；如果命令行环境不可用，再退回手动 Editor 构建并记录原因。
- [ ] Creator 命令行 baseline 必须输出到独立目录，避免覆盖用户已有 Editor baseline 或 CLI 输出目录。示例命令需要按本机 Creator 安装路径修正：

```powershell
rtk pwsh -NoLogo -NoProfile -Command '& "D:\cocos_editors\Creator\Creator\3.8.6\CocosCreator.exe" --project "E:\own_space\engines\cocos-test-projects" --build "stage=build;configPath=E:\own_space\engines\cocos-test-projects\buildConfig_web-mobile.json;buildPath=E:\own_space\engines\cocos-test-projects\build;outputName=editor-build-ex-hook-baseline-20260615"'
```

- [ ] 如果 Creator 命令行使用 `configPath` 后仍被同一 `--build` 字符串中的 `buildPath/outputName` 覆盖，记录该覆盖行为；若实际不覆盖，改为生成一份临时 baseline config 文件，直接在 JSON 中设置独立输出目录。
- [ ] 记录 Editor 是否执行 `build-ex` hook、hook report 位置、输出目录、构建前后 git diff。
- [ ] 记录 Editor 对 `configs["*"]` 与 `configs["web-mobile"]` 的 options 合并结果。
- [ ] 记录 `throwError` 受控失败时 Editor 是否阻塞构建，以及是否执行 `onError`。
- [ ] CLI 使用相同完整 `buildConfig_web-mobile.json` 构建独立输出目录：

```powershell
rtk pwsh -NoLogo -NoProfile -Command 'node .\dist\cli.js build --project "E:\own_space\engines\cocos-test-projects" --platform web-mobile --build-config "E:\own_space\engines\cocos-test-projects\buildConfig_web-mobile.json" --buildPath "E:\own_space\engines\cocos-test-projects\build" --outputName "codex-build-ex-hook-check-20260615"'
```

- [ ] CLI build 退出码为 `0`，hook report 与 Editor baseline 生命周期一致。
- [ ] CLI 不产生 Editor baseline 没有的源资产、`.meta` 或 `library` 顶层 JSON 差异。
- [x] 受控失败验证：`throwError = true` 时 CLI build 退出非 0，错误信息包含 extension name 和 hook name。
- [x] non-fatal 验证：关闭 `throwError` 或使用 non-fatal fixture 时，CLI 记录错误但不阻塞；如与 Editor 不一致，记录差异。
- [ ] 浏览器运行验证：

```powershell
rtk pwsh -NoLogo -NoProfile -Command 'python -m http.server 13340 --directory "E:\own_space\engines\cocos-test-projects\build\codex-build-ex-hook-check-20260615"'
```

- [ ] 用 in-app Browser 打开 `http://127.0.0.1:13340/`，页面 title 为 `Cocos Creator | test-cases`，`canvas` 存在，warning/error 中没有新增 hook 相关错误。
- [ ] 可选 smoke：在 hook MVP 通过后，用 `buildConfig_wechatgame.json` 做一次 CLI build，确认项目 extension hook 不破坏已完成的 `wechatgame` 普通构建；该 smoke 不作为 MVP 阻塞条件。

## Task 9: 文档收敛与状态更新

- [ ] 更新 `docs/dev/build-extension-hooks-20260612.md`，记录 project extension builder hook 的最终事实、边界、fixture 裁剪结论和 Editor/CLI baseline 对比结果。
- [ ] 更新 `docs/dev/build/issues.md` 中 `BUILD-ISSUE-014` 状态；只有验证闭环后才能标记 fixed。
- [ ] 若行为稳定，回填 `docs/dev/modules/builder.md`：
  - 支持的 project extension builder schema。
  - 与 platform internal hook 的差异。
  - hook 排序和错误传播。
  - 不支持或不承诺兼容的 Editor API。
  - `assetHandlers` 的 MVP 边界。
- [ ] 检查 `git diff`，确认没有误改 `wechatgame` 平台计划、`.codex-tmp`、用户项目缓存、资源 `.meta` 或无关文件。

## 验收标准

### Extension hook MVP

- CLI 支持项目内 extension builder discovery：`package.json` 的 `contributions.builder`、builder entry 相对路径、`configs["*"]` / `configs[platform]` hooks。
- CLI 的实现定位为 Editor-like project extension builder host；CLI 不内置 `feature-c/build-ex` 的 SDK、hotupdate、cfg merge、混淆、字体替换、资源删除或 `.meta` 改写业务。
- 无 `extensions/` 时现有 build 行为不变。
- malformed package、缺失 builder entry、缺失 hooks 文件、重复 extension name 的策略明确并有测试。
- `contributes.builder` 与 `contributions.builder` 的 project extension schema 边界明确并有测试。
- project extension hook 必须走 public hook 签名，`internal=false`。
- hook 排序稳定，不依赖文件系统枚举。
- `throwError=true`、non-fatal error、`onError` 触发条件均有测试覆盖。
- `buildConfig_<platform>.json` 中 `packages["build-ex"]` 与 extension builder options 合并语义明确。
- 裁剪版 `build-ex` 可由 Editor 和 CLI 执行同一生命周期 hook，并输出可 diff 的 `build-ex-hook-report.json`。
- 裁剪版 `build-ex` 必须产生最小真实 output side effects：读取 package options、记录平台配置合并结果、写 `build-ex-hook-report.json`、写 `build-ex-output-marker.json`、覆盖受控失败；只有空 hook 或只打印日志不满足验收。
- CLI `web-mobile` 构建通过，输出目录可运行，无新增 console error。
- CLI 构建后源资产、`.meta`、`library` 顶层 JSON 的变化与 Editor baseline 一致；如果 fixture 设计为不写这些位置，则 CLI 和 Editor 都不能产生相关差异。
- `BUILD-ISSUE-014` 事实、验证和状态已回填到文档。

### Fixture parity

- `build-ex-hook-report.json` 包含固定 schema：`events[]`、`optionsSnapshot`、`resultShape`、`writes[]`、`errors[]`，并定义动态字段白名单。
- fixture 覆盖 `configs["*"]` 与平台配置合并、extension package name 到 `options.packages["build-ex"]` 的映射、builder entry 到 hooks 相对路径解析、多个 project extensions 稳定排序。
- fixture 只证明 Editor extension builder contract，不证明 `feature-c/build-ex` 业务迁移完成。
- fixture 证明的是 extension host 能承载项目 extension 的 build output 级逻辑；真实 `feature-c/build-ex` 业务迁移应尽量落在项目 extension 内，而不是继续改 CLI。
- fixture 不保留 `feature-c` 私有 SDK / cfg / hotupdate / 混淆 / manifest / `.meta` 改写业务；每个删除项都有记录和理由。
- 依赖 `Editor.Message`、AssetDB、源资产或 `.meta` 写入的能力必须在文档中标为 unsupported / deferred，不能通过静默 mock 伪装为已支持。
- `assetHandlers` 不属于 MVP 时，有明确 unsupported 记录或测试，不把未覆盖误判为已支持。

## 确认后建议执行顺序

1. Task 1：事实引用校准，移除 `wechatgame` 作为前置阻塞。
2. Task 2：先写失败测试和负向边界测试。
3. Task 3：实现 project extension discovery。
4. Task 4：接入 builder hook 注册、排序、public/internal 语义和错误传播。
5. Task 5：实现 extension builder options 合并。
6. Task 6-7：新增裁剪版 `build-ex` fixture 和 hook report。
7. Task 8：执行 Editor / CLI baseline 对比和运行验证。
8. Task 9：回填事实、issue 状态和稳定 builder 文档。
