# `adapter-to-386` 合并官方 `origin/main` 执行计划

> 本计划固定到 2026-07-13 的官方 target。旧 target 的批准仅继续适用于未受增量影响的 `C-05`、`C-06`；`C-01` 到 `C-04`、`C-07` 到 `C-15` 必须按最新业务流程重新确认。执行时逐项勾选并记录命令结果；任何 stop condition 命中时保留现场，返回合并前报告重新决策。

**Goal:** 将 `origin/main@3b526b9d86519df1ee5046550aaa202d860ab15d` 以 merge commit 合入长期分支 `adapter-to-386`，完整吸收官方 preview、PreviewService、builder、assets API、scene service、四个平台 Pink views、plugin script order、Joint Texture Layout、engine graphics config、prefab/atlas 和 animation session refresh 修复，同时保留 adapter 的 runtime preview、3.8.6 engine / AssetDB、project extension、wechatgame 和 vendored dependency 目标。

**Architecture:** 使用长期 `.worktrees/official-sync`，每轮从当前 `adapter-to-386` 新建独立 `SYNC_BRANCH`。先 `git merge --no-ff --no-commit 3b526b9d86519df1ee5046550aaa202d860ab15d`，按已确认业务主题解决直接与 semantic conflict，完成分层验证后创建单一 merge commit。随后补复盘文档 commit，最终让 `adapter-to-386` 通过 `ff-only` 接收结果。

**Tech Stack:** Git worktree、TypeScript、Jest、Vitest、Express preview server、Cocos AssetDB / builder / scene process、MCP assets API、DTS generator。

## 固定输入

| 名称 | 值 |
| --- | --- |
| `BASE` | `c71c446428da66b77ae8e8c6714c9cc35ac094d2` |
| `ANALYZED_ADAPTER` | `8f52bece43b2512590d28870d7c3f05031299235` |
| `TARGET` | `3b526b9d86519df1ee5046550aaa202d860ab15d` |
| `target ref` | `origin/main`，且分析时与 `upstream/main` 相等 |
| `SYNC_WORKTREE` | `E:\own_space\engines\cocos-cli\.worktrees\official-sync` |
| `SYNC_BRANCH` | `codex/official-sync-20260713-3b526b9d` |
| 合并前报告 | `docs/dev/reports/official-sync/adapter-to-386-origin-main-premerge-analysis-20260709.md` |
| 流程规范 | `docs/dev/architecture/official-sync-workflow.md` |

`ANALYZED_ADAPTER` 之后允许出现本轮流程、报告和计划的 docs-only commits。实际执行起点记为 `START_ADAPTER`。如果 `ANALYZED_ADAPTER..START_ADAPTER` 存在非文档代码变化，本计划失效，必须重新计算 `BASE`、双边 delta 和 `merge-tree`。

## 已确认范围

- 继续沿用未受新提交影响的 `C-05`、`C-06`；重新确认 `C-01` 到 `C-04`、`C-07` 到 `C-15` 后才能进入 merge。
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

旧 `TARGET=610c6b3d` 的最终短复审结果为两名 reviewer 均 `approved`；官方 head 前进到 `d373afbc` 后该批准失效。针对当前固定 target 的多轮对抗审查先后要求拆分 `C-09` 到 `C-12`，补 PreviewService / effect / bootstrap、dump editing、animation、DTS generator、CI typecheck、prefab restart persistence、browser realm / MCP child worker isolation 和可审计用户确认 gate，均已回填。

2026-07-13 官方 head 又前进到 `5c2b76a6`。重新分析发现 7 个新增 commits、75 个变动文件、11 个与 adapter delta 重叠文件，`merge-tree` 直接冲突从 8 个增到 11 个。计划已增加 `C-13` sorting plugin / AssetDB、`C-14` Joint Texture Layout / Engine、`C-15` platform view packaging，并重新打开受影响的 `C-03`、`C-08`、`C-09`、`C-11`。此前 reviewer 和用户批准不适用于当前 target；更新后的计划需要再次对抗审查和用户确认。

2026-07-10 对旧 target 的最终短复审结果为两名 reviewer 均 `approved`。2026-07-13 target 漂移后该结果失效；Task 0 只用于提交当前 docs-only 刷新，Task 0.5 的最新 target 对抗审查、用户确认及其记录 commit 尚未完成，Task 1 及后续 merge 阶段仍被禁止。

2026-07-13 当前 target 的首轮两路对抗审查均要求 `revise`。Git / 可执行性审查指出 esbuild manifest/lock 流程、固定 SHA merge-tree evidence、build 前后生成物比较缺口；业务审查指出误读 sortingPlugin、FB Instant Games collateral exposure、loader 失败 partial cache、Joint Texture Layout 跨路径证据、animation 真实落盘和 Pink 最终 dist/bridge 验收缺口。上述 finding 已回填计划；必须完成短复审后才能勾选 Task 0.5 的 reviewer gate。

2026-07-13 修订后由同两名 reviewer 短复审，结果均为 `approved`。该批准只覆盖固定 target 下的报告/计划完整性，不替代用户对 12 个 `proposed` 决策的确认，也不授权进入 merge。

上述批准固定在 `5c2b76a6`。提交文档前 freshness gate 发现官方又新增 `84000ea1` graphics config；直接冲突仍为 11 个，但 `C-04` 旧批准失效，`C-02` / `C-14` 验收扩展。graphics 业务 reviewer 对修订给出 `approved`，Git reviewer 则发现 target 已再次漂移，并指出 `C-04` 在 `engine/index.ts` 冲突解除前运行 Engine tests 的顺序不可执行。

`TARGET=65644d59` 比 `84000ea1` 再增加 Android / Web Mobile package + Pink views 两个 commits。增量 26 个文件与 adapter 路径无重叠，直接冲突仍为 11 个；`C-03`、`C-08`、`C-15` 的平台注册、view build、builder path 和发布验收已扩展到四个平台，两路 reviewer 最终均为 `approved`。

用户确认 `65644d59` 后、批准记录落盘前，freshness gate 发现最新 `TARGET=3b526b9d` 新增 animation session re-enter refresh 修复。该增量 3 个文件与 adapter 路径无重叠，直接冲突仍为 11 个，但扩大 `C-11` 的 AssetService / AnimationService 协作与 save -> exit -> re-enter 验收。两路 reviewer 已在修正 E2E `assetChanged` 时间线后复审为 `approved`；旧确认不能自动批准新 target，用户待确认项仍为 13 个。

## 全局 Stop Conditions

命中任一条件立即停止，不继续解决后续冲突：

- 固定 `TARGET` 对象不存在，或更新 `upstream/main` 后确认 `TARGET` 不再是当前官方 main 的 ancestor。远端 branch head 正常前进本身不是 stop condition，只记录为下一轮同步事实。
- `adapter-to-386` 相对 `ANALYZED_ADAPTER` 出现未分析的 production code / test 变化。
- 实际直接冲突集合与预测不一致，或出现新的高风险 semantic conflict。
- 已确认方案需要改变用户可见语义、落盘路径、配置真相源或 dependency ownership。
- 测试只能通过 production fallback、清理真实项目缓存、修改 `.meta` 或注入未批准 test env。
- merge 结果无法保持第一 parent 为 `START_ADAPTER`、第二 parent 为 `TARGET`。

## Task 0：提交并冻结计划前文档

当前 dirty 状态只有本轮文档，按意图明确的 commits 提交，禁止 `git add -A`。

- [x] 提交统一 preview / MCP session 需求记录：`682e31837a6b6ba5eac386c21e95af08d40bc495`

```powershell
rtk git add -- docs/dev/runtime-preview/issues.md docs/dev/runtime-preview/facts/unified-preview-mcp-runtime-session-20260709.md
rtk git diff --cached --name-status
rtk git diff --cached --check
rtk git commit -m "docs(runtime-preview): record unified preview MCP session goal"
```

- [x] 提交官方同步流程、报告和旧 target 执行计划：`4c328921e345b574eae49ebe54a712007a12b05d`

```powershell
rtk git add -- docs/dev/README.md docs/dev/architecture/official-sync-workflow.md docs/dev/reports/README.md docs/dev/reports/official-sync/README.md docs/dev/reports/official-sync/adapter-to-386-origin-main-premerge-analysis-20260709.md docs/superpowers/plans/2026-07-10-adapter-to-386-official-merge.md
rtk git diff --cached --name-status
rtk git diff --cached --check
rtk git commit -m "docs: define executable official sync workflow"
```

Expected：每次 cached diff 只能包含命令列出的文档；提交前必须阅读 cached diff 内容，不以 `docs/**` 路径代替内容审查。

- [x] target 漂移到 `d373afbc` 后，提交刷新后的流程 gate、报告和计划：`bdeb201d537c42528093f10a27808063ded9d641`

```powershell
rtk git add -- docs/dev/architecture/official-sync-workflow.md docs/dev/reports/official-sync/adapter-to-386-origin-main-premerge-analysis-20260709.md docs/superpowers/plans/2026-07-10-adapter-to-386-official-merge.md
rtk git diff --cached --name-status
rtk git diff --cached --check
rtk git commit -m "docs: finalize official sync plan for d373afbc"
```

- [x] `5c2b76a6` 分析、流程修订和两路复审已完成，但提交前 freshness gate 发现 `84000ea1`，因此按 stop condition 作废旧 target 提交步骤，未创建 stale docs commit。

- [x] `84000ea1` graphics 修订完成业务复审，但 Git reviewer 在最终批准前发现 `65644d59`，因此再次按 stop condition 作废 stale docs commit。

- [x] target 漂移到 `65644d59` 后，提交刷新的流程、报告和计划：`d53e465c91bbd82eb42f28a7abf278426a167d69`

```powershell
rtk git add -- docs/dev/architecture/official-sync-workflow.md docs/dev/reports/official-sync/adapter-to-386-origin-main-premerge-analysis-20260709.md docs/superpowers/plans/2026-07-10-adapter-to-386-official-merge.md
rtk git diff --cached --name-status
rtk git diff --cached --check
rtk git commit -m "docs: refresh official sync plan for 65644d59"
```

- [x] target 漂移到 `3b526b9d` 后，提交刷新的报告和计划；提交前 freshness gate 已确认 `origin/main == upstream/main == TARGET`，由本次 docs commit 完成：

