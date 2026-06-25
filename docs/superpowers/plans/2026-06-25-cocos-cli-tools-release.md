# cocos-cli Tools Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 `cocos-cli` 发布到 `<p6Root>/tools/cocos-cli`，发布包不包含 `node_modules` 和 `packages/engine`，团队首次使用只需在发布目录执行 `npm install`。

**Architecture:** 变更分三块：`src/core/launcher-engine-root.ts` 负责 engine source 解析；`workflow/release-tools.js` 负责生成 runtime 发布目录；目标仓库 `<p6Root>/tools` 只提交可版本管理的 release 文件。保留现有 `cliInitializedEngineRoot` 显式初始化链路，删除 production 的 `<cliRoot>/packages/engine` fallback。

**Tech Stack:** TypeScript、Jest、Node.js CommonJS workflow、npm lockfile、PowerShell on Windows。

---

## 文件结构

- Modify: `src/core/launcher-engine-root.ts`
  - 集中维护 `SUPPORTED_ENGINE_VERSIONS`、source label、project config、CLI 初始化链路、Creator profile fallback。
  - 删除 `GlobalPaths.enginePath` fallback。

- Modify: `src/core/launcher.ts`
  - 删除对 `global-fallback` 的 warning 分支。
  - 保持 active output 继续输出 `engineRoot` 与 `engineRootSource`。

- Create: `src/core/test/launcher-engine-root.spec.ts`
  - 覆盖 project config、`cliInitializedEngineRoot`、Creator profile、无 engine 失败分支。

- Create: `workflow/release-tools.js`
  - 生成 runtime `package.json`、`.gitignore`、`README.md`。
  - 复制 `dist/`、`static/`、`packages/cc-module/`、`packages/asset-db/`。
  - 在发布目录生成 runtime `package-lock.json`。
  - 静态校验不包含 `node_modules`、`packages/engine`、本机绝对路径。

- Create: `src/core/test/release-tools.spec.ts`
  - 覆盖 runtime manifest、lockfile 校验、README 生成、关键 `static/tools` 目录校验。

- Modify: `package.json`
  - 新增 `"release:tools": "node workflow/release-tools.js"`。
  - 不修改源码仓库 root `postinstall`。

- Generated in target repo: `<p6Root>/tools/cocos-cli/README.md`
  - 中文团队使用文档，由 release script 生成。

- Generated in target repo: `<p6Root>/tools/cocos-cli/.gitignore`
  - 至少包含 `node_modules/`，防止安装 smoke 后误暂存依赖目录。

---

## Task 1: Engine Resolver Focused Tests

**Files:**
- Create: `src/core/test/launcher-engine-root.spec.ts`
- Later modify: `src/core/launcher-engine-root.ts`

- [ ] **Step 1: 创建 resolver 测试文件**

Create `src/core/test/launcher-engine-root.spec.ts`:

```ts
import { mkdtemp, mkdir, rm, writeFile } from 'fs/promises';
import { dirname, join, resolve } from 'path';
import { tmpdir } from 'os';
import { resolveLauncherEngineRoot } from '../launcher-engine-root';

async function writeJson(filePath: string, value: unknown) {
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, JSON.stringify(value, null, 2), 'utf8');
}

describe('resolveLauncherEngineRoot', () => {
    const originalEnv = { ...process.env };
    let roots: string[] = [];

    async function tempRoot(prefix: string) {
        const root = await mkdtemp(join(tmpdir(), prefix));
        roots.push(root);
        return root;
    }

    beforeEach(() => {
        process.env = { ...originalEnv };
        delete process.env.COCOS_CLI_TEST_ENGINE_ROOT;
        delete process.env.COCOS_CLI_TEST_PROJECT_ROOT;
        delete process.env.COCOS_CLI_CREATOR_PROFILE_ROOT;
        roots = [];
    });

    afterEach(async () => {
        process.env = originalEnv;
        await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
    });

    it('uses project package cocos-cli.enginePath before creator profile', async () => {
        const projectRoot = await tempRoot('cocos-cli-project-');
        const projectEngine = await tempRoot('cocos-cli-project-engine-');
        const profileRoot = await tempRoot('cocos-cli-profile-root-');
        const profileEngine = await tempRoot('cocos-cli-profile-engine-');
        await writeJson(join(projectRoot, 'package.json'), {
            name: 'project-config-case',
            'cocos-cli': { enginePath: projectEngine },
        });
        process.env.COCOS_CLI_CREATOR_PROFILE_ROOT = profileRoot;
        await writeJson(join(profileRoot, '.CocosCreator', 'profiles', 'v2', 'packages', 'engine.json'), {
            engine: { '386': { javascript: { builtin: false, custom: profileEngine } } },
        });

        await expect(resolveLauncherEngineRoot(projectRoot)).resolves.toEqual({
            engineRoot: resolve(projectEngine),
            source: 'project-config',
        });
    });

    it('resolves relative project enginePath from project root', async () => {
        const projectRoot = await tempRoot('cocos-cli-relative-project-');
        const engineRoot = join(projectRoot, 'local-engine');
        await mkdir(engineRoot, { recursive: true });
        await writeJson(join(projectRoot, 'package.json'), {
            name: 'relative-project-config-case',
            'cocos-cli': { enginePath: './local-engine' },
        });

        await expect(resolveLauncherEngineRoot(projectRoot)).resolves.toEqual({
            engineRoot: resolve(engineRoot),
            source: 'project-config',
        });
    });

    it('rejects missing project enginePath instead of falling back', async () => {
        const projectRoot = await tempRoot('cocos-cli-missing-project-engine-');
        await writeJson(join(projectRoot, 'package.json'), {
            name: 'missing-project-config-case',
            'cocos-cli': { enginePath: './missing-engine' },
        });

        await expect(resolveLauncherEngineRoot(projectRoot)).rejects.toThrow(/Configured enginePath does not exist/);
    });

    it('keeps explicit cliInitializedEngineRoot source', async () => {
        const projectRoot = await tempRoot('cocos-cli-cli-initialized-project-');
        const initializedEngine = await tempRoot('cocos-cli-initialized-engine-');
        await writeJson(join(projectRoot, 'package.json'), { name: 'cli-initialized-case' });

        await expect(resolveLauncherEngineRoot(projectRoot, {
            cliInitializedEngineRoot: initializedEngine,
        })).resolves.toEqual({
            engineRoot: resolve(initializedEngine),
            source: 'cli-initialized',
        });
    });

    it('uses creator profile custom engine when project has no enginePath', async () => {
        const projectRoot = await tempRoot('cocos-cli-profile-project-');
        const profileRoot = await tempRoot('cocos-cli-profile-home-');
        const engineRoot = await tempRoot('cocos-cli-profile-engine-');
        await writeJson(join(projectRoot, 'package.json'), { name: 'profile-case' });
        process.env.COCOS_CLI_CREATOR_PROFILE_ROOT = profileRoot;
        await writeJson(join(profileRoot, '.CocosCreator', 'profiles', 'v2', 'packages', 'engine.json'), {
            engine: { '386': { javascript: { builtin: false, custom: engineRoot } } },
        });

        await expect(resolveLauncherEngineRoot(projectRoot)).resolves.toEqual({
            engineRoot: resolve(engineRoot),
            source: 'creator-profile',
        });
    });

    it('rejects missing creator profile file', async () => {
        const projectRoot = await tempRoot('cocos-cli-profile-missing-project-');
        const profileRoot = await tempRoot('cocos-cli-profile-missing-home-');
        await writeJson(join(projectRoot, 'package.json'), { name: 'missing-profile-case' });
        process.env.COCOS_CLI_CREATOR_PROFILE_ROOT = profileRoot;

        await expect(resolveLauncherEngineRoot(projectRoot)).rejects.toThrow(/engine profile does not exist/);
    });

    it('rejects creator profile without supported key 386', async () => {
        const projectRoot = await tempRoot('cocos-cli-profile-no-key-project-');
        const profileRoot = await tempRoot('cocos-cli-profile-no-key-home-');
        await writeJson(join(projectRoot, 'package.json'), { name: 'missing-key-profile-case' });
        process.env.COCOS_CLI_CREATOR_PROFILE_ROOT = profileRoot;
        await writeJson(join(profileRoot, '.CocosCreator', 'profiles', 'v2', 'packages', 'engine.json'), {
            engine: {},
        });

        await expect(resolveLauncherEngineRoot(projectRoot)).rejects.toThrow(/supported version 3\.8\.6/);
    });

    it('rejects creator profile builtin engine even if custom path is present', async () => {
        const projectRoot = await tempRoot('cocos-cli-profile-builtin-project-');
        const profileRoot = await tempRoot('cocos-cli-profile-builtin-home-');
        const engineRoot = await tempRoot('cocos-cli-profile-builtin-engine-');
        await writeJson(join(projectRoot, 'package.json'), { name: 'builtin-profile-case' });
        process.env.COCOS_CLI_CREATOR_PROFILE_ROOT = profileRoot;
        await writeJson(join(profileRoot, '.CocosCreator', 'profiles', 'v2', 'packages', 'engine.json'), {
            engine: { '386': { javascript: { builtin: true, custom: engineRoot } } },
        });

        await expect(resolveLauncherEngineRoot(projectRoot)).rejects.toThrow(/builtin engine/);
    });

    it('keeps test env override scoped to matching project root', async () => {
        const projectRoot = await tempRoot('cocos-cli-test-env-project-');
        const otherProjectRoot = await tempRoot('cocos-cli-test-env-other-project-');
        const testEngineRoot = await tempRoot('cocos-cli-test-env-engine-');
        const profileRoot = await tempRoot('cocos-cli-test-env-profile-home-');
        const profileEngineRoot = await tempRoot('cocos-cli-test-env-profile-engine-');
        await writeJson(join(projectRoot, 'package.json'), { name: 'test-env-case' });
        await writeJson(join(otherProjectRoot, 'package.json'), { name: 'other-test-env-case' });
        process.env.COCOS_CLI_TEST_PROJECT_ROOT = projectRoot;
        process.env.COCOS_CLI_TEST_ENGINE_ROOT = testEngineRoot;
        process.env.COCOS_CLI_CREATOR_PROFILE_ROOT = profileRoot;
        await writeJson(join(profileRoot, '.CocosCreator', 'profiles', 'v2', 'packages', 'engine.json'), {
            engine: { '386': { javascript: { builtin: false, custom: profileEngineRoot } } },
        });

        await expect(resolveLauncherEngineRoot(projectRoot)).resolves.toEqual({
            engineRoot: resolve(testEngineRoot),
            source: 'test-env',
        });
        await expect(resolveLauncherEngineRoot(otherProjectRoot)).resolves.toEqual({
            engineRoot: resolve(profileEngineRoot),
            source: 'creator-profile',
        });
    });
});
```

- [ ] **Step 2: 运行测试确认当前失败**

Run:

```powershell
rtk pwsh -NoProfile -Command "npx jest src/core/test/launcher-engine-root.spec.ts --runInBand"
```

Expected: FAIL，失败原因应指向 Creator profile fallback、缺失 project path validation 或 `global-fallback` 旧行为。

