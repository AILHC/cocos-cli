# Project Extension Editor Facade And Strict Hooks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 CLI 的 project extension builder hook 在真实项目中按 Editor-like host 执行，并在 hook 失败时 fail fast，避免生成“构建成功但业务后处理缺失”的产物。

**Architecture:** CLI 不内置 `feature-c/build-ex` 的 SDK、hotupdate、cfg merge、混淆、字体替换、资源删除、`.meta` 改写等业务逻辑。CLI 只提供 builder extension host：为 project extension hook 安装受限 `Editor` facade，包住 hook module `requireFile()`、hook 调用和 `onError` 调用；同时把 project extension hook 标记为 fatal，任何 unsupported `Editor.Message` 或 hook 异常都中断构建并触发现有 `onError` 流程。`Editor.Message` 必须委托现有 CLI AssetDB API 或显式失败，不能用 raw filesystem 模拟 AssetDB 语义。

**Tech Stack:** TypeScript、Jest、`fs-extra`、现有 `assetManager` / `assetDBManager`、PowerShell + `rtk pwsh`、Cocos CLI build pipeline。

---

## 计划修订约束

- 本计划中的实现代码以当前源码事实为准：`TestHookTask` 构造参数是 `IBuildHooksInfo`，`assetManager.moveAsset()` option 字段是 `overwrite` / `rename`，不是 `override`。
- `Editor.Message.request()` 和 `Editor.Message.send()` 必须共用 async dispatcher；`send()` 只负责把 Promise 放进 facade pending queue。不得引入 sync-only `handleEditorMessageSync()` 分支。
- unsupported error message 必须区分调用方式：`Unsupported Editor.Message request: ${channel}.${message}` 或 `Unsupported Editor.Message send: ${channel}.${message}`。
- timer 策略是有界支持：hook scope 内创建的 `setTimeout(..., 0)` 可以在 facade teardown 前 drain；正延迟 timer、drain 后仍未执行的 timer、以及 timer callback 内继续安排的新延迟 timer 都必须 fail fast，错误写明 `Editor.Message send scheduled after hook scope`。
- `onError` hook 的异常仍由现有 `runErrorHook()` 容错路径记录，不应覆盖原始 build error；但 `onError` module load 和函数执行必须同样在 project extension facade scope 下运行。

---

## 当前事实

- 真实产物 `index.html` 仍包含 `__REPLACE_GAME_BUILD_CFG__`，浏览器报 `ReferenceError: __REPLACE_GAME_BUILD_CFG__ is not defined`。
- `feature-c/extensions/build-ex/source/hooks.ts` 的 `onAfterBuild` 里存在 `data.replace(/__REPLACE_GAME_BUILD_CFG__/g, buildCfg)`，但 hook 之前因 `Editor is not defined` 失败，没有执行到替换。
- `build-ex` 在模块顶层读取 `Editor.Project.path`，所以 facade 必须包住 `Utils.File.requireFile(info.path)`，只包住 `handleHook()` 不够。
- 当前 `BuildTaskBase.runPluginTask()` 只在 `hooks.throwError || info.internal` 时中断。普通 public hook 异常会记录日志但继续构建，这导致真实 `build-ex` 失败后 CLI 仍输出成功产物。
- `ResourceManager asset.addRef`、`cc.PhysicsMaterial`、`CCCameraCaptureHelper.init` 是后续 runtime 错误；处理顺序必须先消除前置 `build-ex` hook failure，再重新采样浏览器最早错误。

## File Structure

- Modify: `src/core/builder/@types/protected/build-result.ts`
  - 扩展 hook metadata，记录 hook 来源、是否 fatal、project root、是否需要 `Editor` facade。
- Modify: `src/core/builder/manager/plugin.ts`
  - 注册 project extension builder 时记录 project root，并在 `getHooksInfo()` 里标记 project extension hook。
- Create: `src/core/extensions/editor-facade.ts`
  - 负责创建和安装受限 `globalThis.Editor`，实现 `Editor.Project.path` 与第一批 `asset-db` message。
- Modify: `src/core/builder/worker/builder/manager/task-base.ts`
  - 在 project extension hook 的 `requireFile()` 与 `handleHook()` 外层调用共享 hook runner；基于 metadata fail fast。
- Create: `src/core/builder/worker/builder/manager/hook-runner.ts`
  - 封装 hook module loading、`Editor` facade 生命周期、`Editor.Message.send()` pending drain 和 fatal error wrapping；供 normal hook、bundle hook、stage hook、`runErrorHook()` 复用。
- Modify: `src/core/builder/worker/builder/index.ts`
  - 若 `handleHook()` 签名需要 metadata，主构建 hook 调用同步调整；`runErrorHook()` 改用共享 runner。
- Modify: `src/core/builder/worker/builder/asset-handler/bundle/index.ts`
  - 若 `handleHook()` 签名需要 metadata，bundle hook 调用同步调整。
- Modify: `src/core/builder/worker/builder/stage-task-manager.ts`
  - 保持 stage hook 通过共享 `BuildTaskBase` 路径执行，必要时补签名/测试覆盖。
- Modify: `src/core/builder/test/run-error-hook.spec.ts`
  - 覆盖 project extension `onError` 也能在 facade 下执行。
- Modify: `src/core/builder/test/run-plugin-task-error.spec.ts`
  - 覆盖 project extension fatal 语义和普通 public hook 非 fatal 语义。
- Modify: `src/core/builder/test/project-extension-builder-hooks.spec.ts`
  - 覆盖 project extension hook metadata、top-level `Editor.Project.path` 和 facade 包住 `requireFile()`。
- Create: `src/core/extensions/test/editor-facade.spec.ts`
  - 单测 `Editor.Project.path`、`asset-db/move-asset`、`asset-db/delete-asset`、unsupported message fail fast。
- Modify: `docs/dev/build/issues.md`
  - 更新 `BUILD-ISSUE-016`、`BUILD-ISSUE-019` 的状态和处理记录。
- Modify: `docs/dev/build/facts/feature-c-web-mobile-cli-build-20260616.md`
  - 追加真实构建和浏览器烟测的新事实。

---

## Editor Facade Async Contract