```powershell
rtk git add -- docs/dev/reports/official-sync/adapter-to-386-origin-main-premerge-analysis-20260709.md docs/superpowers/plans/2026-07-10-adapter-to-386-official-merge.md
rtk git diff --cached --name-status
rtk git diff --cached --check
rtk git commit -m "docs: refresh official sync plan for 3b526b9d"
```

## Task 0.5：记录最终用户确认

- [x] 对固定 `TARGET=3b526b9d` 的 animation session re-enter 增量完成两路短复审；Git reviewer 为 `approved`，业务 reviewer 在修正 re-enter 后 `assetChanged` 时间线后复审为 `approved`。`65644d59` 的两路批准仅作为已闭环历史。
- [x] 已向用户展示固定 target 的合并前摘要、11 个增量 commits 对实际用户流程的影响、11 个直接冲突、`C-01` 到 `C-04`、`C-07` 到 `C-15`、最终计划 revision 和 residual risks；用户于 2026-07-13 明确批准 `TARGET=3b526b9d86519df1ee5046550aaa202d860ab15d`、计划 revision `cdf003820d981502153e7d447bfd39eba54c32b3`。
- [x] 已在合并前报告中记录确认日期、target、计划 revision 和覆盖的 `C-ID`，并将 `C-01`、`C-02`、`C-03`、`C-04`、`C-07`、`C-08`、`C-09`、`C-10`、`C-11`、`C-12`、`C-13`、`C-14`、`C-15` 更新为 `approved`；`C-05`、`C-06` 沿用既有批准。确认后若再次修改 target、业务语义、验收标准或 stop condition，立即把相关状态退回 `proposed` 并重新审查 / 确认。
- [x] 以独立 docs commit 提交确认记录（由本次 commit 完成）：

```powershell
rtk git add -- docs/dev/reports/official-sync/adapter-to-386-origin-main-premerge-analysis-20260709.md docs/superpowers/plans/2026-07-10-adapter-to-386-official-merge.md
rtk git diff --cached --name-status
rtk git diff --cached --check
rtk git commit -m "docs: approve official sync plan for 3b526b9d"
```

Expected：cached diff 只有两份确认记录文档；报告明确列出 13 个本轮 approved decision IDs，计划记录对抗审查和用户确认 gate 已完成。该 commit 完成前禁止执行 Task 1。

- [x] 2026-07-14 执行阶段发现 `upstream/main` 已前进到 `df01f317b88b6901733d4e4a9fb0eba2220578e0`，而固定 `TARGET` 与 `origin/main` 仍为 `3b526b9d86519df1ee5046550aaa202d860ab15d`。用户确认本轮采用固定 snapshot 语义：远端 head 正常前进不改变已批准 target；只在 target 对象不存在或不再属于当前官方 lineage 时停止。该修订不改变 `C-01` 到 `C-15` 的业务语义和验收范围，由本次 docs commit 记录。

本次只完成 Task 0.5。用户明确要求本会话不进入 merge，不创建或切换长期 worktree / merge branch，不执行 Task 1；后续会话必须从 freshness gate 和 `START_ADAPTER` 记录重新开始。

- [ ] 确认主工作区 clean，并记录提交后的 `START_ADAPTER`：

```powershell
rtk git status --short --branch --untracked-files=all
rtk git rev-parse adapter-to-386
rtk git diff --name-only 8f52bece43b2512590d28870d7c3f05031299235..adapter-to-386
```

Expected：最后一条命令只列出 `docs/**`。否则停止并刷新分析。

## Task 1：执行前 target lineage 检查和长期 worktree 准备

- [ ] 记录远端 heads，更新官方 remote-tracking ref，并检查固定 target lineage 和 worktrees：

```powershell
rtk git ls-remote upstream refs/heads/main
rtk git ls-remote origin refs/heads/main
rtk git fetch --no-tags upstream refs/heads/main:refs/remotes/upstream/main
rtk git rev-parse origin/main upstream/main adapter-to-386
rtk git cat-file -e 3b526b9d86519df1ee5046550aaa202d860ab15d^{commit}
rtk git merge-base --is-ancestor 3b526b9d86519df1ee5046550aaa202d860ab15d upstream/main
rtk git worktree list --porcelain
```

Expected：固定 `TARGET` 对象存在且是当前 `upstream/main` 的 ancestor；记录 `origin/main`、`upstream/main` 的当前 heads，但它们允许前进，不要求继续等于 `TARGET`。若 ancestry 失败则停止；若只发生正常前进，登记为下一轮同步事实后继续本轮固定 snapshot。

- [ ] 如果长期 worktree 不存在，创建它：

```powershell
rtk git worktree add .worktrees/official-sync -b codex/official-sync-20260713-3b526b9d adapter-to-386
```

- [ ] 如果长期 worktree 已存在，必须检查当前 branch、最近复盘、工作区状态和本轮 branch 是否已存在。clean 不等于已归档；不得覆盖或复用同名分支：

```powershell
rtk git -C .worktrees/official-sync status --short --branch --untracked-files=all
rtk git branch --list codex/official-sync-20260713-3b526b9d
rtk git -C .worktrees/official-sync switch -c codex/official-sync-20260713-3b526b9d adapter-to-386
```

Expected：`git branch --list` 无输出，worktree 位于新建的本轮 `SYNC_BRANCH`，HEAD 等于 `START_ADAPTER`。不得删除或 reset 上一轮未归档状态。

- [ ] 冻结测试项目和 3.8.6 engine commits，在 temp 下创建一个只读验收 project worktree、一个允许测试落盘的 mutable project worktree，以及一个 engine worktree。先记录两个 SHA 为 `FIXTURE_PROJECT_COMMIT`、`FIXTURE_ENGINE_COMMIT`，再执行：

```powershell
rtk git -C E:\own_space\engines\cocos-test-projects rev-parse HEAD
rtk git -C D:\workspace\engines\cocos\3.8.6 rev-parse HEAD
rtk pwsh -NoProfile -Command '$root=Join-Path $env:TEMP "cocos-cli-official-sync-3b526b9d"; if (Test-Path $root) { throw "Fixture root already exists: $root" }; New-Item -ItemType Directory -Path $root | Out-Null'
rtk git -C E:\own_space\engines\cocos-test-projects worktree add --detach $env:TEMP\cocos-cli-official-sync-3b526b9d\cocos-test-projects <FIXTURE_PROJECT_COMMIT>
rtk git -C E:\own_space\engines\cocos-test-projects worktree add --detach $env:TEMP\cocos-cli-official-sync-3b526b9d\cocos-test-projects-mutable <FIXTURE_PROJECT_COMMIT>
rtk git -C D:\workspace\engines\cocos\3.8.6 worktree add --detach $env:TEMP\cocos-cli-official-sync-3b526b9d\engine-3.8.6 <FIXTURE_ENGINE_COMMIT>
```

- [ ] 在隔离 engine config 中把确定存在的 HTML5 override `pal/system-info/web/system-info.ts` 改为 extensionless `pal/system-info/web/system-info`，并把隔离项目 `package.json["cocos-cli"].enginePath` 指向该 engine fixture：

```powershell
rtk pwsh -NoProfile -Command '$root=Join-Path $env:TEMP "cocos-cli-official-sync-3b526b9d"; $engine=Join-Path $root "engine-3.8.6"; $engineConfigPath=Join-Path $engine "cc.config.json"; $config=Get-Content -Raw -LiteralPath $engineConfigPath | ConvertFrom-Json; $html5=$config.moduleOverrides | Where-Object { $_.test -eq "context.buildTimeConstants && context.buildTimeConstants.HTML5" }; if ($html5.overrides."pal/system-info" -ne "pal/system-info/web/system-info.ts") { throw "Unexpected pal/system-info override" }; $html5.overrides."pal/system-info"="pal/system-info/web/system-info"; $config | ConvertTo-Json -Depth 100 | Set-Content -LiteralPath $engineConfigPath -Encoding utf8NoBOM; foreach ($projectName in @("cocos-test-projects","cocos-test-projects-mutable")) { $projectPackagePath=Join-Path $root "$projectName\package.json"; $package=Get-Content -Raw -LiteralPath $projectPackagePath | ConvertFrom-Json; $package."cocos-cli".enginePath=$engine; $package | ConvertTo-Json -Depth 100 | Set-Content -LiteralPath $projectPackagePath -Encoding utf8NoBOM }'
```

Expected：engine fixture 只修改 `cc.config.json`，两个 project fixtures 初始都只修改 `package.json`；`pal/system-info/web/system-info.ts` source 确实存在。只读 project fixture 用于 project-bound Vitest、CLI 和不落盘 browser tests；mutable fixture 仅用于 MCP save / restart / realm-isolation 验收，必须逐项记录预期资产变化并在验收后恢复。extensionless 候选数必须大于 0。

- [ ] 为长期 worktree 建立独立可运行环境。不得链接或复用主工作区 `node_modules`：

```powershell
rtk pwsh -NoProfile -Command '$worktree="E:\own_space\engines\cocos-cli\.worktrees\official-sync"; $projectRoot=Join-Path $env:TEMP "cocos-cli-official-sync-3b526b9d\cocos-test-projects"; $packageJson=Get-Content -Raw -LiteralPath (Join-Path $projectRoot "package.json") | ConvertFrom-Json; $enginePath=$packageJson."cocos-cli".enginePath; $engineLink=Join-Path $worktree "packages\engine"; if (Test-Path -LiteralPath $engineLink) { $item=Get-Item -LiteralPath $engineLink -Force; if ($item.LinkType -ne "Junction" -or $item.Target -notcontains $enginePath) { throw "Unexpected packages/engine link: $($item.Target)" } } else { New-Item -ItemType Junction -Path $engineLink -Target $enginePath | Out-Null }; $enginePath'
rtk npm ci
rtk npm --prefix vitests ci
rtk node -e "console.log(require.resolve('@cocos/asset-db')); console.log(require.resolve('@parcel/watcher')); console.log(require.resolve('jest'));"
rtk npm --prefix vitests exec -- vitest --version
```

Working directory：`SYNC_WORKTREE`。Expected：engine Junction 指向测试项目配置的 3.8.6 engine；依赖分别安装在本 worktree；`@cocos/asset-db` 解析到本 worktree `packages/asset-db`。如果 `npm ci` 需要修改 lockfile，停止，不允许用 `npm install` 掩盖。

## Task 2：启动 merge 并核对预测