---

## Task 2: Engine Resolver Implementation

**Files:**
- Modify: `src/core/launcher-engine-root.ts`
- Modify: `src/core/launcher.ts`
- Test: `src/core/test/launcher-engine-root.spec.ts`

- [ ] **Step 1: 更新 resolver source 类型与解析顺序**

Modify `src/core/launcher-engine-root.ts` so the source union and exported function match this shape:

```ts
export type LauncherEngineRootSource = 'test-env' | 'project-config' | 'cli-initialized' | 'creator-profile';

const SUPPORTED_ENGINE_VERSIONS = ['3.8.6'] as const;

export async function resolveLauncherEngineRoot(
    projectPath: string,
    options: { cliInitializedEngineRoot?: string } = {},
): Promise<LauncherEngineRootResolution> {
    const testEngineRoot = process.env.COCOS_CLI_TEST_ENGINE_ROOT;
    const testProjectRoot = process.env.COCOS_CLI_TEST_PROJECT_ROOT;
    if (testEngineRoot && testProjectRoot && resolve(projectPath) === resolve(testProjectRoot)) {
        return { engineRoot: resolve(testEngineRoot), source: 'test-env' };
    }

    const projectConfigEngineRoot = await readProjectConfigEngineRoot(projectPath);
    if (projectConfigEngineRoot) {
        return { engineRoot: projectConfigEngineRoot, source: 'project-config' };
    }

    if (options.cliInitializedEngineRoot) {
        return { engineRoot: resolve(options.cliInitializedEngineRoot), source: 'cli-initialized' };
    }

    const creatorProfileEngineRoot = await readCreatorProfileEngineRoot();
    if (creatorProfileEngineRoot) {
        return { engineRoot: creatorProfileEngineRoot, source: 'creator-profile' };
    }

    throw new Error([
        'Unable to resolve Cocos engine source.',
        'Configure project package.json cocos-cli.enginePath, or configure a custom Cocos Creator engine for supported version 3.8.6.',
    ].join(' '));
}
```

Add helpers in the same file:

```ts
interface ProjectPackageJson {
    'cocos-cli'?: { enginePath?: unknown };
}

interface CreatorEngineProfile {
    engine?: Record<string, {
        javascript?: {
            builtin?: unknown;
            custom?: unknown;
        };
    }>;
}

async function readProjectConfigEngineRoot(projectPath: string): Promise<string | null> {
    const packageJsonPath = resolve(projectPath, 'package.json');
    let packageJson: ProjectPackageJson;
    try {
        packageJson = await readJSON(packageJsonPath) as ProjectPackageJson;
    } catch (error) {
        if (isNodeError(error) && error.code === 'ENOENT') {
            return null;
        }
        throw error;
    }

    const configuredEnginePath = packageJson['cocos-cli']?.enginePath;
    if (typeof configuredEnginePath !== 'string' || configuredEnginePath.trim() === '') {
        return null;
    }

    const engineRoot = isAbsolute(configuredEnginePath.trim())
        ? resolve(configuredEnginePath.trim())
        : resolve(projectPath, configuredEnginePath.trim());
    if (!existsSync(engineRoot)) {
        throw new Error(`Configured enginePath does not exist: ${configuredEnginePath.trim()}`);
    }
    return engineRoot;
}

function getCreatorProfilePath(): string {
    const profileRoot = process.env.COCOS_CLI_CREATOR_PROFILE_ROOT || homedir();
    return join(profileRoot, '.CocosCreator', 'profiles', 'v2', 'packages', 'engine.json');
}

function versionToProfileKey(version: string): string {
    return version.replace(/\./g, '');
}

async function readCreatorProfileEngineRoot(): Promise<string | null> {
    const profilePath = getCreatorProfilePath();
    let profile: CreatorEngineProfile;
    try {
        profile = await readJSON(profilePath) as CreatorEngineProfile;
    } catch (error) {
        if (isNodeError(error) && error.code === 'ENOENT') {
            throw new Error(`Cocos Creator engine profile does not exist: ${profilePath}`);
        }
        throw error;
    }

    const version = SUPPORTED_ENGINE_VERSIONS[0];
    const info = profile.engine?.[versionToProfileKey(version)];
    if (!info?.javascript) {
        throw new Error(`Cocos Creator profile does not contain custom engine config for supported version ${version}.`);
    }
    if (info.javascript.builtin === true) {
        throw new Error(`Cocos Creator profile uses builtin engine for supported version ${version}; custom engine source is required.`);
    }
    if (typeof info.javascript.custom !== 'string' || info.javascript.custom.trim() === '') {
        throw new Error(`Cocos Creator profile custom engine path is empty for supported version ${version}.`);
    }

    const engineRoot = resolve(info.javascript.custom.trim());
    if (!existsSync(engineRoot)) {
        throw new Error(`Cocos Creator profile custom engine path does not exist: ${info.javascript.custom.trim()}`);
    }
    return engineRoot;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
    return error instanceof Error && 'code' in error;
}
```

The file must import `existsSync` from `fs`, `homedir` from `os`, `isAbsolute` / `join` / `resolve` from `path`, and `readJSON` from `fs-extra`. It must no longer import `GlobalPaths` for fallback.

- [ ] **Step 2: 删除 launcher 中的 `global-fallback` warning 分支**

Modify `src/core/launcher.ts` around the resolver call:

```ts
this._engineRootResolution = await resolveLauncherEngineRoot(this.projectPath);
```

Remove the branch:

```ts
if (this._engineRootResolution.source === 'global-fallback') {
    console.warn(`[runtime-preview] engineRoot:global-fallback ${this._engineRootResolution.engineRoot}`);
}
```

