# `adapter-to-386` 合并官方 `origin/main` 执行计划

> 本计划只执行已确认的 `C-01` 到 `C-08`。执行时逐项勾选并记录命令结果；任何 stop condition 命中时保留现场，返回合并前报告重新决策。

**Goal:** 将 `origin/main@610c6b3d5f8608680a7374970bad99262ff25e02` 以 merge commit 合入长期分支 `adapter-to-386`，完整吸收官方 preview、builder、assets API 和修复，同时保留 adapter 的 runtime preview、3.8.6 engine / AssetDB、project extension、wechatgame 和 vendored dependency 目标。

**Architecture:** 使用长期 `.worktrees/official-sync`，每轮从当前 `adapter-to-386` 新建独立 `SYNC_BRANCH`。先 `git merge --no-ff --no-commit origin/main`，按已确认业务主题解决直接与 semantic conflict，完成分层验证后创建单一 merge commit。随后补复盘文档 commit，最终让 `adapter-to-386` 通过 `ff-only` 接收结果。

**Tech Stack:** Git worktree、TypeScript、Jest、Vitest、Express preview server、Cocos AssetDB / builder / scene process、MCP assets API、DTS generator。

## 固定输入

| 名称 | 值 |
| --- | --- |
| `BASE` | `c71c446428da66b77ae8e8c6714c9cc35ac094d2` |
| `ANALYZED_ADAPTER` | `8f52bece43b2512590d28870d7c3f05031299235` |
| `TARGET` | `610c6b3d5f8608680a7374970bad99262ff25e02` |
| `target ref` | `origin/main`，且分析时与 `upstream/main` 相等 |
| `SYNC_WORKTREE` | `E:\own_space\engines\cocos-cli\.worktrees\official-sync` |
| `SYNC_BRANCH` | `codex/official-sync-20260710-610c6b3d` |
| 合并前报告 | `docs/dev/reports/official-sync/adapter-to-386-origin-main-premerge-analysis-20260709.md` |
| 流程规范 | `docs/dev/architecture/official-sync-workflow.md` |

`ANALYZED_ADAPTER` 之后允许出现本轮流程、报告和计划的 docs-only commits。实际执行起点记为 `START_ADAPTER`。如果 `ANALYZED_ADAPTER..START_ADAPTER` 存在非文档代码变化，本计划失效，必须重新计算 `BASE`、双边 delta 和 `merge-tree`。

## 已确认范围

- 执行 `C-01` 到 `C-08` 的修订方案。
- 默认 `preview`、`--build`、`--scene-editor`、`--runtime` 保持不同 mode；不在本次合并中实现 normal/runtime/scene editor/MCP 同实例新架构。
- 接收官方 Material query/save，但不把它描述为并发安全事务或 prefab / scene / component 通用编辑 API。
- `@cocos/asset-db` 本次不升级，继续使用 `file:./packages/asset-db`。
- 不 rebase，不 force push，不自动 stash 或清理用户变更。

## 对抗审查记录

2026-07-10 已完成两路只读审查：一组检查 Git / worktree / index / dependency / generated file 可执行性，一组检查测试层级和 `C-01` 到 `C-08` 证据覆盖。首轮结论为 `revise`，已回填以下缺口：

- 长期 worktree 独立 engine Junction、root / vitests dependencies bootstrap。
- 固定 SHA merge、机器化冲突清单、显式 staging 和 merge parent 校验。
- Vitest scoped env、隔离测试项目 worktree、可执行 browser acceptance helper。
- Material MCP transport / restart persistence E2E，以及 config-map base / derived extension handler fixture。
- 官方 builder、assets、extensionless import-map tests 和跨 owner heartbeat lifecycle tests。
- 唯一一次 DTS generation、固定 types package version、cached dependency diff 和 pack dry-run。

本计划修订后已完成短复审。Task 0 可用于提交并清理当前 docs-only dirty 状态；Task 1 及后续 merge 阶段必须等待用户确认本计划。

最终短复审结果：两名 reviewer 均为 `approved`。最后一项修订是将 types package 审计命令改为 `npm --prefix packages/cocos-cli-types pack --dry-run --json`，与 Task 8 的 root package vendored `asset-db` 审计分开。

## 全局 Stop Conditions

命中任一条件立即停止，不继续解决后续冲突：

- `upstream/main` 或 `origin/main` 不再等于固定 `TARGET`。
- `adapter-to-386` 相对 `ANALYZED_ADAPTER` 出现未分析的 production code / test 变化。
- 实际直接冲突集合与预测不一致，或出现新的高风险 semantic conflict。
- 已确认方案需要改变用户可见语义、落盘路径、配置真相源或 dependency ownership。
- 测试只能通过 production fallback、清理真实项目缓存、修改 `.meta` 或注入未批准 test env。
- merge 结果无法保持第一 parent 为 `START_ADAPTER`、第二 parent 为 `TARGET`。

## Task 0：提交并冻结计划前文档

当前 dirty 状态只有本轮文档，按两个意图明确的 commits 提交，禁止 `git add -A`。

- [ ] 提交统一 preview / MCP session 需求记录：

```powershell
rtk git add -- docs/dev/runtime-preview/issues.md docs/dev/runtime-preview/facts/unified-preview-mcp-runtime-session-20260709.md
rtk git diff --cached --name-status
rtk git diff --cached --check
rtk git commit -m "docs(runtime-preview): record unified preview MCP session goal"
```

- [ ] 提交官方同步流程、报告和执行计划：