- [ ] 在 `SYNC_WORKTREE` 启动不提交的 merge：

```powershell
rtk git merge --no-ff --no-commit 3b526b9d86519df1ee5046550aaa202d860ab15d
rtk git status --short --untracked-files=all
rtk git diff --name-only --diff-filter=U
```

Working directory：`E:\own_space\engines\cocos-cli\.worktrees\official-sync`。

Expected 直接冲突仅为：

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

- [ ] 将实际冲突与上述清单排序后机器比较，并把 expected / actual / diff 保存到 worktree 外的固定 evidence 目录：

```powershell
rtk pwsh -NoProfile -Command '$evidence=Join-Path $env:TEMP "cocos-cli-official-sync-3b526b9d\evidence\merge-conflicts"; New-Item -ItemType Directory -Force -Path $evidence | Out-Null; $expected=@(".gitignore","packages/cocos-cli-types/__tests__/__snapshots__/dts-snapshot.test.ts.snap","src/commands/preview.ts","src/core/assets/asset-config.ts","src/core/builder/index.ts","src/core/builder/share/common-options-validator.ts","src/core/builder/worker/builder/asset-handler/bundle/index.ts","src/core/builder/worker/builder/manager/task-base.ts","src/core/engine/index.ts","src/core/launcher.ts","src/core/scene/scene.scripting.middleware.ts") | Sort-Object; $actual=@(git diff --name-only --diff-filter=U) | Sort-Object; $expected | Set-Content -LiteralPath (Join-Path $evidence "expected.txt") -Encoding utf8NoBOM; $actual | Set-Content -LiteralPath (Join-Path $evidence "actual.txt") -Encoding utf8NoBOM; $delta=@(Compare-Object $expected $actual); $delta | Out-String | Set-Content -LiteralPath (Join-Path $evidence "diff.txt") -Encoding utf8NoBOM; if($delta.Count){ $delta | Format-Table | Out-String | Write-Error; exit 1 }'
```