No replacement warning is needed. `engineRootSource` is still passed later from `engineRootResolution.source`.

- [ ] **Step 3: 运行 focused resolver 测试**

Run:

```powershell
rtk pwsh -NoProfile -Command "npx jest src/core/test/launcher-engine-root.spec.ts --runInBand"
```

Expected: PASS.

- [ ] **Step 4: 运行现有 runtime-preview resolver 测试**

Run:

```powershell
rtk pwsh -NoProfile -Command "npx vitest run vitests/suites/runtime-preview/launcher-engine-root.test.ts"
```

Expected: PASS. This protects the existing `cliInitializedEngineRoot` behavior.

- [ ] **Step 5: 运行 TypeScript 编译检查**

Run:

```powershell
rtk pwsh -NoProfile -Command "npx tsc -p tsconfig.json --noEmit"
```

Expected: PASS. If it fails only because this repo already has unrelated baseline errors, capture the exact output and do not claim TypeScript verification passed.

- [ ] **Step 6: 提交 green resolver 变更**

Run:

```powershell
rtk pwsh -NoProfile -Command "git add src/core/launcher-engine-root.ts src/core/launcher.ts src/core/test/launcher-engine-root.spec.ts; git commit -m 'fix: resolve engine root from project or creator profile'"
```

---

## Task 3: Release Helper Tests

**Files:**
- Create: `src/core/test/release-tools.spec.ts`
- Later create: `workflow/release-tools.js`

- [ ] **Step 1: 创建 release helper 测试文件**

Create `src/core/test/release-tools.spec.ts`:

```ts
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

const releaseTools = require('../../../workflow/release-tools.js');

const keyToolDirs = [
    join('static', 'tools', 'creator-3.8.6', 'PVRTexTool_win32'),
    join('static', 'tools', 'PVRTexTool_win32'),
    join('static', 'tools', 'libwebp_win32'),
    join('static', 'tools', 'mali_win32'),
    join('static', 'tools', 'astc-encoder'),
    join('static', 'tools', 'cmft'),
    join('static', 'tools', 'LightFX'),
    join('static', 'tools', 'lightmap-tools'),
    join('static', 'tools', 'cmake'),
    join('static', 'tools', 'keystore'),
];

describe('workflow/release-tools', () => {
    let roots: string[] = [];

    async function tempRoot(prefix: string) {
        const root = await mkdtemp(join(tmpdir(), prefix));
        roots.push(root);
        return root;
    }

    afterEach(async () => {
        await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
        roots = [];
    });

    it('creates runtime package without root postinstall or devDependencies', () => {
        const runtimePackage = releaseTools.createRuntimePackageJson({
            name: 'cocos-cli',
            version: '1.2.3',
            main: 'dist/index.js',
            bin: { cocos: './dist/cli.js' },
            scripts: {
                build: 'npm run build:clear',
                postinstall: 'node workflow/postinstall.js',
                cli: 'node ./dist/cli.js',
            },
            overrides: { fsevents: '2.3.3' },
            devDependencies: { jest: '^29.7.0' },
            dependencies: {
                cc: 'file:./packages/cc-module',
                '@cocos/asset-db': 'file:./packages/asset-db',
                commander: '^11.0.0',
            },
        });

        expect(runtimePackage).toEqual({
            name: 'cocos-cli',
            version: '1.2.3',
            main: 'dist/index.js',
            bin: { cocos: './dist/cli.js' },
            scripts: { cli: 'node ./dist/cli.js' },
            overrides: { fsevents: '2.3.3' },
            dependencies: {
                cc: 'file:./packages/cc-module',
                '@cocos/asset-db': 'file:./packages/asset-db',
                commander: '^11.0.0',
            },
        });
    });

    it('detects invalid runtime lockfile root install script metadata', () => {
        expect(() => releaseTools.assertRuntimeLockfile({
            packages: { '': { hasInstallScript: true } },
        })).toThrow(/root package-lock entry must not have hasInstallScript/);

        expect(() => releaseTools.assertRuntimeLockfile({
            packages: {
                '': {},
                'node_modules/sharp': { hasInstallScript: true },
            },
        })).not.toThrow();
    });

    it('rejects README content with local absolute paths', () => {
        expect(() => releaseTools.assertNoLocalAbsolutePaths('Use <p6Root>\\tools\\cocos-cli')).not.toThrow();
        const drivePath = `Use ${'D:'}/workspace/tools/cocos-cli`;
        const uncPath = `${'\\\\'}server\\share\\tools\\cocos-cli`;
        expect(() => releaseTools.assertNoLocalAbsolutePaths(drivePath)).toThrow(/local absolute path/);
        expect(() => releaseTools.assertNoLocalAbsolutePaths(uncPath)).toThrow(/local absolute path/);
    });

    it('renders README with verification metadata and common errors', () => {
        const readme = releaseTools.renderReadme({
            nodeVersion: 'v22.17.0',
            npmVersion: '10.9.2',
        });
        expect(readme).toContain('Node.js v22.17.0');
        expect(readme).toContain('npm 10.9.2');
        expect(readme).toContain('profile 缺失');
        expect(readme).toContain('engine path 不存在');
        expect(readme).toContain('端口占用');
        expect(() => releaseTools.assertNoLocalAbsolutePaths(readme)).not.toThrow();
    });

    it('validates release directory excludes engine and node_modules but includes all key tools', async () => {
        const targetRoot = await tempRoot('cocos-cli-release-validation-');
        await mkdir(join(targetRoot, 'packages', 'asset-db'), { recursive: true });
        await mkdir(join(targetRoot, 'packages', 'cc-module'), { recursive: true });
        for (const relativePath of keyToolDirs) {
            await mkdir(join(targetRoot, relativePath), { recursive: true });
        }
        await writeFile(join(targetRoot, '.gitignore'), 'node_modules/\n', 'utf8');
        await writeFile(join(targetRoot, 'package.json'), JSON.stringify({
            scripts: { cli: 'node ./dist/cli.js' },
        }), 'utf8');
        await writeFile(join(targetRoot, 'package-lock.json'), JSON.stringify({
            packages: { '': {} },
        }), 'utf8');

        expect(() => releaseTools.assertReleaseDirectory(targetRoot)).not.toThrow();

        await mkdir(join(targetRoot, 'packages', 'engine'), { recursive: true });
        expect(() => releaseTools.assertReleaseDirectory(targetRoot)).toThrow(/packages\/engine must not exist/);
    });
});
```