- `Editor.Project.path` 只在 project extension hook runner scope 内可用；hook module 顶层 `requireFile()`、hook 函数本体、`onError` hook 都在同一 scope 内执行。
- `Editor.Message.request(channel, message, ...args)` 返回 Promise，必须 await 真实 CLI API 或明确 throw unsupported。
- `Editor.Message.send(channel, message, ...args)` 不能静默忽略 Promise。实现必须把操作加入 facade pending queue，hook runner 在恢复 `globalThis.Editor` 前执行 `await drainEditorFacade()`；pending operation 失败要包装成当前 hook failure。
- 第一阶段只支持 hook scope 内创建的零延迟 `setTimeout(..., 0)`，runner 必须在恢复 `globalThis.Editor` 前 drain 这些 timer callback 和 callback 内产生的 `Editor.Message.send()` pending queue。正延迟 timer、drain 后仍未执行的 timer、以及 timer callback 内继续安排的新延迟 timer 都必须 fail fast，错误写明 `Editor.Message send scheduled after hook scope`。
- `asset-db.move-asset`、`asset-db.delete-asset`、`asset-db.query-asset-meta`、`asset-db.save-asset-meta`、`asset-db.query-uuid`、`asset-db.refresh-asset`、`asset-db.reimport-asset`、`asset-db.save-asset` 必须优先委托现有 `assetManager`，不能用 `moveSync/removeSync` 绕过 AssetDB。
- unsupported `Editor.Message` 必须 throw `Unsupported Editor.Message request: ${channel}.${message}` 或 `Unsupported Editor.Message send: ${channel}.${message}`，不能返回空对象、`true` 或 no-op。

---

### Task 0: Commit Current Runtime Facts Baseline

**Files:**
- Modify: `docs/dev/build/issues.md`
- Modify: `docs/dev/build/facts/feature-c-web-mobile-cli-build-20260616.md`

- [ ] **Step 1: Review the current dirty docs baseline**

```powershell
rtk pwsh -NoProfile -Command 'git diff -- docs/dev/build/issues.md docs/dev/build/facts/feature-c-web-mobile-cli-build-20260616.md'
```

Expected: diff only records Attempt 7/browser runtime facts and `BUILD-ISSUE-019`; no source code changes are included.

- [ ] **Step 2: Commit current facts before implementation**

```powershell
rtk pwsh -NoProfile -Command 'git add docs/dev/build/issues.md docs/dev/build/facts/feature-c-web-mobile-cli-build-20260616.md; git commit -m "docs: record feature-c browser runtime baseline"'
```

Expected: current pre-facade facts are isolated from later implementation checkpoints.

---

### Task 1: Hook Metadata And Fatal Policy

**Files:**
- Modify: `src/core/builder/@types/protected/build-result.ts`
- Modify: `src/core/builder/manager/plugin.ts`
- Modify: `src/core/builder/test/run-plugin-task-error.spec.ts`
- Modify: `src/core/builder/test/project-extension-builder-hooks.spec.ts`

- [ ] **Step 1: Write failing tests for project extension fatal behavior**

Add a test to `src/core/builder/test/run-plugin-task-error.spec.ts` that keeps ordinary public hook behavior unchanged but makes project extension hook failure fatal:

```ts
it('fails project extension hook errors even without exported throwError', async () => {
    const hookPath = join(tempRoot, 'project-extension-fatal-hook.js');
    writeFileSync(hookPath, `
        exports.onBeforeBuild = async function () {
            throw new Error('project extension exploded');
        };
    `, 'utf8');
    const onError = jest.fn(function (this: TestHookTask, error: Error, throwError = true) {
        this.error = error;
        if (throwError) {
            throw error;
        }
    });
    const task = new TestHookTask({
        pkgNameOrder: ['build-ex'],
        infos: {
            'build-ex': {
                path: hookPath,
                internal: false,
                source: 'project-extension',
                projectRoot: tempRoot,
                fatal: true,
                editorFacade: true,
            },
        },
    });
    task.onError = onError;

    await expect(task.runPluginTask('onBeforeBuild'))
        .rejects
        .toThrow('Build plugin "build-ex" hook "onBeforeBuild" failed: project extension exploded');
    expect(onError).toHaveBeenCalledTimes(1);
});
```

Add a companion assertion to the existing public non-fatal test:

```ts
expect(task.hooksInfo.infos['project-build-ex']).toEqual({
    path: hookPath,
    internal: false,
});
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```powershell
rtk pwsh -NoProfile -Command "npx jest src/core/builder/test/run-plugin-task-error.spec.ts --runInBand"
```

Expected: the new project extension fatal test fails because `fatal`, `source`, `projectRoot`, and `editorFacade` are not yet part of `IBuildHooksInfo`, and `runPluginTask()` still ignores metadata.

- [ ] **Step 3: Extend hook metadata types**

In `src/core/builder/@types/protected/build-result.ts`, replace the inline `infos` shape with named interfaces:

```ts
export type IBuildHookSource = 'platform' | 'registered-builder' | 'project-extension';

export interface IBuildHookInfo {
    path: string;
    internal: boolean;
    source?: IBuildHookSource;
    projectRoot?: string;
    fatal?: boolean;
    editorFacade?: boolean;
}

