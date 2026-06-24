# AssetDB `library` / `temp` path 对齐交接文档

## 背景

官方 `origin/main` 中 commit `1bbcbc4 Fix: align temp and library paths with Cocos Creator directory structure. (#632)` 修改了 AssetDB 与 config schema 的路径布局。

这是逐项对齐台账中的：

- A13：`asset-config.ts` temp/library path
- A16：configuration schema path

相关文档：

- `docs/dev/build/plans/adapter-to-386-origin-main-alignment-ledger-20260622.md`
- `docs/dev/build/reports/adapter-to-386-rebase-origin-main-deep-analysis-20260622.md`

## 执行位置

当前“合并官方改动并验证”的实际修改位置应是 rebase worktree，而不是主工作区。

推荐执行目录：

```text
E:\own_space\engines\cocos-cli\.worktrees\rebase-adapter-to-386-origin-main-20260622
```

推荐分支：

```text
codex/rebase-adapter-to-386-origin-main-20260622
```

主工作区：

```text
E:\own_space\engines\cocos-cli
```

主工作区当前在 `adapter-to-386`，应只用于查看文档和原始 adapter 事实，不应直接修改代码来试合官方路径。若需要修改文档，可以在主工作区写；若需要修改代码或运行 rebase 验证，应切到上面的 rebase worktree。

开始前先确认：

```powershell
rtk git status --short --branch
rtk git rev-parse --abbrev-ref HEAD
rtk git rev-parse HEAD
```

预期：

- 当前目录是 `.worktrees\rebase-adapter-to-386-origin-main-20260622`。
- 当前分支是 `codex/rebase-adapter-to-386-origin-main-20260622`。
- 工作区 clean；如果不 clean，先记录脏文件，不要直接覆盖。

## 官方改动

官方在 `src/core/assets/asset-config.ts` 中做了三处路径调整：

| 项 | 旧路径 | 官方新路径 |
| --- | --- | --- |
| `tempRoot` | `<project>/temp/cli/asset-db` | `<project>/temp/asset-db` |
| project assets library | `<project>/library/cli` | `<project>/library` |
| extension asset-db library | `<project>/library/cli-extensions/<name>` | `<project>/library/<name>` |

官方在 `src/core/configuration/script/manager.ts` 中也调整了 schema path：

| 项 | 旧路径 | 官方新路径 |
| --- | --- | --- |
| `ConfigurationManager.relativeSchemaPath` | `./temp/cli/cocos.config.schema.json` | `./temp/cocos.config.schema.json` |

## adapter 相关背景

adapter-to-386 之前为了支持 3.8.6 / Editor parity，做过以下相关改动：

- local `@cocos/asset-db` 维护 internal record parity。
- project extension asset-db mount。
- runtime-preview source meta / generated output fixture。
- configuration owner model：Editor-owned config 与 CLI-owned overlay 分离。

因此，不能只看路径 diff 后直接判断“采用官方一定没问题”。需要确认：

- project assets 使用 `<project>/library` 是否符合 adapter 当前 Editor baseline parity。
- extension asset-db 使用 `<project>/library/<name>` 是否会与 project assets、internal records 或其他 extension 产物冲突。
- `temp/asset-db` 是否会与 Editor / CLI / runtime-preview 其它 temp 目录冲突。
- config schema path 从 `temp/cli` 到 `temp` 是否仍符合 owner model。

## 初步判断

project assets library 使用 `<project>/library` 很可能应该采用官方路径，因为它更接近 Creator 目录结构，也与 `docs/dev/build/facts/meta-library-editor-parity-20260613.md` 中“project/internal library 与 Editor baseline 对齐”的方向一致。

需要重点分析的是 extension asset-db library：

- adapter 旧方向是 `<project>/library/cli-extensions/<extensionName>`。
- 官方新方向是 `<project>/library/<extensionName>`。

风险在于：

- extension name 是否可能与 project asset output、bundle、internal record 或其它 reserved 目录冲突。
- 多个 extension 的 name 规则是否稳定。
- official Creator 是否确实使用 `<project>/library/<extensionName>` 存放 extension asset-db import outputs。
- runtime-preview resolver 是否依赖 `cli-extensions` 目录结构。

## 分析任务

新会话应按以下顺序分析。

### 1. 固定基准

```powershell
rtk git merge-base adapter-to-386 origin/main
rtk git rev-parse origin/main adapter-to-386 codex/rebase-adapter-to-386-origin-main-20260622
```

