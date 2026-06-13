# Build 问题台账

本文记录 normal build 相关问题。runtime preview 专题问题仍记录在 `docs/dev/runtime-preview/issues.md`。

## 状态定义

| 状态 | 含义 |
| --- | --- |
| `open` | 已有可重复事实，仍需处理。 |
| `fact-gap` | 事实不足，不能用猜测推进。 |
| `deferred` | 已记录，但当前阶段不处理。 |
| `fixed` | 已有实现和验证证据。 |

## 当前问题

| ID | 问题 | 状态 | 当前结论 | 事实入口 | 处理方向 |
| --- | --- | --- | --- | --- | --- |
| BUILD-ISSUE-001 | normal build 在 `Package scripts` 阶段被 TypeScript 静态检查阻塞 | `fixed` | 已移除 `ScriptBuilder.buildBundleScript()` 中对 `runStaticCompileCheck()` 的 hard fail 调用。复跑 normal build 后，不再出现 Tiled tileset XML `.tsx` 被 TypeScript 当 TSX 源码解析的 `TS1109`、`TS1005` 阻塞；构建已进入真正的 `buildScriptCommand` worker。 | [../build-extension-hooks-20260612.md](../build-extension-hooks-20260612.md) | 不手工修改 `temp/cli/tsconfig.cocos.json`。后续若要恢复静态检查，必须改为 asset-aware 或 report-only，不能再用 broad `assets/**/*` 作为 build hard gate。 |
| BUILD-ISSUE-002 | normal build 在真正脚本打包阶段无法解析 `db://localization-editor/l10n` | `fixed` | 去掉静态检查后曾失败于 `db://localization-editor/l10n`。用户安装 `localization-editor` 后，CLI build 已能通过 extension AssetDB mount 解析该 domain，`debug.log` 中可见其解析到 `extensions/localization-editor/static/assets/l10n.ts`；最新复跑的 fatal blocker 已转移到 `db://automation-framework/runtime/test-framework.mjs`。 | [../build-extension-hooks-20260612.md](../build-extension-hooks-20260612.md) | 保留为事实记录。后续关注点不是 `localization-editor` domain 本身，而是 CLI build 启动时对项目 `library` 的 AssetDB 副作用，以及其他 Editor package domain 是否也需要同类加载机制。 |
| BUILD-ISSUE-003 | normal build 无法解析 `db://automation-framework/runtime/test-framework.mjs` | `open` | 使用项目 `web-mobile` 配置复跑时，构建仍失败于 `Package scripts`。fatal error 来自 `assets/auto-test-case/dynamic/2D/2d-rendering-in-3d.test.ts` import `db://automation-framework/runtime/test-framework.mjs`，worker 最终尝试打开 `E:\own_space\engines\cocos-cli\db:\automation-framework\runtime\test-framework.mjs` 并得到 `ENOENT`。当前项目 `extensions` 下只有 `localization-editor` 和 `ViewStateGroup`，没有发现 `automation-framework` extension mount。 | [../build-extension-hooks-20260612.md](../build-extension-hooks-20260612.md) | 需要核对 Editor 成功构建时 `automation-framework` 的来源：是项目 extension、Creator package、engine/editor 内置 package，还是用户环境中的额外 package。CLI 若要对齐 Editor，需要显式加载并注册该 package 的 `asset-db` domain；否则只能通过排除相关测试脚本或让项目补齐 extension 来绕过。 |
| BUILD-ISSUE-004 | `--build-config` 不能等价使用 Creator profile `profiles/v2/packages/web-mobile.json` | `fixed` | 已新增 Creator profile adapter。`web-mobile.json` 中多数 `builder.common` 字段与 CLI common build options 同名且语义基本对得上；`builder.taskOptionsMap.<taskId>` 中的 `useWebGPU`、`orientation`、`embedWebDebugger` 与 `packages["web-mobile"]` 的叶子字段同名且语义对得上。当前实现会 flatten `builder.common`，将选中的 task options 写入 `packages[platform]`，并保留原有 `pluginManager.checkOptions()` 校验。最新复跑 `node .\dist\cli.js build --project ... --platform web-mobile --build-config profiles\v2\packages\web-mobile.json` 退出码为 `0`。 | [../build-extension-hooks-20260612.md](../build-extension-hooks-20260612.md) | 多 task profile 需要显式 `--taskId`；该修复只覆盖本次确认的 Creator build profile adapter，不表示所有 Creator profile package schema 都已完整兼容。 |
| BUILD-ISSUE-005 | 普通 build 产物在浏览器中因 unresolved CommonJS bare specifier 触发 host `require()` | `fixed` | 修复前，`assets/cases/scripting/commonjs-bare-specifier/commonjs-bare-specifier.js` 中的 `require('@tbmp/mp-cloud-sdk')` 会在浏览器运行时报 `Current environment does not provide a require()`。原因是普通 build 使用的 `@cocos/creator-programming-rollup-plugin-mod-lo` fallback 只导出 `__cjsMetaURL = '@tbmp/mp-cloud-sdk'`，后续 CJS loader 仍会走 host `require()`。当前已将普通 build 和 runtime preview fallback 统一为浏览器可加载的空 CJS module，fresh tab 打开 `codex-cjs-fallback-fixed` 产物时同端口 warning/error console 日志为 `0`，该 require error 数量为 `0`。 | [../build-extension-hooks-20260612.md](../build-extension-hooks-20260612.md) | 该修复是 unresolved bare specifier 的容错 fallback，不提供 `@tbmp/mp-cloud-sdk` 的真实实现。若业务实际依赖该 SDK 行为，仍需通过 import map、真实依赖或平台注入解决。 |
| BUILD-ISSUE-006 | CLI 生成的 `cocos.config.json` 可能滞后于 Editor 修改后的项目配置 | `deferred` | 初步源码核查显示，`ConfigurationManager.initialize()` 会读取项目根目录 `cocos.config.json`，只在 CLI 配置版本落后时从 `settings/v2/packages/*.json`、`profiles/v2/packages/*.json` 等 Creator 配置执行迁移；如果 `cocos.config.json` 已存在且版本为当前 `1.0.0`，Editor 后续修改项目配置后，CLI 再打开/构建不会自动重写该文件。该行为解释了用户反馈的“用 CLI 打开后，再用 Editor 改配置，`cocos.config.json` 仍是旧的”。 | `src/core/configuration/script/manager.ts`；`src/core/configuration/migration/cocos-config-loader.ts`；用户反馈 2026-06-13 | 后续处理前需要先确定 production 策略：不生成该文件、每次 CLI 初始化强制从 Creator settings 重写，还是基于 settings/profile mtime 或显式 remigrate 触发更新。不能在未确认策略时直接改变初始化默认行为。 |
| BUILD-ISSUE-007 | CLI build/AssetDB 可能改写项目级 `library` JSON，导致 Editor 后续无法打开项目 | `fact-gap` | 用户反馈流程为：先用 Editor 打开项目，再用 CLI 打开/构建，然后 Editor 无法再次打开；怀疑 CLI 改写了 `E:\own_space\engines\cocos-test-projects\library\.assets-data.json`、`.internal-data.json` 等同级 JSON。源码事实是 `Launcher.build()` 会先执行 `Launcher.import()`，进而启动 AssetDB；当前 `assets` DB 写入 `library/cli`，`internal` DB 写入项目级 `library`。用户提供的备份目录 `.codex-tmp/bak_test_projects_library_data_json` 与当前测试项目 `library` 顶层同名 JSON hash 一致，因此现有磁盘状态尚不能证明 CLI 已在备份之后改写这些文件。 | `src/core/launcher.ts`；`src/core/assets/asset-config.ts`；`.codex-tmp/bak_test_projects_library_data_json`；用户反馈 2026-06-13 | 暂不处理。后续需要用受控复现确认：记录 Editor 打开后的 `library` 顶层 JSON hash，运行 CLI build/open，再比较 hash、文件命名、关键 JSON shape 和 Editor 打开失败日志。确认根因前不能把测试缓存或一次历史目录状态反向作为 production 策略依据。 |

## 记录规则

- 事实证据应写入对应 `facts/` 或专题事实文档，再从本台账引用。
- 不能把测试缓存、临时配置或手工修改 `temp` 文件作为 production 默认策略依据。
- 修改方案必须说明是否会阻塞 normal build，以及与 Editor / AssetDB / `@cocos/lib-programming` 行为的关系。
