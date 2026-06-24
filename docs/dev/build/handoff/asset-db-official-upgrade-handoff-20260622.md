# `@cocos/asset-db` 官方版本升级交接文档

## 背景

当前 `adapter-to-386` 没有直接使用官方 registry `@cocos/asset-db`。分支把官方 npm package vendored 到本仓库：

- root `package.json`: `@cocos/asset-db: file:./packages/asset-db`
- local package: `packages/asset-db`

这不是官方原本状态。官方 `origin/main` 当前仍使用 registry package：

- `@cocos/asset-db@3.0.0-alpha.10`
- resolved: `https://registry.npmjs.org/@cocos/asset-db/-/asset-db-3.0.0-alpha.10.tgz`

adapter 使用 local package 的原因是需要维护 3.8.6 / Editor baseline parity，尤其是 internal record 写入行为。

## 目标

如果未来要升级或重新采用官方 `@cocos/asset-db` 版本，不能直接覆盖 `packages/asset-db`。正确流程是：

1. 获取官方 package baseline。
2. 将官方 package 中相关 JS 模块同步为可维护 TS 源。
3. 在 TS 源层合并 adapter patch。
4. 处理官方新逻辑与 adapter patch 的冲突或兼容。
5. 重新生成 runtime JS / `.d.ts`。
6. 跑 focused tests 和真实 baseline 对比。

## 当前 adapter patch 范围

当前 local `packages/asset-db` 与官方 package 的关键差异集中在以下模块：

- `libs/asset-db.js`
- `libs/console.js` / `libs/console.d.ts`
- `libs/data.js` / `libs/data.d.ts`
- `libs/dependency.js` / `libs/dependency.d.ts`
- `libs/info.js` / `libs/info.d.ts`
- `libs/migrator.js` / `libs/migrator.d.ts`
- `src/libs/console.ts`
- `src/libs/data.ts`
- `src/libs/dependency.ts`
- `src/libs/info.ts`
- `src/libs/migrator.ts`

维护风险：

- `libs/asset-db.js` 中的 `prepareStart()` patch 当前没有对应 `src/libs/asset-db.ts`。
- 未来升级官方 package 时，不能只覆盖 `libs/asset-db.js`，否则会丢失 internal info record path patch。

## 必须保留或重新评估的 adapter 行为

以下行为是 adapter 引入 local package 的主要原因：

1. `internal` DB 使用 `.internal-info1.0.0.json`
   - 官方 package 使用 `.${name}-info.json`，对 `internal` 即 `.internal-info.json`。
   - adapter 需要对齐 Editor baseline 的 `.internal-info1.0.0.json`。

2. `InfoManager` 的 Editor compatibility
   - local package 对 `.internal-info1.0.0.json` 保持 Editor `version/map/missing` 形状。
   - internal record 中保留绝对路径。
   - 非 internal record 仍使用当前相对路径 schema。

3. `DependencyManager` 的 Editor compatibility
   - local package 对 `.internal-dependency.json` 保持 Editor 顶层 `path/uuid` 形状。
   - 非 internal 输出 `version/data.path/data.uuid`。

4. `DataManager` preserve behavior
   - local package 对已存在的 `.internal-data.json` 执行 preserve。
   - 避免 `empty/update/setValue` 覆盖 Editor baseline。

5. associated map restore
   - `DependencyManager` 增加 `restoreAssociatedMap()`。
   - 读取 cache 后重建 associated map。

这些行为不能在升级官方 package 时静默丢失。若官方新版本已包含等价行为，需要用代码 diff 和测试证明。

## 建议落地脚本

建议新增：

- `packages/asset-db/scripts/extract-official-package.js`
- `packages/asset-db/scripts/diff-official-package.js`

### `extract-official-package.js`

职责：

- 输入官方版本号，例如 `3.0.0-alpha.10`。
- 执行 `npm pack @cocos/asset-db@<version>`。
- 校验 package metadata、version、integrity。
- 解包到临时 baseline 目录，例如：
  - `packages/asset-db/.baseline/<version>/package`
  - 或 `.worktrees/asset-db-baseline/<version>/package`
- 不覆盖当前 `packages/asset-db`。

输出：

- 官方 package 文件列表。
- `package.json` metadata。
- `libs/**/*.js` / `libs/**/*.d.ts` hash。
- dependencies/devDependencies/scripts。

### `diff-official-package.js`

职责：

- 对比官方 baseline 与当前 `packages/asset-db`。
- 输出：
  - 文件增删。
  - metadata 差异。
  - `libs/*.js` 差异。
  - `libs/*.d.ts` 差异。
  - 当前 local `src/libs/*.ts` 是否覆盖被修改的 runtime JS。