export interface IBuildHooksInfo {
    pkgNameOrder: string[];
    infos: Record<string, IBuildHookInfo>;
}
```

- [ ] **Step 4: Record project extension projectRoot in PluginManager**

In `src/core/builder/manager/plugin.ts`, add a map next to `projectExtensionPkgNamesMap`:

```ts
private projectExtensionProjectRootsMap: Record<string, Record<string, string>> = {};
```

When applying `pendingRegistrations`, record the project root:

```ts
if (!this.projectExtensionProjectRootsMap[platform]) {
    this.projectExtensionProjectRootsMap[platform] = {};
}
this.projectExtensionProjectRootsMap[platform][registration.pkgName] = projectRoot;
```

When clearing project extension builders, delete the root record:

```ts
delete this.projectExtensionProjectRootsMap[platform]?.[pkgName];
```

In `getHooksInfo()`, replace the `result.infos[pkgName]` assignment with:

```ts
const isProjectExtension = this.projectExtensionPkgNamesMap[platform]?.has(pkgName) === true;
result.infos[pkgName] = {
    path: this.builderPathsMap[platform][pkgName],
    internal: pkgName === platform,
    source: pkgName === platform ? 'platform' : isProjectExtension ? 'project-extension' : 'registered-builder',
    projectRoot: isProjectExtension ? this.projectExtensionProjectRootsMap[platform]?.[pkgName] : undefined,
    fatal: isProjectExtension ? true : undefined,
    editorFacade: isProjectExtension ? true : undefined,
};
```

- [ ] **Step 5: Add metadata assertion for discovered project extension**

In `src/core/builder/test/project-extension-builder-hooks.spec.ts`, extend the successful registration test with:

```ts
expect(hooksInfo.infos['build-ex']).toMatchObject({
    internal: false,
    source: 'project-extension',
    projectRoot,
    fatal: true,
    editorFacade: true,
});
```

Keep existing assertions for platform/internal hooks unchanged.

- [ ] **Step 6: Run focused registration tests**

Run:

```powershell
rtk pwsh -NoProfile -Command "npx jest src/core/builder/test/project-extension-builder-hooks.spec.ts --runInBand"
```

Expected: metadata assertions pass after implementation.

- [ ] **Step 7: Commit**

```powershell
rtk pwsh -NoProfile -Command "git add src/core/builder/@types/protected/build-result.ts src/core/builder/manager/plugin.ts src/core/builder/test/run-plugin-task-error.spec.ts src/core/builder/test/project-extension-builder-hooks.spec.ts; git commit -m 'fix: mark project extension hooks fatal'"
```

---

### Task 2: Editor Facade Unit

**Files:**
- Create: `src/core/extensions/editor-facade.ts`
- Create: `src/core/extensions/test/editor-facade.spec.ts`

- [ ] **Step 1: Write tests for Project.path and supported asset-db messages**

Create `src/core/extensions/test/editor-facade.spec.ts`:

```ts
import { join } from 'path';
import { tmpdir } from 'os';
import { mkdtempSync } from 'fs-extra';
import { assetManager } from '../../assets';
import { createEditorFacade, drainEditorFacade, withEditorFacade } from '../editor-facade';

jest.mock('../../assets', () => ({
    assetManager: {
        moveAsset: jest.fn(async () => ({ uuid: 'moved-uuid' })),
        removeAsset: jest.fn(async () => ({ uuid: 'removed-uuid' })),
    },
}));

describe('project extension Editor facade', () => {
    let projectRoot: string;

    beforeEach(() => {
        projectRoot = mkdtempSync(join(tmpdir(), 'cocos-cli-editor-facade-'));
    });

    afterEach(() => {
        delete (globalThis as any).Editor;
    });

    it('exposes Editor.Project.path while installed', async () => {
        await withEditorFacade({ projectRoot }, async () => {
            expect((globalThis as any).Editor.Project.path).toBe(projectRoot);
        });
        expect((globalThis as any).Editor).toBeUndefined();
    });

    it('delegates move-asset to assetManager.moveAsset', async () => {
        const editor = createEditorFacade({ projectRoot });
        await editor.Message.request('asset-db', 'move-asset', 'db://assets/resources/cfg', 'db://assets/tmp_cfg', {
            overwrite: true,
            rename: true,
        });

        expect(assetManager.moveAsset).toHaveBeenCalledWith('db://assets/resources/cfg', 'db://assets/tmp_cfg', {
            overwrite: true,
            rename: true,
        });
    });

    it('delegates delete-asset to assetManager.removeAsset without trash during build hook processing', async () => {
        const editor = createEditorFacade({ projectRoot });
        await editor.Message.request('asset-db', 'delete-asset', 'db://assets/tmp_cfg');

        expect(assetManager.removeAsset).toHaveBeenCalledWith('db://assets/tmp_cfg', { useTrash: false });
    });

    it('throws explicit errors for unsupported messages', async () => {
        const editor = createEditorFacade({ projectRoot });
        await expect(editor.Message.request('asset-db', 'query-assets'))
            .rejects
            .toThrow('Unsupported Editor.Message request: asset-db.query-assets');
    });

    it('throws explicit send errors when draining unsupported send operations', async () => {
        await expect(withEditorFacade({ projectRoot }, async () => {
            (globalThis as any).Editor.Message.send('asset-db', 'query-assets');
        })).rejects.toThrow('Unsupported Editor.Message send: asset-db.query-assets');
    });

    it('queues send operations and drains them before facade teardown', async () => {
        await withEditorFacade({ projectRoot }, async () => {
            (globalThis as any).Editor.Message.send('asset-db', 'move-asset', 'db://assets/tmp_cfg', 'db://assets/resources/cfg', {
                overwrite: true,
                rename: true,
            });
            await drainEditorFacade();
        });

        expect(assetManager.moveAsset).toHaveBeenCalledWith('db://assets/tmp_cfg', 'db://assets/resources/cfg', {
            overwrite: true,
            rename: true,
        });
    });

    it('drains zero-delay timer Editor.Message operations before teardown', async () => {
        await withEditorFacade({ projectRoot }, async () => {
            setTimeout(() => {
                (globalThis as any).Editor.Message.send('asset-db', 'move-asset', 'db://assets/project.json', 'db://assets/project.manifest', {
                    overwrite: true,
                    rename: true,
                });
            }, 0);
        });

        expect(assetManager.moveAsset).toHaveBeenCalledWith('db://assets/project.json', 'db://assets/project.manifest', {
            overwrite: true,
            rename: true,
        });
    });

    it('fails delayed Editor.Message scheduled after hook scope', async () => {
        await expect(withEditorFacade({ projectRoot }, async () => {
            setTimeout(() => {
                (globalThis as any).Editor.Message.send('asset-db', 'move-asset', 'db://assets/project.json', 'db://assets/project.manifest', {
                    overwrite: true,
                    rename: true,
                });
            }, 10);
        })).rejects.toThrow('Editor.Message send scheduled after hook scope');
    });
});
```

- [ ] **Step 2: Run test and verify failure**

Run:

```powershell
rtk pwsh -NoProfile -Command "npx jest src/core/extensions/test/editor-facade.spec.ts --runInBand"
```

Expected: FAIL because `src/core/extensions/editor-facade.ts` does not exist.

- [ ] **Step 3: Implement facade**

Create `src/core/extensions/editor-facade.ts`:

```ts
import { assetManager } from '../assets';

export interface EditorFacadeContext {
    projectRoot: string;
}

export interface EditorFacade {
    Project: {
        path: string;
    };
    Message: {
        request(channel: string, message: string, ...args: any[]): Promise<any>;
        send(channel: string, message: string, ...args: any[]): void;
    };
}