```powershell
rtk git add -- docs/dev/README.md docs/dev/architecture/official-sync-workflow.md docs/dev/reports/README.md docs/dev/reports/official-sync/README.md docs/dev/reports/official-sync/adapter-to-386-origin-main-premerge-analysis-20260709.md docs/superpowers/plans/2026-07-10-adapter-to-386-official-merge.md
rtk git diff --cached --name-status
rtk git diff --cached --check
rtk git commit -m "docs: define executable official sync workflow"
```

Expected：每次 cached diff 只能包含命令列出的文档；提交前必须阅读 cached diff 内容，不以 `docs/**` 路径代替内容审查。

- [ ] 确认主工作区 clean，并记录提交后的 `START_ADAPTER`：

```powershell
rtk git status --short --branch --untracked-files=all
rtk git rev-parse adapter-to-386
rtk git diff --name-only 8f52bece43b2512590d28870d7c3f05031299235..adapter-to-386
```

Expected：最后一条命令只列出 `docs/**`。否则停止并刷新分析。

## Task 1：执行前漂移检查和长期 worktree 准备

- [ ] 只读检查远端、refs 和 worktrees：

```powershell
rtk git ls-remote upstream refs/heads/main
rtk git ls-remote origin refs/heads/main
rtk git rev-parse origin/main upstream/main adapter-to-386
rtk git worktree list --porcelain
```

Expected：两个远端 main 和本地 tracking refs 都是 `610c6b3d5f8608680a7374970bad99262ff25e02`。

- [ ] 如果长期 worktree 不存在，创建它：

```powershell
rtk git worktree add .worktrees/official-sync -b codex/official-sync-20260710-610c6b3d adapter-to-386
```

- [ ] 如果长期 worktree 已存在，必须检查当前 branch、最近复盘、工作区状态和本轮 branch 是否已存在。clean 不等于已归档；不得覆盖或复用同名分支：

```powershell
rtk git -C .worktrees/official-sync status --short --branch --untracked-files=all
rtk git branch --list codex/official-sync-20260710-610c6b3d
rtk git -C .worktrees/official-sync switch -c codex/official-sync-20260710-610c6b3d adapter-to-386
```

Expected：`git branch --list` 无输出，worktree 位于新建的本轮 `SYNC_BRANCH`，HEAD 等于 `START_ADAPTER`。不得删除或 reset 上一轮未归档状态。

- [ ] 冻结测试项目和 3.8.6 engine commits，在 temp 下分别创建 detached worktrees。先记录两个 SHA 为 `FIXTURE_PROJECT_COMMIT`、`FIXTURE_ENGINE_COMMIT`，再执行：

```powershell
rtk git -C E:\own_space\engines\cocos-test-projects rev-parse HEAD
rtk git -C D:\workspace\engines\cocos\3.8.6 rev-parse HEAD
rtk pwsh -NoProfile -Command '$root=Join-Path $env:TEMP "cocos-cli-official-sync-610c6b3d"; if (Test-Path $root) { throw "Fixture root already exists: $root" }; New-Item -ItemType Directory -Path $root | Out-Null'
rtk git -C E:\own_space\engines\cocos-test-projects worktree add --detach $env:TEMP\cocos-cli-official-sync-610c6b3d\cocos-test-projects <FIXTURE_PROJECT_COMMIT>
rtk git -C D:\workspace\engines\cocos\3.8.6 worktree add --detach $env:TEMP\cocos-cli-official-sync-610c6b3d\engine-3.8.6 <FIXTURE_ENGINE_COMMIT>
```

- [ ] 在隔离 engine config 中把确定存在的 HTML5 override `pal/system-info/web/system-info.ts` 改为 extensionless `pal/system-info/web/system-info`，并把隔离项目 `package.json["cocos-cli"].enginePath` 指向该 engine fixture：

```powershell
rtk pwsh -NoProfile -Command '$root=Join-Path $env:TEMP "cocos-cli-official-sync-610c6b3d"; $engine=Join-Path $root "engine-3.8.6"; $engineConfigPath=Join-Path $engine "cc.config.json"; $config=Get-Content -Raw -LiteralPath $engineConfigPath | ConvertFrom-Json; $html5=$config.moduleOverrides | Where-Object { $_.test -eq "context.buildTimeConstants && context.buildTimeConstants.HTML5" }; if ($html5.overrides."pal/system-info" -ne "pal/system-info/web/system-info.ts") { throw "Unexpected pal/system-info override" }; $html5.overrides."pal/system-info"="pal/system-info/web/system-info"; $config | ConvertTo-Json -Depth 100 | Set-Content -LiteralPath $engineConfigPath -Encoding utf8NoBOM; $projectPackagePath=Join-Path $root "cocos-test-projects\package.json"; $package=Get-Content -Raw -LiteralPath $projectPackagePath | ConvertFrom-Json; $package."cocos-cli".enginePath=$engine; $package | ConvertTo-Json -Depth 100 | Set-Content -LiteralPath $projectPackagePath -Encoding utf8NoBOM'
```

Expected：engine fixture 只修改 `cc.config.json`，project fixture 只修改 `package.json`；`pal/system-info/web/system-info.ts` source 确实存在。这个确定性 fixture 用于所有 project-bound Vitest、CLI 和 browser tests，extensionless 候选数必须大于 0。

- [ ] 为长期 worktree 建立独立可运行环境。不得链接或复用主工作区 `node_modules`：

