# 官方同步与长期分支合并流程

本文定义长期分支吸收官方更新时的通用流程。目标是先还原事实和双方意图，再决定合并方向；不能靠记忆、单次经验或反向 diff 推断官方历史。

适用场景：

- `adapter-to-386` 这类长期分支需要吸收官方 `upstream/main` 的更新。
- fork 的 `origin/main` 需要同步到官方最新后再作为本地合并目标。
- 长期分支包含本项目为了 Creator / engine parity、runtime preview、AssetDB、builder、scene editing 等目标做出的本地适配。

## 核心原则

- 先分析，后执行。进入实际 `merge` / `rebase` / `push` 前，必须先产出合并前分析摘要和推荐路线。
- 事实、推断、决策分开写。不能把“可能没问题”当成结论。
- 不能用 `adapter..target` 反推官方历史。官方真实更新必须看 `BASE..target`；本地长期分支意图必须看 `BASE..adapter`。
- 默认优先吸收官方改进；只有官方改动破坏长期分支的明确目标时，才保留本地行为或做 adapter-specific merge。
- 保留本地行为必须说明被保护的目标、证据来源和验证方式。
- 冲突解决不是文件级选边。执行前必须向用户说明目标合并语义、具体实现方式、选择理由和未采用方案；高风险决策未经确认不得落地。
- fork 同步、历史改写、force push、删除分支都不是默认动作；必须有明确目标和确认。
- `fetch` 会修改本地 remote-tracking refs，不属于冻结状态。需要 fetch 时，应先记录 fetch 前状态，再进入“更新 refs”步骤。

## 术语

- `adapter`：长期适配分支，例如 `adapter-to-386`。
- `upstream`：官方仓库 remote，例如 `https://github.com/cocos/cocos-cli.git`。
- `origin`：个人 fork remote，例如 `https://github.com/AILHC/cocos-cli.git`。
- `target`：本次要合入的基线。可以是 `origin/main`、`upstream/main` 或一个临时同步分支，但必须显式记录。
- `BASE`：`git merge-base adapter target` 的结果。
- `OFFICIAL_DELTA`：`BASE..target`，表示 target 相对共同祖先的真实新增。
- `ADAPTER_DELTA`：`BASE..adapter`，表示长期分支相对共同祖先的真实新增。
- `SYNC_WORKTREE`：长期保留、专用于官方同步分析、冲突处理和验证的 worktree。本仓库默认使用 `.worktrees/official-sync`，不随单轮合并结束而删除。
- `SYNC_BRANCH`：每轮同步从当时 `adapter` HEAD 新建的分支，例如 `codex/official-sync-<YYYYMMDD>-<target-shortsha>`。它承载本轮 merge commit，但不作为下一轮同步基线复用。

## 阶段 0：冻结当前状态

先只读记录，不修改 remote、branch、index 或工作区。

必须记录：

```powershell
git status --short --branch --untracked-files=all
git remote -v
git branch --show-current
git worktree list --porcelain
git for-each-ref --format="%(refname:short) %(upstream:short) %(objectname:short)" refs/heads refs/remotes/origin/main refs/remotes/upstream/main
git log --date=short --pretty=format:"%h %ad %d %s" -n 20
```

判定规则：

- 工作区有未提交变更时，先分类：用户变更、上次流程残留、生成物、文档记录、状态噪声。不得直接清理或回滚。
- `SYNC_WORKTREE` 已存在时，必须额外记录其 branch、HEAD、index 和工作区状态。存在未归档变更时，不得清理后直接开始下一轮。
- remote 命名不符合 `origin=fork`、`upstream=official` 时，先停止并说明风险。
- 本地 `origin/main` 或 `upstream/main` 可能过期时，先停止在“需要 fetch”状态，不继续给出合并路线。

## 阶段 1：同步 fork main 的前置判断

如果本次目标是“以官方最新 main 为基线”，通常应先让 fork 的 `origin/main` 同步到 `upstream/main`，再用 `origin/main` 作为本次 `target`。但这不是无条件动作。

### 1A：只读新鲜度检查

只读阶段使用 `ls-remote` 查看远端当前 head，不更新本地 refs：