const pendingOperations = new WeakMap<EditorFacade, Promise<any>[]>();

export function createEditorFacade(context: EditorFacadeContext): EditorFacade {
    const pending: Promise<any>[] = [];
    const facade: EditorFacade = {
        Project: {
            path: context.projectRoot,
        },
        Message: {
            async request(channel: string, message: string, ...args: any[]) {
                return handleEditorMessage('request', channel, message, args);
            },
            send(channel: string, message: string, ...args: any[]) {
                pending.push(handleEditorMessage('send', channel, message, args));
            },
        },
    };
    pendingOperations.set(facade, pending);
    return facade;
}

export async function withEditorFacade<T>(context: EditorFacadeContext, run: () => Promise<T>): Promise<T> {
    const key = 'Editor';
    const globalObject = globalThis as any;
    const hadEditor = Object.prototype.hasOwnProperty.call(globalObject, key);
    const previous = globalObject.Editor;
    const facade = createEditorFacade(context);
    globalObject.Editor = facade;
    try {
        const result = await run();
        await drainEditorFacade(facade);
        return result;
    } finally {
        if (hadEditor) {
            globalObject.Editor = previous;
        } else {
            delete globalObject.Editor;
        }
    }
}

export async function drainEditorFacade(facade: EditorFacade = (globalThis as any).Editor): Promise<void> {
    const pending = pendingOperations.get(facade) || [];
    while (pending.length) {
        await pending.shift();
    }
}

async function handleEditorMessage(kind: 'request' | 'send', channel: string, message: string, args: any[]): Promise<any> {
    if (channel !== 'asset-db') {
        throw new Error(`Unsupported Editor.Message ${kind}: ${channel}.${message}`);
    }
    if (message === 'move-asset') {
        const [source, target, options = {}] = args;
        return assetManager.moveAsset(source, target, {
            overwrite: Boolean(options.overwrite),
            rename: Boolean(options.rename),
        });
    }
    if (message === 'delete-asset') {
        const [target] = args;
        return assetManager.removeAsset(target, { useTrash: false });
    }
    throw new Error(`Unsupported Editor.Message ${kind}: ${channel}.${message}`);
}
```

In the same file, wrap `setTimeout` inside `withEditorFacade()` and track timer callbacks created during the hook scope. The wrapper must support only zero-delay timers and must fail positive-delay or still-pending timers before restoring `globalThis.Editor`:

```ts
const originalSetTimeout = globalObject.setTimeout;
const scheduledTimers: Promise<void>[] = [];
const timerFailures: Error[] = [];
let scopeOpen = true;
globalObject.setTimeout = (callback: (...args: any[]) => void, timeout?: number, ...args: any[]) => {
    if (timeout && timeout > 0) {
        timerFailures.push(new Error('Editor.Message send scheduled after hook scope'));
        return originalSetTimeout(() => undefined, timeout);
    }
    let resolveTimer!: () => void;
    let rejectTimer!: (error: Error) => void;
    const timerPromise = new Promise<void>((resolve, reject) => {
        resolveTimer = resolve;
        rejectTimer = reject;
    });
    scheduledTimers.push(timerPromise);
    return originalSetTimeout(() => {
        if (!scopeOpen) {
            rejectTimer(new Error('Editor.Message send scheduled after hook scope'));
            return;
        }
        try {
            callback(...args);
            resolveTimer();
        } catch (error) {
            rejectTimer(error instanceof Error ? error : new Error(String(error)));
        }
    }, 0);
};
```

Replace the simple `try { const result = await run(); await drainEditorFacade(facade); return result; }` body shown above with the following drain sequence. Before restoring `globalThis.Editor`, wait one event-loop tick for zero-delay timers, then drain both `scheduledTimers` and facade pending sends while `scopeOpen` is still true:

```ts
const result = await run();
await new Promise((resolve) => originalSetTimeout(resolve, 0));
if (timerFailures.length) {
    throw timerFailures[0];
}
await Promise.all(scheduledTimers);
await drainEditorFacade(facade);
scopeOpen = false;
return result;
```

Any positive-delay timer or timer operation that survives this drain point must reject with:

```ts
throw new Error('Editor.Message send scheduled after hook scope');
```

Also restore `globalObject.setTimeout = originalSetTimeout` in `finally`, and set `scopeOpen = false` before restoring `globalThis.Editor` if the hook throws.

- [ ] **Step 4: Run facade tests**

Run:

```powershell
rtk pwsh -NoProfile -Command "npx jest src/core/extensions/test/editor-facade.spec.ts --runInBand"
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
rtk pwsh -NoProfile -Command "git add src/core/extensions/editor-facade.ts src/core/extensions/test/editor-facade.spec.ts; git commit -m 'feat: add project extension Editor facade'"
```

---

### Task 3: Wrap Hook Require And Execution With Facade

**Files:**
- Create: `src/core/builder/worker/builder/manager/hook-runner.ts`
- Modify: `src/core/builder/worker/builder/manager/task-base.ts`
- Modify: `src/core/builder/worker/builder/index.ts`
- Modify: `src/core/builder/worker/builder/asset-handler/bundle/index.ts`
- Modify: `src/core/builder/test/project-extension-builder-hooks.spec.ts`
- Modify: `src/core/builder/test/run-error-hook.spec.ts`

- [ ] **Step 1: Add a failing test for top-level Editor.Project.path**

In `src/core/builder/test/project-extension-builder-hooks.spec.ts`, add a fixture hook whose module top level reads `Editor.Project.path`:

```ts
import { readFileSync } from 'fs';
import { BuildTaskBase } from '../worker/builder/manager/task-base';
import type { IBuildHooksInfo } from '../@types/protected';

class FacadeHookTask extends BuildTaskBase {
    public hooksInfo: IBuildHooksInfo;
    public options: any;
    public hookMap: Record<string, string> = {
        onBeforeBuild: 'onBeforeBuild',
    };

    constructor(hooksInfo: IBuildHooksInfo, options: any) {
        super('facade-hook-task', 'test');
        this.hooksInfo = hooksInfo;
        this.options = options;
    }

    async handleHook(func: Function): Promise<void> {
        await func(this.options, {});
    }

    async run(): Promise<boolean> {
        return true;
    }
}

