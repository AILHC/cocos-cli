# `@cocos/asset-db` 官方版本维护脚本实施计划

## 目标

为 `packages/asset-db` 补充未来官方 registry 版本升级时可重复使用的维护脚本。当前不升级 `@cocos/asset-db`，不修改 `packages/asset-db/libs/` 或 `packages/asset-db/src/` runtime 逻辑，只建立官方 package 提取、差异分析和源码整理 staging 流程。

适用场景示例：未来 npm registry 出现 `@cocos/asset-db@3.0.0-alpha.12` 时，先提取官方 package，再生成可读 JS / candidate TS staging，最后比较官方变更与 adapter local patch 的差异，决定是否合并、保留或重写 adapter patch。

## 工作区

本计划应在合并官方的 worktree 执行：

```text
E:\own_space\engines\cocos-cli\.worktrees\rebase-adapter-to-386-origin-main-20260622
```

不得在主工作区 `E:\own_space\engines\cocos-cli` 执行本计划的文件修改。

## 背景事实

- git 历史显示，adapter vendor 前的 registry baseline 是 `@cocos/asset-db@3.0.0-alpha.10`。
- `7e3d243 chore: vendor asset-db local package mirror` 将 root dependency 从 `3.0.0-alpha.10` 改为 `file:./packages/asset-db`。
- 当前 local package `packages/asset-db/package.json` version 仍是 `3.0.0-alpha.10`。
- 当前 local package 不是纯 mirror，包含 internal record parity patch。
- 官方版本未变化时，不需要 re-vendor；未来官方版本变化时，不能直接覆盖 `packages/asset-db`。

## 文件计划

新增：

- `packages/asset-db/scripts/extract-official-package.js`
- `packages/asset-db/scripts/diff-official-package.js`
- `packages/asset-db/scripts/prepare-official-ts-source.js`

可选更新：

- `docs/dev/build/handoff/asset-db-official-upgrade-handoff-20260622.md`

仅补充脚本实际命令、输出目录和边界说明，不改动既有事实结论。

## 脚本设计

### `extract-official-package.js`

职责：

- 输入官方版本号，例如 `3.0.0-alpha.12`。
- 执行 `npm pack @cocos/asset-db@<version> --json --pack-destination <download-dir>`。
- 解包到：

```text
packages/asset-db/.baseline/<version>/package
```

- tarball 下载目录：

```text
packages/asset-db/.baseline/<version>/download
```

- 写入 summary：

```text
packages/asset-db/.baseline/<version>/summary.json
```

summary 至少包含：

- package name / version
- tarball filename
- npm registry
- npm view `dist.tarball` / `dist.shasum` / `dist.integrity`
- shasum / integrity
- 官方 package 文件列表
- `libs/**/*.js` / `libs/**/*.d.ts` hash
- `package.json` metadata：`main`、`types`、`exports`、`bin`、`scripts`、`dependencies`、`devDependencies`

约束：

- 不覆盖当前 `packages/asset-db/index.js`、`libs/`、`src/`。
- 同一版本重复执行默认只清理 `.baseline/<version>/package`、`.baseline/<version>/download` 和 `summary.json`，不得删除同版本下已有的 `readable-js` / `candidate-src`。
- 只有显式传入 `--force` 时，才允许清理整个 `.baseline/<version>`。
- 失败时退出非 0，并说明失败阶段。

### `diff-official-package.js`

职责：

- 支持两类对比，不把 upstream delta 和 adapter patch 混在一起：
  - upstream delta：`previous official baseline -> new official baseline`
  - adapter delta：`new official baseline -> current local package`
- 推荐参数：

```powershell
rtk node packages/asset-db/scripts/diff-official-package.js --from <previous-official-version> --to <new-official-version>
```

- 兼容参数：

```powershell
rtk node packages/asset-db/scripts/diff-official-package.js <official-version>
```

  仅输出 `official baseline -> current local package`，用于当前 `3.0.0-alpha.10` baseline 校验。

