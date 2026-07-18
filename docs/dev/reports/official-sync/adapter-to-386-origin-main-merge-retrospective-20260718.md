# adapter-to-386 官方同步合并复盘

## 状态

- 复盘日期：2026-07-18
- 分支：`codex/official-sync-20260713-3b526b9d`
- `START_ADAPTER`：`c9302b35bbc7e4b2a59a838b0afa7ac5be95685b`
- `TARGET`：`3b526b9d86519df1ee5046550aaa202d860ab15d`
- `MERGE_COMMIT`：`30a13e3f03882fa02f6f06eaa3ae1d12560374b9`
- merge first parent：`c9302b35bbc7e4b2a59a838b0afa7ac5be95685b`
- merge second parent：`3b526b9d86519df1ee5046550aaa202d860ab15d`
- 结论：固定 target 已形成 merge commit，但计划尚未全部完成。本报告明确保留未验收项，不把 merge commit 等同于可 push 或最终交付完成。

## 执行基线变化

执行最初曾从旧起点 `6a02af4e50427afbc1a0c98134e5db3a3e859445` 建立 merge 现场。执行过程中 adapter 分支继续前进到 `c9302b35bbc7e4b2a59a838b0afa7ac5be95685b`，其中包含 runtime preview script output integrity 修正。旧现场因此不再是有效的最终合并基线。

处理方式不是在旧 merge 上继续堆补丁，而是保留旧结果用于对照，以新的 `START_ADAPTER=c9302b35...` 重新建立对 `TARGET=3b526b9d...` 的 no-commit merge，恢复已审查的冲突处理并重新运行相关门禁。最终 merge commit 的 parent 已机器校验，未把旧 `6a02af4e...` 误留为 first parent。

## 实际直接冲突

实际直接冲突与合并前预测一致，共 11 个：

```text
.gitignore
packages/cocos-cli-types/__tests__/__snapshots__/dts-snapshot.test.ts.snap
src/commands/preview.ts
src/core/assets/asset-config.ts
src/core/builder/index.ts
src/core/builder/share/common-options-validator.ts
src/core/builder/worker/builder/asset-handler/bundle/index.ts
src/core/builder/worker/builder/manager/task-base.ts
src/core/engine/index.ts
src/core/launcher.ts
src/core/scene/scene.scripting.middleware.ts
```

冲突处理没有采用整文件 `ours` 或 `theirs`。主要组合关系如下：

- `preview.ts`、`launcher.ts`：接收官方 default game、legacy build 和 scene-editor mode，同时保留 adapter `--runtime`、engine resolver、runtime diagnostics、watch、log 和 cleanup。
- `scene.scripting.middleware.ts`：接收官方共享 `scriptingRoutes` 和 scene route 拓扑，保留 adapter `temp/cli/asset-db` effect 产物边界，并保持 normal/scene 与 runtime programming workspace 分离。
- `asset-config.ts`：接入官方 `script.sortingPlugin` 同实例更新，保留 adapter AssetDB roots、records、internal library 和 project extension mounts ownership。
- builder 相关冲突：接收官方 cache、log、stage options、progress heartbeat 和 platform package 结构，保留 adapter project extension builder、hook runner、wechatgame/mini-game、`packAutoAtlas` 和 fatal/non-fatal hook 合同。
- `engine/index.ts`：接收官方 `engine.graphics` normalization 和 Joint Texture Layout resolver，保留 adapter `EngineRuntimeMode`、项目 engine root、UUID compatibility，以及 browser-owned builtin assets/physics 语义。
- DTS snapshot：不手工选边，以最终源码的 generator 结果为准，并用 types tests 校验。

## 保护的 adapter 定制

本次同步明确保护了下列既有定制边界：

1. `preview --runtime` 仍是独立 runtime preview 流程，不被官方 default browser preview、legacy build preview 或 scene-editor preview 替代。
2. engine source 继续从项目配置与 Launcher 初始化链路解析；测试覆盖只通过 `COCOS_CLI_TEST_*` 显式注入，不把冻结 Editor reference 或缓存路径变成 production 默认值。
3. runtime preview 保留独立的 `temp/cli/programming`、AssetDB、settings、health/readiness、refresh/watch 和关闭语义；normal/scene preview 不被静默接到 runtime workspace。
4. adapter 的本地 vendored `@cocos/asset-db`、library records、shared/non-shared ownership、internal library 和 project extension mounts 没有退回官方旧布局。
5. builder 的 project extension registration、hook metadata/error hook、wechatgame/mini-game 和 `packAutoAtlas` 行为与官方新增的 cache、heartbeat、stage 和四个平台 package/view pipeline 共存。
6. scene editing 中既有 Node/Component/Prefab dump、Undo/Redo 和引用恢复合同没有为了接收官方 `service-access` 解环而恢复静态 circular import。
7. engine 初始化继续保留 adapter runtime mode、3.8.6 UUID compatibility 和 browser-owned builtin assets/physics；CLI Node 侧不会为了初始化 Launcher 预加载 browser builtin assets。