```powershell
rtk pwsh -NoProfile -Command '$worktree="E:\own_space\engines\cocos-cli\.worktrees\official-sync"; $projectRoot=Join-Path $env:TEMP "cocos-cli-official-sync-610c6b3d\cocos-test-projects"; $packageJson=Get-Content -Raw -LiteralPath (Join-Path $projectRoot "package.json") | ConvertFrom-Json; $enginePath=$packageJson."cocos-cli".enginePath; $engineLink=Join-Path $worktree "packages\engine"; if (Test-Path -LiteralPath $engineLink) { $item=Get-Item -LiteralPath $engineLink -Force; if ($item.LinkType -ne "Junction" -or $item.Target -notcontains $enginePath) { throw "Unexpected packages/engine link: $($item.Target)" } } else { New-Item -ItemType Junction -Path $engineLink -Target $enginePath | Out-Null }; $enginePath'
rtk npm ci
rtk npm --prefix vitests ci
rtk node -e "console.log(require.resolve('@cocos/asset-db')); console.log(require.resolve('@parcel/watcher')); console.log(require.resolve('jest'));"
rtk npm --prefix vitests exec -- vitest --version
```

Working directory：`SYNC_WORKTREE`。Expected：engine Junction 指向测试项目配置的 3.8.6 engine；依赖分别安装在本 worktree；`@cocos/asset-db` 解析到本 worktree `packages/asset-db`。如果 `npm ci` 需要修改 lockfile，停止，不允许用 `npm install` 掩盖。

## Task 2：启动 merge 并核对预测

- [ ] 在 `SYNC_WORKTREE` 启动不提交的 merge：

```powershell
rtk git merge --no-ff --no-commit 610c6b3d5f8608680a7374970bad99262ff25e02
rtk git status --short --untracked-files=all
rtk git diff --name-only --diff-filter=U
```

Working directory：`E:\own_space\engines\cocos-cli\.worktrees\official-sync`。

Expected 直接冲突仅为：

```text
packages/cocos-cli-types/__tests__/__snapshots__/dts-snapshot.test.ts.snap
src/commands/preview.ts
src/core/builder/index.ts
src/core/builder/share/common-options-validator.ts
src/core/builder/worker/builder/asset-handler/bundle/index.ts
src/core/builder/worker/builder/manager/task-base.ts
src/core/launcher.ts
src/core/scene/scene.scripting.middleware.ts
```

- [ ] 将 `git diff --name-only --diff-filter=U` 与上述清单机器化逐行比较，并把输出保存到 worktree 外的临时 evidence 文件。merge commit 前不修改分析报告，避免过程文档混入代码 merge commit。如果集合不同，保持 merge state，停止执行并重新确认。

## Task 3：`C-01` Preview mode 和 Launcher

**Production files:**

- `src/commands/preview.ts`
- `src/core/launcher.ts`

**Tests:**

- `vitests/suites/runtime-preview/cli-startup.test.ts`
- `vitests/suites/runtime-preview/launcher-runtime-preview.test.ts`
- 必要时新增 command mode matrix focused test，位置优先沿用上述 CLI test

- [ ] 先扩展 mode matrix 测试，覆盖缺省 game、`--build`、`--scene-editor`、`--runtime` 和非法组合。
- [ ] 覆盖 companion option ownership：`--project` / `--port` 是公共参数；runtime-only 参数只属于 runtime；`--platform` / `--build-config` 只属于 build；`--no-open` 只属于会自动打开 browser 的 game/build/scene-editor，runtime 必须显式拒绝；两种 `--scene` 分别按 game/runtime contract 传递。不兼容参数必须失败且不能调用 Launcher。
- [ ] 以官方 mode dispatch 为结构主干，接回完整 `startRuntimePreview()`、adapter engine resolver、runtime diagnostics / log / watch / cleanup。
- [ ] 所有 normal / scene / legacy build 入口继续使用 adapter engine resolver；legacy build 必须调用 `init(platform, projectRoot)`。
- [ ] 保持官方 browser dispose 和 adapter runtime close cleanup，禁止把两套 server 在本任务中合成共享实例。

Focused verification：

```powershell
rtk pwsh -NoProfile -Command '$projectRoot=Join-Path $env:TEMP "cocos-cli-official-sync-610c6b3d\cocos-test-projects"; $packageJson=Get-Content -Raw -LiteralPath (Join-Path $projectRoot "package.json") | ConvertFrom-Json; $enginePath=$packageJson."cocos-cli".enginePath; $env:COCOS_CLI_TEST_PROJECT_ROOT=$projectRoot; $env:COCOS_CLI_TEST_ENGINE_ROOT=[System.IO.Path]::GetFullPath($enginePath); npm --prefix vitests run test -- suites/runtime-preview/cli-startup.test.ts suites/runtime-preview/launcher-runtime-preview.test.ts'
```

Expected：mode 和参数矩阵全部通过；runtime path 不启动 scene RPC；缺省 path 不调用 runtime launcher。

- [ ] 只 stage 本任务明确修改的文件：

```powershell
rtk git add -- src/commands/preview.ts src/core/launcher.ts vitests/suites/runtime-preview/cli-startup.test.ts vitests/suites/runtime-preview/launcher-runtime-preview.test.ts
rtk git diff --name-only --diff-filter=U -- src/commands/preview.ts src/core/launcher.ts
rtk git diff --cached --check
```

## Task 4：`C-02` Scene editor 与共享 scripting routes

**Production files:**