```powershell
git ls-remote --heads upstream main
git ls-remote --heads origin main
git rev-parse refs/remotes/upstream/main
git rev-parse refs/remotes/origin/main
```

如果 `ls-remote` 显示的远端 head 与本地 remote-tracking ref 不一致，必须记录“本地 refs 过期”，然后进入 1B。不要在冻结阶段继续推导 merge-base 或 ahead/behind。

### 1B：更新本地 remote-tracking refs

这一步会修改 `.git` 中的 remote-tracking refs，不是只读检查。执行前先记录本地 refs 快照：

```powershell
git for-each-ref --format="%(refname:short) %(objectname)" refs/remotes/origin refs/remotes/upstream
git fetch upstream
git fetch origin
git rev-list --left-right --count origin/main...upstream/main
git log --date=short --pretty=format:"%h %ad %d %s" --left-right origin/main...upstream/main
```

`--prune` 不作为默认动作。只有确认需要清理 stale remote-tracking refs 时，才单独执行并记录 prune 前后的 refs。

决策规则：

- `git rev-list --left-right --count origin/main...upstream/main` 的左侧是 `origin/main` 独有 commit 数，右侧是 `upstream/main` 独有 commit 数。
- `0 N`：`origin/main` 只落后 `upstream/main`，可建议 fast-forward 同步 fork main。
- `N 0`：`origin/main` 有 fork-only commits，必须停下说明差异，不能自动覆盖。
- `N M`：双方分叉，必须停下做专项分析，不能按“同步 fork main”继续。
- 如果需要 push fork main，只能做 fast-forward push；非 fast-forward / force push 必须单独确认。
- 如果本次合并目标不是 fork main，而是某个官方 tag、release branch 或临时 ref，不应强行同步 `origin/main`。

## 阶段 2：确定 target 与 BASE

记录 target 后计算：

```powershell
git merge-base adapter-to-386 <target>
git rev-list --left-right --count adapter-to-386...<target>
git log --date=short --pretty=format:"%h %ad %d %s" --reverse <BASE>..<target>
git log --date=short --pretty=format:"%h %ad %d %s" --reverse <BASE>..adapter-to-386
```

必须输出 commit 矩阵：

| 名称 | 引用 | commit | 说明 |
| --- | --- | --- | --- |
| `BASE` | `git merge-base adapter target` | `<hash>` | 共同祖先 |
| `TARGET` | `<target>` | `<hash>` | 本次要吸收的基线 |
| `ADAPTER` | `adapter-to-386` | `<hash>` | 当前长期分支 |

## 阶段 3：分析官方更新

只分析 `BASE..target`。不要把 adapter 独有文件在 target 中不存在描述成“官方删除”。

建议命令：

```powershell
git diff --stat <BASE>..<target>
git diff --name-status <BASE>..<target>
git log --date=short --pretty=fuller --reverse <BASE>..<target>
git diff --unified=80 <BASE>..<target> -- <重点文件>
```

分类维度：

- package / workspace / lockfile。
- builder API、schema、platform、build lifecycle。
- AssetDB、library、meta、resource path。
- scripting / programming / generated chunks。
- runtime preview、server route、browser entry。
- scene / prefab / component editing。
- configuration owner model。
- generated files，例如 DTS、schema、static bundle、i18n。
- docs / issues / acceptance / handoff。

每个官方主题需要回答：

- 官方改了什么？
- 这个改动解决什么问题或暴露什么新 API？
- 它会影响长期分支保护的哪个目标？
- 是否已有官方等价能力可以替代本地 patch？

官方意图不能只从文本 diff 猜。高风险主题必须补证据：

- commit message / PR title / commit body。
- 官方新增或修改的测试。
- docs / changelog / public API snapshot / schema 生成物。
- package version、lockfile、workspace、tarball 或 generated artifact。
- 如果无法证明官方能力等价覆盖本地需求，结论写成“推断”或“待验证”，不能直接 `adopt official`。

## 阶段 4：分析长期分支意图

只分析 `BASE..adapter`。目标是从代码、测试、文档、issue、commit message 中还原“为什么改”，而不是只看冲突文本。

建议命令：