it('installs Editor facade before requiring project extension hooks', async () => {
    const extensionRoot = createBuilderExtension(projectRoot, 'build-ex', 'build-ex', `
        exports.configs = {
            '*': {
                hooks: './hooks.js',
            },
        };
    `);
    writeFileSync(join(extensionRoot, 'dist', 'hooks.js'), `
        const fs = require('fs');
        const path = require('path');
        const marker = path.join(Editor.Project.path, 'editor-project-path-marker.txt');
        exports.onBeforeBuild = async function () {
            fs.writeFileSync(marker, Editor.Project.path, 'utf8');
        };
    `, 'utf8');
    const pm = createPluginManager();
    await pm.registerProjectExtensionBuilders(projectRoot, PLATFORM);
    const hooksInfo = pm.getHooksInfo(PLATFORM);
    const task = new FacadeHookTask(hooksInfo, { projectRoot, platform: PLATFORM });

    await task.runPluginTask('onBeforeBuild');

    expect(readFileSync(join(projectRoot, 'editor-project-path-marker.txt'), 'utf8')).toBe(projectRoot);
});
```

In `src/core/builder/test/run-error-hook.spec.ts`, add a project extension error hook case:

```ts
it('runs project extension onError with Editor facade installed', async () => {
    const hookPath = join(tempRoot, 'project-extension-error-hooks.js');
    writeFileSync(hookPath, `
        const fs = require('fs');
        const path = require('path');
        const marker = path.join(Editor.Project.path, 'on-error-marker.txt');
        exports.onError = async function () {
            fs.writeFileSync(marker, Editor.Project.path, 'utf8');
        };
    `, 'utf8');
    const fakeTask = {
        hooksInfo: {
            pkgNameOrder: ['build-ex'],
            infos: {
                'build-ex': {
                    path: hookPath,
                    internal: false,
                    source: 'project-extension',
                    projectRoot: tempRoot,
                    fatal: true,
                    editorFacade: true,
                },
            },
        },
        result: {
            rawOptions: { platform: 'web-mobile' },
        },
        buildResult: { dest: 'build-output' },
        error: new Error('original build failure'),
        updateProcess: jest.fn(),
        postBuild: jest.fn(),
    };

    await BuildTask.prototype.runErrorHook.call(fakeTask as any);

    expect(readFileSync(join(tempRoot, 'on-error-marker.txt'), 'utf8')).toBe(tempRoot);
});
```

- [ ] **Step 2: Run test and verify failure**

Run:

```powershell
rtk pwsh -NoProfile -Command "npx jest src/core/builder/test/project-extension-builder-hooks.spec.ts --runInBand"
```

Expected: FAIL with `Editor is not defined` during `Utils.File.requireFile(info.path)`.

- [ ] **Step 3: Add shared hook runner**

Create `src/core/builder/worker/builder/manager/hook-runner.ts`:

```ts
import { Utils } from '../../../../base';
import { withEditorFacade } from '../../../../extensions/editor-facade';
import type { IBuildHookInfo } from '../../../@types/protected';

export interface RunBuildHookOptions {
    pkgName: string;
    funcName: string;
    info: IBuildHookInfo;
    invoke(func: Function, info: IBuildHookInfo): Promise<void>;
}

export async function loadAndRunBuildHook(options: RunBuildHookOptions): Promise<any> {
    const run = async () => {
        const hooks = Utils.File.requireFile(options.info.path);
        if (hooks[options.funcName]) {
            await options.invoke(hooks[options.funcName], options.info);
        }
        return hooks;
    };
    if (options.info.editorFacade && options.info.projectRoot) {
        return withEditorFacade({ projectRoot: options.info.projectRoot }, run);
    }
    return run();
}

export function shouldFailBuildForHook(hooks: any, info: IBuildHookInfo): boolean {
    return Boolean((hooks && hooks.throwError) || info.internal || info.fatal);
}