- `src/core/scene/scene.scripting.middleware.ts`
- `src/core/preview/scripting-routes.ts`

**Tests:**

- 新增或扩展 `src/core/preview/test/scripting-routes.spec.ts`
- `src/core/scene/test/prefab-editor-preview-canvas.test.ts`

- [ ] 采用官方精简 scene middleware 和共享 `scriptingRoutes`，不恢复旧路由复制。
- [ ] 仅将 effect settings 指向 `temp/cli/asset-db/effect/effect.bin`。
- [ ] normal / scene QuickPack 保持 `temp/programming`；runtime 保持自己的 `temp/cli/programming` 和 routes。
- [ ] 证明 route 注册顺序不会让 scene wildcard 抢占 `/` 或 shared scripting routes。

Focused verification：

```powershell
rtk npx jest src/core/preview/test/scripting-routes.spec.ts src/core/scene/test/prefab-editor-preview-canvas.test.ts --runInBand
```

Expected：`/`、`/scene-editor/`、effect-settings、import-map 和 QuickPack 路径合同通过；normal / scene 不读取 runtime programming root。

- [ ] Stage 并确认本主题 direct conflict 已解除：

```powershell
rtk git add -- src/core/scene/scene.scripting.middleware.ts src/core/preview/scripting-routes.ts src/core/preview/test/scripting-routes.spec.ts src/core/scene/test/prefab-editor-preview-canvas.test.ts
rtk git diff --name-only --diff-filter=U -- src/core/scene/scene.scripting.middleware.ts
rtk git diff --cached --check
```

## Task 5：`C-03`、`C-04` Builder lifecycle 与配置真相源

**Production files:**

- `src/core/builder/index.ts`
- `src/core/builder/share/common-options-validator.ts`
- `src/core/builder/preview-options.ts`
- 所有调用 `init(platform)` 的 Launcher / API call sites

**Tests:**

- `src/core/builder/test/execute-build-stage-task.spec.ts`
- `src/core/builder/test/project-extension-builder-hooks.spec.ts`
- `src/core/builder/test/run-error-hook.spec.ts`
- `src/core/builder/test/preview-settings-debug-option.spec.ts`
- `src/core/builder/test/check-options.spec.ts`
- `src/core/builder/test/physics-default-material.spec.ts`
- `src/core/builder/test/clear-cache.spec.ts`
- `src/core/builder/test/lib-clear-cache.spec.ts`
- `src/core/builder/test/common-options-validator.spec.ts`
- `src/core/builder/test/create-build-stage-task.spec.ts`
- `src/core/builder/test/build-task-next-stages.spec.ts`

- [ ] 接收官方 `clearCache` exports、`.log` 文件规范化、早失败 log sink 和 stage runtime options merge。
- [ ] 保留 `init(platform, projectRoot?)`、project extension registration、`runErrorHook()` 和 `createPreviewBuildOptions()`。
- [ ] 使用 `rtk rg -n "\binit\(" src/core src/api` 列出 builder `init()` 调用点，逐项判断 instance build / legacy preview 是否必须传 `projectRoot`；把清单和结论写入执行记录。
- [ ] `Engine.getConfig()` resolver 唯一决定 `includeModules`；`CocosConfigLoader` 如保留，只能读取 preview graphics pipeline。
- [ ] clone `physicsConfig` 后再按 dependent asset 添加或删除 default material，不能修改 Engine config 原对象。
- [ ] 添加连续两次配置/build 的测试，证明第一轮后处理不会污染第二轮。

Focused verification：

```powershell
rtk npx jest src/core/builder/test/execute-build-stage-task.spec.ts src/core/builder/test/project-extension-builder-hooks.spec.ts src/core/builder/test/run-error-hook.spec.ts src/core/builder/test/preview-settings-debug-option.spec.ts src/core/builder/test/check-options.spec.ts src/core/builder/test/physics-default-material.spec.ts src/core/builder/test/clear-cache.spec.ts src/core/builder/test/lib-clear-cache.spec.ts src/core/builder/test/common-options-validator.spec.ts src/core/builder/test/create-build-stage-task.spec.ts src/core/builder/test/build-task-next-stages.spec.ts --runInBand
```

Expected：官方 log/cache/stage tests 和 adapter extension/runtime settings tests 同时通过；没有双 `includeModules` 真相源或 config object 污染。

- [ ] Stage 本主题文件和实际修改的相关 tests，不使用目录级 `git add`：

```powershell
rtk git add -- src/core/builder/index.ts src/core/builder/share/common-options-validator.ts src/core/builder/preview-options.ts src/core/builder/test/execute-build-stage-task.spec.ts src/core/builder/test/project-extension-builder-hooks.spec.ts src/core/builder/test/run-error-hook.spec.ts src/core/builder/test/preview-settings-debug-option.spec.ts src/core/builder/test/check-options.spec.ts src/core/builder/test/physics-default-material.spec.ts src/core/builder/test/clear-cache.spec.ts src/core/builder/test/lib-clear-cache.spec.ts src/core/builder/test/common-options-validator.spec.ts src/core/builder/test/create-build-stage-task.spec.ts src/core/builder/test/build-task-next-stages.spec.ts
rtk git diff --name-only --diff-filter=U -- src/core/builder/index.ts src/core/builder/share/common-options-validator.ts
rtk git diff --cached --check
```

如果 call-site 审计修改了其它 Launcher / API 文件，必须把精确路径追加到执行记录和 `git add --`，不得用 wildcard 代替。