Expected：`expected.txt` 与 `actual.txt` 都是 11 行且 `diff.txt` 为空。集合不同则保持 merge state，停止执行并重新确认。merge commit 前不修改分析报告，避免过程文档混入代码 merge commit。

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
rtk pwsh -NoProfile -Command '$projectRoot=Join-Path $env:TEMP "cocos-cli-official-sync-3b526b9d\cocos-test-projects"; $packageJson=Get-Content -Raw -LiteralPath (Join-Path $projectRoot "package.json") | ConvertFrom-Json; $enginePath=$packageJson."cocos-cli".enginePath; $env:COCOS_CLI_TEST_PROJECT_ROOT=$projectRoot; $env:COCOS_CLI_TEST_ENGINE_ROOT=[System.IO.Path]::GetFullPath($enginePath); npm --prefix vitests run test -- suites/runtime-preview/cli-startup.test.ts suites/runtime-preview/launcher-runtime-preview.test.ts'
```

Expected：mode 和参数矩阵全部通过；runtime path 不启动 scene RPC；缺省 path 不调用 runtime launcher。

- [ ] 只 stage 本任务明确修改的文件：

```powershell
rtk git add -- src/commands/preview.ts src/core/launcher.ts vitests/suites/runtime-preview/cli-startup.test.ts vitests/suites/runtime-preview/launcher-runtime-preview.test.ts
rtk git diff --name-only --diff-filter=U -- src/commands/preview.ts src/core/launcher.ts
rtk git diff --cached --check
```

## Task 4：`C-02`、`C-09` Scene editor、PreviewService 与共享 scripting routes

**Production files:**

- `src/core/scene/scene.scripting.middleware.ts`
- `src/core/preview/scripting-routes.ts`
- `src/core/scene/common/preview.ts`
- `src/core/scene/scene-process/service/preview/**`
- `src/core/scene/scene-process/engine-bootstrap.ts`
- `src/core/assets/asset-handler/assets/effect.ts`
- `src/core/assets/asset-handler/index.ts`
- `static/web/preview.ejs`
- `static/web/preview-app.js`

**Tests:**

- 新增或扩展 `src/core/preview/test/scripting-routes.spec.ts`
- `src/core/preview/test/scripting-routes.test.ts`
- 新增 `src/core/scene/test/preview-service.test.ts`
- 新增 `src/core/scene/test/engine-bootstrap-preview.test.ts`
- 新增 `src/core/scene/test/engine-bootstrap-prefab-atlas.test.ts`
- 新增 `src/core/assets/test/effect-prebuilt-fallback.test.ts`
- 新增 `src/core/preview/test/scripting-routes-security.spec.ts`
- `src/core/scene/test/prefab-editor-preview-canvas.test.ts`

- [ ] 采用官方精简 scene middleware 和共享 `scriptingRoutes`，不恢复旧路由复制。
- [ ] 仅将 effect settings 指向 `temp/cli/asset-db/effect/effect.bin`。
- [ ] normal / scene QuickPack 保持 `temp/programming`；runtime 保持自己的 `temp/cli/programming` 和 routes。
- [ ] 接收 `84000ea1` 的 graphics normalization；`/scripting/engine/modules` 对 `engine.graphics`、旧 `customPipeline`、selected config modules 的优先级与 `Engine.getConfig()` 一致，不建立 route-local 第二算法。
- [ ] 证明 route 注册顺序不会让 scene wildcard 抢占 `/` 或 shared scripting routes。
- [ ] 完整接收官方 PreviewService、scene engine bootstrap、effect fallback、public types 和 static resource preview page；`/preview` 只在 scene-enabled server stack（`--scene-editor` 和 `start-mcp-server`）可用，不接入 default game、legacy build 或 runtime server。每个 browser tab 自建独立 scene realm，不能描述为复用 MCP child scene worker。
- [ ] PreviewService focused tests 覆盖 supported material/model/mesh/prefab/skeleton/spine type resolution、unsupported type、`open()` active preview lifecycle、thumbnail 和 camera cleanup。测试只证明 scene service，不宣称资产编辑落盘。
- [ ] 不保留官方“整个 project root 可读”的宽边界。`/engine/read-file-sync` 只允许 canonical engine roots 和 AssetDB 实际 `library` roots；请求文件与 roots 都用 `realpath` 校验。安全 tests 必须覆盖合法 project / extension library file、`..`、percent-encoded traversal、prefix sibling 和 library 内 junction 指向外部文件；后四者返回 403。
- [ ] Engine bootstrap tests 覆盖 3.8.6：暂停 built-in loop、service init 前后 pause/resume、EffectAsset JSON / CCONB 注册、`loadAny()` fallback、camera / scene cleanup；不能用 `/preview` HTTP 200 替代。
- [ ] 保留 `5c2b76a6` 的 native extension recovery、partial asset 前置 cache、`nativeReady` 和 `inFlight` 先后关系，以及 adapter `installUuidUtilsCompatibility()`；但不照搬官方失败泄漏：dependency/native 失败时释放 `Details`、readiness、in-flight，并仅在 cache 仍指向本次创建对象时删除该 partial asset。Engine resume 从 EJS 移到 boot 后只调用一次。
- [ ] prefab/atlas focused test 使用真实 imported ImageAsset、Texture2D、SpriteFrame / SpriteAtlas 循环引用：并发请求同一 UUID 只触发一次 fetch/deserialize，cache hit 在 native ready 后返回非零宽高；在 cache 插入后分别注入 dependency/native failure，断言其它 owner cache 不被误删，第二次请求发生真实 fetch/deserialize 并成功。
- [ ] Effect tests 覆盖完整 imported records 和只有 prebuilt internal `.effect.meta` / library 两条路径，均必须生成非空 `temp/cli/asset-db/effect/effect.bin`。缺失或生成失败必须让 PreviewService acceptance 失败，不能只因 production 打印 warning 而通过。

Focused verification：

```powershell
rtk npx jest src/core/preview/test/scripting-routes.spec.ts src/core/preview/test/scripting-routes.test.ts src/core/preview/test/scripting-routes-security.spec.ts src/core/scene/test/preview-service.test.ts src/core/scene/test/engine-bootstrap-preview.test.ts src/core/scene/test/engine-bootstrap-prefab-atlas.test.ts src/core/assets/test/effect-prebuilt-fallback.test.ts src/core/scene/test/prefab-editor-preview-canvas.test.ts --runInBand
```

Expected：`/`、`/scene-editor/`、`/preview`、两个 effect endpoints、import-map 和 QuickPack 路径合同通过；PreviewService / bootstrap 在 3.8.6 上通过；atlas prefab texture 尺寸非零、循环和并发 load 无死锁或重复实例；normal / scene 不读取 runtime programming root；file route 不能越出 canonical engine / AssetDB library roots；effect.bin 非空。

- [ ] Stage 并确认本主题 direct conflict 已解除：

```powershell
rtk git add -- src/core/scene/scene.scripting.middleware.ts src/core/scene/scene-process/engine-bootstrap.ts static/web/scene-editor-boot.js static/web/scene-editor.ejs src/core/preview/scripting-routes.ts src/core/preview/test/scripting-routes.spec.ts src/core/preview/test/scripting-routes.test.ts src/core/preview/test/scripting-routes-security.spec.ts src/core/scene/test/preview-service.test.ts src/core/scene/test/engine-bootstrap-preview.test.ts src/core/scene/test/engine-bootstrap-prefab-atlas.test.ts src/core/assets/test/effect-prebuilt-fallback.test.ts src/core/scene/test/prefab-editor-preview-canvas.test.ts
rtk git diff --name-only --diff-filter=U -- src/core/scene/scene.scripting.middleware.ts
rtk git diff --cached --check
```

## Task 4A：`C-10` Dump service 与 prefab/component 落盘回归

**Production files:**

- `src/core/scene/scene-process/service/dump/service-access.ts`
- `src/core/scene/scene-process/service/dump/decode.ts`
- `src/core/scene/scene-process/service/dump/encode.ts`
- `src/core/scene/scene-process/service/node/index.ts`
- `src/core/scene/scene-process/service/component/index.ts`

**Tests:**

- 新增 `src/core/scene/test/dump-service-access.test.ts`
- 既有 node / component / prefab scene tests
- Task 9 的 MCP node/component/prefab E2E 与 dedicated restart persistence E2E

- [ ] 完整接收官方 `service-access` 解环结构，不恢复 Node / Component / Dump 的静态 circular imports。
- [ ] focused tests 在 child-worker 风格 service bundle 和 browser scene bundle 两种初始化顺序下验证 accessors 已注册；覆盖 node 删除 / 排序、component add / remove / recycle、component path encode 和节点引用恢复。
- [ ] 明确 PreviewService 打开的 prefab 是预览副本，不参与 Undo、dirty 或 save；真正落盘继续由 MCP scene editing -> `scene-save` 链路完成。

Focused verification：

```powershell
rtk npx jest src/core/scene/test/dump-service-access.test.ts --runInBand
```

Expected：两种 realm 初始化无 circular import undefined access；dump encode/decode 和引用恢复通过。重启后的真实落盘由 Task 9 的 `prefab-restart-persistence.e2e.test.ts` 证明。

- [ ] 对本任务新增 / 修改 tests 精确 stage；官方 auto-merged production files 保持现有 index，除非实际修订后逐路径 stage：

```powershell
rtk git add -- src/core/scene/test/dump-service-access.test.ts
rtk git diff --cached --check
```

## Task 4B：`C-11` Animation 实时同步、保存与 session re-enter

**Production files:**

- `src/core/scene/scene-process/service/animation.ts`
- `src/core/scene/scene-process/service/animation/service-playback.ts`
- `src/core/scene/scene-process/service/asset.ts`

**Test:**

- `src/core/scene/test/animation-service-playback.test.ts`
- `src/core/scene/test/animation-service-enter.test.ts`
- `src/core/scene/test/animation-clip-operations.test.ts`
- Task 9 新增 `e2e/mcp/api/animation-clip-restart-persistence.e2e.test.ts`

- [ ] 接收官方 playing-state contract：播放中 property query 返回节点当前实时值，不调用 `setTime()` / `sample()`；确定 frame sampling 必须先 pause。
- [ ] 使用 fake timers 验证初始 0 不广播、首次非零时间及时广播、时间单调、广播频率有上限；pause / resume / stop / natural completion / realm dispose 后 timer count 为 0。
- [ ] 加入慢 listener / IPC backlog 模拟，证明约 60 Hz source 不会无界排队；如果现有实现无法满足，停止并重新决策，不静默降回旧 10 Hz。
- [ ] 接收 `eb20da14` / `d0768c59` 的 reset-before-edit、self-save snapshot restore 和 state recreation；覆盖播放中编辑、保存、undo/redo 后当前时间、curve 数据和 Animation component 都绑定最新 clip instance，运行态采样值不写回 source。
- [ ] 接收 `3b526b9d` 的 `AnimationService.preserveCurrentClipAssetForChange()` 与 AssetService 协作。保存后 exit/re-enter 同一 clip，再触发 `assetChanged(clipUuid)` 时保留 authoritative `AnimationState.clip` 并重新绑定 component；不得在 session dispose 时清空尚待消费的 self-save suppression。
- [ ] 增加 current clip with state、current clip without state、non-current clip、delete current clip 四类测试。只有第一类允许跳过 `releaseAsset()` / watcher reload；其它 change/delete 行为保持原合同，避免 suppression 泄漏后吞掉普通资产刷新。

Focused verification：

```powershell
rtk npx jest src/core/scene/test/animation-service-playback.test.ts src/core/scene/test/animation-service-enter.test.ts src/core/scene/test/animation-clip-operations.test.ts --runInBand
```

Expected：实时 query、时间广播、edit/save/undo/redo state recreation、save -> exit -> re-enter refresh suppression 和所有 cleanup paths 通过；non-current / delete 不被误抑制。

本 Task 的 Jest 只证明 service 内部合同；“真实 edit/save sync 可用”的结论必须等 Task 9 的 scene/MCP、AssetDB reimport 和新进程重启 E2E 通过。

```powershell
rtk git add -- src/core/scene/scene-process/service/animation.ts src/core/scene/scene-process/service/animation/service-playback.ts src/core/scene/scene-process/service/animation/clip-operations.ts src/core/scene/scene-process/service/asset.ts src/core/scene/test/animation-service-playback.test.ts src/core/scene/test/animation-service-enter.test.ts src/core/scene/test/animation-clip-operations.test.ts
rtk git diff --cached --check
```

## Task 5：`C-03`、`C-04` Builder lifecycle 与配置真相源

**Production files:**

- `src/core/builder/index.ts`
- `src/core/builder/share/common-options-validator.ts`
- `src/core/builder/preview-options.ts`
- `src/core/builder/manager/plugin.ts`
- `src/core/engine/graphics-config.ts`
- `src/core/engine/@types/config.d.ts`
- `src/core/engine/metadata.ts`
- `src/core/configuration/migration/register-migration.ts`
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
- `src/core/builder/test/query-platform-build-schema.spec.ts`
- `src/core/builder/test/lib-create-build-template.spec.ts`
- `src/core/configuration/test/cocos-migration.test.ts`
- `src/core/configuration/test/metadata.test.ts`

- [ ] 接收官方 `clearCache` exports、`.log` 文件规范化、早失败 log sink 和 stage runtime options merge。
- [ ] 保留 `init(platform, projectRoot?)`、project extension registration、`runErrorHook()` 和 `createPreviewBuildOptions()`。
- [ ] 接收缺少 build template 时的 throw contract；内置 platform package 与 project extension package 同名时保持显式冲突，不允许静默覆盖。Google Play 是否公开由 `C-15` 的完整产物验收共同决定。
- [ ] 使用 `rtk rg -n "\binit\(" src/core src/api` 列出 builder `init()` 调用点，逐项判断 instance build / legacy preview 是否必须传 `projectRoot`；把清单和结论写入执行记录。
- [ ] `Engine.getConfig()` resolver 唯一决定 `includeModules`；`CocosConfigLoader` 如保留，只能读取 preview graphics pipeline。
- [ ] 接收 `engine.graphics` types、normalization helper、metadata / i18n 和旧配置 migration。`graphics.pipeline` / post-process 与 `includeModules` 双向规范化，`CUSTOM_PIPELINE_NAME` 只在 graphics metadata 出现一次；旧 `customPipeline` 只作兼容输入，不继续作为持久化真相源。
- [ ] `C-14` 解决 `engine/index.ts` direct conflict 时必须调用本 Task 的 graphics helper；禁止在 EngineManager 内再复制一套 pipeline/module 算法。
- [ ] clone `physicsConfig` 后再按 dependent asset 添加或删除 default material，不能修改 Engine config 原对象。
- [ ] 添加连续两次配置/build 的测试，证明第一轮后处理不会污染第二轮。

Focused verification：

```powershell
rtk npx jest src/core/builder/test/execute-build-stage-task.spec.ts src/core/builder/test/project-extension-builder-hooks.spec.ts src/core/builder/test/run-error-hook.spec.ts src/core/builder/test/preview-settings-debug-option.spec.ts src/core/builder/test/check-options.spec.ts src/core/builder/test/physics-default-material.spec.ts src/core/builder/test/clear-cache.spec.ts src/core/builder/test/lib-clear-cache.spec.ts src/core/builder/test/common-options-validator.spec.ts src/core/builder/test/create-build-stage-task.spec.ts src/core/builder/test/build-task-next-stages.spec.ts src/core/builder/test/query-platform-build-schema.spec.ts src/core/builder/test/lib-create-build-template.spec.ts src/core/configuration/test/cocos-migration.test.ts src/core/configuration/test/metadata.test.ts --runInBand
```

Expected：官方 log/cache/stage tests 和 adapter extension/runtime settings tests 同时通过；没有双 `includeModules` 真相源或 config object 污染。

本 Task 不运行或 stage `src/core/engine/test/engine.test.ts`：此时 `src/core/engine/index.ts` 仍是 `C-14` 的未解决直接冲突。Engine live config、graphics/JTL parity 和该测试统一延后到 Task 7B，在最终 `engine/index.ts` 实现上执行。

- [ ] Stage 本主题文件和实际修改的相关 tests，不使用目录级 `git add`：

```powershell
rtk git add -- src/core/builder/index.ts src/core/builder/share/common-options-validator.ts src/core/builder/preview-options.ts src/core/builder/manager/plugin.ts src/core/engine/graphics-config.ts src/core/engine/@types/config.d.ts src/core/engine/metadata.ts src/core/configuration/migration/register-migration.ts src/core/builder/test/execute-build-stage-task.spec.ts src/core/builder/test/project-extension-builder-hooks.spec.ts src/core/builder/test/run-error-hook.spec.ts src/core/builder/test/preview-settings-debug-option.spec.ts src/core/builder/test/check-options.spec.ts src/core/builder/test/physics-default-material.spec.ts src/core/builder/test/clear-cache.spec.ts src/core/builder/test/lib-clear-cache.spec.ts src/core/builder/test/common-options-validator.spec.ts src/core/builder/test/create-build-stage-task.spec.ts src/core/builder/test/build-task-next-stages.spec.ts src/core/builder/test/query-platform-build-schema.spec.ts src/core/builder/test/lib-create-build-template.spec.ts src/core/configuration/test/cocos-migration.test.ts src/core/configuration/test/metadata.test.ts static/i18n/en/configuration.json static/i18n/zh/configuration.json
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

## Task 7A：`C-13` Plugin script order 与 AssetDB ownership

**Production files:**

- `src/core/assets/asset-config.ts`
- `src/core/assets/index.ts`
- `src/core/scripting/shared/query-shared-settings.ts`
- `src/core/configuration/script/metadata.ts`

**Tests:**

- `src/core/assets/test/config-sync.test.ts`
- 新增 `src/core/assets/test/asset-config-listener-lifecycle.test.ts`
- 新增 `src/core/assets/test/sorting-plugin-runtime-flow.test.ts`
- adapter shared library / records / extension mount tests

- [ ] 以 adapter 的 `temp/cli/asset-db`、shared/non-shared records、internal library 和 `resolveProjectExtensionAssetDbMounts()` 为主干，接入官方 `setSortingPlugin()`、初始 sync、late script registry、update/remove/reload listeners。
- [ ] 排序值只接受 string UUID array；配置 remove 后立刻清空。同一进程重复 init / close / reopen 不增加 listener 数，不让旧项目 listener 响应新项目配置。
- [ ] 证明 sorting 更新改变 `querySortedPlugins()` 返回顺序，并由 preview `settings.plugins.jsList`、scene script service、build data task / bundle script load 消费；它不改变 importer pipeline，也不重建或覆盖 `assetDBList`、records、mounts 和 `createTemplateRoot`。

```powershell
rtk npx jest src/core/assets/test/config-sync.test.ts src/core/assets/test/asset-config-listener-lifecycle.test.ts src/core/assets/test/sorting-plugin-runtime-flow.test.ts src/core/assets/test/asset-db-internal-record.test.ts src/core/assets/test/asset-db-shared-library-output.test.ts src/core/assets/test/asset-db-shared-library-records.test.ts src/core/assets/test/extension-asset-db-mounts.spec.ts --runInBand
rtk git add -- src/core/assets/asset-config.ts src/core/assets/index.ts src/core/scripting/shared/query-shared-settings.ts src/core/configuration/script/metadata.ts src/core/assets/test/config-sync.test.ts src/core/assets/test/asset-config-listener-lifecycle.test.ts src/core/assets/test/sorting-plugin-runtime-flow.test.ts
rtk git diff --name-only --diff-filter=U -- src/core/assets/asset-config.ts
rtk git diff --cached --check
```

Expected：初始、late registry、update、remove、reload 和重复生命周期均通过；query / preview / scene / build 得到同一 plugin UUID 顺序；adapter 的四组 AssetDB ownership tests 不回退，`asset-config.ts` direct conflict 已解除。

## Task 7B：`C-14` Joint Texture Layout、Graphics normalization 与 Engine runtime mode

**Production files:**

- `src/core/engine/index.ts`
- `src/core/engine/graphics-config.ts`
- `src/core/engine/joint-texture-layout.ts`
- `src/core/engine/@types/config.d.ts`
- `src/core/engine/metadata.ts`
- `src/core/builder/worker/builder/tasks/setting-task/utils/project-options.ts`
- `src/lib/engine/engine.ts`
- `src/core/engine/test/engine.test.ts`
- 新增 `vitests/suites/runtime-preview/joint-texture-layout-settings-parity.test.ts`
- 新增 `vitests/suites/runtime-preview/engine-graphics-settings-parity.test.ts`

- [ ] 在 adapter EngineManager 上叠加官方 preview query、resolver 和 `animation.customJointTextureLayouts` settings；保留 `EngineRuntimeMode`、project engine root、`installUuidUtilsCompatibility()`、browser-owned builtin assets / physics 语义。
- [ ] 同一 `engine/index.ts` conflict 同时接入 `C-04` 的 official graphics normalization；`getConfig()`、`getGameConfig()`、`initEngine()` 中 pipeline/modules 和 JTL 注入都不能覆盖 adapter runtimeMode / browser-owned physics/builtin 语义。
- [ ] game preview、runtime preview 和 build setting task 均调用同一个 resolver；UUID skeleton / clips 从当前 AssetDB imported records 读取 hash、sample、duration、joints count。新增同一真实 3.8.6 fixture 的交叉路径测试，逐项比较三条路径的 hash、textureLength、contents 和 missing UUID；number 兼容、重复 UUID和 device tip 行为与官方 tests 一致。
- [ ] 对同一 fixture 的 absent/partial/full graphics、legacy/custom/post-process 和旧 customPipeline 输入，逐项比较 Engine live config、normal route、game settings、runtime settings 与 build settings 的 modules / customPipeline；不允许只比较 helper unit output。
- [ ] 不整文件采用 official 或 adapter。若 3.8.6 imported asset shape 不满足 resolver，记录实际 shape 并回到 `C-14` 决策，不用 test-only fallback。

```powershell
rtk npx jest src/core/engine/test/engine.test.ts src/core/engine/test/joint-texture-layout.test.ts tests/engine-lib.test.ts --runInBand
rtk pwsh -NoProfile -Command '$projectRoot=Join-Path $env:TEMP "cocos-cli-official-sync-3b526b9d\cocos-test-projects"; $packageJson=Get-Content -Raw -LiteralPath (Join-Path $projectRoot "package.json") | ConvertFrom-Json; $env:COCOS_CLI_TEST_PROJECT_ROOT=$projectRoot; $env:COCOS_CLI_TEST_ENGINE_ROOT=[System.IO.Path]::GetFullPath($packageJson."cocos-cli".enginePath); npm --prefix vitests run test -- suites/runtime-preview/settings-generation.test.ts suites/runtime-preview/joint-texture-layout-settings-parity.test.ts suites/runtime-preview/engine-graphics-settings-parity.test.ts'
rtk git add -- src/core/engine/index.ts src/core/engine/graphics-config.ts src/core/engine/joint-texture-layout.ts src/core/engine/@types/config.d.ts src/core/engine/metadata.ts src/core/builder/worker/builder/tasks/setting-task/utils/project-options.ts src/lib/engine/engine.ts src/core/engine/test/engine.test.ts src/core/engine/test/joint-texture-layout.test.ts tests/engine-lib.test.ts vitests/suites/runtime-preview/joint-texture-layout-settings-parity.test.ts vitests/suites/runtime-preview/engine-graphics-settings-parity.test.ts
rtk git diff --name-only --diff-filter=U -- src/core/engine/index.ts
rtk git diff --cached --check
```

Expected：resolver、public API、真实 3.8.6 AssetDB shape 和 game/runtime/build settings parity 通过，adapter runtime mode 没有回退。

## Task 8A：`C-15` iOS / Google Play / Android / Web Mobile platform views 与发布物

- [ ] 完整接收官方 iOS / Google Play / Android / Web Mobile package 重组、Pink custom view / host、static assets 和 workflow scripts；只公开 Google Play，继续隐藏本轮没有完整 package/view 验收的 `fb-instant-games`。
- [ ] Android / Web Mobile 的 config、hooks、type、utils 已迁入 package `src/`；public option imports、package `contributes.builder`、PluginManager registration 和实际 build hook load 必须全部指向新路径，不保留只在旧目录存在的引用。
- [ ] `PluginManager` 同时保留 adapter project extension `source` / `projectRoot` / `fatal` / `editorFacade` metadata；内置平台和项目扩展同名时显式失败。
- [ ] root `compile` / `build` 按官方生成 platform views，并保留 adapter 既有 `build:runtime-preview-app` / release tools 入口及 static web、schema / DTS 顺序；不擅自把独立 runtime app build 塞进 root compile，也不手工提交 ignored `src/core/builder/platforms/*/dist`。
- [ ] 四个 platform scripts 直接 `require('esbuild')`，但 target root manifest 未声明它。用受控 `--package-lock-only` 命令把 `esbuild@0.25.11` 精确写为 root `devDependency`，审查 manifest/lock diff；随后 clean `npm ci`，确认 root 直接 owner 后才运行 view build，不依赖 transitive hoist。
- [ ] 增加 `src/core/builder/test/platform-view-build.spec.ts`：从最终 root `dist` 加载 browser ESM / Node host bundle，mock Pink bridge，验证 iOS `developerTeam`、Google Play keystore/icon/API、Android API level/debug/custom keystore/bridge methods 和 Web Mobile WebGPU/preview URL/QR 的读写；同时验证 Google Play visible、FB hidden 和四个平台 package/static/dist 清单。该测试在 Task 9 完整 build 后执行。
- [ ] 增加 `src/core/builder/test/platform-package-registration.spec.ts`：从最终 root `dist` 的 package metadata 注册 Android / Web Mobile builder，执行 config load 和最小 hook dispatch，证明新 `src/` path 与实际 build 入口一致；UI bundle load 不能替代该测试。public option type import 由 root TypeScript compile 和旧路径零引用检查证明。该测试也在 Task 9 完整 build 后执行。
- [ ] Web Mobile 验收拆成两条合同：builder `onAfterBuild()` / `run()` 返回 `buildExitRes.custom.previewUrl`；Pink host 根据 active project 注册 build output route，并覆盖普通 QR、WebGPU + HTTP secure-context 提示和 HTTPS 分支。不得只验证 UI 字段回写。
- [ ] Android host 验证 `getAndroidAPILevels()` 的 env/default SDK fallback、`getNativeEngineInfo()` builtin fallback、`openEngineSettings()` / `openProgramSettings()` command bridge，以及 FilePicker 的 keystore path 回写、debug/custom 切换和必填校验。

```powershell
rtk npm install --save-dev --save-exact esbuild@0.25.11 --package-lock-only --ignore-scripts
rtk git diff -- package.json package-lock.json
rtk npm ci
rtk npm ls esbuild
rtk node -e "const p=require('./package.json'); if(p.devDependencies?.esbuild!=='0.25.11') process.exit(1); console.log(require.resolve('esbuild'))"
rtk npm run build:platform-views
rtk pwsh -NoProfile -Command '$roots=@("src/core/builder/platforms/ios","src/core/builder/platforms/google-play","src/core/builder/platforms/android","src/core/builder/platforms/web-mobile"); foreach($root in $roots){ foreach($path in @("dist/view/build-config.js","dist/view/build-config-host.js")){ if(-not (Test-Path -LiteralPath (Join-Path $root $path))){ throw "Missing source platform view artifact: $root/$path" } } }'
rtk git add -- .gitignore package.json package-lock.json src/core/builder/manager/plugin.ts workflow/build-platform-assets.js workflow/build-platform-views.js src/core/builder/test/platform-view-build.spec.ts src/core/builder/test/platform-package-registration.spec.ts
rtk git diff --name-only --diff-filter=U -- .gitignore
rtk git diff --cached --check
```

Expected：四个平台的 source view/host bundle 可生成；root manifest/lock 直接拥有 `esbuild@0.25.11`，`.gitignore` 同时保护 platform dist、runtime preview dist 和 versioned Creator tools。最终 root dist、registration、hook dispatch 和 pack 验收必须等 Task 9 完整 build 后执行，本 Task 的 source bundle preflight 不得替代它们。

## Task 8：`C-08` Dependency 和 vendored ownership

**Files:**

- `package.json`
- `package-lock.json`
- `packages/asset-db/**`
- `vitests/package.json` / `vitests/package-lock.json`
- `.gitignore`

- [ ] 接收官方 CLI 版本、Pink requirement、DTS memory 参数和 `build:platform-views`；`build` / `compile` 保留官方调用位置。
- [ ] 保留 `@cocos/asset-db: file:./packages/asset-db`、vendored package files、`@parcel/watcher`、`build:runtime-preview-app`、runtime preview 和 release scripts。
- [ ] `.gitignore` 合并为四个明确 owner：官方 platform view dist、adapter runtime preview app dist、`.codex` 文档目录和 versioned `static/tools/creator-3.8.6`；不得用宽泛 `static/tools/` 重新忽略已版本化工具。
- [ ] 检查 staged lockfile root、local link 和 package entry，不运行无约束 dependency upgrade；然后在 merged lockfile 上重新执行独立 `npm ci`。

Verification：

```powershell
rtk git diff --cached -- .gitignore package.json package-lock.json packages/asset-db vitests/package.json vitests/package-lock.json
rtk npm ci
rtk npm --prefix vitests ci
rtk npm ls @cocos/asset-db @parcel/watcher
rtk npm pack --dry-run --json
rtk npm view @cocos/asset-db dist-tags --json
```

Expected：解析到 local `packages/asset-db@3.0.0-alpha.10` 和预期 watcher；pack dry-run 文件清单包含 vendored `packages/asset-db`。固定 `TARGET` 的 package / lockfile 是本轮 dependency 依据；registry 查询只作 freshness evidence。若 registry latest 前进，登记独立 asset-db upgrade 分析，但不临时改变本轮固定 target，也不在本轮升级。

## Task 9：`C-12` 编译、DTS contract、全量 focused 回归和生成物审计

**CI / typecheck files:**

- `.github/workflows/check-dts.yml`
- 新增 `packages/cocos-cli-types/tsconfig.typecheck.json`

- [ ] 先验证固定 `TARGET` 的 `check-dts.yml` 引用不存在的 `packages/cocos-cli-types/tsconfig.typecheck.json`，并用 `grep "^packages/cocos-cli-types/" || true` 吞掉 `TS5058` 等不匹配该前缀的 config 级错误。新增 config，`files` 精确列出 `index.d.ts`、`assets.d.ts`、`base.d.ts`、`configuration.d.ts`、`engine.d.ts`、`project.d.ts`、`scripting.d.ts`、`builder.d.ts`、`cli.d.ts` 和 CI 在 typecheck 前复制的 `cc.d.ts`；compiler options 固定为 `noEmit: true`、`skipLibCheck: false`、`target: ES2022`、`module: Node16`、`moduleResolution: Node16`。
- [ ] 将 workflow 的 Typecheck step 简化为直接执行 `npx tsc -p packages/cocos-cli-types/tsconfig.typecheck.json --noEmit`，由 shell 保留真实退出码；不保留 output grep、`|| true` 或其它错误过滤。使用不存在 config 的同形式对照命令验证非零，再用正确 config 验证为 0；两次都使用与 CI 相同的 bash shell 形式。

- [ ] build 前记录 unstaged / staged 状态和当前 generated declarations hashes，避免 merge index 中的大量 staged files掩盖 generator 变化：

```powershell
rtk git diff --name-status
rtk git diff --cached --name-status
rtk pwsh -NoProfile -Command '$evidence=Join-Path $env:TEMP "cocos-cli-official-sync-3b526b9d\evidence\build-generated"; New-Item -ItemType Directory -Force -Path $evidence | Out-Null; $unstaged=@(git diff --name-only); $unstaged | Set-Content -LiteralPath (Join-Path $evidence "before-seed-unstaged.txt") -Encoding utf8NoBOM; if($unstaged.Count -ne 1 -or $unstaged[0] -ne "packages/cocos-cli-types/__tests__/__snapshots__/dts-snapshot.test.ts.snap"){ throw "Unexpected unstaged files before DTS seed: $($unstaged -join ', ')" }'
rtk pwsh -NoProfile -Command 'Get-ChildItem packages/cocos-cli-types -Filter *.d.ts | Get-FileHash -Algorithm SHA256 | Sort-Object Path | Format-Table Path,Hash -AutoSize'
rtk npx jest tests/generate-dts-postprocess.test.ts --runInBand
```

Expected：focused postprocess test 证明 `@cocos/asset-db/libs/filesystem` 合并 import 和 `StatsQuery.ConstantManager` namespace 修正。

- [ ] 运行官方 extensionless import-map 回归：

```powershell
rtk npx jest tests/engine-compiler-fix-import-map-extensions.test.ts --runInBand
```

Expected：有 `.js` 或 `.ts` source 的 extensionless `q-bundled:///fs/*` entry 被规范为 `.js`；其它 entry 不变。

- [ ] DTS snapshot 冲突只用固定 `TARGET` 内容作为 generator seed，不作为最终选边。随后只运行一次完整 build：

```powershell
rtk git restore --source=3b526b9d86519df1ee5046550aaa202d860ab15d --worktree -- packages/cocos-cli-types/__tests__/__snapshots__/dts-snapshot.test.ts.snap
rtk pwsh -NoProfile -Command '$evidence=Join-Path $env:TEMP "cocos-cli-official-sync-3b526b9d\evidence\build-generated"; $seed=@(git diff --name-only); $seed | Set-Content -LiteralPath (Join-Path $evidence "after-seed-unstaged.txt") -Encoding utf8NoBOM; if($seed.Count -ne 1 -or $seed[0] -ne "packages/cocos-cli-types/__tests__/__snapshots__/dts-snapshot.test.ts.snap"){ throw "Unexpected DTS seed diff: $($seed -join ', ')" }'
rtk npx tsc -b --pretty false
rtk npm run build
rtk npm pkg set version=0.0.1-alpha.33.1 --prefix packages/cocos-cli-types
rtk git status --short --untracked-files=all
rtk pwsh -NoProfile -Command '$evidence=Join-Path $env:TEMP "cocos-cli-official-sync-3b526b9d\evidence\build-generated"; $expected=@("packages/cocos-cli-types/__tests__/__snapshots__/dts-snapshot.test.ts.snap","packages/cocos-cli-types/package.json") | Sort-Object; $actual=@(git diff --name-only) | Sort-Object; $actual | Set-Content -LiteralPath (Join-Path $evidence "after-build-unstaged.txt") -Encoding utf8NoBOM; $delta=@(Compare-Object $expected $actual); $delta | Out-String | Set-Content -LiteralPath (Join-Path $evidence "after-build-diff.txt") -Encoding utf8NoBOM; if($delta.Count){ $delta | Format-Table | Out-String | Write-Error; exit 1 }'
rtk pwsh -NoProfile -Command 'Get-ChildItem packages/cocos-cli-types -Filter *.d.ts | Get-FileHash -Algorithm SHA256 | Sort-Object Path | Format-Table Path,Hash -AutoSize'
```

Expected：`npm run build` 退出码 0，完成 dist、static、schema 和唯一一次 DTS 生成；最终 types package version 固定为官方 `TARGET` 的 `0.0.1-alpha.33.1`，不能采用 registry 动态计算出的下一版本。tracked 变化只允许 `packages/cocos-cli-types/package.json` 和 DTS snapshot；生成的 `*.d.ts` 被 `.gitignore` 排除，不应 stage，改由 types tests 和 pack dry-run 审计。其它 tracked generated diff 必须逐项解释，否则停止。

- [ ] 完整 build 后执行 `C-15` 最终发布物验收；Task 8A 的 source view bundle preflight 不能替代本步骤：

```powershell
rtk rg -n "platforms/(android|web-mobile)/(config|hooks|type|utils)" src tests packages
rtk npx jest src/core/builder/test/query-platform-build-schema.spec.ts src/core/builder/test/platform-view-build.spec.ts src/core/builder/test/platform-package-registration.spec.ts --runInBand
rtk pwsh -NoProfile -Command '$platforms=@("ios","google-play","android","web-mobile"); $common=@("package.json","src/config.js","src/hooks.js","src/type.js","i18n/en.js","i18n/zh.js","static/card.png","static/icon.png","dist/view/build-config.js","dist/view/build-config-host.js"); $extra=@{ ios=@("src/utils.js"); "google-play"=@("src/utils.js","src/custom-icon.js","static/platform-intro/README.md","static/platform-intro/README.zh-cn.md"); android=@("src/utils.js","static/platform-intro/README.md","static/platform-intro/README.zh-cn.md"); "web-mobile"=@() }; foreach($platform in $platforms){ $root="dist/core/builder/platforms/$platform"; foreach($path in @($common + $extra[$platform])){ if(-not (Test-Path -LiteralPath (Join-Path $root $path))){ throw "Missing final platform artifact: $root/$path" } }; $pkg=Get-Content -Raw -LiteralPath (Join-Path $root "package.json") | ConvertFrom-Json; foreach($entry in @($pkg.contributes.builder.config,$pkg.contributes.builder.hooks,$pkg.contributes.pinkBuilder.customView,$pkg.contributes.pinkBuilder.customExtensionHost)){ $relative=([string]$entry).TrimStart([char[]]"./"); $candidate=Join-Path $root $relative; if(-not (Test-Path -LiteralPath $candidate) -and -not (Test-Path -LiteralPath "$candidate.js")){ throw "Broken platform manifest path: $platform -> $entry" } } }'
rtk pwsh -NoProfile -Command '$pack=@(npm pack --dry-run --json | ConvertFrom-Json)[0]; $files=@($pack.files.path); $platforms=@("ios","google-play","android","web-mobile"); $common=@("package.json","src/config.js","src/hooks.js","src/type.js","i18n/en.js","i18n/zh.js","static/card.png","static/icon.png","dist/view/build-config.js","dist/view/build-config-host.js"); $extra=@{ ios=@("src/utils.js"); "google-play"=@("src/utils.js","src/custom-icon.js","static/platform-intro/README.md","static/platform-intro/README.zh-cn.md"); android=@("src/utils.js","static/platform-intro/README.md","static/platform-intro/README.zh-cn.md"); "web-mobile"=@() }; $expected=@(); foreach($platform in $platforms){ $root="dist/core/builder/platforms/$platform"; foreach($path in @($common + $extra[$platform])){ $expected += "$root/$path" } }; $missing=@($expected | Where-Object { $files -notcontains $_ }); if($missing.Count){ throw "Pack missing platform files: $($missing -join ', ')" }'
```

Expected：第一条旧路径扫描无输出；root TypeScript build 已验证 public type import。registration test 从最终 `dist` 注册并 dispatch Android / Web Mobile hooks；Web Mobile 的 build/run URL 与 Pink route/QR/WebGPU 分支、Android 四个 host methods / SDK fallback / FilePicker 校验均通过。四个平台 manifest 的 builder/view paths 全部指向可加载文件，具体 compiled source、i18n、static、platform intro 和 view/host 同时存在于最终 root dist 与 `npm pack` 清单。

- [ ] Stage 生成物并确认最后一个 direct conflict 解除：

```powershell
rtk git add -- packages/cocos-cli-types/package.json packages/cocos-cli-types/__tests__/__snapshots__/dts-snapshot.test.ts.snap
rtk git diff --name-only --diff-filter=U
rtk git diff --cached --check
rtk npm --prefix packages/cocos-cli-types pack --dry-run --json
```

Expected：无 unmerged paths；types package pack 文件清单包含生成后的 declarations。vendored `packages/asset-db` 由 Task 8 的 root pack dry-run 单独审计。

- [ ] 对生成 declarations 做 consumer-level typecheck 和关键 contract 检查。先模拟 CI 复制 engine declaration，再执行与 workflow 相同的 project command：

```powershell
rtk pwsh -NoProfile -Command '$gitBash="C:\Program Files\Git\bin\bash.exe"; if(-not (Test-Path -LiteralPath $gitBash)){ throw "Git Bash not found: $gitBash" }; Copy-Item -LiteralPath packages/engine/bin/.declarations/cc.d.ts -Destination packages/cocos-cli-types/cc.d.ts -Force'
rtk "C:\Program Files\Git\bin\bash.exe" -lc 'npx tsc -p packages/cocos-cli-types/does-not-exist.json --noEmit'
rtk "C:\Program Files\Git\bin\bash.exe" -lc 'npx tsc -p packages/cocos-cli-types/tsconfig.typecheck.json --noEmit'
rtk node -e "console.log(require.resolve('@cocos/asset-db/libs/filesystem'))"
rtk pwsh -NoProfile -Command 'Select-String -Path packages/cocos-cli-types/builder.d.ts -Pattern "@cocos/asset-db/libs/filesystem","StatsQuery.ConstantManager"'
```

Expected：第一条 typecheck 对照命令因 `TS5058` 非 0，第二条与 workflow 相同的 command 退出 0；vendored filesystem type 可解析；builder declaration 不再引用旧 `./filesystem`，namespace 外 bare `ConstantManager` 已修正。`cc.d.ts` 是 ignored CI 临时文件，不 stage。

- [ ] Stage CI typecheck config：

```powershell
rtk git add -- .github/workflows/check-dts.yml packages/cocos-cli-types/tsconfig.typecheck.json
rtk git diff --cached --check
```

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

- [ ] 运行 scene dump / node / component / prefab E2E，验证官方 circular-import fix 没有破坏 adapter scene editing：

```powershell
rtk npm run test:e2e -- --runTestsByPath e2e/mcp/api/node.e2e.test.ts e2e/mcp/api/component.e2e.test.ts e2e/mcp/api/prefab.e2e.test.ts e2e/mcp/api/editor-prefab.e2e.test.ts --runInBand
```

Expected：scene process 可启动，node/component dump encode/decode、prefab open/save/reload 通过；该测试不证明 `/preview` browser canvas。

- [ ] 新增并运行 `e2e/mcp/api/prefab-restart-persistence.e2e.test.ts`。测试必须要求 `COCOS_CLI_OFFICIAL_SYNC_MUTABLE_PROJECT_ROOT`，通过既有 `createTestProject()` 从该 fixture 创建独立 E2E workspace。第一个 `MCPTestClient({ projectPath: testProject.path })` 启动后，用 `fs.copyFile()` 只复制 `assets/resources/test_assets/prefab.prefab` source 到唯一 `assets/e2e-official-sync/prefab-restart-<test-id>.prefab`，禁止复制原 `.meta`；轮询 `assets-query-uuid` 的 `db://assets/e2e-official-sync/prefab-restart-<test-id>.prefab`，直到 AssetDB import 产生非空且不同于原 prefab 的新 UUID。随后通过真实 transport 打开新 UUID，创建 marker node，在另一节点添加 `cc.Button`，设置 `interactable=false` 和 `target=<marker node>`，执行 `scene-save`，轮询 AssetDB reimport / query 成功，然后完全关闭 client / server。第二个新建的 `MCPTestClient({ projectPath: sameTestProject.path })` 重新打开并 query，逐项断言组件、boolean 字段和 target node UUID / path 均保持。`finally` 使用 `assets-delete-asset` 删除唯一 db URL，轮询 `assets-query-uuid` 为空且 source / generated `.meta` 消失，再清理 E2E workspace；fixture 原 prefab 与 `.meta` 不得被修改。

```powershell
rtk pwsh -NoProfile -Command '$env:COCOS_CLI_OFFICIAL_SYNC_MUTABLE_PROJECT_ROOT=Join-Path $env:TEMP "cocos-cli-official-sync-3b526b9d\cocos-test-projects-mutable"; npm run test:e2e -- --runTestsByPath e2e/mcp/api/prefab-restart-persistence.e2e.test.ts --runInBand'
```

Expected：断言发生在第二个 MCP process；仅 reload 同一 process 不算通过。若 save、reimport 或 restart 任一步只能依赖固定 sleep，测试不合格。

- [ ] 新增并运行 `e2e/mcp/api/animation-clip-restart-persistence.e2e.test.ts`。使用 mutable project fixture 中已有 `assets/resources/test_assets/testAnim.anim`，在 `createTestProject()` 产生的隔离 workspace 内通过真实 scene/MCP API 给测试 prefab root 配置 `cc.Animation` 与该 clip，进入 animation session，播放后执行一次 curve/keyframe edit 和 save。save 前订阅并记录 AssetDB / scene asset-change 事件及时间点；save 返回后不先等待 reimport，立即在同一 scene worker 退出 animation session并重新进入同一 clip，然后等待真实 `assetChanged`。必须断言该 current-clip change 发生在 re-enter 完成之后；若事件已在退出前或 re-enter 期间被消费，本轮证据无效并失败，不能用后续 query 冒充跨 session suppression。事件完成后 query 必须仍返回刚保存的 curve/event，component 绑定当前 state，且非当前 animation asset 的 change 仍可观察到 refresh。随后关闭首个 client/server；第二个 `MCPTestClient` 重新打开同一 workspace，进入同一 clip 并 query，断言保存值、当前 clip 绑定和可播放状态。测试不得 mock AnimationState、asset refresh 或 save；workspace 销毁前直接检查 `.anim` source 已变化，fixture 原仓库保持 clean。

```powershell
rtk pwsh -NoProfile -Command '$env:COCOS_CLI_OFFICIAL_SYNC_MUTABLE_PROJECT_ROOT=Join-Path $env:TEMP "cocos-cli-official-sync-3b526b9d\cocos-test-projects-mutable"; npm run test:e2e -- --runTestsByPath e2e/mcp/api/animation-clip-restart-persistence.e2e.test.ts --runInBand'
```

Expected：真实 scene worker 完成 edit/save；证据时间线明确为 `save -> exit -> re-enter completed -> current clip assetChanged`，同进程 change 不把当前 clip 替换为 stale reload，也不吞 non-current refresh；第二个 MCP process 能 query 相同 curve 值并重新绑定当前 clip。任一层失败时 C-11 只能记录为未验收 residual risk，不能满足最终完成标准。

- [ ] Stage dedicated E2E：

```powershell
rtk git add -- e2e/mcp/api/prefab-restart-persistence.e2e.test.ts e2e/mcp/api/animation-clip-restart-persistence.e2e.test.ts
rtk git diff --cached --check
```

- [ ] Runtime preview focused suites。先从主测试项目配置解析 engine root：

```powershell
rtk pwsh -NoProfile -Command '$projectRoot=Join-Path $env:TEMP "cocos-cli-official-sync-3b526b9d\cocos-test-projects"; $packageJson=Get-Content -Raw -LiteralPath (Join-Path $projectRoot "package.json") | ConvertFrom-Json; $enginePath=$packageJson."cocos-cli".enginePath; $env:COCOS_CLI_TEST_PROJECT_ROOT=$projectRoot; $env:COCOS_CLI_TEST_ENGINE_ROOT=[System.IO.Path]::GetFullPath($enginePath); npm --prefix vitests run test -- suites/runtime-preview/cli-startup.test.ts suites/runtime-preview/launcher-engine-root.test.ts suites/runtime-preview/launcher-runtime-preview.test.ts suites/runtime-preview/settings-generation.test.ts suites/runtime-preview/preview-app-route-contract.test.ts suites/runtime-preview/engine-graphics-settings-parity.test.ts'
```

Expected：退出码 0。这里只证明列出的 fixture / integration contract。

- [ ] 运行主测试项目 CLI integration：

```powershell
rtk pwsh -NoProfile -Command '$projectRoot=Join-Path $env:TEMP "cocos-cli-official-sync-3b526b9d\cocos-test-projects"; $packageJson=Get-Content -Raw -LiteralPath (Join-Path $projectRoot "package.json") | ConvertFrom-Json; $enginePath=$packageJson."cocos-cli".enginePath; $env:COCOS_CLI_TEST_PROJECT_ROOT=$projectRoot; $env:COCOS_CLI_TEST_ENGINE_ROOT=[System.IO.Path]::GetFullPath($enginePath); npm --prefix vitests run test -- suites/runtime-preview/main-test-project-cli-integration.test.ts'
```

Expected：真实 `dist/cli.js preview --runtime` 在主测试项目通过；不能扩大为所有真实项目通过。

## Task 10：Preview 用户流程验收

- [ ] 新增 `vitests/scripts/official-sync-preview-mode-acceptance.mjs`。该 helper 必须：

  - 通过 `child_process.spawn()` 且 `windowsHide: true` 顺序启动 game / build / scene-editor / runtime / MCP 五个 CLI processes。
  - game / build / scene-editor 使用 `--no-open`；runtime 不传 `--no-open`，因为该参数在 runtime 下应被拒绝。
  - 使用固定独立端口，stdout/stderr 分 mode 写入 evidence 目录。
  - 在明确 timeout 内轮询实际 URL / readiness，不使用固定 sleep 作为成功条件。
  - 使用 Playwright 打开 browser，收集 `pageerror`、`unhandledrejection`、`console.error`、同源 failed request 和非预期 bad response。
  - scene-editor 和 MCP scene-enabled server stack 额外访问 `/preview?uuid=<uuid>`。启动前强断言 `assets/resources/test_assets/testMat.mtl`、`testMat.mtl.meta`、`prefab.prefab`、`prefab.prefab.meta` 均存在；分别从两个 `.meta` 读取真实 Material / Prefab UUID。调用 `Scene.Preview.open()` 和 `generateThumbnail()`，等待状态为 `ok`，执行 canvas pixel 非空检查并保存 screenshot；再覆盖不支持 / 不存在 UUID。
  - 同时打开两个 `/preview` tabs，分别切换资源 / primitive，证明 active preview、camera 和 browser heap 相互独立；reload / close 后无残留 camera、timer 或 scene。
  - URL availability matrix 必须证明 default / build / runtime 不暴露 resource preview page 或 `Scene.Preview`；`--scene-editor` 与 MCP startup 都能托管 `/preview`，但每个 browser tab 是独立 browser scene realm，MCP 另有 child scene worker。
  - 在 mutable project 执行 realm-isolation 序列：第一个独立 `MCPTestClient` 明确以 mutable project path 启动 child worker；helper 用 `fs.copyFile()` 只把 fixture prefab source 复制到 `assets/e2e-official-sync/prefab-realm-isolation.prefab`，不复制 `.meta`，轮询 `assets-query-uuid(db://assets/e2e-official-sync/prefab-realm-isolation.prefab)` 直到取得不同于原 asset 的新 UUID。MCP 打开新 UUID，加入唯一 marker node，并在另一节点新增 `cc.Button`，将 `cc.Button.interactable` 设为 `false`、`cc.Button.target` 指向 marker node，但先不 `scene-save`；browser `/preview` 打开同 UUID，并通过 `page.evaluate()` 检查当前 browser realm 的 preview object tree，必须看不到 marker。随后 MCP 执行 `scene-save`，helper 以 AssetDB reimport / asset mtime 与 query 条件轮询完成，不用固定 sleep；browser reload 后重新 `Scene.Preview.open()`，必须看到 marker。最后完全关闭第一个 client / server，创建第二个 `MCPTestClient` 并以同一 project path 启动，重新打开 prefab，query 必须仍得到 marker、`interactable=false` 和指向 marker 的 `target`。`finally` 通过 `assets-delete-asset` 删除该 db URL，轮询 UUID 为空且 source / generated `.meta` 消失。该序列证明共享的是 AssetDB / library / disk，不是 scene object memory。
  - 在 `finally` 中终止本 helper 启动的进程，并验证端口释放。
  - 运行非法 mode / companion option matrix，要求非 0、明确错误且端口没有监听。
  - 对 Task 1 固定构造的 `pal/system-info -> pal/system-info/web/system-info` extensionless override 做强断言：候选数必须大于 0，生成 import-map value 必须以 `system-info.js` 结尾，该 URL 请求 200，browser 不得出现 extensionless failed request。零命中必须失败，不能 skip。

- [ ] 使用 Task 1 已冻结的 project / engine fixtures。普通 mode / browser smoke 使用只读 project；realm-isolation 使用 mutable project。运行前验证两个 project fixtures 都只有 `package.json`、engine fixture 只有 `cc.config.json` 三项预期测试配置变化，并执行 source/meta preflight；任何其它 source asset、`.meta` 或 engine source 变化都阻塞验收：

```powershell
rtk pwsh -NoProfile -Command '$roots=@((Join-Path $env:TEMP "cocos-cli-official-sync-3b526b9d\cocos-test-projects"),(Join-Path $env:TEMP "cocos-cli-official-sync-3b526b9d\cocos-test-projects-mutable")); $paths=@("assets/resources/test_assets/testMat.mtl","assets/resources/test_assets/testMat.mtl.meta","assets/resources/test_assets/prefab.prefab","assets/resources/test_assets/prefab.prefab.meta"); foreach($root in $roots){ foreach($path in $paths){ $full=Join-Path $root $path; if(-not (Test-Path -LiteralPath $full)){ throw "Missing acceptance fixture: $full" } } }'
rtk git -C $env:TEMP\cocos-cli-official-sync-3b526b9d\cocos-test-projects status --short
rtk git -C $env:TEMP\cocos-cli-official-sync-3b526b9d\cocos-test-projects-mutable status --short
```

Expected：四个路径在两个 project fixtures 中都存在；两个 project status 都只列 `package.json`。

- [ ] 清理当前进程 test env 后运行可执行 helper：

```powershell
rtk pwsh -NoProfile -Command 'Remove-Item Env:COCOS_CLI_TEST_PROJECT_ROOT -ErrorAction SilentlyContinue; Remove-Item Env:COCOS_CLI_TEST_ENGINE_ROOT -ErrorAction SilentlyContinue; Remove-Item Env:COCOS_CLI_TEST_EDITOR_LIBRARY_REF -ErrorAction SilentlyContinue; Remove-Item Env:COCOS_CLI_TEST_EDITOR_PROGRAMMING_REF -ErrorAction SilentlyContinue; node vitests/scripts/official-sync-preview-mode-acceptance.mjs --cli-root "E:\own_space\engines\cocos-cli\.worktrees\official-sync" --project-root "$env:TEMP\cocos-cli-official-sync-3b526b9d\cocos-test-projects" --mutable-project-root "$env:TEMP\cocos-cli-official-sync-3b526b9d\cocos-test-projects-mutable" --game-port 9630 --build-port 9631 --scene-port 9632 --runtime-port 9633 --mcp-port 9634 --startup-timeout-ms 180000 --browser-timeout-ms 120000 --evidence-root "$env:TEMP\cocos-cli-official-sync-3b526b9d\evidence"'
```

- [ ] Helper 必须实际执行并验收：

```text
default game preview -> /
--build              -> legacy build preview URL
--scene-editor       -> /scene-editor/；同一 server stack 同时检查 / 和 /preview，各 browser tab 独立初始化 scene realm
--runtime            -> runtime root、/settings.js、/scene-list、health/readiness
start-mcp-server     -> /mcp、/scene-editor/、/preview；MCP child worker 与 browser scene realms 分离
```

- [ ] 每种 mode 记录命令、端口、进程初始化链路、HTTP / browser 结果和 cleanup；helper 总退出码必须为 0。
- [ ] 验收后比较三个 fixtures：只读 project 除 `package.json` 外不得变化，engine 除 `cc.config.json` 外不得变化；mutable project 的临时 prefab source / `.meta` 必须已由 helper 清理，最终也只能剩 `package.json`。出现额外 dirty 时保留现场并失败。证据归档后恢复三项明确配置文件，确认三个 worktrees clean，再允许非 force `git worktree remove`。

Acceptance：

| 流程 | 必须成立 | 必须不成立 |
| --- | --- | --- |
| default | `/` 可用，走官方 dynamic game preview | 不启动 runtime server 或 scene RPC |
| `--build` | 走 legacy build 后预览 | 不忽略 build-only options |
| `--scene-editor` | `/scene-editor/`、`/` 和 `/preview` 可用；resource UUID 预览 canvas 非空；不同 tab 的 scene realm 相互隔离 | 不读取 runtime programming root，不把 PreviewService 说成 save API 或 MCP child worker |
| `--runtime` | adapter diagnostics、settings、watch / refresh 保留 | 不启动 scene RPC，不把 Material API误称为同实例 MCP |
| `start-mcp-server` | `/mcp` 与 scene/resource preview routes 可用，共享主进程 AssetDB / library / disk | 不宣称 MCP child scene worker 与 `/preview` browser realm 共享对象内存 |

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
rtk git commit -m "merge: sync official main at 3b526b9d"
rtk git rev-parse HEAD
rtk git rev-parse <MERGE_COMMIT>^1
rtk git rev-parse <MERGE_COMMIT>^2
```

Expected：第一 parent 是 `START_ADAPTER`，第二 parent 是 `3b526b9d86519df1ee5046550aaa202d860ab15d`。

- [ ] 立即记录固定 `MERGE_COMMIT`。创建官方同步复盘，记录该 SHA、实际冲突、`C-01` 到 `C-15` 实现、命令结果、失败和未验证项；以单独 docs commit 提交。docs commit 后仍使用 `<MERGE_COMMIT>^1/^2` 检查，不用新的 `HEAD^2`。
- [ ] 在主工作区确认 clean 后回收：

```powershell
rtk git rev-parse adapter-to-386
rtk git switch adapter-to-386
rtk git merge --ff-only codex/official-sync-20260713-3b526b9d
```

Expected：回收前 `adapter-to-386` 仍精确等于 `START_ADAPTER`；只 fast-forward 到含 merge commit 和复盘 docs commit 的 sync branch tip，不产生第二个 merge commit。

- [ ] push 前展示最终 log、ahead/behind、测试摘要和 residual risks，获得用户单独确认。禁止 force push。

## 最终完成标准

- 固定 `TARGET` 是执行时当前 `upstream/main` 的 ancestor；远端 heads 已记录但允许正常前进；合并 commit 第二 parent 精确等于 `TARGET`。
- 11 个直接冲突和 `C-01` 到 `C-15` 的全部 direct / semantic conflict 均有实现与验证记录。
- 四种 `preview` mode 与 `start-mcp-server` 用户流程符合确认合同，非法组合明确失败。
- 官方 builder progress/log/cache/stage、iOS / Google Play / Android / Web Mobile Pink views 和迁移后的 builder package paths、adapter extension/wechatgame/runtime settings 同时保留。
- Material / config-map 官方 API、PreviewService、prefab/atlas native loading、dump editing 和 animation edit/save、session re-enter refresh suppression 可用，adapter AssetDB / scene tests 不回退。
- `script.sortingPlugin` 在同一实例热更新 preview / scene / build 的 plugin script 加载顺序，且不破坏 adapter AssetDB records / mounts；Joint Texture Layout 在 game/runtime/build settings 中使用同一 resolver 结果。
- `engine.graphics`、legacy `customPipeline` 与 selected config modules 经同一 normalization 进入 dynamic preview、runtime preview 和 build，旧项目 migration 不改变最终 pipeline/module 语义。
- DTS 由 generator 更新并完成 consumer typecheck。
- `@cocos/asset-db` 继续解析到 local vendored package。
- TypeScript、`npm run build`、focused Jest/Vitest 和声明范围内的 CLI acceptance 通过。
- 复盘已落盘，adapter 只通过 `ff-only` 接收结果，远端 push 尚需单独确认。
