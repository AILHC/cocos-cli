# BUILD-ISSUE-023 Shared Library Cache Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 CLI 与 Editor 串行复用 project `library` import output 缓存，同时避免 CLI 污染 Editor `assets` record 或因 importer 差异导致反复重导。

**Architecture:** 先把 `@cocos/asset-db` 的 record/cache path 与 import output root 解耦，再在 CLI 侧使用 `.cli-assets-*` sidecar record。只有完成 importer parity 和 sidecar bootstrap 后，才把 project `assets.library` 从 `library/cli` 切到共享 `library` output；`temp/asset-db` 保持隔离，除非后续真实项目证明转换缓存复用收益明显。

**Tech Stack:** TypeScript, Jest, local `@cocos/asset-db` generated JS package, Cocos Creator 3.8.6 Editor baseline, runtime-preview smoke fixture.

---

## 执行工作区

本计划必须在 rebase worktree 中执行：

```text
E:\own_space\engines\cocos-cli\.worktrees\rebase-adapter-to-386-origin-main-20260622
```

预期分支：

```text
codex/rebase-adapter-to-386-origin-main-20260622
```

不要在主工作区执行 production code 修改：

```text
E:\own_space\engines\cocos-cli
```

执行任何 task 前先确认：

```powershell
rtk git rev-parse --show-toplevel
rtk git rev-parse --abbrev-ref HEAD
rtk git status --short --branch
```

预期：

```text
E:/own_space/engines/cocos-cli/.worktrees/rebase-adapter-to-386-origin-main-20260622
codex/rebase-adapter-to-386-origin-main-20260622
```

如果工作区已有未提交改动，先判断是否属于本 issue；不得覆盖、回滚或格式化无关文件。

---

## 背景和当前决策

登记 issue：`docs/dev/build/issues.md#BUILD-ISSUE-023`

事实入口：

- `docs/dev/build/facts/asset-db-shared-cache-diff-analysis-20260622.md`
- `docs/dev/build/plans/asset-db-shared-cache-design-20260623.md`

当前主测试项目缓存规模：

```text
temp/asset-db                         约 91 MiB
temp/cli/asset-db                     约 89 MiB
library excluding cli/cli-extensions  约 620 MiB
library/cli                           约 585 MiB
```

结论：

- `temp/asset-db` 可以继续隔离；隔离不会让同一个工具下次打开缓存失效。
- 主要缓存收益来自 project `library` import output。
- 不能直接把 `assets.library` 指向 `<project>/library`，因为当前 `@cocos/asset-db` 把 record/cache path 与 output root 绑定。
- `assets` record 先使用 CLI sidecar，不直接复用 Editor `.assets-*` record。

---

## 文件结构

### Production files

- Modify: `packages/asset-db/libs/asset-db.d.ts`
  - 给 `AssetDBOptions` 增加 `records` 可选字段。
- Modify: `packages/asset-db/libs/asset-db.js`
  - 让 `AssetDB.prepareStart()` 使用 `options.records` 覆盖 record/cache path。
  - 让 `cachePath` 可从 `options.records.cache` 覆盖。
  - 注意：当前 repo 没有 `packages/asset-db/src/libs/asset-db.ts`，这是 generated JS patch，必须用 focused tests 固定行为。
- Modify: `src/core/assets/@types/private/plugin.d.ts`
  - 给 `AssetDBRegisterInfo` 增加 `records` 字段，透传到 local `@cocos/asset-db`。
- Modify: `src/core/assets/@types/public.d.ts`
  - 核对 public `AssetDBOptions` 是否表示同一个配置面；若是，同步增加 `records` 字段；若不是，在计划执行记录中写明该 public type 不参与 AssetDB startup。
- Modify: `src/core/assets/manager/asset-db.ts`
  - 在 `patchAssetDBInfo()` 中透传 `config.records`。
- Modify: `src/core/assets/asset-config.ts`
  - 阶段 1 保持 `assets.library = library/cli`。
  - 给 `assets` DB 明确配置 CLI record sidecar，初始仍指向 `library/cli/.assets-*`，不改变行为。
  - 阶段 3 才切 `assets.library = library`，同时把 records 指向 `library/.cli-assets-*`。

### Test files

- Modify: `src/core/assets/test/asset-db-internal-record.test.ts`
  - 增加 `assets` DB 自定义 record path 测试。
  - 更新 asset config path 测试，证明阶段 1 不改变现有 `library/cli` output。
- Create: `src/core/assets/test/asset-db-shared-library-records.test.ts`
  - 覆盖 `AssetDBRegisterInfo.records` 透传和 sidecar record 路径。
- Create: `docs/dev/build/facts/build-issue-023-importer-parity-blockers-20260623.md`
  - 固化 importer parity blocker，不把 shared output gate 误当成 parity 修复。
- Create: `src/core/assets/test/asset-db-shared-library-output.test.ts`
  - 覆盖 shared output root + sidecar record 的实验 gate。
- Create: `src/core/assets/test/asset-db-sidecar-bootstrap.test.ts`
  - 覆盖冷 sidecar 启动时只读 Editor record 转换 CLI sidecar，不写 Editor `.assets-*`。