- [ ] **Step 2: 运行测试确认当前失败**

Run:

```powershell
rtk pwsh -NoProfile -Command "npx jest src/core/test/release-tools.spec.ts --runInBand"
```

Expected: FAIL because `workflow/release-tools.js` does not exist.

---

## Task 4: Release Workflow Implementation

**Files:**
- Create: `workflow/release-tools.js`
- Modify: `package.json`
- Test: `src/core/test/release-tools.spec.ts`

- [ ] **Step 1: 创建 `workflow/release-tools.js`**

Create `workflow/release-tools.js` with these exported helpers and CLI entry:

```js
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { spawnSync } = require('child_process');

const rootDir = path.resolve(__dirname, '..');
const runtimeScriptAllowlist = new Set(['cli']);
const releaseDirs = [
    'dist',
    'static',
    path.join('packages', 'cc-module'),
    path.join('packages', 'asset-db'),
];
const keyToolDirs = [
    path.join('static', 'tools', 'creator-3.8.6', 'PVRTexTool_win32'),
    path.join('static', 'tools', 'PVRTexTool_win32'),
    path.join('static', 'tools', 'libwebp_win32'),
    path.join('static', 'tools', 'mali_win32'),
    path.join('static', 'tools', 'astc-encoder'),
    path.join('static', 'tools', 'cmft'),
    path.join('static', 'tools', 'LightFX'),
    path.join('static', 'tools', 'lightmap-tools'),
    path.join('static', 'tools', 'cmake'),
    path.join('static', 'tools', 'keystore'),
];

function createRuntimePackageJson(sourcePackage) {
    const runtimePackage = {
        name: sourcePackage.name,
        version: sourcePackage.version,
        main: sourcePackage.main,
        bin: sourcePackage.bin,
        scripts: {},
        overrides: sourcePackage.overrides,
        dependencies: sourcePackage.dependencies,
    };
    for (const scriptName of runtimeScriptAllowlist) {
        if (sourcePackage.scripts && sourcePackage.scripts[scriptName]) {
            runtimePackage.scripts[scriptName] = sourcePackage.scripts[scriptName];
        }
    }
    return JSON.parse(JSON.stringify(runtimePackage));
}

function assertNoLocalAbsolutePaths(content) {
    if (/(?:[A-Za-z]:[\\/]|\\\\[^\\]+\\[^\\]+)/.test(content)) {
        throw new Error('README contains local absolute path');
    }
}

function assertRuntimeLockfile(lockfile) {
    const rootPackage = lockfile && lockfile.packages && lockfile.packages[''];
    if (rootPackage && rootPackage.hasInstallScript === true) {
        throw new Error('Runtime package-lock root package-lock entry must not have hasInstallScript: true');
    }
}

function assertReleaseDirectory(targetRoot) {
    for (const relativePath of ['node_modules', path.join('packages', 'engine')]) {
        if (fs.existsSync(path.join(targetRoot, relativePath))) {
            throw new Error(`${relativePath.replace(/\\/g, '/')} must not exist in tools release`);
        }
    }
    for (const relativePath of [
        '.gitignore',
        'package.json',
        'package-lock.json',
        path.join('packages', 'asset-db'),
        path.join('packages', 'cc-module'),
        ...keyToolDirs,
    ]) {
        if (!fs.existsSync(path.join(targetRoot, relativePath))) {
            throw new Error(`${relativePath.replace(/\\/g, '/')} is missing in tools release`);
        }
    }

    const packageJson = JSON.parse(fs.readFileSync(path.join(targetRoot, 'package.json'), 'utf8'));
    if (packageJson.scripts && packageJson.scripts.postinstall) {
        throw new Error('Runtime package.json must not include scripts.postinstall');
    }
    if (packageJson.devDependencies) {
        throw new Error('Runtime package.json must not include devDependencies');
    }
    const lockfile = JSON.parse(fs.readFileSync(path.join(targetRoot, 'package-lock.json'), 'utf8'));
    assertRuntimeLockfile(lockfile);
}

async function copyDirectory(src, dest) {
    await fsp.rm(dest, { recursive: true, force: true });
    await fsp.mkdir(path.dirname(dest), { recursive: true });
    await fsp.cp(src, dest, {
        recursive: true,
        force: true,
        dereference: true,
        filter: (source) => {
            const normalized = source.replace(/\\/g, '/');
            return !normalized.includes('/node_modules/') &&
                !normalized.endsWith('/node_modules') &&
                !normalized.includes('/packages/engine/') &&
                !normalized.endsWith('/packages/engine');
        },
    });
}

function renderReadme(metadata) {
    const nodeVersion = metadata.nodeVersion;
    const npmVersion = metadata.npmVersion;
    const content = `# cocos-cli 团队工具

