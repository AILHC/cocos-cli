# `@cocos/asset-db` 定制源码接管实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用本仓库可控的 local package 接管 `@cocos/asset-db`，先证明 local mirror 与官方 npm 包行为等价，再基于 Editor baseline 修正 CLI build 写入 `library` 顶层 internal JSON 与 Editor 不一致的问题。

**Architecture:** 保留 package 名称 `@cocos/asset-db` 和既有 `@cocos/asset-db/libs/*` 子路径，避免批量修改 91 个调用点。先在 registry dependency 状态下写行为测试，切到 local mirror 后复跑同一组测试证明替换等价；再在 local package 的可维护源码层实现 Editor parity。

**Tech Stack:** Node.js, TypeScript, CommonJS, Jest, npm file dependency, Cocos CLI AssetDB manager。

---

## 文档归属

- Build 专题入口：[../../dev/build/README.md](../../dev/build/README.md)
- AssetDB 正式模块：[../../dev/modules/asset-db.md](../../dev/modules/asset-db.md)
- Packages 正式模块：[../../dev/modules/packages.md](../../dev/modules/packages.md)
- Builder 正式模块：[../../dev/modules/builder.md](../../dev/modules/builder.md)

## 执行原则

- 本计划是独立实施文档；执行者不需要依赖会话历史。
- 文档使用中文；代码标识符、路径、命令、专业术语保留英文。
- 每个 Task 完成后单独提交，提交信息说明本 Task 意图。
- 不得为了让测试通过而改变 production 默认行为；测试要对齐真实 CLI、Editor 或 npm 包事实。
- 不能简单禁止 CLI 写 `.meta` 或 `library`。目标是写入结果与 Editor 一致。
- 修改 `@cocos/asset-db` 行为前，必须先有行为测试覆盖当前官方 npm 包行为。
- 当前官方 npm 包关键 `libs/*.js` 没有 source map，不能声称完整恢复官方 TypeScript 源码；只能以格式化产物、`.d.ts` 和行为测试作为事实基础。

## 已确认事实

- 当前 CLI 依赖：`package.json` 中 `@cocos/asset-db: 3.0.0-alpha.10`。
- lockfile tarball：`package-lock.json` 中 `https://registry.npmjs.org/@cocos/asset-db/-/asset-db-3.0.0-alpha.10.tgz`。
- `npm view @cocos/asset-db version versions repository homepage --json` 返回版本列表仅有 `3.0.0-alpha.4` 到 `3.0.0-alpha.10`；当前 latest 为 `3.0.0-alpha.10`；没有返回 `repository` / `homepage` 字段。
- 本地包 `node_modules/@cocos/asset-db/package.json` 声明 `license: MIT`，入口为 `index.js`。
- 本地包包含 `index.js` / `index.d.ts` / `libs/*.js` / `libs/*.d.ts`。
- 只有根 `index.js` 带 inline `sourceMappingURL=data:application/json;base64,...`；`libs/*.js` 不带 inline source map，也没有独立 `.map` 文件。
- `src` 下共有 91 个文件命中 `@cocos/asset-db`，其中 14 个文件使用 `@cocos/asset-db/libs/*` 子路径。
- `src/core/assets/asset-config.ts` 当前配置：
  - `assets` DB：`target = <project>/assets`，`library = <project>/library/cli`。
  - `internal` DB：`target = <engine>/editor/assets`，`library = <project>/library`。
  - extension mount：`library = <project>/library/cli-extensions/<extension-name>`。
- `src/core/launcher.ts` 的 `Launcher.build()` 会先执行 `this.import()`，从而进入 AssetDB 启动链路。
- `src/core/assets/manager/asset-db.ts` 的 `_startDirectly()` / `_startDB()` 会调用 `db.start({ hooks })`。
- `node_modules/@cocos/asset-db/libs/asset-db.js`：
  - `AssetDB.version = "1.0.1"`。
  - `prepareStart()` 会对 `infoManager`、`dataManager`、`dependencyManager` 调 `setRecordJSON()`。
- `node_modules/@cocos/asset-db/libs/info.js`：
  - `InfoManager.version = "1.0.1"`。
  - `_readRecordInfo(file)` 优先读取 `file.replace(".json", "1.0.0.json")`。
  - 读到旧 `*.info1.0.0.json` 后会 migration 并移除旧文件。
  - `saveImmediate()` 写当前 `*.info.json`，结构为 `version` / `map` / `missing`。
- `node_modules/@cocos/asset-db/libs/dependency.js`：
  - `DependencyManager.version = "1.0.0"`。
  - migration 会把旧 `path` / `uuid` 顶层结构迁移为 `{ data: { path, uuid }, version }`，并保留转换为相对路径后的依赖映射。

## 问题结论

`library` 顶层 internal JSON 被改写的直接条件是：