## Task 6：`C-05`、`C-06` Bundle、hooks 和 heartbeat

**Production files:**

- `src/core/builder/worker/builder/asset-handler/bundle/index.ts`
- `src/core/builder/worker/builder/manager/task-base.ts`
- `src/core/builder/worker/builder/index.ts`
- `src/core/builder/worker/builder/stage-task-manager.ts`

**Tests:**

- `src/core/builder/test/build-task-progress-heartbeat.spec.ts`
- `src/core/builder/test/query-bundle-config.spec.ts`
- `src/core/builder/test/lib-auto-atlas-preview.spec.ts`
- `src/core/builder/test/pack-auto-atlas-option.spec.ts`
- `src/core/builder/test/wechatgame-platform.spec.ts`
- `src/core/builder/test/project-extension-builder-hooks.spec.ts`
- 新增 `src/core/builder/test/build-task-progress-heartbeat-lifecycle.spec.ts`

- [ ] 接收官方 disabled-platform 容错、preview 全 feature internal assets 和 heartbeat 实现。
- [ ] 保留 adapter mini-game helpers、wechatgame、explicit configs、`packAutoAtlas` 和 hook metadata。
- [ ] 以 adapter `loadAndRunBuildHook()` 为 hook 调度入口；不退回裸 `require + call`。
- [ ] 联合审计 worker、stage、bundle 的 success / break / error / finally，所有路径停止 heartbeat timer。
- [ ] 使用新 lifecycle test 分别驱动 worker builder、stage manager 和 bundle owner 的 success、throw、break、fatal hook、stage transition，逐项断言一次 hook 调用且 `jest.getTimerCount() === 0`；不能只依赖官方 `BuildTaskBase` 单元测试。

Focused verification：

```powershell
rtk npx jest src/core/builder/test/build-task-progress-heartbeat.spec.ts src/core/builder/test/build-task-progress-heartbeat-lifecycle.spec.ts src/core/builder/test/query-bundle-config.spec.ts src/core/builder/test/lib-auto-atlas-preview.spec.ts src/core/builder/test/pack-auto-atlas-option.spec.ts src/core/builder/test/wechatgame-platform.spec.ts src/core/builder/test/project-extension-builder-hooks.spec.ts --runInBand
```

Expected：preview 不因 `includeModules` 裁剪 builtin assets；wechatgame / atlas 行为不回退；所有 heartbeat 生命周期测试通过。

- [ ] Stage 本主题精确文件：

```powershell
rtk git add -- src/core/builder/worker/builder/asset-handler/bundle/index.ts src/core/builder/worker/builder/manager/task-base.ts src/core/builder/worker/builder/index.ts src/core/builder/worker/builder/stage-task-manager.ts src/core/builder/test/build-task-progress-heartbeat.spec.ts src/core/builder/test/build-task-progress-heartbeat-lifecycle.spec.ts src/core/builder/test/query-bundle-config.spec.ts src/core/builder/test/lib-auto-atlas-preview.spec.ts src/core/builder/test/pack-auto-atlas-option.spec.ts src/core/builder/test/wechatgame-platform.spec.ts src/core/builder/test/project-extension-builder-hooks.spec.ts
rtk git diff --name-only --diff-filter=U -- src/core/builder/worker/builder/asset-handler/bundle/index.ts src/core/builder/worker/builder/manager/task-base.ts
rtk git diff --cached --check
```

## Task 7：`C-07` Assets API、Material 与 DTS

**Production / generated files:**

- `src/core/assets/material-service.ts`
- `src/core/assets/manager/asset.ts`
- `src/core/assets/manager/asset-handler.ts`
- `src/api/assets/assets.ts`
- `src/api/assets/schema.ts`
- `src/lib/assets/assets.ts`
- `src/core/assets/@types/public.d.ts`
- `packages/cocos-cli-types/**`

**Tests:**

- `src/core/assets/test/material-service.test.ts`
- `src/core/assets/test/asset-config-map-i18n.test.ts`
- `src/core/assets/test/animation-graph-variant.test.ts`
- `src/core/assets/test/animation-mask.test.ts`
- `src/core/assets/test/property-schema.test.ts`
- `src/core/assets/test/serialized-data.test.ts`
- `tests/assets-material-api.test.ts`
- `tests/assets-query-property-schema-api.test.ts`
- `tests/assets-serialized-data-api.test.ts`
- `tests/assets-update-asset-user-data-api.test.ts`
- `tests/lib/assets-api.test.ts`
- 新增 `e2e/mcp/api/assets/material.e2e.test.ts`
- adapter AssetDB internal record / shared library / extension mount tests

- [ ] 接收官方 material query/save、localized config map、serialized / animation APIs 和 tests。
- [ ] 保留官方 material service 对 primitive、Color 和 Texture reference 的落盘覆盖，并补 dedicated Material MCP E2E：使用独立 `MCPTestClient` 启动 `start-mcp-server`，创建 / query / save material，直接检查 `.mtl` source 变化和 reimport 结果；关闭并重启 MCP server 后再次 query，证明持久化。不得用 mock `assetManager` 测试替代该链路。
- [ ] 在 config-map test 中构造明确的 base / derived project extension handlers：记录 lazy load 顺序，断言 derived 所需 base 已注册，最终 localized map 包含两者且 raw config 未改变。若并行 activation 顺序失败，停止并重新决策，不静默串行化所有 handler。
- [ ] localized output 只用于 presentation；测试 stable importer/property key 和 option value，raw config 保持不变。
- [ ] `assets-query-asset-config-map` 当前没有 `@tool`，因此只验证 core/API presentation contract，不将其描述为 MCP tool。
- [ ] 不在本次实现 revision / mtime transaction、stale write 防护或 prefab 通用编辑；将这些保留为明确 residual risk。
- [ ] DTS snapshot 暂不手工拼接；本任务只解决 API / schema / exports。snapshot 在 Task 9 由唯一一次 `npm run build` 重建。