### Documentation files

- Modify: `docs/dev/build/issues.md`
  - `BUILD-ISSUE-023` 状态和事实入口。
- Modify: `docs/dev/build/plans/asset-db-shared-cache-design-20260623.md`
  - 若实现中发现设计需要修订，回填阶段状态和风险。

---

## Task 1: AssetDB record path override

**Files:**

- Modify: `packages/asset-db/libs/asset-db.d.ts`
- Modify: `packages/asset-db/libs/asset-db.js`
- Modify: `src/core/assets/test/asset-db-internal-record.test.ts`

- [ ] **Step 1: Add failing Jest test for custom record paths**

Add this test to `src/core/assets/test/asset-db-internal-record.test.ts` after the existing `keeps non-internal record file paths during AssetDB.prepareStart` test:

```ts
    it('uses explicit record paths when AssetDBOptions.records is provided', async () => {
        const fixture = await makeTempProject();
        const recordRoot = join(fixture.projectRoot, 'library', 'records');
        const db = new AssetDB({
            name: 'assets',
            target: fixture.target,
            library: join(fixture.projectRoot, 'library'),
            temp: join(fixture.projectRoot, 'temp', 'asset-db', 'assets'),
            level: 4,
            ignoreFiles: [],
            readonly: false,
            records: {
                info: join(recordRoot, '.cli-assets-info.json'),
                data: join(recordRoot, '.cli-assets-data.json'),
                dependency: join(recordRoot, '.cli-assets-dependency.json'),
                cache: join(recordRoot, '.cli-assets'),
            },
        } as any);

        const infoSpy = jest.spyOn(db.infoManager, 'setRecordJSON').mockResolvedValue(undefined);
        const dataSpy = jest.spyOn(db.dataManager, 'setRecordJSON').mockResolvedValue(undefined);
        const dependencySpy = jest.spyOn(db.dependencyManager, 'setRecordJSON').mockResolvedValue(undefined);

        await (db as any).prepareStart();

        expect(infoSpy).toHaveBeenCalledWith(join(recordRoot, '.cli-assets-info.json'));
        expect(dataSpy).toHaveBeenCalledWith(join(recordRoot, '.cli-assets-data.json'));
        expect(dependencySpy).toHaveBeenCalledWith(join(recordRoot, '.cli-assets-dependency.json'));
        expect((db as any).cachePath).toBe(join(recordRoot, '.cli-assets'));
    });
```

- [ ] **Step 2: Run failing test**

Run:

```powershell
rtk npm run test -- src/core/assets/test/asset-db-internal-record.test.ts --runInBand
```

Expected before implementation:

```text
FAIL uses explicit record paths when AssetDBOptions.records is provided
Expected ... .cli-assets-info.json
Received ... .assets-info.json
```

- [ ] **Step 3: Update `AssetDBOptions` typing**

Modify `packages/asset-db/libs/asset-db.d.ts`:

```ts
export interface AssetDBRecordOptions {
    info?: string;
    data?: string;
    dependency?: string;
    cache?: string;
}

export interface AssetDBOptions {
    name: string;
    target: string;
    library: string;
    temp: string;
    records?: AssetDBRecordOptions;
    // existing fields unchanged
}
```

- [ ] **Step 4: Patch generated AssetDB JS record resolution**

Modify `packages/asset-db/libs/asset-db.js` so the constructor computes `cachePath` from `options.records.cache` when present:

```js
this.cachePath = t.records && t.records.cache
  ? (0,utils_1.absolutePath)(t.records.cache)
  : (0,path_1.join)(this.options.library, `.${t.name}`);
```

Modify `prepareStart()` so the three record paths are resolved as:

```js
const e = this.options.records || {};
const s = (0,path_1.join)(this.options.library, "internal" === this.options.name ? ".internal-info1.0.0.json" : `.${this.options.name}-info.json`);
const a = (0,path_1.join)(this.options.library, `.${this.options.name}-data.json`);
const i = (0,path_1.join)(this.options.library, `.${this.options.name}-dependency.json`);
await this.infoManager.setRecordJSON(e.info || s);
await this.dataManager.setRecordJSON(e.data || a);
await this.dependencyManager.setRecordJSON(e.dependency || i);
```

Keep the existing `internal` default behavior unchanged.

- [ ] **Step 5: Run focused test**

Run:

```powershell
rtk npm run test -- src/core/assets/test/asset-db-internal-record.test.ts --runInBand
```

Expected:

```text
PASS src/core/assets/test/asset-db-internal-record.test.ts
```

- [ ] **Step 6: Commit task 1**

```powershell
rtk git add packages/asset-db/libs/asset-db.d.ts packages/asset-db/libs/asset-db.js src/core/assets/test/asset-db-internal-record.test.ts
rtk git commit -m "fix(asset-db): allow sidecar record paths"
```

---

## Task 2: CLI AssetDB config passes sidecar records without behavior change

**Files:**