## 真实 3.8.6 的有界兼容改动

### Engine source

3.8.6 engine 的独立兼容提交为：

- `d0d7f2b02327ec1759ab91597cbb45d9e045f465`：`fix: guard missing UI render material passes`
- 修改文件仅为 `cocos/2d/framework/ui-renderer.ts`
- 来源为本地 `E:\own_space\engines\cocos4` 中的 Cocos 4 official commit `89f8768e57c52107ec89beb657ff8c8ecc104285`

迁移范围只包含 `UIRenderer` 对缺失 material instance、render material 和首个 pass 的空值保护，以及复用已取得的 `matInstance`。没有迁移该 4.0 commit 对 `sprite.ts` 的另一项修改，也没有为错误临时设计新的渲染算法。3.8.6 与 4.0 对应代码段的语义 diff 已核对一致，仅行号因版本不同而变化。

该提交目前位于独立 worktree/branch `codex/official-sync-runtime-3.8.6`。它必须进入实际使用的 3.8.6 engine lineage 后，才可以把这项 runtime source 修正视为交付完成。CLI merge commit 本身不能替代 engine 仓库的集成。

### CLI 兼容边界

CLI 侧只保留有源码依据的 3.8.6 兼容层，包括 engine path resolver、UUID compatibility、CCONB JSON fallback、extensionless engine import-map 解析、browser-owned builtin assets，以及 graphics/JTL 在 game、runtime 和 build settings 间使用同一 resolver。没有把测试缓存、历史 `engineRoot`、frozen Editor reference 或特殊 fixture 行为提升为 production 默认策略。

## 测试环境与分层证据

### Fixture 和环境变量

- 主测试项目：`E:\own_space\engines\cocos-test-projects`，commit `9209d955b1ad2a169264bb6bd8b768cb9ef0f642`。
- 主测试项目 `package.json["cocos-cli"].enginePath`：`D:\workspace\engines\cocos\3.8.6`；最终 main-project integration 使用的是该项目配置解析出的 engine，而不是 frozen Editor reference。运行时该 worktree 为 `1f00541ac8092f7f591f3b5378554c8c20b9c2f9`，因此这条 integration 不包含独立 engine patch `d0d7f2b023...`。
- frozen parity project：`C:\Users\Nobody\AppData\Local\Temp\cocos-cli-official-sync-3b526b9d\cocos-test-projects`，commit `9209d955...`，预期仅 `M package.json`。
- frozen parity engine：`C:\Users\Nobody\AppData\Local\Temp\cocos-cli-official-sync-3b526b9d\engine-3.8.6`，commit `07aeda13c299e812192e3589a200a096c2056f01`，预期仅 `M cc.config.json`。
- project-bound Vitest 显式设置 `COCOS_CLI_TEST_PROJECT_ROOT` 与从对应 `package.json` 解析的 `COCOS_CLI_TEST_ENGINE_ROOT`。不需要 Editor reference 的测试和 main-project integration 均清除了 `COCOS_CLI_TEST_EDITOR_*`。

这些 fixture 只用于对应合同。frozen parity 不能冒充 production 真实项目，主测试项目的一条 scene integration 也不能冒充所有业务项目。

### 已通过门禁

| 层级 | 结果 | 能证明的范围 |
| --- | --- | --- |
| merge/index 审计 | 11 个冲突全部解除；`unmerged=0`；merge parent 精确匹配 `START_ADAPTER` / `TARGET`；merge 前 `git diff --check` 与 `git diff --cached --check` 通过 | Git 拓扑、冲突集合和 staged 内容一致性 |
| TypeScript | `npx tsc -b --pretty false` 退出码 0 | root project 可编译 |
| 完整 build | `npm run build` 退出码 0；dist/static/schema、9 个 DTS entry、snapshot 9/9、Android/Google Play/iOS/Web Mobile view/assets 构建完成 | 最终生成链路和本轮平台产物可生成；API Extractor 仍有既存 warning，不等于 declaration 内部 strict clean |
| types Jest | 10 suites、67 tests、9 snapshots 全部通过 | 发布 declarations 的当前测试合同 |
| runtime script integrity | `packer-driver-output-transaction` 7/7、`script-registration-integrity` 5/5 | QuickPack output transaction 与 script registration integrity |
| graphics/JTL parity | frozen 3.8.6 fixture 上 2 files、2 tests 通过，测试前后 fixture dirty 集合不变 | 当前 fixture 的 game/runtime/build graphics 与 Joint Texture Layout parity |
| Launcher builtin assets | focused 用例通过；child timeout 90 秒、外层 Vitest timeout 120 秒，并保留 stdout/stderr 失败诊断 | Launcher engine 初始化期间 CLI Node 侧 builtin assets 为 `undefined`，browser config 仍包含 builtin assets/default physics material |
| engine patch focused test | engine patch 后 Animation 相关 49/49 通过 | 已覆盖的 Animation 场景在补丁 engine worktree 上通过；不能替代完整 scene 或主项目验收 |
| main test project CLI integration | 1/1 通过；真实 `dist/cli.js preview --runtime` 启动并在 browser 加载 `TestBundleZip` scene，无该用例定义的 browser/server log error | 这一个主测试项目、这一个 scene 和 runtime CLI 路径 |