1. CLI 的 `internal` DB 使用 `<project>/library` 作为 library。
2. `@cocos/asset-db@3.0.0-alpha.10` 在启动时迁移并保存当前 record schema。
3. `readonly: true` 不等于 `library` record readonly。

修复不能是“禁止写入”或“build 后回滚文件”，而应确认 Editor 侧使用的 record schema / migration 策略 / internal library 策略，再让 CLI 的写入行为对齐 Editor。

`BUILD-ISSUE-008` 的 4 个非 3D `.meta imported:false` 属于独立问题；本计划只处理 `BUILD-ISSUE-007` 的 `library` 顶层 internal JSON parity。Task 6 验证时若出现 `.meta` diff，应分类记录；除非 diff 是本计划改动引入，否则不作为 `BUILD-ISSUE-007` 修复验收失败的唯一依据。

## 文件职责图

计划实施时预计新增或修改以下文件：

- Modify: `package.json`
  - 将 `@cocos/asset-db` 从 registry dependency 改为 local file dependency。
  - 在 root `files` 白名单加入 `packages/asset-db`，保证 `npm pack` / release 包含 local dependency。
- Modify: `package-lock.json`
  - 由 `npm install` 生成 local package lock 记录。
- Create: `packages/asset-db/package.json`
  - local `@cocos/asset-db` package manifest，保持 name 为 `@cocos/asset-db`。
- Create: `packages/asset-db/index.js`
  - 兼容现有 CommonJS 入口。
- Create: `packages/asset-db/index.d.ts`
  - 复制或维护 public type entry。
- Create: `packages/asset-db/libs/**/*.js`
  - local package 初始 mirror 产物；后续由源码生成或受控维护。
- Create: `packages/asset-db/libs/**/*.d.ts`
  - 保持 `@cocos/asset-db/libs/*` 子路径类型兼容。
- Create: `packages/asset-db/src/**/*.ts`
  - 定制源码。第一批只源码化需要改动且可独立编译的 record manager 模块。
- Create: `packages/asset-db/scripts/extract-official-package.js`
  - 下载/解包/格式化官方 npm 包的受控工具。
- Create: `src/core/assets/test/asset-db-internal-record.test.ts`
  - registry dependency 和 local mirror 共用的行为测试。
- Modify: `docs/dev/build/facts/meta-library-editor-parity-20260613.md`
  - 实现验证后记录事实摘要。
- Modify: `docs/dev/build/issues.md`
  - 更新 `BUILD-ISSUE-007` 状态和修复摘要。

## Task 0：执行前基线检查

**Files:** 不改文件。

- [ ] **Step 1: 确认当前分支和 dirty 状态**

Run:

```powershell
rtk pwsh -NoProfile -Command "git branch --show-current; git status --short"
```

Expected:

- 当前分支是本轮适配分支。
- 如果存在与本计划无关的 dirty 文件，记录但不回滚。

- [ ] **Step 2: 确认当前 npm 包事实**

Run:

```powershell
rtk pwsh -NoProfile -Command "node -e \"const pkg=require('./node_modules/@cocos/asset-db/package.json'); console.log(pkg.name, pkg.version, pkg.main, pkg.license)\""
rtk pwsh -NoProfile -Command "npm view @cocos/asset-db version versions repository homepage --json"
```

Expected:

- 第一条输出包含 `@cocos/asset-db 3.0.0-alpha.10 index.js MIT`。
- 第二条输出 latest 为 `3.0.0-alpha.10`，没有 repository / homepage 时按事实记录，不补猜测。

- [ ] **Step 3: 确认 source map 状态**

Run:

```powershell
rtk pwsh -NoProfile -Command @'
Get-ChildItem -LiteralPath 'node_modules/@cocos/asset-db' -Recurse -Filter '*.js' | ForEach-Object {
  $content = Get-Content -LiteralPath $_.FullName -Raw -Encoding UTF8
  [pscustomobject]@{
    Path = $_.FullName.Replace((Resolve-Path 'node_modules/@cocos/asset-db').Path + '\', '')
    HasInlineSourceMap = $content.Contains('sourceMappingURL=data:application/json;base64,')
  }
}
'@
```

Expected:

- `index.js` 为 `HasInlineSourceMap = True`。
- `libs/*.js` 为 `HasInlineSourceMap = False`。

## Task 1：在 registry dependency 状态下补当前行为测试

**Files:**

- Create: `src/core/assets/test/asset-db-internal-record.test.ts`

- [ ] **Step 1: 写 `InfoManager` 当前行为测试**

Test target:

- 输入旧文件 `.internal-info1.0.0.json`。
- 调 `InfoManager.setRecordJSON('.internal-info.json')`。
- 验证旧文件被读取、迁移并删除。
- 调 `saveImmediate()`。
- 验证输出文件名为 `.internal-info.json`。
- 验证输出 shape 包含 `version` / `map` / `missing`。