记录：

- `BASE`
- `OFFICIAL`
- `ADAPTER`
- `REBASED`

### 2. 读取官方路径改动

```powershell
rtk git show --unified=80 1bbcbc4 -- src/core/assets/asset-config.ts src/core/configuration/script/manager.ts src/core/configuration/test/manager.test.ts
```

确认官方改动只包含：

- `temp/cli/asset-db` -> `temp/asset-db`
- `library/cli` -> `library`
- `library/cli-extensions/<name>` -> `library/<name>`
- `./temp/cli/cocos.config.schema.json` -> `./temp/cocos.config.schema.json`

### 3. 对比 adapter 对同一区域的改动

```powershell
rtk git diff --unified=80 BASE..adapter-to-386 -- src/core/assets/asset-config.ts src/core/assets/extension-asset-db-mounts.ts src/core/launcher.ts vitests docs/dev/runtime-preview docs/dev/build
```

重点看：

- adapter 如何注册 project extension asset-db mount。
- extension library root 是否被 runtime-preview resolver 使用。
- 测试是否硬编码 `library/cli-extensions`。
- 文档是否把 `cli-extensions` 作为设计要求，而不是临时实现。

### 4. 审计 rebase 结果

```powershell
rtk git diff --unified=80 origin/main..codex/rebase-adapter-to-386-origin-main-20260622 -- src/core/assets/asset-config.ts src/core/assets/extension-asset-db-mounts.ts src/core/launcher.ts
rtk git diff --unified=80 adapter-to-386..codex/rebase-adapter-to-386-origin-main-20260622 -- src/core/assets/asset-config.ts src/core/assets/extension-asset-db-mounts.ts src/core/launcher.ts
```

确认 `REBASED` 当前到底采用了哪种路径：

- project library 是否是 `<project>/library`
- extension library 是否是 `<project>/library/<name>` 或 `<project>/library/cli-extensions/<name>`
- runtime-preview 是否同步读取同一策略

## 候选修改文件

如果分析后决定调整 A13，应优先限制在以下文件内。不要做无关重构。

### 生产代码

| 文件 | 可能修改内容 |
| --- | --- |
| `src/core/assets/asset-config.ts` | `tempRoot`、project assets library、extension asset-db library 的最终路径策略。 |
| `src/core/assets/extension-asset-db-mounts.ts` | 如果 extension library root 需要统一由 helper 计算，可在这里补结构化字段；否则不要改。 |
| `src/core/launcher.ts` | runtime-preview / launcher 若读取 extension library roots，需要同步最终路径策略。 |
| `src/core/configuration/script/manager.ts` | `ConfigurationManager.relativeSchemaPath`，A16 相关。若已采用官方 `./temp/cocos.config.schema.json`，不要反向改回 `temp/cli`。 |

### 测试

| 文件 | 可能修改内容 |
| --- | --- |
| `src/core/assets/test/extension-asset-db-mounts.spec.ts` | 增加或更新 extension library root 断言。 |
| `src/core/assets/test/asset-db-internal-record.test.ts` | 验证 project/internal library root 和 `.internal-*` records。 |
| `src/core/assets/test/config-sync.test.ts` | 验证 AssetDB config sync 与 project library root。 |
| `src/core/configuration/test/manager.test.ts` | 验证 `$schema` 使用 `./temp/cocos.config.schema.json`。 |
| `src/core/configuration/test/manager-editor-files.test.ts` | 验证 owner model 不因 schema path 改动回退。 |
| `src/core/configuration/test/owner-map.test.ts` | 必要时验证新增/变更 metadata 的 owner 归属。 |
| `vitests/suites/runtime-preview/**` | 如果 runtime-preview resolver 依赖旧 extension library path，补 fixture 或更新预期。 |

### 文档

| 文件 | 可能修改内容 |
| --- | --- |
| `docs/dev/build/plans/adapter-to-386-origin-main-alignment-ledger-20260622.md` | 在 A13 下追加最终决策、验证命令和结果。 |
| `docs/dev/build/reports/adapter-to-386-rebase-origin-main-deep-analysis-20260622.md` | 只有发现原报告事实错误时才修正；一般不要继续膨胀报告。 |

## 建议修改顺序

1. 在 rebase worktree 确认当前 `src/core/assets/asset-config.ts` 的路径状态。
2. 先补或更新测试，让测试明确断言最终路径策略：
   - project assets library
   - extension asset-db library
   - config schema path