```powershell
git diff --stat <BASE>..adapter-to-386
git diff --name-status <BASE>..adapter-to-386
git log --date=short --pretty=format:"%h %ad %s" --reverse <BASE>..adapter-to-386
git log --follow --date=short --pretty=format:"%h %ad %s" -- <重点文件>
git show --stat --oneline <相关commit>
```

意图来源优先级：

- 代码和测试。
- `docs/dev/**/issues.md`、`facts/`、`acceptance/`、`handoff/`。
- `docs/superpowers/specs/` 与 `docs/superpowers/plans/`。
- commit message 和历史报告。
- 线程消息只能作为辅助线索；如果当前环境无法读取线程，必须写明缺口。

### 意图还原协议

对每个高风险文件或主题，必须输出一条本地需求陈述：

| 字段 | 要求 |
| --- | --- |
| 本地需求 | 用一句话说明 adapter 为什么需要这类改动。 |
| 证据 | 列出代码、测试、issue、facts、plans、reports 或 commit。 |
| 推断等级 | `confirmed` / `inferred` / `fact-gap`。 |
| 保护目标 | 说明它保护的是 parity、API、runtime preview、AssetDB、scene editing、configuration owner model 等哪类目标。 |
| 官方等价性 | 说明 target 是否已有等价能力；没有证据时写 `unknown`。 |
| 缺口 | 需要补的源码、产物、测试或真实项目验证。 |

证据不足时，默认推荐方向为 `defer` 或 `merge with guard`，不能直接 `keep adapter` 或 `adopt official`。

长期分支的典型保护目标包括但不限于：

- Creator / engine 特定版本 parity。
- Editor baseline parity，尤其 AssetDB record、source `.meta`、library 输出。
- runtime preview 的 route、settings、browser smoke、watch / refresh。
- project extension builder hooks 和受限 `Editor` facade。
- 平台支持，例如 `wechatgame`。
- scene / prefab / component editing 的落盘语义。
- configuration owner model：Editor-owned runtime input 与 CLI-owned persisted overlay 分离。
- vendored package 或 local workspace patch。

## 阶段 4.5：差异到用户流程和业务流程的具现化

代码差异必须翻译成实际使用流程后，才能进入冲突决策。尤其是 CLI 入口、preview、MCP、server route、AssetDB、builder、scene editing 这类变更，不能只写“新增参数”“抽了模块”“改了 helper”。必须说明用户如何触发、一个实例里启动了什么、状态在哪里共享、能否在入口之间切换、失败时用户会看到什么。

本阶段不是要求每个小 diff 都写长篇业务文档，而是按差异类型选择合适的呈现方式。目标是让后续 reviewer 能判断：如果采用官方、保留 adapter 或做语义合并，会破坏哪条真实流程。

### 差异类型路由

| 差异类型 | 必须具现化的问题 | 推荐呈现方式 |
| --- | --- | --- |
| CLI option / URL / route / UI 入口 | 用户输入什么命令；默认打开哪个入口；有哪些 URL；能否在入口间切换；错误时提示什么 | 用户旅程表：命令、URL、默认行为、可切换路径、失败表现 |
| server / preview / MCP / worker 生命周期 | 一个 CLI 实例启动哪些服务、进程或 worker；哪些能力同实例共享；哪些能力只在特定参数下初始化；何时释放 | 实例能力表或 mermaid sequence |
| public API / schema / dts | 谁调用；输入输出是什么；旧调用是否还能工作；官方 API 是否等价覆盖 adapter API | 调用方流程表：caller、API、输入、输出、兼容性、替代关系 |
| builder / AssetDB / library / cache | source 如何进入 import/cache/library/output；哪些路径落盘；哪些是临时缓存；dirty / refresh 如何传播 | 产物流表：source -> import -> cache/library -> output |
| scene / prefab / component editing | 如何加载对象；如何修改字段；引用如何解析；何时 dirty；如何 undo / save；最终落到哪个源资产 | 编辑流程表：load、mutate、reference、dirty、undo、save |
| config / engine root / project root | 真相源是什么；fallback 顺序；test env 和 production 默认边界；旧缓存是否参与 | 配置解析链路：source、fallback、禁止来源、验证方式 |
| generated files | 由哪个命令生成；输入是什么；输出文件有哪些；能否手工编辑；冲突后如何再生成 | 生成流程表：generator、inputs、outputs、regenerate command |