export function wrapBuildHookError(pkgName: string, funcName: string, error: unknown): Error {
    const originalMessage = error instanceof Error ? error.message : String(error);
    const wrappedError = new Error(`Build plugin "${pkgName}" hook "${funcName}" failed: ${originalMessage}`);
    (wrappedError as Error & { cause?: unknown }).cause = error;
    return wrappedError;
}
```

In `src/core/builder/worker/builder/manager/task-base.ts`, replace direct `Utils.File.requireFile(info.path)` with `loadAndRunBuildHook()`:

```ts
hooks = await loadAndRunBuildHook({
    pkgName,
    funcName,
    info,
    invoke: async (func, hookInfo) => {
        newConsole.pluginTask(pkgName, funcName, 'start');
        console.debug(trickTimeLabel);
        await this.handleHook(func, hookInfo.internal, hookInfo);
        const time = newConsole.trackTimeEnd(trickTimeLabel, { output: true });
        newConsole.pluginTask(pkgName, funcName, 'complete', `${time}ms`);
        this.updateProcess(`${pkgName}:${funcName} completed ✓`, increment, 'success');
    },
});
```

Change fatal decision to use metadata:

```ts
if (shouldFailBuildForHook(hooks, info)) {
    this.onError(wrapBuildHookError(pkgName, funcName, error));
}
```

In `src/core/builder/worker/builder/index.ts`, update `runErrorHook()` to use the same helper:

```ts
await loadAndRunBuildHook({
    pkgName,
    funcName: 'onError',
    info,
    invoke: async (func, hookInfo) => {
        await this.handleHook(func, hookInfo.internal, hookInfo, buildError);
    },
});
```

- [ ] **Step 4: Update handleHook signatures**

In `src/core/builder/worker/builder/manager/task-base.ts`, change the abstract signature:

```ts
abstract handleHook(func: Function, internal: boolean, info?: IBuildHookInfo, ...args: any[]): Promise<void>;
```

In `src/core/builder/worker/builder/index.ts`:

```ts
async handleHook(func: Function, internal: boolean, _info?: IBuildHookInfo, ...args: any[]) {
    if (internal) {
        await func.call(this, this.options, this.result, this.cache, ...args);
    } else {
        await func(this.result.rawOptions, this.buildResult, ...args);
    }
}
```

In `src/core/builder/worker/builder/asset-handler/bundle/index.ts`:

```ts
async handleHook(func: Function, internal: boolean, _info?: IBuildHookInfo, ...args: any[]) {
    if (internal) {
        await func.call(this, this.options, this.bundles, this.cache);
    } else {
        await func();
    }
}
```

Add `IBuildHookInfo` to imports in both files.

- [ ] **Step 5: Run hook tests**

Run:

```powershell
rtk pwsh -NoProfile -Command "npx jest src/core/builder/test/run-plugin-task-error.spec.ts src/core/builder/test/project-extension-builder-hooks.spec.ts src/core/builder/test/run-error-hook.spec.ts --runInBand"
```

Expected: PASS. The ordinary public non-fatal test remains non-fatal; project extension failure is fatal; top-level `Editor.Project.path` works; project extension `onError` also runs under facade.

- [ ] **Step 6: Commit**

```powershell
rtk pwsh -NoProfile -Command "git add src/core/builder/worker/builder/manager/hook-runner.ts src/core/builder/worker/builder/manager/task-base.ts src/core/builder/worker/builder/index.ts src/core/builder/worker/builder/asset-handler/bundle/index.ts src/core/builder/test/run-plugin-task-error.spec.ts src/core/builder/test/project-extension-builder-hooks.spec.ts src/core/builder/test/run-error-hook.spec.ts; git commit -m 'fix: run project extension hooks with Editor facade'"
```

---

### Task 4: Real Build Checkpoint 1, Expect Fail Fast Or Placeholder Removal

**Files:**
- Modify: `docs/dev/build/facts/feature-c-web-mobile-cli-build-20260616.md`
- Modify: `docs/dev/build/issues.md`

- [ ] **Step 1: Rebuild CLI dist before real project verification**

```powershell
rtk pwsh -NoProfile -Command 'npm run build'
```

Expected: PASS. This step is required because the real project command uses `node .\dist\cli.js`; without rebuilding `dist`, the checkpoint may test stale code.

- [ ] **Step 2: Build the real project with the existing debug no-atlas skip-texture config**

Use the existing real project config path as the baseline source:

```powershell
rtk pwsh -NoProfile -Command '$env:NODE_OPTIONS="--max-old-space-size=12288"; node .\dist\cli.js build --project D:\ps_copy\p6\trunk\Project\GameClient\feature-c --platform web-mobile --build-config D:\ps_copy\p6\trunk\Project\GameClient\feature-c\build_configs\p6_buildConfig_web-mobile.json --output-name codex-p6-web-mobile-cli-editor-facade-checkpoint-20260616 *> .codex-tmp\p6-web-mobile-editor-facade-checkpoint.stdout.log'
```

If the command uses the temporary debug/no-atlas/skip texture JSON created during the previous investigation, record that exact JSON path in the fact doc before running.

- [ ] **Step 3: Classify the result**

If the build exits non-zero with an unsupported `Editor.Message` error, do not patch around it. Record the exact first unsupported API:

```powershell
rtk pwsh -NoProfile -Command "Select-String -Path .codex-tmp\p6-web-mobile-editor-facade-checkpoint.stdout.log -Pattern 'Unsupported Editor.Message|Build plugin `"build-ex`" hook|ReferenceError: Editor' -Context 2,4"
```

Expected allowed outcomes:

- PASS path: no `ReferenceError: Editor is not defined`, build succeeds, and `index.html` no longer contains `__REPLACE_GAME_BUILD_CFG__`.
- FAIL path: build exits non-zero on a specific unsupported `Editor.Message` API. This is acceptable and better than a false success; add the exact API to `BUILD-ISSUE-016` before implementing it.

- [ ] **Step 4: Verify placeholder replacement when build succeeds**

Run:

```powershell
rtk pwsh -NoProfile -Command "Select-String -Path D:\ps_copy\p6\trunk\Project\GameClient\feature-c\build\codex-p6-web-mobile-cli-editor-facade-checkpoint-20260616\index.html -Pattern '__REPLACE_GAME_BUILD_CFG__|__GAME_BUILD_CFG__' -Context 0,2"
```

Expected on success:

- `__REPLACE_GAME_BUILD_CFG__` is absent.
- `__GAME_BUILD_CFG__` is assigned a concrete JSON/object literal produced by `build-ex`.

- [ ] **Step 5: Run subagent review checkpoint**

Dispatch one review subagent with this prompt:

```text
Review the current cocos-cli changes for project extension hook parity. Check whether the implementation keeps build-ex business logic out of CLI, installs Editor facade before hook module require, makes project extension hook failures fatal, and does not hide unsupported Editor.Message APIs with empty mocks. Report deviations with file and line references.
```

Required decision:

- If review finds CLI-owned business logic copied from `feature-c/build-ex`, revert that part and redesign before continuing.
- If review finds unsupported messages are silently ignored, change them to explicit errors before continuing.

- [ ] **Step 6: Commit docs for checkpoint**

```powershell
rtk pwsh -NoProfile -Command "git add docs/dev/build/facts/feature-c-web-mobile-cli-build-20260616.md docs/dev/build/issues.md; git commit -m 'docs: record project extension facade build checkpoint'"
```

---

### Task 5: Add Fact-Based AssetDB Message Support

**Files:**
- Modify: `src/core/extensions/editor-facade.ts`
- Modify: `src/core/extensions/test/editor-facade.spec.ts`
- Modify: `docs/dev/build/issues.md`
- Modify: `docs/dev/build/facts/feature-c-web-mobile-cli-build-20260616.md`

Only execute this task for APIs observed in Task 4 logs. The initial allowlist is based on `feature-c/extensions/build-ex/source/hooks.ts` inventory:

```text
asset-db.query-asset-meta
asset-db.save-asset-meta
asset-db.query-uuid
asset-db.refresh-asset
asset-db.reimport-asset
asset-db.save-asset
```

- [ ] **Step 1: Add tests for each observed API before implementation**

Mock `assetManager` at the top of the test file for the async delegation cases:

```ts
jest.mock('../../assets', () => ({
    assetManager: {
        moveAsset: jest.fn(async () => ({ uuid: 'moved-uuid' })),
        removeAsset: jest.fn(async () => ({ uuid: 'removed-uuid' })),
        queryAssetInfo: jest.fn(() => ({ uuid: 'asset-uuid' })),
        queryAssetMeta: jest.fn(() => ({ userData: {} })),
        saveAssetMeta: jest.fn(async () => undefined),
        refreshAsset: jest.fn(async () => 1),
        reimportAsset: jest.fn(async () => ({ uuid: 'asset-uuid' })),
        saveAsset: jest.fn(async () => ({ uuid: 'asset-uuid' })),
    },
}));
```