主测试项目本来就是 dirty worktree，因此 integration 前后比较采用状态和内容 hash，而不是清理项目。运行前后均为 `HEAD=9209d955...`、290 条 status、3 个 untracked；`STATUS_HASH=3a40fe4f...`、`DIFF_HASH=20e5759e...`、`UNTRACKED_HASH=85f4b8c2...` 均未变化。该结果证明本次 integration 没有新增 tracked/untracked source 或 `.meta` 副作用，但不能证明所有真实业务项目都可用。

## 未通过或未完成项

以下项目仍是明确 residual risk，因此不能勾选计划“全部完成”：

1. **Task 10 五 mode browser helper 未完成。** `default game`、`--build`、`--scene-editor`、`--runtime`、`start-mcp-server` 的统一可执行 helper、非法 option matrix、双 tab realm isolation、`/preview` canvas pixel、端口释放和最终 fixture cleanup 没有形成完整通过证据。未完成的 `vitests/scripts/official-sync-preview-mode-acceptance.mjs` 没有进入 merge commit。
2. **Animation MCP restart E2E 未执行。** 计划要求真实 `save -> exit -> re-enter -> assetChanged` 时间线和第二 MCP process persistence；现有 Animation service 只存在于 scene process，没有可直接复用的当前 MCP transport 测试入口。本轮没有为通过验收临时设计新的跨进程 API。因此 `C-11` 的 service/unit 证据不能扩大为真实 MCP restart persistence 已通过。
3. **完整 root Jest 未在最终 tree 全跑绿。** 在 final merge `30a13e3f...` 上，显式使用 engine worktree `d0d7f2b023...` 的已构建 bundle 和同一测试 fixture/env 重跑完整 `src/core/scene/test/scene.test.ts`，结果为 362 tests 中 353 passed、9 failed；Animation 相关测试 49/49 通过，9 个失败全部属于 Engine Proxy，均因等待 `engine:update` 超时。前序 Prefab Proxy suite 虽在 `afterAll` 关闭场景，但后续 Script Proxy suite 已检测并重新打开场景，且其 reload/query 测试通过，因此可排除简单的“前序 close 后场景未重开”。曾尝试在 browser-only `engine-bootstrap.ts` 的 service 初始化后添加 `Engine.resume()`，但 root scene Jest 实际 fork `dist/core/scene/scene-process/main.js`，该修改不在测试执行路径内，结果仍为 353/362；该无效尝试已撤销。固定 `TARGET=3b526b9d...` 与最新本地 `upstream/main=539d2575...` 均无现成修复，因此本轮没有继续猜测性修改 production。不能用 `tsc`、build、types Jest 或 runtime focused suites 替代这项失败。
4. **Engine commit 尚未进入实际 3.8.6 lineage。** `d0d7f2b023...` 当前仍在独立 engine branch/worktree。主测试项目 integration 解析到的 `D:\workspace\engines\cocos\3.8.6` 当时为既有 3.8.6 lineage，并不构成 engine patch 已被业务项目采用的证据。
5. **真实项目覆盖有限。** main-project integration 只覆盖 `E:\own_space\engines\cocos-test-projects` 的 `TestBundleZip` scene；未覆盖其它业务项目、全部 scene、全部资源类型或长期运行稳定性。
6. **尚未 push。** merge commit 只存在于本地同步分支。按计划仍需先处理上述未验收项或由用户明确接受 partial，再完成复盘提交、主分支 `ff-only` 接收和独立 push 确认。禁止把当前状态描述为已发布。

## 后续门禁

1. 将 `d0d7f2b023...` 以可审计方式接入实际 3.8.6 engine lineage，并在项目配置实际指向该 lineage 后重跑必要 integration。
2. 若继续处理 9 个 Engine Proxy `engine:update` timeout，必须先为 scene-worker 的 tick/repaint 路径采集可重复的内部状态，确认事件未产生或未转发的具体环节后再决定是否修改；禁止基于 suite 顺序或 browser bootstrap 状态猜改 production。随后在最终 tree 重跑完整 root Jest/scene 回归。
3. 先为 scene-process-only Animation service 建立经确认的真实 MCP 验收路径，再执行 restart persistence E2E；不得以 mock 或单进程 reload 替代。
4. 完成 Task 10 五 mode browser acceptance helper及其 fixture cleanup，或由用户在看到具体缺口后明确接受 partial。
5. 上述结果落盘后再决定 `adapter-to-386` 的 `ff-only` 接收；push 仍需单独确认，禁止 force push。

本复盘记录的是已经发生的 merge 和现有证据，不修改原执行计划中的完成状态，也不将未运行、失败或范围较窄的测试描述为通过。