Expected Jest assertion shape:

```typescript
expect(output).toHaveProperty('version', '1.0.1');
expect(output).toHaveProperty('map');
expect(output).toHaveProperty('missing');
expect(existsSync(oldInfoPath)).toBe(false);
```

- [ ] **Step 2: 写 `DependencyManager` 当前行为测试**

Test target:

- 输入旧结构 `.internal-dependency.json`：

```json
{
  "path": {
    "E:/project/assets/a.ts": ["E:/project/assets/b.ts"]
  },
  "uuid": {
    "E:/project/assets/a.ts": ["uuid-b"]
  }
}
```

- 使用 `pathRoot = "E:/project"`。
- 调 `DependencyManager.setRecordJSON(file)` 后 `saveImmediate()`。
- 验证输出 shape 为 `{ data: { path, uuid }, version }`。
- 验证迁移后保留相对路径映射，例如 `data.path["assets/a.ts"]` 包含 `assets/b.ts`。
- 验证旧顶层 `path` / `uuid` 不再存在。

Expected assertion:

```typescript
expect(output).toHaveProperty('version', '1.0.0');
expect(output).toHaveProperty('data.path');
expect(output).toHaveProperty('data.uuid');
expect(output.data.path['assets/a.ts']).toContain('assets/b.ts');
expect(output.data.uuid['assets/a.ts']).toContain('uuid-b');
expect(output).not.toHaveProperty('path');
expect(output).not.toHaveProperty('uuid');
```

- [ ] **Step 3: 写 `AssetDB.prepareStart()` record path 测试**

Test target:

- 构造 `new AssetDB({ name: 'internal', target, library, temp })`。
- mock 或 spy `infoManager.setRecordJSON`、`dataManager.setRecordJSON`、`dependencyManager.setRecordJSON`。
- 调 `prepareStart()`。
- 验证 record 文件路径分别是：
  - `<library>/.internal-info.json`
  - `<library>/.internal-data.json`
  - `<library>/.internal-dependency.json`

Expected assertion shape:

```typescript
expect(infoSpy).toHaveBeenCalledWith(join(library, '.internal-info.json'));
expect(dataSpy).toHaveBeenCalledWith(join(library, '.internal-data.json'));
expect(dependencySpy).toHaveBeenCalledWith(join(library, '.internal-dependency.json'));
```

- [ ] **Step 4: 写 CLI `internal.library` 配置测试**

Test target:

- `assetConfig.init()` 后，`internal` DB 的 `library` 仍是 `<project>/library`。
- 该测试锁住当前风险入口，后续修复时必须显式更新期望。

Run:

```powershell
rtk pwsh -NoProfile -Command "npx jest src/core/assets/test/asset-db-internal-record.test.ts src/core/assets/test/config-sync.test.ts --runInBand"
```

Expected:

- 当前行为测试通过。
- 测试名称必须写明 “current behavior”，避免误读为目标行为。
- 此时 `package.json` 仍依赖 registry `@cocos/asset-db: 3.0.0-alpha.10`。

- [ ] **Step 5: 提交 registry 行为测试**

Run:

```powershell
rtk pwsh -NoProfile -Command "git add src/core/assets/test/asset-db-internal-record.test.ts && git commit -m 'test: cover current asset-db internal record behavior'"
```

Expected: commit succeeds。

## Task 2：建立 local package mirror 并证明等价

**Files:**

- Create: `packages/asset-db/package.json`
- Create: `packages/asset-db/index.js`
- Create: `packages/asset-db/index.d.ts`
- Create: `packages/asset-db/libs/**`
- Modify: `package.json`
- Modify: `package-lock.json`

- [ ] **Step 1: 创建 local package 目录**

Run:

```powershell
rtk pwsh -NoProfile -Command "New-Item -ItemType Directory -Force -Path 'packages/asset-db' | Out-Null"
```

Expected: command exit code `0`。

- [ ] **Step 2: 复制官方包作为 mirror 初始内容**

Run:

```powershell
rtk pwsh -NoProfile -Command "Copy-Item -Path 'node_modules/@cocos/asset-db/*' -Destination 'packages/asset-db' -Recurse -Force"
```

Expected:

- `packages/asset-db/index.js` 存在。
- `packages/asset-db/libs/info.js` 存在。
- `packages/asset-db/libs/dependency.js` 存在。
- 不提交 `packages/asset-db/node_modules`；如果复制后存在，删除它并通过 root dependency 解析依赖。

- [ ] **Step 3: 调整 root dependency 和发布白名单**

Modify `package.json`:

```json
"@cocos/asset-db": "file:./packages/asset-db"
```

Modify root `files` array，加入：

```json
"packages/asset-db"
```

Run:

```powershell
rtk pwsh -NoProfile -Command "npm install"
```

Expected:

- `package-lock.json` 中 `node_modules/@cocos/asset-db` 指向 `packages/asset-db` 或 file dependency。
- `node -p "require('@cocos/asset-db/package.json').version"` 输出 `3.0.0-alpha.10`。

- [ ] **Step 4: 验证现有子路径 import 可解析**

Run:

```powershell
rtk pwsh -NoProfile -Command "node -e \"require('@cocos/asset-db'); require('@cocos/asset-db/libs/info'); require('@cocos/asset-db/libs/dependency'); require('@cocos/asset-db/libs/asset-db'); console.log('asset-db local package ok')\""
```

Expected: 输出 `asset-db local package ok`。

- [ ] **Step 5: 复跑 Task 1 行为测试证明 mirror 等价**

Run:

```powershell
rtk pwsh -NoProfile -Command "npx jest src/core/assets/test/asset-db-internal-record.test.ts src/core/assets/test/config-sync.test.ts src/core/assets/test/filesystem-provider.test.ts --runInBand"
```

Expected: Jest exit code `0`。这证明 local mirror 在当前覆盖面内与 registry 包行为一致。

- [ ] **Step 6: 验证 package 白名单**

Run:

```powershell
rtk pwsh -NoProfile -Command "npm pack --dry-run"
```

Expected:

- dry-run 输出包含 `packages/asset-db/package.json`。
- dry-run 输出包含 `packages/asset-db/index.js`。
- dry-run 输出包含 `packages/asset-db/libs/info.js`。

- [ ] **Step 7: 提交 mirror 替换**

Run:

```powershell
rtk pwsh -NoProfile -Command "git add package.json package-lock.json packages/asset-db && git commit -m 'chore: vendor asset-db local package mirror'"
```

Expected: commit succeeds。

## Task 3：建立可维护源码层

**Files:**

- Create: `packages/asset-db/src/libs/info.ts`
- Create: `packages/asset-db/src/libs/dependency.ts`
- Create: `packages/asset-db/src/libs/migrator.ts`
- Create: `packages/asset-db/src/libs/console.ts`
- Create: `packages/asset-db/src/libs/asset-db.ts` only if Task 5 事实证明必须修改 `AssetDB.prepareStart()`。
- Create: `packages/asset-db/tsconfig.json`
- Modify: `packages/asset-db/package.json`

- [ ] **Step 1: 选择首批源码化范围**

Initial scope:

- `src/libs/info.ts`
- `src/libs/dependency.ts`
- `src/libs/migrator.ts`
- `src/libs/console.ts`

Do not rewrite `asset-db.ts` in this task unless Task 4 证明 parity 必须修改 `prepareStart()` 或 record 初始化路径。`asset-db.js` 先继续使用 mirror JS，并通过 `require('./info')` / `require('./dependency')` 使用重新构建后的 record manager。

- [ ] **Step 2: 从格式化 JS 和 `.d.ts` 建立 readable TypeScript**

Rules:

- 以官方压缩 JS 的运行行为为准。
- 以 `.d.ts` 的 public/private API 形状辅助补类型。
- 不引入新的 runtime dependency。
- 生成的 `libs/*.js` 必须保持 CommonJS 可 require。
- `tsconfig.json` 使用 `module: commonjs`，`outDir: "."` 或显式 build script 把 `src/libs/*.ts` 输出为 `libs/*.js`。

- [ ] **Step 3: 增加构建脚本**

Modify `packages/asset-db/package.json` scripts:

```json
{
  "scripts": {
    "build": "tsc -p tsconfig.json"
  }
}
```

Run:

```powershell
rtk pwsh -NoProfile -Command "npm --prefix packages/asset-db run build"
```

Expected: exit code `0`，生成或更新 `packages/asset-db/libs/info.js`、`dependency.js`、`migrator.js`、`console.js`。

- [ ] **Step 4: 对比构建产物行为**

Run:

```powershell
rtk pwsh -NoProfile -Command "npx jest src/core/assets/test/asset-db-internal-record.test.ts --runInBand"
```

Expected: Task 1 的当前行为测试仍通过。

- [ ] **Step 5: 提交源码层**

Run:

```powershell
rtk pwsh -NoProfile -Command "git add packages/asset-db && git commit -m 'chore: add maintainable asset-db record managers'"
```

Expected: commit succeeds。

## Task 4：补 Editor baseline 事实

**Files:**

- Modify: `docs/dev/build/facts/meta-library-editor-parity-20260613.md`
- Temporary only: `.codex-tmp/asset-db-editor-baseline/*`，不得提交。

- [ ] **Step 1: 确认 Editor baseline 是否存在**

Run:

```powershell
rtk pwsh -NoProfile -Command @'
$baseline = 'E:\own_space\engines\cocos-cli\.codex-tmp\bak_test_projects_library_data_json'
if (!(Test-Path -LiteralPath $baseline)) {
  throw "Editor library baseline missing: $baseline. Stop and ask user to provide or regenerate Editor baseline."
}
Get-ChildItem -LiteralPath $baseline -File | Select-Object Name,Length
'@
```