### 最低输出要求

如果本次差异命中上述类型之一，合并前分析必须至少包含：

- 用户流程变化：用表格或步骤写出从命令 / API / 编辑动作到结果的真实路径。
- 实例与状态边界：写出同一个 CLI / server / worker 实例里有哪些能力，哪些不是同实例能力。
- 决策影响：写出 `adopt official`、`keep adapter`、`merge` 分别会影响哪些用户流程。

示例结构：

| 流程 | 触发方式 | 同实例能力 | 共享状态 | 不能做什么 | 验证 |
| --- | --- | --- | --- | --- | --- |
| `<官方流程>` | `<command/url/api>` | `<server/worker/route>` | `<asset-db/cache/rpc>` | `<边界>` | `<test>` |
| `<adapter 流程>` | `<command/url/api>` | `<server/worker/route>` | `<asset-db/cache/rpc>` | `<边界>` | `<test>` |
| `<目标合并流程>` | `<command/url/api>` | `<server/worker/route>` | `<asset-db/cache/rpc>` | `<边界>` | `<test>` |

具现化时要区分事实和推断。没有运行验证但从源码推导出的流程，必须标为“源码推断，待验证”。

## 阶段 5：只读冲突预测

用 `git merge-tree` 做预测，不进入实际 merge 状态。

```powershell
git merge-tree adapter-to-386 <target>
```

如果 Git 版本支持，也可以输出冲突文件：

```powershell
git merge-tree --write-tree --name-only --messages adapter-to-386 <target>
```

命令顺序必须与实际执行方向一致：如果计划在 `adapter-to-386` 上执行 `git merge <target>`，则第一个参数写 `adapter-to-386`，第二个参数写 `<target>`。后续分析中的 `ours` 对应 adapter，`theirs` 对应 target。

冲突预测只说明 text conflict。还必须额外审计 semantic conflict：

- package spec 与 lockfile 不冲突但 runtime source 变了。
- generated files 没冲突但生成规则变了。
- 官方新增 API 与本地 API 并存但 schema 语义冲突。
- path / cache / library 默认值变化。
- tests 被删除、迁移或改 runner。
- 本地 vendored package 与官方 npm package 版本关系变化。

## 阶段 6：生成冲突决策表

每个直接冲突文件和高风险 semantic conflict 都应记录。表格不能只写 `ours` / `theirs` 或抽象方向，必须让用户看懂“准备合成什么行为、代码上怎么实现、为什么这样做”：

| ID | 文件 / 主题 | 官方意图 | 本地意图 | 目标合并语义 | 具体合并方式 | 为什么这样合 | 未采用方案 | 用户 / 业务流程影响 | 风险 | 验证 | 确认状态 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `C-01` | `<path 或主题>` | `<BASE..target 事实>` | `<BASE..adapter 事实>` | `<合并后用户可观察行为>` | `<保留/迁移/桥接/重生成哪些代码>` | `<证据和权衡>` | `<方案及不采用原因>` | `<受影响流程>` | `<剩余风险>` | `<命令或 fixture>` | `proposed / approved / revise / deferred` |

推荐方向定义：

- `adopt official`：官方实现覆盖本地旧实现；确认不破坏保护目标。
- `keep adapter`：保留本地行为；必须说明官方为何不能替代。
- `merge`：官方 API / 修复与本地目标都保留，通过桥接或迁移共存。
- `defer`：事实不足，不进入合并；需列出阻塞事实。

决策阶梯：

1. 先确认本地 protected invariant：这项本地行为具体保护什么目标，是否仍然需要。
2. 再确认官方 contract / API shape：官方 public API、schema、生成物或路径约定应优先吸收，除非事实证明它破坏 protected invariant。
3. 证明官方是否等价覆盖本地需求：如果等价，`adopt official`；如果不等价但 API shape 有价值，优先 `merge`，用 official shape 承载 adapter behavior。
4. 只有官方改动明确破坏 protected invariant 且无法桥接时，才 `keep adapter`。
5. 证据不足时，`defer`，并列出缺失事实；不得靠偏好选边。

