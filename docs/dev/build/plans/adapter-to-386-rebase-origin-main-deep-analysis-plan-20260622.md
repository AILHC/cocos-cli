# adapter-to-386 rebase origin/main 深入分析计划

## 目标

重新分析 `adapter-to-386` rebase 到最新 `origin/main` 的风险、冲突、依赖策略和验证方式。重点修正之前的错误：不能把 `adapter-to-386..origin/main` 的差异误读成官方历史，尤其不能把 adapter 自己引入的 `packages/asset-db` workspace 说成官方原本状态。

本计划只定义分析方法、证据来源、产出格式和验收标准。执行分析时应先读事实再下结论；对不确定项必须标注证据缺口，不能用“应该”“可能没问题”替代验证。

## 分析基准

必须固定以下引用，并在分析报告开头记录实际 commit：

- `BASE=$(git merge-base adapter-to-386 origin/main)`：共同祖先。
- `OFFICIAL=origin/main`：官方 rebase 目标。
- `ADAPTER=adapter-to-386`：adapter 当前目标。
- `REBASED=codex/rebase-adapter-to-386-origin-main-20260622`：已有 rebase 试验分支，只用于审计“我实际怎么处理了”，不能反向证明处理正确。

禁止只用 `ADAPTER..OFFICIAL` 推断官方更新。正确用法：

- `BASE..OFFICIAL`：官方真实更新。
- `BASE..ADAPTER`：adapter 自己引入的改动。
- `OFFICIAL..REBASED`：rebase 结果相对官方保留了哪些 adapter 改动。
- `ADAPTER..REBASED`：rebase 结果相对 adapter 发生了哪些变化。

## 总体产出

执行完成后应新增或更新一份中文分析报告，至少包含：

- commit 矩阵：`BASE`、`OFFICIAL`、`ADAPTER`、`REBASED` 的 hash、ahead/behind、upstream。
- 官方更新清单：按子系统列出 `BASE..OFFICIAL` 的 commit 与文件影响。
- adapter 改动清单：按目标列出 `BASE..ADAPTER` 的 commit 与文件影响。
- rebase 实际处理清单：每个冲突文件的官方意图、adapter 意图、最终处理、风险。
- 自定义 npm 依赖分析：官方 npm package vs adapter local package 的代码逻辑差异。
- 维护流程追溯：是否存在 vendor/sync/build/patch 脚本或文档。
- 验证矩阵：每条结论对应的验证命令、覆盖范围、未覆盖风险。

## 阶段 1：冻结仓库状态

记录并核对：

- `git status --short --branch`
- `git for-each-ref --format="%(refname:short) %(upstream:short) %(objectname:short)" refs/heads/main refs/remotes/origin/main refs/heads/adapter-to-386 refs/heads/codex/rebase-adapter-to-386-origin-main-20260622`
- `git merge-base adapter-to-386 origin/main`
- `git rev-list --left-right --count adapter-to-386...origin/main`
- `git rev-list --left-right --count origin/main...codex/rebase-adapter-to-386-origin-main-20260622`

判定标准：

- 如果本地 `origin/main` 未 fetch 到最新，先停止并说明，不继续分析。
- 如果 `REBASED` worktree 不干净，先记录脏文件，不把它作为成功 rebase 结果。
- 如果主工作区有未跟踪文档，只记录，不把它混入代码 diff 判断。

## 阶段 2：官方更新分析

目标：只回答 `BASE..OFFICIAL` 中官方实际更新了什么。

命令范围：

- `git log --oneline --reverse BASE..origin/main`
- `git diff --stat BASE..origin/main`
- `git diff --name-status BASE..origin/main`
- 对重点文件使用 `git diff --unified=80 BASE..origin/main -- <file>`

分类维度：

- npm/package 管理：`package.json`、`package-lock.json`、workspaces、`packages/*/package.json`。
- builder API：`src/api/builder/*`、`src/core/builder/*`、`src/lib/builder/*`。
- asset/asset-db：`src/core/assets/*`、`packages/asset-db`、asset-db 调用点。
- configuration：`src/core/configuration/*`。
- runtime-preview/Vitest：`src/runtime-preview/*`、`vitests/*`。
- generated/public API：`packages/cocos-cli-types/*`、schema 生成物。

输出要求：

- 每个官方 commit 写明“改了什么”和“可能影响 adapter 哪个目标”。
- 如果只是版本号、lockfile 或生成物变化，要标注它是否有行为含义。
- 不得把 adapter 自己添加的文件在 `OFFICIAL` 中不存在这件事描述为“官方删除”，除非 `BASE` 中确实存在。

## 阶段 3：adapter 目标与改动分析