Expected:

- 如果 baseline 不存在，立即停止，不能继续推断 Editor parity。
- 如果存在，明确文件集合。

- [ ] **Step 2: 计算 Editor baseline canonical hash**

Run:

```powershell
rtk pwsh -NoProfile -Command @'
function ConvertTo-StableJson($value) {
  if ($null -eq $value) { return 'null' }
  if ($value -is [System.Array]) {
    return '[' + (($value | ForEach-Object { ConvertTo-StableJson $_ }) -join ',') + ']'
  }
  if ($value -is [System.Management.Automation.PSCustomObject]) {
    $props = $value.PSObject.Properties | Sort-Object Name
    return '{' + (($props | ForEach-Object { (ConvertTo-Json $_.Name -Compress) + ':' + (ConvertTo-StableJson $_.Value) }) -join ',') + '}'
  }
  return ConvertTo-Json $value -Compress
}
$baseline = 'E:\own_space\engines\cocos-cli\.codex-tmp\bak_test_projects_library_data_json'
Get-ChildItem -LiteralPath $baseline -File -Filter '.internal-*.json' | ForEach-Object {
  $raw = Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256
  $json = Get-Content -LiteralPath $_.FullName -Raw -Encoding UTF8 | ConvertFrom-Json
  $canonical = ConvertTo-StableJson $json
  $bytes = [Text.Encoding]::UTF8.GetBytes($canonical)
  $sha = [System.Security.Cryptography.SHA256]::Create()
  $canonicalHash = [BitConverter]::ToString($sha.ComputeHash($bytes)).Replace('-', '').ToLowerInvariant()
  [pscustomobject]@{ Name = $_.Name; RawHash = $raw.Hash.ToLowerInvariant(); CanonicalHash = $canonicalHash }
}
'@
```

Expected:

- 记录每个 `.internal-*.json` 的 raw hash 和 canonical JSON hash。

- [ ] **Step 3: 记录 Editor record schema**

Update `docs/dev/build/facts/meta-library-editor-parity-20260613.md`:

- Editor baseline 文件名集合。
- `.internal-info*` 的 version / top-level keys。
- `.internal-dependency.json` 的 top-level keys。
- `.internal-data.json` 的关键 value shape。
- raw hash 和 canonical JSON hash。
- baseline 权威来源说明：当前阶段以用户提供的 Editor backup 为权威产物；若要进一步证明 Editor 内部 AssetDB 版本或 patch，应作为附加事实，不替代产物 baseline。

- [ ] **Step 4: 判定修复层级**

Decision rules:

- 如果 Editor 使用旧 schema，但 CLI 必须继续使用 `<project>/library`：优先在 local `asset-db` 中提供 compatibility mode。
- 如果 Editor 使用不同 `internal.library`：优先改 `src/core/assets/asset-config.ts`，但必须证明 Editor 也是这个策略。
- 如果 Editor 使用私有 patch：在 local `asset-db` 中实现等价 patch，并记录 patch 与官方包差异。

- [ ] **Step 5: 提交事实记录**

Run:

```powershell
rtk pwsh -NoProfile -Command "git add docs/dev/build/facts/meta-library-editor-parity-20260613.md && git commit -m 'docs: record editor asset-db internal baseline'"
```

Expected: commit succeeds。

## Task 5：实现 Editor parity 定制

**Files:** 由 Task 4 决策决定。

Expected write scopes:

- Prefer Modify: `packages/asset-db/src/libs/info.ts`
- Prefer Modify: `packages/asset-db/src/libs/dependency.ts`
- Possibly Create/Modify: `packages/asset-db/src/libs/asset-db.ts` only if `prepareStart()` behavior must change。
- Only if proven by Editor facts, Modify: `src/core/assets/asset-config.ts`
- Test: `src/core/assets/test/asset-db-internal-record.test.ts`

- [ ] **Step 1: 写目标行为测试**

Test must fail before implementation.

Expected assertions depend on Task 4 facts. Example for旧 `InfoManager` file-name parity:

```typescript
expect(filesAfterBuild).toContain('.internal-info1.0.0.json');
expect(filesAfterBuild).not.toContain('.internal-info.json');
```

Example for旧 `DependencyManager` schema parity:

```typescript
expect(output).toHaveProperty('path');
expect(output).toHaveProperty('uuid');
expect(output).not.toHaveProperty('data');
```

- [ ] **Step 2: Run failing test**

Run:

```powershell
rtk pwsh -NoProfile -Command "npx jest src/core/assets/test/asset-db-internal-record.test.ts --runInBand"
```

Expected: fail on the new Editor parity assertion only。

- [ ] **Step 3: Implement minimal parity change**