- Modify: `src/core/assets/@types/private/plugin.d.ts`
- Modify: `src/core/assets/@types/public.d.ts`
- Modify: `src/core/assets/manager/asset-db.ts`
- Modify: `src/core/assets/asset-config.ts`
- Create: `src/core/assets/test/asset-db-shared-library-records.test.ts`

- [ ] **Step 1: Write failing config test**

Create `src/core/assets/test/asset-db-shared-library-records.test.ts`:

```ts
import { join } from 'path';
import { TestGlobalEnv } from '../../../tests/global-env';

async function loadFreshRuntime() {
    jest.resetModules();
    const { configurationManager } = require('../../configuration') as typeof import('../../configuration');
    const project = (require('../../project') as typeof import('../../project')).default;
    const { Engine } = require('../../engine') as typeof import('../../engine');
    const assetConfig = (require('../asset-config') as typeof import('../asset-config')).default;

    return {
        configurationManager,
        project,
        Engine,
        assetConfig,
    };
}

describe('asset-db sidecar record path configuration', () => {
    beforeEach(() => {
        jest.resetModules();
    });

    it('keeps current assets output isolated and records under library/cli before shared output is enabled', async () => {
        const runtime = await loadFreshRuntime();
        await runtime.configurationManager.initialize(TestGlobalEnv.projectRoot);
        await runtime.project.open(TestGlobalEnv.projectRoot);
        await runtime.Engine.init(TestGlobalEnv.engineRoot);
        await runtime.assetConfig.init();

        const assetsDb = runtime.assetConfig.data.assetDBList.find((db) => db.name === 'assets');
        expect(assetsDb?.library).toBe(join(TestGlobalEnv.projectRoot, 'library', 'cli'));
        expect(assetsDb?.records).toEqual({
            info: join(TestGlobalEnv.projectRoot, 'library', 'cli', '.assets-info.json'),
            data: join(TestGlobalEnv.projectRoot, 'library', 'cli', '.assets-data.json'),
            dependency: join(TestGlobalEnv.projectRoot, 'library', 'cli', '.assets-dependency.json'),
            cache: join(TestGlobalEnv.projectRoot, 'library', 'cli', '.assets'),
        });
    });
});
```

- [ ] **Step 2: Run failing config test**

Run:

```powershell
rtk npm run test -- src/core/assets/test/asset-db-shared-library-records.test.ts --runInBand
```

Expected before implementation:

```text
FAIL
Expected records object
Received undefined
```

- [ ] **Step 3: Add `records` to `AssetDBRegisterInfo`**

Modify `src/core/assets/@types/private/plugin.d.ts`:

```ts
export interface AssetDBRecordPaths {
    info?: string;
    data?: string;
    dependency?: string;
    cache?: string;
}

export interface AssetDBRegisterInfo {
    name: string;
    target: string;
    readonly: boolean;
    visible: boolean;
    globList?: string[];
    preImportExtList?: string[];

    library?: string;
    temp?: string;
    records?: AssetDBRecordPaths;
}
```

If `src/core/assets/@types/public.d.ts#AssetDBOptions` is used by code that constructs AssetDB startup options, add the same `records?: AssetDBRecordPaths` field there. If it is only a public query/result shape, leave it unchanged and record that decision in the task notes.

- [ ] **Step 4: Pass records through `patchAssetDBInfo()`**

Modify `src/core/assets/manager/asset-db.ts`:

```ts
function patchAssetDBInfo(config: AssetDBRegisterInfo): IAssetDBInfo {
    return {
        name: config.name,
        target: Utils.Path.normalize(config.target),
        readonly: !!config.readonly,

        temp: config.temp || Utils.Path.normalize(join(AssetDBManager.tempRoot, config.name)),
        library: config.library || AssetDBManager.libraryRoot,
        records: config.records,

        level: 4,
        globList: assetConfig.data.globList,
        ignoreFiles: [],
        visible: config.visible,
        state: 'none',
        preImportExtList: config.preImportExtList || [],
    };
}
```

If `IAssetDBInfo` rejects `records`, add a matching optional field in its local declaration in `src/core/assets/manager/asset-db.ts`.

- [ ] **Step 5: Add current-behavior records in `asset-config.ts`**

Modify the `assets` entry in `src/core/assets/asset-config.ts`:

```ts
const cliAssetsLibrary = join(this._assetConfig.root, 'library/cli');
```

Then set:

```ts
{
    name: 'assets',
    target: join(this._assetConfig.root, 'assets'),
    readonly: false,
    visible: true,
    library: cliAssetsLibrary,
    records: {
        info: join(cliAssetsLibrary, '.assets-info.json'),
        data: join(cliAssetsLibrary, '.assets-data.json'),
        dependency: join(cliAssetsLibrary, '.assets-dependency.json'),
        cache: join(cliAssetsLibrary, '.assets'),
    },
}
```

- [ ] **Step 6: Run config test**

Run:

```powershell
rtk npm run test -- src/core/assets/test/asset-db-shared-library-records.test.ts --runInBand
```

Expected:

```text
PASS src/core/assets/test/asset-db-shared-library-records.test.ts
```

- [ ] **Step 7: Run existing AssetDB tests**

Run:

```powershell
rtk npm run test -- src/core/assets/test/asset-db-internal-record.test.ts src/core/assets/test/config-sync.test.ts --runInBand
```

Expected:

```text
PASS
```

- [ ] **Step 8: Commit task 2**

```powershell
rtk git add src/core/assets/@types/private/plugin.d.ts src/core/assets/@types/public.d.ts src/core/assets/manager/asset-db.ts src/core/assets/asset-config.ts src/core/assets/test/asset-db-shared-library-records.test.ts
rtk git commit -m "chore(asset-db): wire sidecar records through cli config"
```

---

## Task 3: Importer parity blocker classification

**Files:**

- Create: `docs/dev/build/facts/build-issue-023-importer-parity-blockers-20260623.md`
- Modify: `docs/dev/build/issues.md`

- [ ] **Step 1: Create importer parity blocker fact doc**

Create `docs/dev/build/facts/build-issue-023-importer-parity-blockers-20260623.md`:

```md
# BUILD-ISSUE-023 Importer Parity Blockers

## Source

- Diff source: `docs/dev/build/facts/asset-db-shared-cache-diff-analysis-20260622.md`
- Project: `E:\own_space\engines\cocos-test-projects`
- Engine: `D:\workspace\engines\cocos\3.8.6`

## Blocking `.assets-data.json` differences

| importer | diff 总数 | versionCode diff | value diff | Editor versionCode | CLI versionCode | shared output default status |
| --- | ---: | ---: | ---: | --- | --- | --- |
| `gltf` | 292 | 292 | 0 | `1` | `3` | blocked until Editor effective versionCode is verified and CLI parity is implemented |
| `scene` | 273 | 273 | 273 | `1` | `2` | blocked until versionCode and `depends` value parity are implemented |
| `prefab` | 67 | 67 | 0 | `1` | `2` | blocked with scene importer parity |
| `fbx` | 50 | 50 | 0 | `1` | `3` | blocked until 3D importer parity is implemented |
| `animation-clip` | 19 | 19 | 0 | `1` | `2` | blocked until animation importer parity is implemented |
| `audio-clip` | 11 | 0 | 11 | `1` | `1` | blocked until value diff is classified |
| `spine-data` | 2 | 0 | 2 | `1` | `1` | blocked until value diff is classified |
| `video-clip` | 1 | 0 | 1 | `1` | `1` | blocked until value diff is classified |

## Decision

Shared project `library` output must remain behind `COCOS_CLI_SHARED_LIBRARY_OUTPUT=1` until this blocker list is either fixed or each remaining diff is explicitly accepted with a source-backed reason.
```

- [ ] **Step 2: Update BUILD-ISSUE-023 with blocker doc**

Update `docs/dev/build/issues.md` facts column for `BUILD-ISSUE-023` to include:

```md
[facts/build-issue-023-importer-parity-blockers-20260623.md](facts/build-issue-023-importer-parity-blockers-20260623.md)
```

- [ ] **Step 3: Commit task 3**

```powershell
rtk git add docs/dev/build/facts/build-issue-023-importer-parity-blockers-20260623.md docs/dev/build/issues.md
rtk git commit -m "docs(asset-db): record shared library importer parity blockers"
```

---

## Task 4: Experimental shared-output gate

**Files:**

- Create: `src/core/assets/test/asset-db-shared-library-output.test.ts`

- [ ] **Step 1: Add a test that fails until shared-output gate is explicitly enabled**

Create `src/core/assets/test/asset-db-shared-library-output.test.ts`:

```ts
import { join } from 'path';
import { TestGlobalEnv } from '../../../tests/global-env';

async function loadFreshRuntime() {
    jest.resetModules();
    const { configurationManager } = require('../../configuration') as typeof import('../../configuration');
    const project = (require('../../project') as typeof import('../../project')).default;
    const { Engine } = require('../../engine') as typeof import('../../engine');
    const assetConfig = (require('../asset-config') as typeof import('../asset-config')).default;

    return {
        configurationManager,
        project,
        Engine,
        assetConfig,
    };
}

describe('asset-db shared library output gate', () => {
    beforeEach(() => {
        jest.resetModules();
        delete process.env.COCOS_CLI_SHARED_LIBRARY_OUTPUT;
    });

    it('does not share project library output by default', async () => {
        const runtime = await loadFreshRuntime();
        await runtime.configurationManager.initialize(TestGlobalEnv.projectRoot);
        await runtime.project.open(TestGlobalEnv.projectRoot);
        await runtime.Engine.init(TestGlobalEnv.engineRoot);
        await runtime.assetConfig.init();

        const assetsDb = runtime.assetConfig.data.assetDBList.find((db) => db.name === 'assets');
        expect(assetsDb?.library).toBe(join(TestGlobalEnv.projectRoot, 'library', 'cli'));
    });

    it('shares project library output only when the explicit gate is enabled', async () => {
        process.env.COCOS_CLI_SHARED_LIBRARY_OUTPUT = '1';
        const runtime = await loadFreshRuntime();
        await runtime.configurationManager.initialize(TestGlobalEnv.projectRoot);
        await runtime.project.open(TestGlobalEnv.projectRoot);
        await runtime.Engine.init(TestGlobalEnv.engineRoot);
        await runtime.assetConfig.init();

        const assetsDb = runtime.assetConfig.data.assetDBList.find((db) => db.name === 'assets');
        expect(assetsDb?.library).toBe(join(TestGlobalEnv.projectRoot, 'library'));
        expect(assetsDb?.records).toEqual({
            info: join(TestGlobalEnv.projectRoot, 'library', '.cli-assets-info.json'),
            data: join(TestGlobalEnv.projectRoot, 'library', '.cli-assets-data.json'),
            dependency: join(TestGlobalEnv.projectRoot, 'library', '.cli-assets-dependency.json'),
            cache: join(TestGlobalEnv.projectRoot, 'library', '.cli-assets'),
        });
    });
});
```