## 环境要求

- Node.js ${nodeVersion} 或更高版本
- npm ${npmVersion}
- Windows PowerShell

## 首次安装

\`\`\`powershell
cd <p6Root>\\tools\\cocos-cli
npm install
node .\\dist\\cli.js --help
\`\`\`

## Engine 配置

CLI 不内置 engine source。解析优先级：

1. <projectRoot>\\package.json 的 cocos-cli.enginePath
2. CLI 初始化链路传入的 cliInitializedEngineRoot
3. 本机 Cocos Creator profile 中 supported version 的 custom engine

当前 supported engine version 是 3.8.6。

## Runtime Preview

\`\`\`powershell
node .\\dist\\cli.js preview --runtime --project <projectRoot> --host 127.0.0.1 --port <port>
\`\`\`

## 常见错误

- profile 缺失：本机没有 Cocos Creator engine profile。
- builtin engine：Creator profile 使用内置 engine，无法提供 source path。
- engine path 不存在：项目配置或 profile 记录的路径不存在。
- 依赖未安装：在发布目录执行 npm install。
- 端口占用：更换 preview --port。

## 包内容

- 包含 dist、static、packages/cc-module、packages/asset-db
- 包含 static/tools
- 不包含 node_modules
- 不包含 packages/engine
`;
    assertNoLocalAbsolutePaths(content);
    return content;
}

function runChecked(command, args, options) {
    const result = spawnSync(command, args, {
        stdio: 'inherit',
        shell: process.platform === 'win32',
        ...options,
    });
    if (result.status !== 0) {
        throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status}`);
    }
}

function readCommandOutput(command, args) {
    const result = spawnSync(command, args, {
        encoding: 'utf8',
        shell: process.platform === 'win32',
    });
    if (result.status !== 0) {
        throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status}`);
    }
    return result.stdout.trim();
}

async function createRuntimeLockfile(targetRoot) {
    runChecked('npm', ['install', '--package-lock-only', '--ignore-scripts'], { cwd: targetRoot });
    const lockfile = JSON.parse(await fsp.readFile(path.join(targetRoot, 'package-lock.json'), 'utf8'));
    assertRuntimeLockfile(lockfile);
}

async function releaseTools(targetRoot) {
    if (!targetRoot) {
        throw new Error('Missing required --target <path>');
    }
    const resolvedTarget = path.resolve(targetRoot);
    await fsp.rm(resolvedTarget, { recursive: true, force: true });
    await fsp.mkdir(resolvedTarget, { recursive: true });

    for (const relativePath of releaseDirs) {
        await copyDirectory(path.join(rootDir, relativePath), path.join(resolvedTarget, relativePath));
    }

    const sourcePackage = JSON.parse(await fsp.readFile(path.join(rootDir, 'package.json'), 'utf8'));
    await fsp.writeFile(
        path.join(resolvedTarget, 'package.json'),
        `${JSON.stringify(createRuntimePackageJson(sourcePackage), null, 4)}\n`,
        'utf8',
    );
    await fsp.writeFile(path.join(resolvedTarget, '.gitignore'), 'node_modules/\n', 'utf8');
    await fsp.writeFile(path.join(resolvedTarget, 'README.md'), renderReadme({
        nodeVersion: readCommandOutput('node', ['-v']),
        npmVersion: readCommandOutput('npm', ['-v']),
    }), 'utf8');
    await createRuntimeLockfile(resolvedTarget);
    assertReleaseDirectory(resolvedTarget);
}

function parseArgs(argv) {
    const targetIndex = argv.indexOf('--target');
    return { target: targetIndex >= 0 ? argv[targetIndex + 1] : '' };
}

if (require.main === module) {
    const { target } = parseArgs(process.argv.slice(2));
    releaseTools(target).catch((error) => {
        console.error(error);
        process.exit(1);
    });
}