Implementation constraints:

- Do not disable all `library` writes.
- Do not write project-specific path exceptions for `E:\own_space\engines\cocos-test-projects`。
- Do not restore files after build as a workaround。
- Keep default behavior explainable by Editor facts。

- [ ] **Step 4: Run focused tests**

Run:

```powershell
rtk pwsh -NoProfile -Command "npm --prefix packages/asset-db run build"
rtk pwsh -NoProfile -Command "npx jest src/core/assets/test/asset-db-internal-record.test.ts src/core/assets/test/config-sync.test.ts --runInBand"
```

Expected: exit code `0`。

- [ ] **Step 5: 提交 parity 实现**

Run:

```powershell
rtk pwsh -NoProfile -Command "git add packages/asset-db src/core/assets/test src/core/assets/asset-config.ts && git commit -m 'fix: align asset-db internal records with editor'"
```

Expected: commit succeeds。若 `src/core/assets/asset-config.ts` 未改，`git add` 可跳过该文件。

## Task 6：主测试项目回归验证

**Files:**

- Modify: `docs/dev/build/facts/meta-library-editor-parity-20260613.md`
- Modify: `docs/dev/build/issues.md`

- [ ] **Step 1: 验证主测试项目 build 前 `.meta` baseline**

Run in `E:\own_space\engines\cocos-test-projects`:

```powershell
rtk pwsh -NoProfile -Command "git diff --name-only -- ':(glob)**/*.meta'"
rtk pwsh -NoProfile -Command "git ls-files --others --exclude-standard -- ':(glob)**/*.meta'"
```

Expected:

- 如果存在非预期 `.meta` diff，停止并复述差异。
- 不能在 dirty baseline 上宣称 CLI side effect 已修复。
- 已知独立问题 `BUILD-ISSUE-008` 只分类记录，不混入 `BUILD-ISSUE-007` 结论。

- [ ] **Step 2: 验证主测试项目 build 前 `library` baseline**

Run:

```powershell
rtk pwsh -NoProfile -Command @'
$projectLibrary = 'E:\own_space\engines\cocos-test-projects\library'
$baseline = 'E:\own_space\engines\cocos-cli\.codex-tmp\bak_test_projects_library_data_json'
if (!(Test-Path -LiteralPath $baseline)) {
  throw "Editor library baseline missing: $baseline"
}
$projectFiles = Get-ChildItem -LiteralPath $projectLibrary -File -Filter '.internal-*.json' | Sort-Object Name
$baselineFiles = Get-ChildItem -LiteralPath $baseline -File -Filter '.internal-*.json' | Sort-Object Name
Compare-Object ($baselineFiles.Name) ($projectFiles.Name)
'@
```

Expected:

- 文件集合无 diff。
- 如果文件集合不同，停止并要求用户确认当前 `library` baseline。

- [ ] **Step 3: 计算 build 前 raw hash / canonical hash**

Run:

```powershell
rtk pwsh -NoProfile -Command @'
function ConvertTo-StableJson($value) {
  if ($null -eq $value) { return 'null' }
  if ($value -is [System.Array]) {
    return '[' + (($value | ForEach-Object { ConvertTo-StableJson $_ }) -join ',') + ']'
  }
  if ($value -is [System.Management.Automation.PSCustomObject]) {
    $props = $value.PSObject.Properties | Sort-Object Name
    return '{' + (($props | ForEach-Object { (ConvertTo-Json $_.Name -Compress) + ':' + (ConvertTo-StableJson $_.Value) }) -join ',') + '}'
  }
  return ConvertTo-Json $value -Compress
}
function Get-JsonHash($path) {
  $raw = Get-FileHash -LiteralPath $path -Algorithm SHA256
  $json = Get-Content -LiteralPath $path -Raw -Encoding UTF8 | ConvertFrom-Json
  $canonical = ConvertTo-StableJson $json
  $bytes = [Text.Encoding]::UTF8.GetBytes($canonical)
  $sha = [System.Security.Cryptography.SHA256]::Create()
  [pscustomobject]@{ RawHash = $raw.Hash.ToLowerInvariant(); CanonicalHash = [BitConverter]::ToString($sha.ComputeHash($bytes)).Replace('-', '').ToLowerInvariant() }
}
$projectLibrary = 'E:\own_space\engines\cocos-test-projects\library'
$baseline = 'E:\own_space\engines\cocos-cli\.codex-tmp\bak_test_projects_library_data_json'
Get-ChildItem -LiteralPath $baseline -File -Filter '.internal-*.json' | Sort-Object Name | ForEach-Object {
  $projectFile = Join-Path $projectLibrary $_.Name
  $baseHash = Get-JsonHash $_.FullName
  $projectHash = Get-JsonHash $projectFile
  [pscustomobject]@{ Name = $_.Name; RawEqual = $baseHash.RawHash -eq $projectHash.RawHash; CanonicalEqual = $baseHash.CanonicalHash -eq $projectHash.CanonicalHash }
}
'@
```