- [ ] **Step 2: Run the gate test**

Run:

```powershell
rtk npm run test -- src/core/assets/test/asset-db-shared-library-output.test.ts --runInBand
```

Expected before implementation:

```text
FAIL shares project library output only when the explicit gate is enabled
Expected library
Received library/cli
```

- [ ] **Step 3: Add explicit shared-output gate**

Modify `src/core/assets/asset-config.ts`:

```ts
const sharedLibraryOutput = process.env.COCOS_CLI_SHARED_LIBRARY_OUTPUT === '1';
const projectLibrary = join(this._assetConfig.root, 'library');
const cliAssetsLibrary = join(projectLibrary, 'cli');
const assetsLibrary = sharedLibraryOutput ? projectLibrary : cliAssetsLibrary;
const assetsRecordRoot = sharedLibraryOutput ? projectLibrary : cliAssetsLibrary;
```

Then use:

```ts
library: assetsLibrary,
records: {
    info: join(assetsRecordRoot, sharedLibraryOutput ? '.cli-assets-info.json' : '.assets-info.json'),
    data: join(assetsRecordRoot, sharedLibraryOutput ? '.cli-assets-data.json' : '.assets-data.json'),
    dependency: join(assetsRecordRoot, sharedLibraryOutput ? '.cli-assets-dependency.json' : '.assets-dependency.json'),
    cache: join(assetsRecordRoot, sharedLibraryOutput ? '.cli-assets' : '.assets'),
},
```

This gate must remain test-only / experimental until sidecar bootstrap, importer parity blockers, normal build validation, and `Editor -> CLI -> Editor` snapshots all pass.

- [ ] **Step 4: Run focused tests**

Run:

```powershell
rtk npm run test -- src/core/assets/test/asset-db-shared-library-records.test.ts src/core/assets/test/asset-db-shared-library-output.test.ts --runInBand
```

Expected:

```text
PASS
```

- [ ] **Step 5: Do not commit shared output as production default yet**

Commit the explicit gate only:

```powershell
rtk git add src/core/assets/asset-config.ts src/core/assets/test/asset-db-shared-library-output.test.ts
rtk git commit -m "test(asset-db): gate shared library output"
```

---

## Task 5: Sidecar bootstrap for cold CLI records

**Files:**

- Create: `src/core/assets/asset-db-sidecar-bootstrap.ts`
- Modify: `src/core/assets/asset-config.ts`
- Modify: `src/core/assets/manager/asset-db.ts`
- Create: `src/core/assets/test/asset-db-sidecar-bootstrap.test.ts`

- [ ] **Step 1: Write failing sidecar bootstrap test**

Create `src/core/assets/test/asset-db-sidecar-bootstrap.test.ts`:

```ts
import { join } from 'path';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { ensureDir, pathExists, readJSON, writeJSON } from 'fs-extra';

describe('asset-db sidecar bootstrap', () => {
    async function makeEditorLibraryFixture() {
        const root = await mkdtemp(join(tmpdir(), 'asset-db-sidecar-bootstrap-'));
        const target = join(root, 'assets');
        const library = join(root, 'library');
        await ensureDir(target);
        await ensureDir(library);

        await writeJSON(join(library, '.assets-info1.0.0.json'), {
            version: '1.0.0',
            map: {
                [join(target, 'a.scene')]: {
                    time: 1,
                    uuid: 'uuid-a',
                },
            },
            missing: {},
        }, { spaces: 2 });

        await writeJSON(join(library, '.assets-data.json'), {
            'uuid-a': {
                importer: 'scene',
                versionCode: 1,
                value: { depends: [] },
            },
        }, { spaces: 2 });

        await writeJSON(join(library, '.assets-dependency.json'), {
            path: {
                [join(target, 'a.scene')]: [
                    join(target, 'dep.ts'),
                ],
            },
            uuid: {
                [join(target, 'a.scene')]: [
                    'uuid-dep',
                ],
            },
        }, { spaces: 2 });

        return {
            root,
            target,
            library,
            records: {
                info: join(library, '.cli-assets-info.json'),
                data: join(library, '.cli-assets-data.json'),
                dependency: join(library, '.cli-assets-dependency.json'),
                cache: join(library, '.cli-assets'),
            },
        };
    }

    it('creates CLI sidecar records from Editor records without mutating Editor records', async () => {
        const fixture = await makeEditorLibraryFixture();
        try {
            const { bootstrapAssetsSidecarRecords } = require('../asset-db-sidecar-bootstrap') as typeof import('../asset-db-sidecar-bootstrap');

            await bootstrapAssetsSidecarRecords({
                target: fixture.target,
                library: fixture.library,
                records: fixture.records,
            });

            expect(await pathExists(fixture.records.info)).toBe(true);
            expect(await pathExists(fixture.records.data)).toBe(true);
            expect(await pathExists(fixture.records.dependency)).toBe(true);
            expect(await pathExists(fixture.records.cache)).toBe(true);

            const cliDependency = await readJSON(fixture.records.dependency);
            expect(cliDependency).toEqual({
                data: {
                    path: {
                        'a.scene': [
                            'dep.ts',
                        ],
                    },
                    uuid: {
                        'a.scene': [
                            'uuid-dep',
                        ],
                    },
                },
                version: '1.0.0',
            });
            const cliInfo = await readJSON(fixture.records.info);
            expect(cliInfo.map['a.scene'].uuid).toBe('uuid-a');

            const editorInfo = await readJSON(join(fixture.library, '.assets-info1.0.0.json'));
            expect(editorInfo.version).toBe('1.0.0');
            expect(editorInfo.map[join(fixture.target, 'a.scene')].uuid).toBe('uuid-a');
        } finally {
            await rm(fixture.root, { recursive: true, force: true });
        }
    });
});
```

- [ ] **Step 2: Run failing bootstrap test**

Run:

```powershell
rtk npm run test -- src/core/assets/test/asset-db-sidecar-bootstrap.test.ts --runInBand
```

Expected before implementation:

```text
FAIL Cannot find module '../asset-db-sidecar-bootstrap'
```

- [ ] **Step 3: Implement bootstrap helper**

Create `src/core/assets/asset-db-sidecar-bootstrap.ts`:

```ts
import path, { dirname, relative } from 'path';
import { ensureDir, pathExists, readJSON, writeJSON } from 'fs-extra';

export interface AssetsSidecarRecordPaths {
    info: string;
    data: string;
    dependency: string;
    cache: string;
}

export interface BootstrapAssetsSidecarRecordsOptions {
    target: string;
    library: string;
    records: AssetsSidecarRecordPaths;
}

export async function bootstrapAssetsSidecarRecords(options: BootstrapAssetsSidecarRecordsOptions): Promise<void> {
    const editorInfoPath = path.join(options.library, '.assets-info1.0.0.json');
    const editorDataPath = path.join(options.library, '.assets-data.json');
    const editorDependencyPath = path.join(options.library, '.assets-dependency.json');

    if (await pathExists(options.records.info)
        && await pathExists(options.records.data)
        && await pathExists(options.records.dependency)
        && await pathExists(options.records.cache)) {
        return;
    }

    if (!(await pathExists(editorInfoPath)) || !(await pathExists(editorDataPath)) || !(await pathExists(editorDependencyPath))) {
        return;
    }

    const editorInfo = await readJSON(editorInfoPath);
    const editorData = await readJSON(editorDataPath);
    const editorDependency = await readJSON(editorDependencyPath);

    const cliInfoMap: Record<string, unknown> = {};
    Object.keys(editorInfo.map ?? {}).forEach((sourcePath) => {
        cliInfoMap[relative(options.target, sourcePath)] = editorInfo.map[sourcePath];
    });

    await ensureDir(dirname(options.records.info));
    await writeJSON(options.records.info, {
        version: '1.0.1',
        map: cliInfoMap,
        missing: editorInfo.missing ?? {},
    }, { spaces: 4 });
    await writeJSON(options.records.data, editorData, { spaces: 4 });
    const cliDependencyPathMap: Record<string, string[]> = {};
    Object.keys(editorDependency.path ?? {}).forEach((sourcePath) => {
        cliDependencyPathMap[relative(options.target, sourcePath)] = (editorDependency.path[sourcePath] ?? []).map((dependency: string) => {
            return relative(options.target, dependency);
        });
    });
    const cliDependencyUuidMap: Record<string, string[]> = {};
    Object.keys(editorDependency.uuid ?? {}).forEach((sourcePath) => {
        cliDependencyUuidMap[relative(options.target, sourcePath)] = editorDependency.uuid[sourcePath] ?? [];
    });

    await writeJSON(options.records.dependency, {
        data: {
            path: cliDependencyPathMap,
            uuid: cliDependencyUuidMap,
        },
        version: '1.0.0',
    }, { spaces: 4 });
    await writeJSON(options.records.cache, {
        version: '1.0.1',
        data: {
            paths: Object.keys(cliInfoMap),
        },
    }, { spaces: 4 });
}
```