Focused verification：

```powershell
rtk npm run test -- src/core/assets/test/material-service.test.ts src/core/assets/test/asset-config-map-i18n.test.ts src/core/assets/test/animation-graph-variant.test.ts src/core/assets/test/animation-mask.test.ts src/core/assets/test/property-schema.test.ts src/core/assets/test/serialized-data.test.ts tests/assets-material-api.test.ts tests/assets-query-property-schema-api.test.ts tests/assets-serialized-data-api.test.ts tests/assets-update-asset-user-data-api.test.ts tests/lib/assets-api.test.ts --runInBand
rtk npm run test -- src/core/assets/test/asset-db-internal-record.test.ts src/core/assets/test/asset-db-shared-library-output.test.ts src/core/assets/test/asset-db-shared-library-records.test.ts src/core/assets/test/extension-asset-db-mounts.spec.ts --runInBand
```

Expected：官方 assets API source contract、localized/raw contract 和 adapter AssetDB invariants 同时通过。Material MCP transport / restart persistence 必须等 Task 9 构建 merged `dist` 后执行；这些结果仍不证明并发事务或 prefab editing。

- [ ] Stage API、tests 和 E2E 精确路径。对于官方自动合并且未手工修改的 assets files，保持 merge 已有 index；对本任务修改 / 新增文件逐路径执行 `git add --`，并记录清单。至少包含：

```powershell
rtk git add -- src/core/assets/material-service.ts src/core/assets/manager/asset.ts src/core/assets/manager/asset-handler.ts src/api/assets/assets.ts src/api/assets/schema.ts src/lib/assets/assets.ts src/core/assets/@types/public.d.ts src/core/assets/test/material-service.test.ts src/core/assets/test/asset-config-map-i18n.test.ts e2e/mcp/api/assets/material.e2e.test.ts
rtk git diff --cached --check
```

## Task 8：`C-08` Dependency 和 vendored ownership

**Files:**

- `package.json`
- `package-lock.json`
- `packages/asset-db/**`
- `vitests/package.json` / `vitests/package-lock.json`

- [ ] 接收官方 CLI 版本、Pink requirement 和 DTS memory 参数。
- [ ] 保留 `@cocos/asset-db: file:./packages/asset-db`、vendored package files、`@parcel/watcher`、runtime preview 和 release scripts。
- [ ] 检查 staged lockfile root、local link 和 package entry，不运行无约束 dependency upgrade；然后在 merged lockfile 上重新执行独立 `npm ci`。

Verification：

```powershell
rtk git diff --cached -- package.json package-lock.json packages/asset-db vitests/package.json vitests/package-lock.json
rtk npm ci
rtk npm --prefix vitests ci
rtk npm ls @cocos/asset-db @parcel/watcher
rtk npm pack --dry-run --json
rtk npm view @cocos/asset-db dist-tags --json
```

Expected：解析到 local `packages/asset-db@3.0.0-alpha.10` 和预期 watcher；pack dry-run 文件清单包含 vendored `packages/asset-db`。固定 `TARGET` 的 package / lockfile 是本轮 dependency 依据；registry 查询只作 freshness evidence。若 registry latest 前进，登记独立 asset-db upgrade 分析，但不临时改变本轮固定 target，也不在本轮升级。

## Task 9：编译、全量 focused 回归和生成物审计

- [ ] 运行官方 extensionless import-map 回归：

```powershell
rtk npx jest tests/engine-compiler-fix-import-map-extensions.test.ts --runInBand
```

Expected：有 `.js` 或 `.ts` source 的 extensionless `q-bundled:///fs/*` entry 被规范为 `.js`；其它 entry 不变。

- [ ] DTS snapshot 冲突只用固定 `TARGET` 内容作为 generator seed，不作为最终选边。随后只运行一次完整 build：

```powershell
rtk git restore --source=610c6b3d5f8608680a7374970bad99262ff25e02 --worktree -- packages/cocos-cli-types/__tests__/__snapshots__/dts-snapshot.test.ts.snap
rtk npx tsc -b --pretty false
rtk npm run build
rtk npm pkg set version=0.0.1-alpha.33.1 --prefix packages/cocos-cli-types
rtk git status --short --untracked-files=all
```

Expected：`npm run build` 退出码 0，完成 dist、static、schema 和唯一一次 DTS 生成；最终 types package version 固定为官方 `TARGET` 的 `0.0.1-alpha.33.1`，不能采用 registry 动态计算出的下一版本。tracked 变化只允许 `packages/cocos-cli-types/package.json` 和 DTS snapshot；生成的 `*.d.ts` 被 `.gitignore` 排除，不应 stage，改由 types tests 和 pack dry-run 审计。其它 tracked generated diff 必须逐项解释，否则停止。

- [ ] Stage 生成物并确认最后一个 direct conflict 解除：