module.exports = {
    createRuntimePackageJson,
    assertNoLocalAbsolutePaths,
    assertRuntimeLockfile,
    assertReleaseDirectory,
    renderReadme,
    releaseTools,
};
```

- [ ] **Step 2: 添加 npm script**

Modify root `package.json` scripts:

```json
"release:tools": "node workflow/release-tools.js"
```

Do not remove or alter root `"postinstall": "node workflow/postinstall.js"`.

- [ ] **Step 3: 运行 release helper tests**

Run:

```powershell
rtk pwsh -NoProfile -Command "npx jest src/core/test/release-tools.spec.ts --runInBand"
```

Expected: PASS.

- [ ] **Step 4: 运行 release script 缺参失败路径**

Run:

```powershell
rtk pwsh -NoProfile -Command "node workflow/release-tools.js"
```

Expected: non-zero exit，stderr/stdout contains `Missing required --target <path>`。

- [ ] **Step 5: 提交 green release workflow 变更**

Run:

```powershell
rtk pwsh -NoProfile -Command "git add workflow/release-tools.js src/core/test/release-tools.spec.ts package.json; git commit -m 'feat: add tools release packaging workflow'"
```

---

## Task 5: Generate Release Directory

**Files:**
- Generated: `<p6Root>/tools/cocos-cli`
- Source script: `workflow/release-tools.js`

- [ ] **Step 1: 确认 `dist/cli.js` 存在**

Run:

```powershell
rtk pwsh -NoProfile -Command "if (!(Test-Path 'dist\cli.js')) { npm run build }; if (!(Test-Path 'dist\cli.js')) { throw 'dist\cli.js is missing' }"
```

Expected: `dist/cli.js` exists. `npm run build` is an artifact prerequisite only when `dist/cli.js` is missing; it is not this round's acceptance test.

- [ ] **Step 2: 生成 release 到目标目录**

Run with the real target path supplied at execution time:

```powershell
rtk pwsh -NoProfile -Command "npm run release:tools -- --target '<p6Root>\tools\cocos-cli'"
```

Expected:

- `<p6Root>/tools/cocos-cli/package.json` exists.
- `<p6Root>/tools/cocos-cli/package-lock.json` exists.
- `<p6Root>/tools/cocos-cli/.gitignore` exists and contains `node_modules/`.
- `<p6Root>/tools/cocos-cli/dist/cli.js` exists.
- `<p6Root>/tools/cocos-cli/static/tools` exists.
- `<p6Root>/tools/cocos-cli/packages/asset-db` exists.
- `<p6Root>/tools/cocos-cli/packages/cc-module` exists.
- `<p6Root>/tools/cocos-cli/node_modules` does not exist.
- `<p6Root>/tools/cocos-cli/packages/engine` does not exist.

- [ ] **Step 3: 静态校验 runtime manifest、lockfile、README**

Run:

```powershell
rtk pwsh -NoProfile -Command @'
$target = '<p6Root>\tools\cocos-cli'
$pkg = Get-Content -Raw -Encoding UTF8 (Join-Path $target 'package.json') | ConvertFrom-Json
$lock = Get-Content -Raw -Encoding UTF8 (Join-Path $target 'package-lock.json') | ConvertFrom-Json
$readme = Get-Content -Raw -Encoding UTF8 (Join-Path $target 'README.md')
if ($pkg.scripts.postinstall) { throw 'runtime package.json must not contain scripts.postinstall' }
if ($pkg.devDependencies) { throw 'runtime package.json must not contain devDependencies' }
if ($lock.packages.''.hasInstallScript -eq $true) { throw 'runtime package-lock root must not have hasInstallScript=true' }
if (Test-Path (Join-Path $target 'node_modules')) { throw 'node_modules must not exist before install smoke' }
if (Test-Path (Join-Path $target 'packages\engine')) { throw 'packages\engine must not exist in release target' }
if ($readme -match '(?:[A-Za-z]:[\\/]|\\\\[^\\]+\\[^\\]+)') { throw 'README contains local absolute path' }
'@
```

Expected: exit 0.

- [ ] **Step 4: 先提交目标仓库 release 文件**

Commit before `npm install`, so generated `node_modules` cannot be accidentally staged.

Run:

```powershell
rtk pwsh -NoProfile -Command "git -C '<p6Root>\tools' status --short -- cocos-cli"
rtk pwsh -NoProfile -Command "git -C '<p6Root>\tools' add cocos-cli"
rtk pwsh -NoProfile -Command "$bad = git -C '<p6Root>\tools' diff --cached --name-only -- cocos-cli | Select-String -Pattern '(^|/)cocos-cli/node_modules/|(^|/)cocos-cli/packages/engine/'; if ($bad) { git -C '<p6Root>\tools' reset -- cocos-cli; throw 'release commit would include node_modules or packages/engine' }"
rtk pwsh -NoProfile -Command "git -C '<p6Root>\tools' commit -m 'tools: add cocos-cli release'"
```

Expected: target commit succeeds and staged files do not include `cocos-cli/node_modules` or `cocos-cli/packages/engine`.

---

## Task 6: Install and CLI Smoke

**Files:**
- Target release: `<p6Root>/tools/cocos-cli`
- Target repo: `<p6Root>/tools`

- [ ] **Step 1: 记录 Node.js 与 npm 版本**

Run:

```powershell
rtk pwsh -NoProfile -Command "Set-Location -LiteralPath '<p6Root>\tools\cocos-cli'; node -v; npm -v"
```

Expected: Node.js is `22.17.0` or newer. Record exact versions in final verification notes.

- [ ] **Step 2: 执行团队首次安装命令**

Run:

```powershell
rtk pwsh -NoProfile -Command "Set-Location -LiteralPath '<p6Root>\tools\cocos-cli'; npm install"
```

Expected: exit 0. Root CLI `postinstall` does not run because runtime `package.json` has no `scripts.postinstall`; dependency package lifecycle scripts may run.

- [ ] **Step 3: 确认 install 没有改写 manifest 或 lockfile**

Run:

```powershell
rtk pwsh -NoProfile -Command "git -C '<p6Root>\tools' status --short -- cocos-cli/package.json cocos-cli/package-lock.json"
```

Expected: no output. If there is output, inspect diff and fix runtime lockfile generation before continuing.

- [ ] **Step 4: 确认 `node_modules` 没有进入 target Git 状态**

Run:

```powershell
rtk pwsh -NoProfile -Command "git -C '<p6Root>\tools' status --short -- cocos-cli/node_modules"
```

Expected: no output because `<p6Root>/tools/cocos-cli/.gitignore` ignores `node_modules/`.

- [ ] **Step 5: 运行 `--help` smoke**

Run:

```powershell
rtk pwsh -NoProfile -Command "Set-Location -LiteralPath '<p6Root>\tools\cocos-cli'; node .\dist\cli.js --help"
```

Expected: exit 0 and output includes `Usage:` and `cocos`.

---

## Task 7: Runtime Preview Smoke

**Files:**
- Target release: `<p6Root>/tools/cocos-cli`
- Test project: `<projectRoot>` supplied at execution time

- [ ] **Step 1: project-config engine source case**

Use a test project whose `package.json` contains:

```json
{
  "cocos-cli": {
    "enginePath": "<engineRoot>"
  }
}
```

Run:

```powershell
rtk pwsh -NoProfile -Command "Set-Location -LiteralPath '<p6Root>\tools\cocos-cli'; node .\dist\cli.js preview --runtime --project '<projectRoot>' --host 127.0.0.1 --port <port> --settings-timeout-ms 120000"
```

Expected:

- Output contains `engineRootSource: project-config`.
- Output contains `preview:ready`.
- Stop the process after `preview:ready` if it remains open.

- [ ] **Step 2: creator-profile fallback case**

Use a copy of project metadata where `package.json` does not contain `cocos-cli.enginePath`. Ensure `COCOS_CLI_TEST_ENGINE_ROOT` and `COCOS_CLI_TEST_PROJECT_ROOT` are not set.

Run:

```powershell
rtk pwsh -NoProfile -Command "Set-Location -LiteralPath '<p6Root>\tools\cocos-cli'; Remove-Item Env:COCOS_CLI_TEST_ENGINE_ROOT -ErrorAction SilentlyContinue; Remove-Item Env:COCOS_CLI_TEST_PROJECT_ROOT -ErrorAction SilentlyContinue; node .\dist\cli.js preview --runtime --project '<projectRootWithoutEnginePath>' --host 127.0.0.1 --port <port> --settings-timeout-ms 120000"
```

Expected:

- Output contains `engineRootSource: creator-profile`.
- Output contains `preview:ready`.
- Stop the process after `preview:ready` if it remains open.

- [ ] **Step 3: no-engine negative case**

Run with `COCOS_CLI_CREATOR_PROFILE_ROOT` pointing to an empty temporary profile root and a project without `cocos-cli.enginePath`:

```powershell
rtk pwsh -NoProfile -Command "Set-Location -LiteralPath '<p6Root>\tools\cocos-cli'; $profileRoot = Join-Path $env:TEMP 'cocos-cli-empty-profile'; Remove-Item $profileRoot -Recurse -Force -ErrorAction SilentlyContinue; New-Item -ItemType Directory -Force $profileRoot | Out-Null; $env:COCOS_CLI_CREATOR_PROFILE_ROOT = $profileRoot; node .\dist\cli.js preview --runtime --project '<projectRootWithoutEnginePath>' --host 127.0.0.1 --port <port>"
```

Expected:

- Non-zero exit.
- Error mentions missing Creator engine profile or inability to resolve Cocos engine source.
- Output does not mention `engineRoot:global-fallback`.
- Output does not use `<cliRoot>/packages/engine`.

---

## Task 8: Final Verification and Review

**Files:**
- Source repo changes from Tasks 1-4
- Target repo release from Tasks 5-7

- [ ] **Step 1: 运行 focused source tests**

Run:

```powershell
rtk pwsh -NoProfile -Command "npx jest src/core/test/launcher-engine-root.spec.ts src/core/test/release-tools.spec.ts --runInBand"
```

Expected: PASS.

- [ ] **Step 2: 运行现有 runtime-preview resolver tests**

Run:

```powershell
rtk pwsh -NoProfile -Command "npx vitest run vitests/suites/runtime-preview/launcher-engine-root.test.ts"
```

Expected: PASS.

- [ ] **Step 3: 明确记录 build 验证范围**

Run only this check:

```powershell
rtk pwsh -NoProfile -Command "if (!(Test-Path 'dist\cli.js')) { throw 'dist\cli.js is missing' }"
```

Expected: PASS. Do not report `npm run build` as acceptance verification in this round unless it was actually run only to create missing artifacts.

- [ ] **Step 4: 检查 source repo 状态**

Run:

```powershell
rtk pwsh -NoProfile -Command "git status --short; git log --oneline -5"
```

Expected: source repo clean after commits.

- [ ] **Step 5: 检查 target repo 状态**

Run:

```powershell
rtk pwsh -NoProfile -Command "git -C '<p6Root>\tools' status --short -- cocos-cli/package.json cocos-cli/package-lock.json cocos-cli/node_modules cocos-cli/packages/engine; git -C '<p6Root>\tools' log --oneline -3"
```

Expected:

- No status output for `package.json` and `package-lock.json`.
- No tracked or staged `node_modules`.
- No tracked or staged `packages/engine`.
- Target repo has the release commit.

- [ ] **Step 6: 请求代码 review**

Use `superpowers:requesting-code-review` against the source repo change range. Provide reviewer with:

- Source repo commit range for resolver and release script.
- Target repo release commit SHA.
- Verification outputs for `npm install`, `--help`, `preview --runtime` project-config, `preview --runtime` creator-profile, and no-engine negative case.
- Note that `build` was not part of this round's acceptance verification.

Fix Critical and Important findings before final response.

---

## Self-Review

- Spec coverage: Tasks cover engine resolution priority, `cliInitializedEngineRoot` preservation, removal of `global-fallback`, runtime manifest, runtime lockfile, `static/tools`, `.gitignore`, README, target commit before install, `npm install`, `--help`, `preview --runtime`, and no-engine failure.
- Placeholder scan: `<p6Root>`、`<projectRoot>`、`<engineRoot>`、`<port>` are deliberate execution parameters. The plan does not contain incomplete marker text.
- Type consistency: `LauncherEngineRootSource` values are `test-env`、`project-config`、`cli-initialized`、`creator-profile`; `global-fallback` is removed from implementation and only appears in negative-output assertions.
- Review feedback coverage: release helper fixture creates all `keyToolDirs`; `src/core/launcher.ts` is explicitly modified; target repo commits before `npm install`; README receives real `node -v` / `npm -v`; absolute path guard covers drive and UNC paths; build is artifact prerequisite only.