- 读取官方 baseline：

```text
packages/asset-db/.baseline/<version>/package
```

- `--from` / `--to` 模式要求两个版本都已通过 `extract-official-package.js` 提取；缺失时退出非 0，并提示先提取缺失版本。

输出内容：

- upstream delta：
  - only previous official files
  - only new official files
  - changed official files
  - official `package.json` metadata 差异
  - official `libs/*.js` / `libs/*.d.ts` changed list
- adapter delta：
  - only official files
  - only local files
  - changed common files
  - local `package.json` metadata 差异
  - local `libs/*.js` / `libs/*.d.ts` changed list
  - local `src/libs/*.ts` 对 changed runtime JS 的覆盖情况

持久化报告：

```text
packages/asset-db/.baseline/<to-version>/diff-from-<from-version>.json
packages/asset-db/.baseline/<to-version>/diff-from-<from-version>.md
```

无 `--from` 时：

```text
packages/asset-db/.baseline/<version>/diff-report.json
packages/asset-db/.baseline/<version>/diff-report.md
```

报告应包含输入版本、baseline 路径、文件 hash、metadata diff、source coverage、patch tag 提示和 `needs manual review` 列表。

重点维护风险：

- 如果 `libs/<name>.js` 变化，但没有 `src/libs/<name>.ts`，输出 `missing-source`。
- 当前已知风险示例：`libs/asset-db.js` 有 adapter patch，但当前没有 `src/libs/asset-db.ts`。

patch tag 仅作为提示，不作为硬失败：

- `internal-info-path`
- `info-editor-compatibility`
- `dependency-editor-compatibility`
- `data-preserve`
- `associated-map-restore`

如果 heuristic 未命中，应输出 `needs manual review`，不得静默当作无风险。

### `prepare-official-ts-source.js`

职责：

- 输入官方版本号；未来升级场景推荐同时传入 previous official version：

```powershell
rtk node packages/asset-db/scripts/prepare-official-ts-source.js <new-official-version> --from <previous-official-version>
```

- 读取官方 baseline package。
- 如果传入 `--from`，读取对应 diff 报告：

```text
packages/asset-db/.baseline/<new-official-version>/diff-from-<previous-official-version>.json
```

- 如果未传入 `--from`，读取同版本的 `diff-report.json`；缺失时仍可只按 patch-risk / missing-source 模块生成 staging，但必须在输出中说明没有 upstream delta 输入。
- 生成官方源码整理 staging，不写入当前 runtime。

输出目录：

```text
packages/asset-db/.baseline/<version>/readable-js
packages/asset-db/.baseline/<version>/candidate-src
```

`readable-js`：

- 默认存放格式化后的高价值官方 `libs/*.js`：upstream changed modules、adapter patch 涉及模块、`missing-source` 模块。
- 可通过 `--all` 生成全部官方 `libs/*.js`。
- 只做确定性格式化，不改变语义。

`candidate-src`：

- 默认只为高价值官方 `libs/*.js` 生成对应 `.ts` 候选文件。
- 可通过 `--all` 生成全部候选文件。
- 文件头必须说明：这是从官方 JS staging 得到的候选源，不是最终可维护 TS。
- 保留与官方 JS 的映射关系，方便后续 AI / 人工整理。

约束：

- 不声明自动生成的 candidate TS 已经可维护。
- 不写入 `packages/asset-db/src/libs/`。
- 不运行 `packages/asset-db` build。

## 实施步骤

1. 新建 `packages/asset-db/scripts/`。
2. 实现 `extract-official-package.js`。
3. 实现 `diff-official-package.js`。
4. 实现 `prepare-official-ts-source.js`。
5. 可选更新 handoff 文档，补充实际命令和 staging 边界。

## 推荐使用流程

未来出现官方新版本时：