```powershell
rtk git add -- packages/cocos-cli-types/package.json packages/cocos-cli-types/__tests__/__snapshots__/dts-snapshot.test.ts.snap
rtk git diff --name-only --diff-filter=U
rtk git diff --cached --check
rtk npm --prefix packages/cocos-cli-types pack --dry-run --json
```

Expected：无 unmerged paths；types package pack 文件清单包含生成后的 declarations。vendored `packages/asset-db` 由 Task 8 的 root pack dry-run 单独审计。

- [ ] 生成并 stage snapshot 后再执行 conflict-marker / whitespace gate：

```powershell
rtk rg -n "^(<<<<<<<|=======|>>>>>>>)" . --glob "!node_modules/**" --glob "!.git/**" --glob "!packages/engine/**" --glob "!.worktrees/**"
rtk git diff --check
rtk git diff --cached --check
```

Expected：第一条无匹配，后两条无输出。

- [ ] 运行完整 root Jest 和 types tests，防止 `BASE..TARGET` 中未单列的新 API tests 被漏掉：

```powershell
rtk npm run test -- --runInBand
rtk npx jest --roots packages/cocos-cli-types --runInBand
```

Expected：退出码 0。若完整 Jest 有既存环境失败，必须先用 `START_ADAPTER` 同环境复现并分类；未经用户接受不能把失败直接豁免。

- [ ] 合并后的 `dist/cli.js` 已由 build 更新后，运行 Material MCP transport / restart E2E：

```powershell
rtk npm run test:e2e -- --runTestsByPath e2e/mcp/api/assets/material.e2e.test.ts --runInBand
```

Expected：MCP save 修改 `.mtl` source、触发 reimport，并在关闭 / 重启 MCP server 后 query 到相同持久化值。

- [ ] Runtime preview focused suites。先从主测试项目配置解析 engine root：

```powershell
rtk pwsh -NoProfile -Command '$projectRoot=Join-Path $env:TEMP "cocos-cli-official-sync-610c6b3d\cocos-test-projects"; $packageJson=Get-Content -Raw -LiteralPath (Join-Path $projectRoot "package.json") | ConvertFrom-Json; $enginePath=$packageJson."cocos-cli".enginePath; $env:COCOS_CLI_TEST_PROJECT_ROOT=$projectRoot; $env:COCOS_CLI_TEST_ENGINE_ROOT=[System.IO.Path]::GetFullPath($enginePath); npm --prefix vitests run test -- suites/runtime-preview/cli-startup.test.ts suites/runtime-preview/launcher-engine-root.test.ts suites/runtime-preview/launcher-runtime-preview.test.ts suites/runtime-preview/settings-generation.test.ts suites/runtime-preview/preview-app-route-contract.test.ts'
```

Expected：退出码 0。这里只证明列出的 fixture / integration contract。

- [ ] 运行主测试项目 CLI integration：

```powershell
rtk pwsh -NoProfile -Command '$projectRoot=Join-Path $env:TEMP "cocos-cli-official-sync-610c6b3d\cocos-test-projects"; $packageJson=Get-Content -Raw -LiteralPath (Join-Path $projectRoot "package.json") | ConvertFrom-Json; $enginePath=$packageJson."cocos-cli".enginePath; $env:COCOS_CLI_TEST_PROJECT_ROOT=$projectRoot; $env:COCOS_CLI_TEST_ENGINE_ROOT=[System.IO.Path]::GetFullPath($enginePath); npm --prefix vitests run test -- suites/runtime-preview/main-test-project-cli-integration.test.ts'
```

Expected：真实 `dist/cli.js preview --runtime` 在主测试项目通过；不能扩大为所有真实项目通过。

## Task 10：Preview 用户流程验收

- [ ] 新增 `vitests/scripts/official-sync-preview-mode-acceptance.mjs`。该 helper 必须：

  - 通过 `child_process.spawn()` 且 `windowsHide: true` 顺序启动四个 CLI processes。
  - game / build / scene-editor 使用 `--no-open`；runtime 不传 `--no-open`，因为该参数在 runtime 下应被拒绝。
  - 使用固定独立端口，stdout/stderr 分 mode 写入 evidence 目录。
  - 在明确 timeout 内轮询实际 URL / readiness，不使用固定 sleep 作为成功条件。
  - 使用 Playwright 打开 browser，收集 `pageerror`、`unhandledrejection`、`console.error`、同源 failed request 和非预期 bad response。
  - 在 `finally` 中终止本 helper 启动的进程，并验证端口释放。
  - 运行非法 mode / companion option matrix，要求非 0、明确错误且端口没有监听。
  - 对 Task 1 固定构造的 `pal/system-info -> pal/system-info/web/system-info` extensionless override 做强断言：候选数必须大于 0，生成 import-map value 必须以 `system-info.js` 结尾，该 URL 请求 200，browser 不得出现 extensionless failed request。零命中必须失败，不能 skip。

- [ ] 使用 Task 1 已冻结的 project / engine fixtures。运行前验证 project fixture 只有 `package.json`、engine fixture 只有 `cc.config.json` 两项预期测试配置变化；任何 source asset、`.meta` 或其它 engine source 变化都阻塞验收。

- [ ] 清理当前进程 test env 后运行可执行 helper：