Expected:

- 所有 `.internal-*.json` 的 `RawEqual = True` 且 `CanonicalEqual = True`。
- 如果 build 前不一致，停止，不得继续用该 baseline 判断 CLI side effect。

- [ ] **Step 4: 先构建 CLI**

Run from CLI repo:

```powershell
rtk pwsh -NoProfile -Command "npm run build"
```

Expected:

- Build exit code `0`。
- `dist/cli.js` 存在。

- [ ] **Step 5: 运行 web-mobile 构建**

Run from CLI repo:

```powershell
rtk pwsh -NoProfile -Command "node ./dist/cli.js build --project E:\own_space\engines\cocos-test-projects --platform web-mobile --build-config E:\own_space\engines\cocos-test-projects\profiles\v2\packages\web-mobile.json --buildPath E:\own_space\engines\cocos-test-projects\build --outputName cli-asset-db-parity"
```

Expected:

- Build exit code `0`。
- 输出目录不是 `build/web-mobile`。
- 输出目录是 `E:\own_space\engines\cocos-test-projects\build\cli-asset-db-parity`。

- [ ] **Step 6: 比较 `.meta` 与 `library` 顶层 JSON**

Run in test project:

```powershell
rtk pwsh -NoProfile -Command "git diff --name-status -- ':(glob)**/*.meta'"
rtk pwsh -NoProfile -Command @'
function ConvertTo-StableJson($value) {
  if ($null -eq $value) { return 'null' }
  if ($value -is [System.Array]) {
    return '[' + (($value | ForEach-Object { ConvertTo-StableJson $_ }) -join ',') + ']'
  }
  if ($value -is [System.Management.Automation.PSCustomObject]) {
    $props = $value.PSObject.Properties | Sort-Object Name
    return '{' + (($props | ForEach-Object { (ConvertTo-Json $_.Name -Compress) + ':' + (ConvertTo-StableJson $_.Value) }) -join ',') + '}'
  }
  return ConvertTo-Json $value -Compress
}
function Get-JsonInfo($path) {
  $raw = Get-FileHash -LiteralPath $path -Algorithm SHA256
  $json = Get-Content -LiteralPath $path -Raw -Encoding UTF8 | ConvertFrom-Json
  $canonical = ConvertTo-StableJson $json
  $bytes = [Text.Encoding]::UTF8.GetBytes($canonical)
  $sha = [System.Security.Cryptography.SHA256]::Create()
  [pscustomobject]@{
    RawHash = $raw.Hash.ToLowerInvariant()
    CanonicalHash = [BitConverter]::ToString($sha.ComputeHash($bytes)).Replace('-', '').ToLowerInvariant()
    Keys = (($json.PSObject.Properties | Sort-Object Name | ForEach-Object Name) -join ',')
  }
}
$projectLibrary = 'E:\own_space\engines\cocos-test-projects\library'
$baseline = 'E:\own_space\engines\cocos-cli\.codex-tmp\bak_test_projects_library_data_json'
$baselineFiles = Get-ChildItem -LiteralPath $baseline -File -Filter '.internal-*.json' | Sort-Object Name
$projectFiles = Get-ChildItem -LiteralPath $projectLibrary -File -Filter '.internal-*.json' | Sort-Object Name
$names = @($baselineFiles.Name + $projectFiles.Name | Sort-Object -Unique)
$names | ForEach-Object {
  $name = $_
  $baselineFile = Join-Path $baseline $name
  $projectFile = Join-Path $projectLibrary $name
  $baselineExists = Test-Path -LiteralPath $baselineFile
  $projectExists = Test-Path -LiteralPath $projectFile
  if (!$baselineExists -or !$projectExists) {
    [pscustomobject]@{
      Name = $name
      BaselineExists = $baselineExists
      ProjectExists = $projectExists
      RawEqual = $false
      CanonicalEqual = $false
      SchemaKeysEqual = $false
      BaselineKeys = ''
      ProjectKeys = ''
    }
    return
  }
  $baseInfo = Get-JsonInfo $baselineFile
  $projectInfo = Get-JsonInfo $projectFile
  [pscustomobject]@{
    Name = $name
    BaselineExists = $true
    ProjectExists = $true
    RawEqual = $baseInfo.RawHash -eq $projectInfo.RawHash
    CanonicalEqual = $baseInfo.CanonicalHash -eq $projectInfo.CanonicalHash
    SchemaKeysEqual = $baseInfo.Keys -eq $projectInfo.Keys
    BaselineKeys = $baseInfo.Keys
    ProjectKeys = $projectInfo.Keys
  }
}
'@
```

Expected:

- 非 3D `.meta` diff 若出现，按 `BUILD-ISSUE-008` 或新问题分类记录。
- 每个 `library` 顶层 internal JSON 的 `BaselineExists = True`、`ProjectExists = True`、`RawEqual = True`、`CanonicalEqual = True`、`SchemaKeysEqual = True`。
- 如果项目 build 后额外新增 `.internal-*.json`，必须显示为 `BaselineExists = False`，验收失败。

- [ ] **Step 7: 更新事实和 issue**

Update:

- `docs/dev/build/facts/meta-library-editor-parity-20260613.md`
- `docs/dev/build/issues.md`

Required content:

- 构建命令。
- CLI commit hash。
- 主测试项目 commit hash。
- build 前 baseline 判断。
- build 后 `.meta` diff 分类。
- build 后 `library` 顶层 JSON raw hash / canonical diff 结果。
- `BUILD-ISSUE-007` 状态。

- [ ] **Step 8: 提交验证记录**

Run:

```powershell
rtk pwsh -NoProfile -Command "git add docs/dev/build/facts/meta-library-editor-parity-20260613.md docs/dev/build/issues.md && git commit -m 'docs: record asset-db parity verification'"
```

Expected: commit succeeds。

## Task 7：官方升级流程固化

**Files:**

- Create: `packages/asset-db/scripts/extract-official-package.js`
- Create: `docs/dev/build/facts/asset-db-upgrade-path.md`
- Modify: `packages/asset-db/package.json`

- [ ] **Step 1: 写提取官方包脚本**

Script behavior:

- Input: official version，例如 `3.0.0-alpha.10`。
- Download: `npm pack @cocos/asset-db@<version>` 到 `.codex-tmp/asset-db-official/<version>`。
- Extract tarball。
- Copy `index.js`、`index.d.ts`、`libs/**/*.js`、`libs/**/*.d.ts` 到 `.codex-tmp/asset-db-official/<version>/package`。
- Print extracted path。

Run:

```powershell
rtk pwsh -NoProfile -Command "node packages/asset-db/scripts/extract-official-package.js 3.0.0-alpha.10"
```

Expected: 输出 extracted official package path。

- [ ] **Step 2: 记录升级流程**

Create `docs/dev/build/facts/asset-db-upgrade-path.md` with:

- 当前定制基线版本。
- 官方包提取命令。
- diff 命令。
- 合并原则。
- 必跑测试列表。

- [ ] **Step 3: 提交升级流程**

Run:

```powershell
rtk pwsh -NoProfile -Command "git add packages/asset-db/scripts/extract-official-package.js docs/dev/build/facts/asset-db-upgrade-path.md packages/asset-db/package.json && git commit -m 'docs: add asset-db upgrade workflow'"
```

Expected: commit succeeds。

## 全局验收门槛

完成全部任务前，必须满足：

- Task 1 在 registry `@cocos/asset-db@3.0.0-alpha.10` 状态下通过。
- 切到 local mirror 后，同一组行为测试继续通过。
- `require('@cocos/asset-db')` 和 `require('@cocos/asset-db/libs/info')` 均解析到 local package。
- 现有 91 个 `@cocos/asset-db` 调用点不需要批量改 import。
- `npm pack --dry-run` 包含 `packages/asset-db`。
- Task 5 的目标行为测试先失败、实现后通过。
- 主测试项目 build 前 `library` 顶层 JSON 与 Editor baseline 文件集合、raw hash、canonical hash 一致。
- 主测试项目 build 后，`library` 顶层 internal JSON 与 Editor baseline 一致。
- 文档记录包含命令、commit hash、diff 结论。

## 非目标

- 不在未确认 Editor 行为前改 `src/core/assets/asset-config.ts`。
- 不用 build 后回滚文件作为修复。
- 不把 `.codex-tmp` 内容提交进仓库。
- 不处理已明确移除的 `localization-editor` / `automation-framework` 项目资源。
- 不在本计划内解决 3D `.meta` 差异。
- 不在本计划内修复 `BUILD-ISSUE-008`，但验证时必须分类记录相关 `.meta` diff。

## Review Checklist

执行或 review 本计划时重点检查：

- 是否先在 registry dependency 状态下证明当前行为，再切 local mirror。
- 是否复用同一组测试证明 mirror 等价。
- 是否覆盖 `InfoManager`、`DependencyManager`、`AssetDB.prepareStart()`。
- 是否保留 `@cocos/asset-db/libs/*` 子路径兼容。
- 是否把 `packages/asset-db` 纳入 root package `files` 和 `npm pack --dry-run` 验证。
- 是否避免以 source map 不存在的 `libs/*.js` 推断不存在的 TypeScript 源码。
- 是否把 Editor baseline 作为目标事实，而不是把当前 npm 包行为当目标。
- 是否有 `library` baseline 文件集合、raw hash、canonical hash 的 build 前门槛。
- 是否每个阶段都有可运行命令和明确 expected output。