- 对已知 adapter patch 打标签：
  - `internal-info-path`
  - `info-editor-compatibility`
  - `dependency-editor-compatibility`
  - `data-preserve`
  - `associated-map-restore`

输出不应自动覆盖文件。

## 官方版本升级流程

### 1. 获取官方 baseline

```powershell
rtk node packages/asset-db/scripts/extract-official-package.js <official-version>
```

必须记录：

- version
- resolved tarball
- integrity
- 文件列表
- package metadata

### 2. 对比官方 baseline 与当前 local package

```powershell
rtk node packages/asset-db/scripts/diff-official-package.js <official-version>
```

先回答：

- 官方新版本是否修改了 adapter patch 涉及的模块？
- 官方是否已经包含 adapter 需要的 internal record parity 行为？
- 官方是否引入新的 public API、record schema 或 migration 逻辑？

### 3. 将官方相关 JS 转为 TS 源

不能直接把官方 `libs/*.js` 覆盖到 local package。

如果官方新版本修改了以下模块，应先同步 / 转写到 `src/libs/*.ts`：

- `asset-db`
- `console`
- `data`
- `dependency`
- `info`
- `migrator`
- 其它 diff 显示被官方修改且 adapter 需要继续维护的模块

尤其需要补齐：

- `src/libs/asset-db.ts`

这样后续 patch 应落在 TS 源上，而不是只改 generated JS。

### 4. 在 TS 源层合并 adapter patch

逐项判断：

- 如果官方已经实现等价行为：删除或缩小 adapter patch，并添加验证说明。
- 如果官方没有实现：在 TS 源中重新应用 adapter patch。
- 如果官方实现了部分行为但 schema 不同：写兼容层，并用测试固定输入/输出。

不要直接复制旧 local JS 到新官方版本上。

### 5. 生成 runtime JS / `.d.ts`

```powershell
rtk npm --prefix packages/asset-db run build
```

构建后检查：

- `libs/*.js`
- `libs/*.d.ts`
- 是否有非预期文件变更
- `node_modules/` 是否被误加入 package

### 6. 跑 focused tests

最低验证：

```powershell
rtk npx jest src/core/assets/test/asset-db-internal-record.test.ts src/core/assets/test/config-sync.test.ts --runInBand
```

建议补充：

```powershell
rtk npx jest src/core/assets/test/extension-asset-db-mounts.spec.ts --runInBand
```

如果涉及 source meta / 3D asset：

```powershell
rtk npm --prefix vitests test -- suites/build/3d-source-meta-editor-alignment.test.ts
```

### 7. 做真实 baseline 对比

对真实项目或 fixture 执行 build / AssetDB startup 后，比较：

- `library/.internal-info1.0.0.json`
- `library/.internal-dependency.json`
- `library/.internal-data.json`

需要确认：

- 文件名是否符合 Editor baseline。
- schema 是否符合 Editor baseline。
- 内容是否只存在可解释差异。
- `.internal-info1.0.0.json` 中 engine asset `time` 字段差异是否与 Editor 在相同 engine source mtime 下行为一致。

## 决策表

| 场景 | 处理 |
| --- | --- |
| 官方版本未变 | 不需要 re-vendor；只验证 local patch 仍必要。 |
| 官方版本升级但未触碰 patch 模块 | 可 re-vendor 非 patch 文件，但仍需 diff 和 tests。 |
| 官方版本升级且触碰 patch 模块 | 先转 TS，再合并 patch，处理冲突。 |
| 官方已包含 adapter 行为 | 删除对应 local patch，并用测试证明。 |
| 官方行为与 adapter 目标冲突 | 保留 adapter patch 或加兼容层，并记录原因。 |
| 无法证明行为等价 | 不得回 registry；标记为 blocked 或 accepted-risk。 |

## 交接给新会话的建议任务

新会话应从以下任务开始：

1. 阅读本文档。
2. 阅读 `docs/dev/build/reports/adapter-to-386-rebase-origin-main-deep-analysis-20260622.md` 中 `@cocos/asset-db` 章节。
3. 检查当前 `packages/asset-db` 是否仍无 `scripts/extract-official-package.js`。
4. 新增 `extract-official-package.js` 和 `diff-official-package.js`。
5. 使用官方 `@cocos/asset-db@3.0.0-alpha.10` 跑一次 baseline extract + diff。
6. 不修改 local runtime 逻辑，只先把可重复维护流程落地。
7. 运行 focused tests，记录结果。

## 不应做的事

- 不要直接用官方 package 覆盖 `packages/asset-db`。
- 不要只看 `package.json` 版本号判断可以回 registry。
- 不要只跑 `npm run build` 就声称 `asset-db` 行为验证完成。
- 不要只改 `libs/*.js` 而不补对应 `src/libs/*.ts`。
- 不要把 Editor baseline 差异用 build 后回滚掩盖。