For `query-uuid`, add:

```ts
it('delegates query-uuid to assetManager.queryAssetInfo', async () => {
    const editor = createEditorFacade({ projectRoot });
    const uuid = await editor.Message.request('asset-db', 'query-uuid', 'db://assets/scripts');
    expect(uuid).toBe('asset-uuid');
    expect(assetManager.queryAssetInfo).toHaveBeenCalledWith('db://assets/scripts');
});
```

For `query-asset-meta` and `save-asset-meta`, assert:

```ts
const meta = await editor.Message.request('asset-db', 'query-asset-meta', 'db://assets/scripts');
meta.userData.isBundle = true;
await editor.Message.request('asset-db', 'save-asset-meta', 'db://assets/scripts', JSON.stringify(meta));
expect(assetManager.queryAssetMeta).toHaveBeenCalledWith('db://assets/scripts');
expect(assetManager.saveAssetMeta).toHaveBeenCalledWith('db://assets/scripts', meta);
```

For `refresh-asset`, `reimport-asset`, and `save-asset`, use the same mocked `assetManager` pattern and assert exact delegation. Do not return fake successful data from unsupported APIs unless the underlying CLI `assetManager` call is invoked.

- [ ] **Step 2: Implement exact delegations**

In `src/core/extensions/editor-facade.ts`, import the existing asset APIs:

```ts
import { assetManager } from '../assets';
```

Extend the async `handleEditorMessage()` dispatcher. Keep `request()` and `send()` on the same dispatcher: `request()` awaits the Promise, `send()` queues the Promise for `drainEditorFacade()`.

```ts
async function handleEditorMessage(kind: 'request' | 'send', projectRoot: string, channel: string, message: string, args: any[]): Promise<any> {
    if (channel !== 'asset-db') {
        throw new Error(`Unsupported Editor.Message ${kind}: ${channel}.${message}`);
    }
    if (message === 'move-asset') {
        const [source, target, options = {}] = args;
        return assetManager.moveAsset(source, target, {
            overwrite: Boolean(options.overwrite),
            rename: Boolean(options.rename),
        });
    }
    if (message === 'delete-asset') {
        const [target] = args;
        return assetManager.removeAsset(target, { useTrash: false });
    }
    if (message === 'query-asset-meta') {
        const [target] = args;
        return assetManager.queryAssetMeta(target);
    }
    if (message === 'save-asset-meta') {
        const [target, rawMeta] = args;
        const meta = typeof rawMeta === 'string' ? JSON.parse(rawMeta) : rawMeta;
        return assetManager.saveAssetMeta(target, meta);
    }
    if (message === 'query-uuid') {
        const [target] = args;
        const info = await assetManager.queryAssetInfo(target);
        return info?.uuid || '';
    }
    if (message === 'refresh-asset') {
        const [target] = args;
        return assetManager.refreshAsset(target);
    }
    if (message === 'reimport-asset') {
        const [target] = args;
        return assetManager.reimportAsset(target);
    }
    if (message === 'save-asset') {
        const [target, data] = args;
        return assetManager.saveAsset(target, data);
    }
    throw new Error(`Unsupported Editor.Message ${kind}: ${channel}.${message}`);
}
```

The concrete async cases are:

```ts
if (message === 'query-asset-meta') {
    const [target] = args;
    return assetManager.queryAssetMeta(target);
}
if (message === 'save-asset-meta') {
    const [target, rawMeta] = args;
    const meta = typeof rawMeta === 'string' ? JSON.parse(rawMeta) : rawMeta;
    return assetManager.saveAssetMeta(target, meta);
}
if (message === 'query-uuid') {
    const [target] = args;
    const info = await assetManager.queryAssetInfo(target);
    return info?.uuid || '';
}
if (message === 'refresh-asset') {
    const [target] = args;
    return assetManager.refreshAsset(target);
}
if (message === 'reimport-asset') {
    const [target] = args;
    return assetManager.reimportAsset(target);
}
if (message === 'save-asset') {
    const [target, data] = args;
    return assetManager.saveAsset(target, data);
}
```

Keep every supported `Editor.Message` case in async `handleEditorMessage()`. `Editor.Message.request()` awaits that Promise directly; `Editor.Message.send()` appends that Promise to the facade pending queue and `withEditorFacade()` drains the queue before teardown. Do not introduce a separate sync-only `send()` path.

```ts
pending.push(handleEditorMessage('send', context.projectRoot, channel, message, args));
```

The real `build-ex` uses `send()` for `move-asset` and may call `reimport-asset` from a timer. This plan treats those as queued facade operations; unsupported delayed usage must fail in the hook runner, not become an unhandled asynchronous error after the build continues.

- [ ] **Step 3: Run facade tests**

```powershell
rtk pwsh -NoProfile -Command "npx jest src/core/extensions/test/editor-facade.spec.ts --runInBand"
```

Expected: PASS.

- [ ] **Step 4: Rebuild CLI dist before real build checkpoint**

```powershell
rtk pwsh -NoProfile -Command 'npm run build'
```

Expected: PASS.

- [ ] **Step 5: Re-run real build and repeat classification**

Use the Task 4 command with a new output name:

```powershell
rtk pwsh -NoProfile -Command '$env:NODE_OPTIONS="--max-old-space-size=12288"; node .\dist\cli.js build --project D:\ps_copy\p6\trunk\Project\GameClient\feature-c --platform web-mobile --build-config D:\ps_copy\p6\trunk\Project\GameClient\feature-c\build_configs\p6_buildConfig_web-mobile.json --output-name codex-p6-web-mobile-cli-editor-facade-api-checkpoint-20260616 *> .codex-tmp\p6-web-mobile-editor-facade-api-checkpoint.stdout.log'
```

Expected:

- Every newly supported `Editor.Message` API is backed by existing CLI `assetManager` behavior or explicit filesystem operation.
- Unsupported API still fails the build.
- No `ReferenceError: Editor is not defined`.

- [ ] **Step 6: Commit**

```powershell
rtk pwsh -NoProfile -Command "git add src/core/extensions/editor-facade.ts src/core/extensions/test/editor-facade.spec.ts docs/dev/build/facts/feature-c-web-mobile-cli-build-20260616.md docs/dev/build/issues.md; git commit -m 'feat: support fact-based Editor asset-db messages'"
```