```powershell
rtk node packages/asset-db/scripts/extract-official-package.js <previous-official-version>
rtk node packages/asset-db/scripts/extract-official-package.js <new-official-version>
rtk node packages/asset-db/scripts/diff-official-package.js --from <previous-official-version> --to <new-official-version>
rtk node packages/asset-db/scripts/prepare-official-ts-source.js <new-official-version> --from <previous-official-version>
```

然后人工 / AI 按以下顺序处理：

1. 阅读 `summary.json`、`diff-from-<previous>.json` 和可读 diff 报告。
2. 先判断官方 upstream delta 是否修改 adapter patch 涉及模块。
3. 从 `candidate-src` 中整理可维护 TS。
4. 在 TS 源层重新合并或删除 adapter patch。
5. 构建并运行 focused tests。
6. 做真实 Editor baseline 对比。

## 必要验证

只做能证明脚本有用且不会误伤 runtime 的验证：

```powershell
rtk node packages/asset-db/scripts/extract-official-package.js 3.0.0-alpha.10
rtk node packages/asset-db/scripts/diff-official-package.js 3.0.0-alpha.10
rtk node packages/asset-db/scripts/diff-official-package.js --from 3.0.0-alpha.10 --to 3.0.0-alpha.10
rtk node packages/asset-db/scripts/prepare-official-ts-source.js 3.0.0-alpha.10
rtk node packages/asset-db/scripts/prepare-official-ts-source.js 3.0.0-alpha.10 --from 3.0.0-alpha.10
rtk git status --short
```

验收点：

- `.baseline/3.0.0-alpha.10/package/package.json` 存在，version 正确。
- `.baseline/3.0.0-alpha.10/download` 存放 tarball，worktree root 不出现新 `.tgz`。
- extract 输出 `npm view dist.integrity`、`npm pack integrity` 一致；对 `3.0.0-alpha.10`，该值应等于历史 lockfile 记录的 `sha512-pEgYyRwm7548Zf8B+T/7mnCLIcoDqvPGZtwW3GnIKYcbLuYz+qXDpUIisx4ACAGg19G4XZwHF1U1/PHdfOjaTg==`。
- diff 能列出 changed `libs` 文件。
- diff 能指出 changed runtime JS 的 source coverage，尤其能暴露 `libs/asset-db.js` 缺少 `src/libs/asset-db.ts`。
- diff 生成 `.baseline/3.0.0-alpha.10/diff-report.json` 和 `.baseline/3.0.0-alpha.10/diff-report.md`。
- `--from 3.0.0-alpha.10 --to 3.0.0-alpha.10` 模式下 upstream delta 为空，adapter delta 仍可输出，并生成 `.baseline/3.0.0-alpha.10/diff-from-3.0.0-alpha.10.json` 和 `.md`。
- prepare 只生成 `.baseline/.../readable-js` 和 `.baseline/.../candidate-src`。
- prepare 的 `--from` 模式能读取 `diff-from-*.json`，并以 upstream changed modules / patch-risk / missing-source 模块作为默认 staging 范围。
- `git status --short` 不出现 root `.tgz`、`packages/asset-db/libs/*` 或 `packages/asset-db/src/*` 被误改。

不把 focused Jest 作为本脚本任务的必要验证；除非实现过程中实际修改了 runtime 逻辑。

## 非目标

- 不升级 `@cocos/asset-db`。
- 不覆盖 `packages/asset-db` 当前 runtime。
- 不自动合并官方新版本。
- 不把官方压缩 JS 自动转换结果声明为最终可维护 TS。
- 不用 patch tag 代替人工判断。

## 待确认事项

- `.baseline/` 是否提交到 git：建议不提交官方提取产物，只提交脚本；如需避免误提交，应加入 `packages/asset-db/.gitignore` 或 root `.gitignore`。
- candidate TS 是否需要依赖格式化工具：建议优先使用本仓库已安装依赖或脚本内轻量格式化，避免为 staging 引入新的 production dependency。