3. 再修改生产代码。
4. 跑 focused tests。
5. 若 runtime-preview 受影响，再跑 Vitest fixture。
6. 将 A13 台账状态从 `analyzing` 更新为 `done` / `blocked` / `accepted-risk`。

## 验证矩阵

### 1. 单元测试：extension mount

```powershell
rtk npx jest src/core/assets/test/extension-asset-db-mounts.spec.ts --runInBand
```

覆盖：

- extension mount discovery。
- extension asset-db library root。
- invalid package / missing mount 容错。

需要检查测试是否断言了最终 path。如果测试只验证 mount target，不验证 library root，应补测试。

### 2. 单元测试：AssetDB internal record

```powershell
rtk npx jest src/core/assets/test/asset-db-internal-record.test.ts src/core/assets/test/config-sync.test.ts --runInBand
```

覆盖：

- project/internal DB library root。
- `.internal-info1.0.0.json`
- `.internal-dependency.json`
- `.internal-data.json`
- config sync 后的 path 是否仍符合 baseline。

### 3. configuration schema path

```powershell
rtk npx jest src/core/configuration/test/manager.test.ts src/core/configuration/test/manager-editor-files.test.ts src/core/configuration/test/owner-map.test.ts --runInBand
```

覆盖：

- `$schema` 是否为 `./temp/cocos.config.schema.json`。
- Editor-owned config 不被写回 `cocos.config.json`。
- CLI-owned overlay 仍正常保存。

### 4. runtime-preview resolver / generated output

如果 fixture 可用：

```powershell
rtk npm --prefix vitests test -- suites/runtime-preview/cli-generated-output-integration.test.ts suites/runtime-preview/source-meta-editor-parity.test.ts
```

覆盖：

- runtime-preview 是否仍能找到 project assets library。
- extension asset-db library 是否仍能被 resolver 找到。
- source meta / generated output 是否与 Editor baseline 对齐。

### 5. 真实 project fixture 或手工 fixture

准备一个最小项目：

- `assets/` 中包含普通 asset。
- `extensions/<extensionName>/package.json` 中声明 `contributions.asset-db.mount.path`。
- extension mount 下包含一个可 import asset。

运行 CLI AssetDB startup 或 build 后检查：

- `<project>/library` 中是否有 project assets import output。
- extension output 位于何处。
- extension output 是否与 project assets output 混淆。
- `<project>/temp/asset-db` 是否生成预期临时数据。
- `<project>/cocos.config.json` 的 `$schema` 是否指向 `./temp/cocos.config.schema.json`。

## 决策标准

### 可以采用官方路径的条件

- project assets 使用 `<project>/library` 后，internal record/source meta parity tests 通过。
- extension library 使用 `<project>/library/<extensionName>` 后，不与 project assets、internal records、bundle output 或其它 extension 冲突。
- runtime-preview resolver 不依赖旧 `library/cli-extensions`。
- config owner model 测试通过。

### 应保留 adapter-specific extension isolation 的条件

如果发现以下任一事实，应保留或重新设计 extension isolation：

- `<project>/library/<extensionName>` 与真实 project asset / bundle / reserved library 目录冲突。
- 多个 extension name 无法保证唯一。
- runtime-preview 或 build resolver 需要明确区分 extension output 与 project output。
- Editor baseline 实际不是 `<project>/library/<extensionName>`。

保留 adapter-specific isolation 时，优先考虑：

- project assets 与 internal DB 采用官方路径。
- extension asset-db 保留 `<project>/library/cli-extensions/<extensionName>` 或另一个明确 namespace。
- 文档写明这是 adapter-specific divergence，并加测试固定。

## 推荐结论格式

新会话完成后，应在台账 A13 下追加：

```md
### A13: asset-config.ts temp/library path

- 状态：
- 决策：
- 官方证据：
- adapter 证据：
- 最终路径：
  - tempRoot:
  - project assets library:
  - extension library:
  - config schema path:
- 验证命令：
- 验证结果：
- 剩余风险：
```

## 注意事项

- 不要只因为官方改了路径就直接采用 extension path；extension path 是本项最需要验证的部分。
- 不要把 `npm run build` 通过当作 library path 行为验证。
- 不要删除 local `@cocos/asset-db` patch；A13 只处理 path strategy，不处理 package upgrade。
- 不要把 build 后 generated library 回滚作为验证方式；必须解释为什么不产生差异或差异为何符合 baseline。