目标：从 `BASE..ADAPTER` 反推出 adapter-to-386 的真实目标，不依赖口头记忆。

命令范围：

- `git log --oneline --reverse BASE..adapter-to-386`
- `git diff --stat BASE..adapter-to-386`
- `git diff --name-status BASE..adapter-to-386`
- 对主题 commit 使用 `git show --stat --oneline <commit>` 和必要的正文 diff。

需要归类的 adapter 目标：

- 3.8.6 engine / `cc-module` / generated package 对齐。
- `@cocos/asset-db` 本地 vendored package 与 record manager 维护。
- AssetDB mount、library isolation、internal record/source meta parity。
- builder project extension hooks、package defaults、schema/check pipeline。
- `wechatgame` platform 与 build options。
- isolated Node build runtime、Editor facade、error hook。
- configuration owner model：Editor-owned 与 CLI-owned 配置边界。
- runtime-preview 与 Vitest fixture。

输出要求：

- 每个目标列出对应 commit、文件、测试或文档。
- 对 `@cocos/asset-db` 必须明确：`packages/asset-db` 是 adapter 引入，不是官方 workspace。
- 对目标缺少测试的地方标注“目标存在，但验证缺口待补”。

## 阶段 4：自定义 npm 依赖深入分析

目标：对 adapter 自定义过的 npm 依赖做代码逻辑级对比，而不是只比较 `package.json`。

### 4.1 识别范围

先扫描：

- `git diff BASE..adapter-to-386 -- package.json package-lock.json packages/**/package.json`
- `git diff BASE..origin/main -- package.json package-lock.json packages/**/package.json`
- `git diff origin/main..codex/rebase-adapter-to-386-origin-main-20260622 -- package.json package-lock.json packages/**/package.json`

纳入分析的条件：

- adapter 将 registry dependency 改为 `file:` / workspace。
- adapter 修改了 vendored package 内容。
- 官方 `origin/main` 升级了某个 adapter 相关 npm package。
- 该 package 位于 adapter 改动路径的运行时或生成时依赖链上。

当前已知必须纳入：

- `@cocos/asset-db`
- `cc` / `packages/cc-module`
- `packages/cocos-cli-types` 生成与发布包

是否纳入 `@cocos/ccbuild`、`@cocos/lib-programming`、`@cocos/module-system` 等，需要由 lockfile diff 和调用路径决定，不能预设。

### 4.2 官方 npm baseline 获取

对每个 npm 依赖记录：

- `origin/main:package.json` 中的 dependency spec。
- `origin/main:package-lock.json` 中的 `version`、`resolved`、`integrity`。
- 实际 npm package 内容。

获取方式优先级：

1. 如果 lockfile 有 `resolved` tarball，按 tarball 下载或用 npm cache 获取，并校验 `integrity`。
2. 如果不能直接用 tarball，使用 `npm pack <name>@<version>` 获取。
3. 解包到 `.worktrees` 或临时目录下的分析目录，不写入 production package。

输出必须包含：

- 官方 package 文件列表。
- `package.json` metadata。
- runtime JS、`.d.ts`、entrypoint、exports/types/bin。
- dependencies 与 peer/optional dependencies。

### 4.3 adapter local package 对比

对本地 vendored package 做以下对比：

- 文件列表差异：新增、删除、改名。
- metadata 差异：name、version、main、types、exports、scripts、dependencies。
- API 差异：`.d.ts` 中导出的 class/function/interface/type。
- runtime 差异：关键 JS/TS 函数的逻辑变化。
- source/generated 差异：如果同时存在 `src/` 与 `libs/`，确认是否有构建脚本生成，`src` 与 `libs` 是否一致。

`@cocos/asset-db` 的必查点：

- `8bb68e7 chore: vendor asset-db local package mirror` 如何引入 mirror。
- `8a80e3b chore: add maintainable asset-db record managers` 改了哪些 runtime/source 文件。
- `dependency`、`info`、`migrator`、`console`、`utils` 的 record manager 相关逻辑。
- CLI 中哪些调用点依赖这些改动。
- 官方 npm `3.0.0-alpha.10` 是否已有等价逻辑；如果没有，差异是否仍是 adapter-to-386 的必要条件。

### 4.4 本地 package 维护流程追溯

必须搜索脚本、文档、历史和线程记录：

- `rg -n "asset-db|vendor|vendored|npm pack|package mirror|packages/asset-db|record manager|sync|patch" docs .codex workflow scripts package.json packages/asset-db`
- `git log --oneline --all -- package.json package-lock.json packages/asset-db`
- `git show 8bb68e7`
- `git show 8a80e3b`