---

### Task 6: Browser Smoke Test After Placeholder Is Gone

**Files:**
- Modify: `docs/dev/build/facts/feature-c-web-mobile-cli-build-20260616.md`
- Modify: `docs/dev/build/issues.md`

- [ ] **Step 1: Start static server for the newest successful output**

```powershell
rtk pwsh -NoProfile -Command '$server = Start-Process -FilePath python -ArgumentList @("-m","http.server","17891","--bind","127.0.0.1","--directory","D:\ps_copy\p6\trunk\Project\GameClient\feature-c\build\codex-p6-web-mobile-cli-editor-facade-api-checkpoint-20260616") -WindowStyle Hidden -PassThru; "PID=$($server.Id)"'
```

Keep the printed process id in the fact doc so it can be stopped explicitly.

- [ ] **Step 2: Open browser and capture first errors**

Use the in-app browser against:

```text
http://127.0.0.1:17891/index.html
```

Capture:

- the first console error after page navigation, not only later repeated errors;
- `document.title`;
- whether `#GameCanvas` exists and its dimensions;
- network status for `index.html`, `settings`, `assets/main/config`, `assets/resources/config`, and `cocos-js` entries.

- [ ] **Step 3: Classify runtime result**

Expected fixed condition:

- `__REPLACE_GAME_BUILD_CFG__ is not defined` no longer appears.

If the first remaining error is `Can not find class 'cc.PhysicsMaterial'`, register or update a dedicated issue for engine module/includeModules parity.

If the first remaining error is `asset.addRef is not a function`, inspect the asset object type at `ResourceManager.onLoad` and compare with Editor output before changing CLI behavior.

If the first remaining error is `CCCameraCaptureHelper.init` reading `MinBlurViewSize[0]`, compare the produced config resources and `__GAME_BUILD_CFG__` with Editor/business output before changing CLI behavior.

- [ ] **Step 4: Stop static server**

```powershell
rtk pwsh -NoProfile -Command 'Stop-Process -Id <recorded-server-pid> -Force'
```

- [ ] **Step 5: Run subagent review checkpoint**

Dispatch one review subagent with this prompt:

```text
Review the runtime smoke-test evidence and current code. Check whether the next proposed issue is based on the first browser error after fixing __REPLACE_GAME_BUILD_CFG__, and whether any CLI code is compensating for feature-c business data instead of hosting the extension correctly. Report unsupported assumptions and missing evidence.
```

- [ ] **Step 6: Commit docs**

```powershell
rtk pwsh -NoProfile -Command "git add docs/dev/build/facts/feature-c-web-mobile-cli-build-20260616.md docs/dev/build/issues.md; git commit -m 'docs: record browser smoke after build-ex facade'"
```

---

### Task 7: Full Verification

**Files:**
- No source changes unless verification finds a regression.

- [ ] **Step 1: Run focused tests**

```powershell
rtk pwsh -NoProfile -Command "npx jest src/core/extensions/test/editor-facade.spec.ts src/core/builder/test/run-plugin-task-error.spec.ts src/core/builder/test/project-extension-builder-hooks.spec.ts src/core/builder/test/run-error-hook.spec.ts --runInBand"
```

Expected: PASS.

- [ ] **Step 2: Run existing packAutoAtlas regression test**

```powershell
rtk pwsh -NoProfile -Command "npx jest src/core/builder/test/pack-auto-atlas-option.spec.ts --runInBand --detectOpenHandles"
```

Expected: PASS.

- [ ] **Step 3: Build CLI**

```powershell
rtk pwsh -NoProfile -Command "npm run build"
```

Expected: PASS.

- [ ] **Step 4: Check git status**

```powershell
rtk pwsh -NoProfile -Command "git status --short --branch"
```

Expected: only intentional files are modified, or clean after final commit.

- [ ] **Step 5: Final review checkpoint**

Dispatch one review subagent with this prompt:

```text
Final review for project extension Editor facade and strict hook work. Verify tests cover fatal hook behavior, top-level Editor.Project.path, supported asset-db messages, and unsupported message fail-fast. Verify docs accurately separate fixed facts from open runtime issues. Report blockers only with file/line evidence.
```

- [ ] **Step 6: Final commit if verification changed docs or tests**

```powershell
rtk pwsh -NoProfile -Command "git add src docs; git commit -m 'test: verify project extension Editor facade'"
```

Skip this commit only if `git status --short` is clean.

---

## Acceptance Criteria

- Project extension hook module top-level code can read `Editor.Project.path`.
- Project extension hook failures are fatal by default and no longer produce false successful builds.
- `Editor.Message` unsupported APIs throw explicit errors naming `channel.message`.
- Supported `Editor.Message` APIs are backed by existing CLI AssetDB APIs or bounded project `assets` filesystem operations; there are no empty mocks.
- Real `feature-c` build logs no longer contain `ReferenceError: Editor is not defined`.
- If real build succeeds, output `index.html` no longer contains `__REPLACE_GAME_BUILD_CFG__`.
- Browser smoke test records the earliest remaining runtime error after placeholder replacement is fixed.
- Docs distinguish:
  - fixed extension host/fail-fast behavior;
  - still-open `packAutoAtlas=true` worker hang;
  - still-open runtime errors that require fresh evidence after `build-ex` runs.

## Risks And Controls

- Risk: project extension `asset-db.move-asset` / `asset-db.delete-asset` can mutate source project assets, matching what the real Editor extension requests. Control: route through existing `assetManager.moveAsset()` / `assetManager.removeAsset()` so `.meta`, AssetDB queue, refresh, readonly checks, and filesystem bridge behavior stay centralized; record every real build attempt in fact docs.
- Risk: `Editor.Message.send()` fire-and-forget can race source restoration. Control: every supported `send()` operation is pushed into the facade pending queue, and hook runner drains it before restoring `globalThis.Editor`; delayed timer usage outside the supported scope fails explicitly.
- Risk: adding fatal semantics changes compatibility for project extensions. Control: only project extension hooks get `fatal: true`; ordinary registered public hooks keep existing non-fatal behavior unless they export `throwError`.
- Risk: facade gradually becomes a hidden Editor clone. Control: implement only APIs observed in real logs or tests, backed by concrete CLI APIs, and keep unsupported messages fail-fast.