### 冲突确认粒度

以下冲突必须逐项与用户确认，不能只按文件批量确认：

- CLI 默认语义、URL / route、public API、schema、配置真相源发生变化。
- AssetDB、scene / prefab / component editing、dirty / save / undo 或其他落盘语义发生变化。
- server、MCP、worker、scene process 的实例生命周期或共享状态发生变化。
- dependency / vendored package 的版本、源码所有权或生成方式发生变化。
- 可能造成兼容性破坏、数据丢失、历史改写或用户流程变化。

低风险 mechanical conflict 可以按同一规则成组确认，例如 import 排序、无语义差异的重命名、确认可重生成的 snapshot。但必须列出分组规则、代表文件和统一验证方式，不能把未分析的文件藏在“机械处理”中。

职责边界：agent 负责还原事实、提出方案、解释取舍和执行已确认方案；用户确认业务语义与风险接受。用户确认的是目标行为和合并理由，不需要逐行指定冲突标记如何删除。

## 阶段 7：合并前摘要与路线确认

进入实际 merge / rebase 前，必须输出简短但完整的摘要：

- 当前 remote 拓扑和 target。
- `BASE`、`target`、`adapter` commit。
- fork main 是否需要同步，以及是否 fast-forward。
- 官方新增主题。
- 本地保护目标。
- 用户流程、业务流程、实例与状态边界的变化。
- 预计冲突文件和高风险 semantic conflict。
- 每项高风险冲突准备怎么合、为什么这样合、未采用什么方案，以及对应的确认状态。
- 推荐执行路线及其适用条件；不能只列 merge、rebase、cherry-pick 选项而不作判断。
- 推荐验证矩阵。

只有当执行路线和全部高风险冲突决策均为 `approved`，才进入实际 merge。`deferred` 冲突默认阻塞本轮合并，除非调整 target 或合并范围后该冲突不再进入本轮。

进入 merge 后，如果出现未预测冲突，或实际源码证明已确认方案不可行，必须保留现场、补充决策表并重新与用户对齐；不得擅自改成 `ours`、`theirs` 或另一种业务语义。完全符合已确认目标语义的机械实现不需要逐 hunk 重复确认。

## 阶段 7.5：可执行实施与验收计划

冲突方向获批后仍不能立即进入 merge。必须先写一份本轮可执行计划，将“准备怎么合”展开成可逐项实施、验证和停止的步骤。正式 implementation plan 写入 `docs/superpowers/plans/`；合并前分析报告继续保留在 `docs/dev/reports/official-sync/`，两者不能互相替代。

计划至少包含：

- 固定输入：`ANALYZED_ADAPTER`、`TARGET`、`BASE`、remote 拓扑、`SYNC_WORKTREE` 和 `SYNC_BRANCH` 命名。
- 漂移 gate：执行前重新检查远端 head、target、adapter code delta。target 前进或 adapter 出现未分析的代码改动时，计划失效并返回阶段 2。
- merge 启动命令、预期直接冲突清单，以及实际冲突与预测不一致时的停止条件。
- 每个冲突 ID 的文件范围、目标行为、具体代码处理、不得破坏的 invariant、测试文件和通过标准。
- semantic conflict 和自动合并文件的审计步骤；不能只计划处理 conflict marker。
- generated file 的生成命令、允许变化范围和人工 diff 检查。
- 分层验证矩阵：focused test、TypeScript、compile/build、CLI / HTTP / browser smoke、必要的真实项目验收；每层写明能证明和不能证明什么。
- merge commit、parent 校验、复盘文档、adapter `ff-only` 回收和 push 前确认步骤。
- 每个 task 使用 checkbox 或等价状态，执行时逐项回填命令、结果和偏差。

计划中的命令必须给出工作目录、前置环境和 expected result。不能只写“跑相关测试”“解决冲突”“确认没有问题”。高风险 task 应先有 focused regression / contract test，再改 production 实现；如果现有事实测试预期当前就应通过，要明确标为 fact gate，而不是伪装成 red-green test。

计划写完后必须经过一次对抗审查，重点检查：