如果当前环境能访问 Codex 线程工具，应搜索当前仓库相关线程消息：

- 搜索关键词：`asset-db`、`packages/asset-db`、`vendor asset-db`、`record manager`、`adapter-to-386`、`3.8.6 parity`。
- 记录线程来源、结论和是否有可复现命令。

如果没有线程工具或没有可读线程记录，报告中必须写明“未能从当前环境读取线程记录”，不能伪造来源。

### 4.5 决策规则

- 官方版本未变，adapter patch 仍只存在于本地 package：保留本地 package，并列出 patch 与验证。
- 官方版本变了：先 re-vendor 官方新 package，再重新应用 adapter patch；不能直接沿用旧 vendored package。
- 官方已包含 adapter patch：评估删除本地 patch，进一步评估能否回到 registry package。
- 本地 package 没有维护脚本：不得手工覆盖后声称完成；必须记录维护风险。
- 行为无法证明等价：列为风险，不得用 `npm run build` 通过替代。

## 阶段 5：冲突与间接影响审计

目标：重新审计直接冲突和间接影响，不只列文件。

直接冲突来源：

- `git merge-tree origin/main adapter-to-386`
- 实际 rebase 记录中的冲突文件。
- `git diff origin/main..REBASED` 中重叠文件。

每个冲突文件必须记录：

- 官方在 `BASE..OFFICIAL` 的改动意图。
- adapter 在 `BASE..ADAPTER` 的改动意图。
- rebase 结果在 `REBASED` 中采用了什么。
- 为什么这样处理。
- 需要什么测试证明。

当前已知直接冲突候选：

- `src/api/builder/builder.ts`
- `src/api/builder/schema.ts`
- `src/core/assets/asset-config.ts`
- `src/core/builder/index.ts`
- `src/core/builder/manager/plugin.ts`
- `src/core/builder/worker/builder/asset-handler/script/index.ts`
- `src/core/configuration/test/manager.test.ts`

间接影响必须覆盖：

- npm/package 来源与 lockfile。
- `packages/engine`、`packages/cc-module`、`node_modules/cc`、`node_modules/@cocos/asset-db` 的实际解析。
- generated files：schema、DTS snapshot、static web bundle。
- runtime-preview 独立 package 是否仍应存在。
- build/test 脚本变化导致的验证范围变化。

## 阶段 6：验证矩阵设计

验证不能只写“通过”。每条命令必须记录：

- 命令。
- 工作目录。
- 前置环境。
- 覆盖的风险。
- 未覆盖的风险。
- 输出摘要。

最低验证矩阵：

- dependency sanity：
  - 验证 `require.resolve("@cocos/asset-db/package.json")`、`require.resolve("cc/package.json")` 实际路径。
  - 验证 worktree `packages/engine` 是否与 adapter 指向同一个 3.8.6 engine。
  - 验证 `packages/cc-module` 生成物是否与 adapter 预期一致。
- package logic：
  - 对 `@cocos/asset-db` 跑 targeted tests 或 fixture，覆盖 internal record/source meta/library path。
  - 如果没有现成测试，报告应明确缺口，并建议补测试。
- compile/build：
  - `npm run compile`
  - `npm run build`
  - 记录是否更新 generated files，例如 `packages/cocos-cli-types` snapshot。
- focused Jest：
  - builder schema/API/progress/template。
  - project extension builder hooks。
  - `wechatgame` platform。
  - configuration owner model。
  - asset-db mount/internal record/source meta。
- runtime-preview：
  - 根据 `vitests` 是否保留，运行对应 Vitest suite 或说明 fixture/env 缺口。

成功判定：

- 所有直接冲突都有验证覆盖或明确风险。
- 所有保留的 adapter patch 都有对应测试、fixture 或手工可复现验证。
- npm 自定义依赖的官方 baseline 与本地 package 差异已解释。
- 没有把“编译通过”当成 package 行为验证。

## 阶段 7：报告修订原则

后续报告必须遵守：

- 事实、推断、决策分开写。
- 错误结论需要保留更正说明，不能静默覆盖。
- 对每个“保留 adapter 行为”的决策写明官方是否已有等价能力。
- 对每个“跟随官方”的决策写明 adapter 目标是否受损。
- 所有文档使用中文；代码标识符、路径、命令、package 名保留英文。

## 下一步执行顺序

1. 冻结状态并写 commit 矩阵。
2. 分析 `BASE..OFFICIAL`。
3. 分析 `BASE..ADAPTER`。
4. 深入分析自定义 npm 依赖，先从 `@cocos/asset-db` 开始。
5. 审计 `REBASED` 实际处理。
6. 设计并运行验证矩阵。
7. 产出最终中文分析报告。