This helper is deliberately conservative: it only reads Editor records and only writes CLI sidecar files. It does not write `.assets-info1.0.0.json`, `.assets-data.json`, or `.assets-dependency.json`. It must convert Editor dependency record shape `{ path, uuid }` to CLI non-internal shape `{ data: { path, uuid }, version: "1.0.0" }`, and both dependency `path` keys and dependency path values must be relative to `options.target`; direct copy is invalid for CLI sidecar dependency records.

- [ ] **Step 4: Wire bootstrap before AssetDB startup**

In `src/core/assets/manager/asset-db.ts`, before constructing or starting the `assets` database, call bootstrap only when:

```ts
info.name === 'assets' && info.records && info.library === assetConfig.data.libraryRoot
```

Use:

```ts
await bootstrapAssetsSidecarRecords({
    target: info.target,
    library: info.library,
    records: info.records,
});
```

If the exact startup hook is not near `patchAssetDBInfo()`, locate the `new AssetDB(...)` call and place the bootstrap immediately before it.

- [ ] **Step 5: Run bootstrap and config tests**

Run:

```powershell
rtk npm run test -- src/core/assets/test/asset-db-sidecar-bootstrap.test.ts src/core/assets/test/asset-db-shared-library-records.test.ts src/core/assets/test/asset-db-shared-library-output.test.ts --runInBand
```

Expected:

```text
PASS
```

- [ ] **Step 6: Commit task 5**

```powershell
rtk git add src/core/assets/asset-db-sidecar-bootstrap.ts src/core/assets/manager/asset-db.ts src/core/assets/test/asset-db-sidecar-bootstrap.test.ts
rtk git commit -m "feat(asset-db): bootstrap cli sidecar records"
```

---

## Task 6: Snapshot validation for repeated reimport risk

**Files:**

- Create: `docs/dev/build/facts/build-issue-023-editor-cli-editor-validation-20260623.md`
- Optional create: `scripts/dev/compare-asset-cache-snapshots.mjs` only if no existing snapshot script can be reused.

- [ ] **Step 1: Run baseline three-step validation without shared output**

Run manually with `COCOS_CLI_SHARED_LIBRARY_OUTPUT` unset. The env setup, compile, Editor open, CLI preview, and second Editor open must stay in the same `pwsh` command block:

```powershell
rtk pwsh -NoLogo -NoProfile -Command '& {
  Remove-Item Env:\COCOS_CLI_SHARED_LIBRARY_OUTPUT -ErrorAction SilentlyContinue
  rtk npm run compile
  cce run --project E:\own_space\engines\cocos-test-projects
  rtk node .\dist\cli.js preview --project E:\own_space\engines\cocos-test-projects --runtime --engine D:\workspace\engines\cocos\3.8.6
  cce run --project E:\own_space\engines\cocos-test-projects
}'
```

Expected:

```text
preview:ready
no unexpected source .meta changes
baseline snapshot recorded
```

- [ ] **Step 2: Run gated shared-output validation**

Run with explicit gate. The env setup and CLI invocation must stay in the same `pwsh` command block:

```powershell
rtk pwsh -NoLogo -NoProfile -Command '& {
  $env:COCOS_CLI_SHARED_LIBRARY_OUTPUT = "1"
  rtk npm run compile
  cce run --project E:\own_space\engines\cocos-test-projects
  rtk node .\dist\cli.js preview --project E:\own_space\engines\cocos-test-projects --runtime --engine D:\workspace\engines\cocos\3.8.6
  cce run --project E:\own_space\engines\cocos-test-projects
}'
```

Expected:

```text
preview:ready
library/.assets-info1.0.0.json not deleted
library/.assets-dependency.json not converted to { data, version }
library/.cli-assets-* created or updated
library/<uuid-prefix>/... no unexplained back-and-forth rewrite
```

- [ ] **Step 3: Run normal build validation with explicit gate**

Run:

```powershell
rtk pwsh -NoLogo -NoProfile -Command '& {
  $env:COCOS_CLI_SHARED_LIBRARY_OUTPUT = "1"
  rtk npm run compile
  rtk node .\dist\cli.js build --project E:\own_space\engines\cocos-test-projects --platform web-mobile --build-config E:\own_space\engines\cocos-test-projects\buildConfig_web-mobile.json --outputName codex-build-issue-023-shared-cache-validation
}'
```

Expected:

```text
Build completed successfully
library/.assets-info1.0.0.json hash unchanged
library/.assets-dependency.json hash unchanged
library/.assets-data.json hash unchanged unless the diff is explicitly classified and accepted
no unexpected source assets/**/*.meta diff
```

- [ ] **Step 4: Record validation facts**

Create `docs/dev/build/facts/build-issue-023-editor-cli-editor-validation-20260623.md` with the observed output from the validation run:

```md
# BUILD-ISSUE-023 Editor -> CLI -> Editor Validation

## Environment

- project: `E:\own_space\engines\cocos-test-projects`
- engine: `D:\workspace\engines\cocos\3.8.6`
- repo: `E:\own_space\engines\cocos-cli\.worktrees\rebase-adapter-to-386-origin-main-20260622`
- branch: command output of `rtk git rev-parse --abbrev-ref HEAD`
- commit: command output of `rtk git rev-parse HEAD`
- shared output gate: `COCOS_CLI_SHARED_LIBRARY_OUTPUT=1`

## Directory sizes

Paste exact output of:

```powershell
rtk pwsh -NoLogo -NoProfile -Command '& {
  $root="E:\own_space\engines\cocos-test-projects"
  $paths=@("temp\asset-db","temp\cli\asset-db","library","library\cli")
  foreach($rel in $paths){
    $p=Join-Path $root $rel
    $files=Get-ChildItem -LiteralPath $p -Recurse -File -Force -ErrorAction SilentlyContinue
    $bytes=($files | Measure-Object -Property Length -Sum).Sum
    if($null -eq $bytes){$bytes=0}
    "{0}`tfiles={1}`tMiB={2:N2}" -f $rel,@($files).Count,($bytes/1MB)
  }
}'
```

## Snapshot results

Paste exact output of the snapshot diff command or script. The output must include:

- `A -> B library records`
- `A -> B library output`
- `B -> C library records`
- `B -> C library output`
- hash status for `library/.assets-info1.0.0.json`
- hash status for `library/.assets-dependency.json`
- hash status for `library/.assets-data.json`
- rewrite list for `library/<uuid-prefix>/...`
- source `.meta` diff summary

## Decision

- shared output ready for default: `yes` only when Editor record files are unchanged and output rewrite list is empty or fully explained; otherwise `no`.
- blockers: list every unexplained record mutation, repeated import output rewrite, source `.meta` diff, missing file, or runtime preview failure from this run.
- next action: either `make shared output default` or `keep explicit gate and fix listed blockers`.
```

- [ ] **Step 5: Commit validation docs**

```powershell
rtk git add docs/dev/build/facts/build-issue-023-editor-cli-editor-validation-20260623.md
rtk git commit -m "docs(asset-db): record shared library cache validation"
```

---

## Task 7: Decide production default

**Files:**

- Modify: `src/core/assets/asset-config.ts`
- Modify: `docs/dev/build/issues.md`
- Modify: `docs/dev/build/plans/asset-db-shared-cache-design-20260623.md`

- [ ] **Step 1: If validation passes, make shared output default**

Only if sidecar bootstrap is implemented, importer parity blockers are fixed or explicitly accepted, and Task 6 proves no record pollution or repeated output rewrite, modify `src/core/assets/asset-config.ts`:

```ts
const sharedLibraryOutput = process.env.COCOS_CLI_SHARED_LIBRARY_OUTPUT !== '0';
```

Keep emergency opt-out:

```text
COCOS_CLI_SHARED_LIBRARY_OUTPUT=0
```

- [ ] **Step 2: If validation fails, keep isolated output**

If Task 6 shows importer parity, bootstrap, build, or runtime-preview blockers, keep:

```ts
const sharedLibraryOutput = process.env.COCOS_CLI_SHARED_LIBRARY_OUTPUT === '1';
```

Then document exact blockers in `BUILD-ISSUE-023`.

- [ ] **Step 3: Update issue and design docs**

Update `docs/dev/build/issues.md`:

```md
BUILD-ISSUE-023 status:
- fixed: only if shared output becomes default and validation passes
- open: if gated shared output remains experimental
```

Update `docs/dev/build/plans/asset-db-shared-cache-design-20260623.md` with the final default and opt-out.

- [ ] **Step 4: Run final focused tests**

Run:

```powershell
rtk npm run compile
rtk npm run test -- src/core/assets/test/asset-db-internal-record.test.ts src/core/assets/test/asset-db-shared-library-records.test.ts src/core/assets/test/asset-db-shared-library-output.test.ts src/core/assets/test/asset-db-sidecar-bootstrap.test.ts src/core/assets/test/config-sync.test.ts --runInBand
```

Expected:

```text
compile passes
all focused Jest tests pass
```

- [ ] **Step 5: Commit final decision**

```powershell
rtk git add src/core/assets/asset-config.ts docs/dev/build/issues.md docs/dev/build/plans/asset-db-shared-cache-design-20260623.md
rtk git commit -m "feat(asset-db): share project library output safely"
```

---

## Explicit Non-Goals

- Do not make `temp/asset-db` shared by default in this issue.
- Do not make `temp/programming` shared by default in this issue.
- Do not write CLI records into Editor `.assets-*` files.
- Do not delete Editor-only files from shared `library` or `temp/asset-db`.
- Do not use `git checkout --` or reset generated cache files as a validation strategy.

---

## Review Checklist

- `AssetDB.prepareStart()` keeps existing defaults when `records` is absent.
- `internal` DB still uses `.internal-info1.0.0.json`, `.internal-data.json`, `.internal-dependency.json`.
- `assets` DB can write sidecar record files without changing output root.
- Shared output is gated until `Editor -> CLI -> Editor` validation passes.
- The final default is decided by validation facts, not by official path preference.