- 是否漏掉自动合并但高风险的文件。
- 是否把测试 fixture 当成 production 验收。
- 是否存在无法验证的模糊步骤。
- 是否把本次官方同步扩大成未经批准的新架构或重构。
- 是否遗漏失败停止、现场保留和重新确认条件。

只有计划已落盘、对抗审查问题已回填，并获得用户确认，才进入阶段 8。用户确认冲突方向不等于自动批准尚未编写的执行计划。

确认必须可审计，不能只停留在聊天上下文：

- 记录用户确认的 `TARGET`、计划路径 / revision、覆盖的 `C-ID`、确认日期和仍接受的 residual risk。
- 将对应决策状态从 `proposed` 更新为 `approved`，并在执行计划中勾选“用户确认 gate”。
- 以独立 docs commit 提交确认记录；该 commit 之后的 clean adapter HEAD 才能记为 `START_ADAPTER`。
- 如果确认后计划、target 或任一已批准语义发生实质变化，原确认失效，必须重新对抗审查并重新确认。仅修正错字、链接等不影响执行或语义的改动，也必须在复盘中说明。

未完成确认记录 commit 时，禁止创建本轮 `SYNC_BRANCH` 或进入 merge state。

## 阶段 8：执行策略

### 8.1 长期 worktree 与单轮分支

本仓库默认采用“长期 `SYNC_WORKTREE` + 每轮独立 `SYNC_BRANCH`”。长期 worktree 是可复用的合并工作台；单轮分支用于冻结本轮 adapter 起点、target 和冲突决策。不能把“worktree 长期保留”误解成“同一同步分支持续累积所有轮次”。

首次创建：

```powershell
git worktree add .worktrees/official-sync -b <SYNC_BRANCH> adapter-to-386
```

后续轮次开始前，先确认长期 worktree 没有未归档状态，再从当前 adapter HEAD 新建本轮分支：

```powershell
git -C .worktrees/official-sync status --short --branch --untracked-files=all
git -C .worktrees/official-sync switch -c <SYNC_BRANCH> adapter-to-386
```

上一轮 `SYNC_BRANCH` 在合并报告、验证结果和复盘完成前不得删除。新一轮不得从上一轮成功或失败的 `SYNC_BRANCH` 继续叠加。

### 8.2 本仓库默认历史策略

`adapter-to-386` 属于长期、已共享且需要反复吸收官方更新的分支，默认采用 merge commit，不 rebase：

```powershell
git -C .worktrees/official-sync merge --no-ff --no-commit <target>
```

选择 merge commit 的原因：

- 保留本轮 adapter 起点和官方 target 两个 parent，形成可审计的官方同步边界。
- 冲突集中在本轮汇合点解决，避免把大量 adapter commits 重新播放并重复处理冲突。
- 不改写已共享 commit hash，不要求 force push，也不破坏文档、issue 和外部分支引用。
- 下一轮可以从新的共同历史继续计算 `BASE`，复盘能准确对应到一次 merge commit。

只有同时满足“分支未共享、独有提交较少、没有外部 hash 引用、接受历史改写和潜在 force push、用户明确批准”时，才可把 rebase 列为执行路线。当前 `adapter-to-386` 不满足这些条件。

### 8.3 冲突处理与提交

实际冲突必须按已确认决策表处理。每完成一个主题，更新对应 ID 的实际实现和验证结果；不能为了消除 conflict marker 直接选择整文件 `ours` / `theirs`。

源码冲突解决并完成验证后再创建 merge commit，并核对 parent：

```powershell
git -C .worktrees/official-sync rev-parse HEAD^1
git -C .worktrees/official-sync rev-parse HEAD^2
```

预期第一 parent 是本轮开始时的 `ADAPTER`，第二 parent 是已确认的 `TARGET`。如果 parent 或 target 漂移，当前结果不能进入 adapter。

### 8.4 回收到 adapter

验收通过后，只允许让 `adapter-to-386` fast-forward 到已验证的 `SYNC_BRANCH`，避免再制造第二个合并节点：

```powershell
git switch adapter-to-386
git merge --ff-only <SYNC_BRANCH>
```

执行前 adapter 主工作区必须处于可安全更新状态。存在用户未提交变更时，不自动 stash、清理或绕过；先完成归档或提交决策。长期 `SYNC_WORKTREE` 在本轮结束后继续保留。