```powershell
rtk pwsh -NoProfile -Command 'Remove-Item Env:COCOS_CLI_TEST_PROJECT_ROOT -ErrorAction SilentlyContinue; Remove-Item Env:COCOS_CLI_TEST_ENGINE_ROOT -ErrorAction SilentlyContinue; Remove-Item Env:COCOS_CLI_TEST_EDITOR_LIBRARY_REF -ErrorAction SilentlyContinue; Remove-Item Env:COCOS_CLI_TEST_EDITOR_PROGRAMMING_REF -ErrorAction SilentlyContinue; node vitests/scripts/official-sync-preview-mode-acceptance.mjs --cli-root "E:\own_space\engines\cocos-cli\.worktrees\official-sync" --project-root "$env:TEMP\cocos-cli-official-sync-610c6b3d\cocos-test-projects" --game-port 9630 --build-port 9631 --scene-port 9632 --runtime-port 9633 --startup-timeout-ms 180000 --browser-timeout-ms 120000 --evidence-root "$env:TEMP\cocos-cli-official-sync-610c6b3d\evidence"'
```

- [ ] Helper 必须实际执行并验收：

```text
default game preview -> /
--build              -> legacy build preview URL
--scene-editor       -> /scene-editor/，同实例同时检查 /
--runtime            -> runtime root、/settings.js、/scene-list、health/readiness
```

- [ ] 每种 mode 记录命令、端口、进程初始化链路、HTTP / browser 结果和 cleanup；helper 总退出码必须为 0。
- [ ] 验收后比较两个 fixtures：除 Task 1 的 `package.json` / `cc.config.json` 测试配置外，source assets、`.meta` 和 engine source 不得新增变化。出现额外 dirty 时保留现场并失败。证据归档后先恢复这两个明确配置文件，确认两个 worktrees clean，再允许非 force `git worktree remove`。

Acceptance：

| 流程 | 必须成立 | 必须不成立 |
| --- | --- | --- |
| default | `/` 可用，走官方 dynamic game preview | 不启动 runtime server 或 scene RPC |
| `--build` | 走 legacy build 后预览 | 不忽略 build-only options |
| `--scene-editor` | `/scene-editor/` 可用且 `/` route 不被抢占 | 不读取 runtime programming root |
| `--runtime` | adapter diagnostics、settings、watch / refresh 保留 | 不启动 scene RPC，不把 Material API误称为同实例 MCP |

browser smoke 是 merge commit gate。本机无法完成时不得继续创建 merge commit，除非用户看到具体未验证项后明确接受本轮 `partial`；HTTP 200 不能替代 browser acceptance。

- [ ] Stage acceptance helper：

```powershell
rtk git add -- vitests/scripts/official-sync-preview-mode-acceptance.mjs
rtk git diff --cached --check
```

## Task 11：创建 merge commit、复盘和回收

- [ ] 提交前审计实际变化：

```powershell
rtk git status --short --untracked-files=all
rtk git diff --name-only --diff-filter=U
rtk git diff --name-status
rtk git diff --cached --name-status
rtk git diff --cached --check
rtk git diff HEAD --check
rtk git diff --name-only <START_ADAPTER> -- docs/dev/reports docs/superpowers/plans
```

- `--diff-filter=U` 必须无输出。
- 普通 `git diff --name-status` 必须无输出，表示所有已审查修改均已 stage。
- cached diff 必须包含完整官方 merge、已批准的冲突处理、明确新增 tests / acceptance helper 和 generated DTS；不得有未解释文件。
- 最后一条命令必须证明执行阶段没有把报告或计划修改混入代码 merge commit。禁止使用 `git add -A` 补齐遗漏。

- [ ] 所有 task 通过后创建 merge commit：

```powershell
rtk git commit -m "merge: sync official main at 610c6b3d"
rtk git rev-parse HEAD
rtk git rev-parse <MERGE_COMMIT>^1
rtk git rev-parse <MERGE_COMMIT>^2
```

Expected：第一 parent 是 `START_ADAPTER`，第二 parent 是 `610c6b3d5f8608680a7374970bad99262ff25e02`。

- [ ] 立即记录固定 `MERGE_COMMIT`。创建官方同步复盘，记录该 SHA、实际冲突、`C-01` 到 `C-08` 实现、命令结果、失败和未验证项；以单独 docs commit 提交。docs commit 后仍使用 `<MERGE_COMMIT>^1/^2` 检查，不用新的 `HEAD^2`。
- [ ] 在主工作区确认 clean 后回收：

```powershell
rtk git rev-parse adapter-to-386
rtk git switch adapter-to-386
rtk git merge --ff-only codex/official-sync-20260710-610c6b3d
```

Expected：回收前 `adapter-to-386` 仍精确等于 `START_ADAPTER`；只 fast-forward 到含 merge commit 和复盘 docs commit 的 sync branch tip，不产生第二个 merge commit。

- [ ] push 前展示最终 log、ahead/behind、测试摘要和 residual risks，获得用户单独确认。禁止 force push。

## 最终完成标准

- `origin/main == upstream/main == TARGET`，合并 commit 第二 parent 精确等于 `TARGET`。
- 8 个直接冲突和 `C-08` semantic conflict 均有实现与验证记录。
- 四种 preview 用户流程符合确认合同，非法组合明确失败。
- 官方 builder progress/log/cache/stage 和 adapter extension/wechatgame/runtime settings 同时保留。
- Material / config-map 官方 API 可用，adapter AssetDB tests 不回退，DTS 由 generator 更新。
- `@cocos/asset-db` 继续解析到 local vendored package。
- TypeScript、`npm run build`、focused Jest/Vitest 和声明范围内的 CLI acceptance 通过。
- 复盘已落盘，adapter 只通过 `ff-only` 接收结果，远端 push 尚需单独确认。