大冲突按已确认的业务主题分批处理和验证，避免“一次全收再看测试”。

禁止动作：

- 未确认就 `git reset --hard`。
- 未确认就 force push。
- 未确认就删除远端分支。
- 为了通过测试丢弃没有分析过的本地 patch。
- 复用上一轮同步分支作为新一轮起点。
- 实际发现与已确认方案不符时，静默改变冲突决策。

## 阶段 9：验证矩阵

验证矩阵必须和冲突决策表对应。每条命令记录：

- 制定或执行验证矩阵前，先读 `docs/dev/testing-spec.md`。涉及 runtime preview 时，还必须读 `docs/dev/runtime-preview/testing-spec.md`。
- 命令。
- 工作目录。
- 前置环境。
- 测试层级。
- fixture / 项目分类。
- 覆盖风险。
- 未覆盖风险。
- 结果摘要。

常见验证类别：

- dependency sanity：`require.resolve()`、workspace link、engine source 指向。
- compile / build：`npm run compile`、`npm run build`、必要时单独生成 DTS 或 static bundle。
- focused Jest / Vitest：按冲突子系统选择。
- generated diff：DTS、schema、static assets、i18n。
- real project smoke：只有在需要验证真实项目行为时执行，并先读测试规范。

不能把 `npm run build` 通过当作 AssetDB、runtime preview、scene editing 或 vendored package 行为已经正确的证明。

## 阶段 10：过程归档、复盘与流程回填

每次合并完成或中止后，都要写本次复盘。复盘是过程文档，不替代本通用流程。

归档规则：

- 合并前分析：写入对应专题的 `reports/`，例如 build 专题用 `docs/dev/build/reports/<date>-<branch>-official-sync-analysis.md`。如果没有明确专题，写入 `docs/dev/reports/official-sync/`。
- 复盘：写入对应专题的 `retrospectives/` 或 `reports/`。如果专题尚无目录，优先新建 `retrospectives/`；不要把纯过程复盘默认写入 `facts/`。
- 事实证据：只有可重复命令、源码位置、产物 diff、真实输出等 evidence 写入 `facts/`。
- 待办和状态：对应专题 `issues.md` 或专项台账。

复盘至少包含：

- 实际 target、BASE 和最终 commit。
- 本轮 `SYNC_WORKTREE`、`SYNC_BRANCH`，以及 merge commit 的两个 parent。
- 实际冲突与预测是否一致。
- 每项冲突的确认方案、实际实现和发生过的重新决策。
- 哪些方向判断正确，哪些错误。
- 哪些测试暴露了分析遗漏。
- 哪些文档、issue 或流程需要更新。
- adapter 是否通过 `ff-only` 接收结果，是否遗留未归档的同步分支或 worktree 状态。
- 下一次合并前必须重点检查的事项。

如果复盘发现本流程有缺口，应回填本文，而不是只写在某次 dated report 中。

下一次官方同步开始前，必须先读取最近一次复盘和本流程文档。

## 输出模板

合并前分析摘要模板：

```md
# <branch> 官方同步合并前分析

## 状态

- `adapter`：
- `target`：
- `BASE`：
- remote 拓扑：
- 工作区状态：

## 官方新增

## 本地保护目标

## 用户流程变化

## 实例与状态边界

## 冲突预测

## 冲突决策与用户确认

| ID | 主题 | 打算怎么合 | 为什么 | 未采用方案 | 验证 | 确认状态 |
| --- | --- | --- | --- | --- | --- | --- |

## 推荐路线

## 验证矩阵

## 需要确认的问题
```

合并复盘模板：

```md
# <branch> 官方同步复盘

## 结果

## 实际冲突

## 决策记录

| ID | 确认方案 | 实际实现 | 是否重新确认 | 结果 |
| --- | --- | --- | --- | --- |

## 验证结果

## 踩坑与修正

## 闭环表

| 问题 / 教训 | 回填位置 | issue ID 或不建 issue 理由 | stable docs 是否更新 | 流程是否更新 | 下一次检查项 | 状态 |
| --- | --- | --- | --- | --- | --- | --- |

## 后续流程改进
```
