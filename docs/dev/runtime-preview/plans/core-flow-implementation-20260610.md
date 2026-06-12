# Runtime Preview Core Flow Implementation Plan

> **Status:** historical execution record. 当前状态以 [../issues.md](../issues.md) 和 [../acceptance/matrix.md](../acceptance/matrix.md) 为准；本文中的 unchecked checklist 保留原计划草稿状态，不表示当前仍未执行。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 production `preview --runtime` 按 current Cocos preview flow 跑通 feature-c exact scene，并正确服务 engine runtime 实际请求的 project / extension / internal library 文件。
**Architecture:** `RuntimePreviewContext` 只保存启动链路解析好的 roots 和 providers；`resolveLibraryRequest()` 对 `/assets/<namespace>/(import|native)/<tail>` 统一执行 path-safe direct lookup，不再用旧 production allow-list 阻断真实文件。脚本加载继续交给 current preview-app / import-map / loader，E2E 用更长 timeout 和稳定观察窗口验证真实 browser runtime。
**Tech Stack:** TypeScript, Node.js `fs/promises`, `path`, Vitest, Playwright/CDP smoke scripts, Cocos CLI runtime preview.

---

## File Structure

- Modify: `src/runtime-preview/context/runtime-preview-context.ts`
  - Add explicit `extensionLibraryRoots`.
  - Keep context startup state lazy; do not scan roots.
- Create: `src/core/assets/extension-asset-db-mounts.ts`
  - Shared helper that resolves project extension AssetDB mounts and their CLI library roots.
- Modify: `src/core/assets/asset-config.ts`
  - Reuse the shared extension mount helper so Launcher and AssetDB use one rule.
- Modify: `src/runtime-preview/server/runtime-preview-server.ts`
  - Accept and log `extensionLibraryRoots`.
  - Include roots in health response.
- Modify: `src/core/launcher.ts`
  - Resolve extension AssetDB mount roots from `<project>/extensions/*/package.json`.
  - Pass resolved roots to `startRuntimePreviewServer()`.
- Modify: `src/runtime-preview/library/resolve-library-request.ts`
  - Replace old production `allowedRequestPaths` / `bundleConfigs.paths` gate for import/native library file routes.
  - Parse any `/assets|remote/<namespace>/(import|native)/<tail>`.
  - Direct lookup across `projectLibraryRoot`, `extensionLibraryRoots`, `internalLibraryRoot`.
- Modify: `src/runtime-preview/server/runtime-preview-routes.ts`
  - Include extension roots in `/query-extname/<uuid>` lookup.
  - Keep captured test mode strict only where explicitly passed by tests.
- Modify: `vitests/shared/browser-runtime-smoke.ts`
  - Record `unhandledRejections`.
  - Preserve default failure on `console.error`, `pageerror`, same-origin 4xx/5xx.
- Modify: `vitests/scripts/listen-existing-preview-url.mjs`
  - Record unhandled rejections if CDP or page events expose them.
  - Use env-configured long windows for feature-c evidence.
- Modify: `vitests/scripts/runtime-preview-feature-c-diagnose.ts`
  - Default ready timeout to `600000`.
  - Default stable window to `300000`.
- Modify/Test: `vitests/suites/runtime-preview/on-demand-resolver.test.ts`
  - Focused unit tests for path safety, non-general namespace, extension roots, empty tail.
- Modify/Test: `vitests/suites/runtime-preview/preview-app-route-contract.test.ts`
  - HTTP-level tests for general, non-general, native, extension root, and no physical namespace path.
- Modify/Test: `vitests/suites/runtime-preview/cli-startup.test.ts`
  - Server health/startup log includes extension roots.
- Modify/Test: `vitests/suites/runtime-preview/cli-generated-output-integration.test.ts`
  - Launcher process exposes extension roots resolved from project extension mounts.

---

### Task 1: Add Failing Resolver Contract Tests

**Files:**
- Modify: `vitests/suites/runtime-preview/on-demand-resolver.test.ts`

- [ ] **Step 1: Add helpers for temporary library roots**

Add helpers near the top of `vitests/suites/runtime-preview/on-demand-resolver.test.ts`:

```ts
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtemp } from 'node:fs/promises';

async function createLibraryFile(root: string, relativePath: string, content = '{}'): Promise<string> {
  const absolutePath = join(root, ...relativePath.split('/'));
  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, content, 'utf8');
  return absolutePath;
}

async function createResolverFixture() {
  const root = await mkdtemp(join(tmpdir(), 'runtime-preview-resolver-'));
  const projectLibraryRoot = join(root, 'project-library');
  const extensionLibraryRoot = join(root, 'extension-library');
  const internalLibraryRoot = join(root, 'internal-library');
  await mkdir(projectLibraryRoot, { recursive: true });
  await mkdir(extensionLibraryRoot, { recursive: true });
  await mkdir(internalLibraryRoot, { recursive: true });
  const context = createRuntimePreviewContext({
    projectRoot: root,
    engineRoot: join(root, 'engine'),
    projectLibraryRoot,
    extensionLibraryRoots: [{ name: 'view-state-group', root: extensionLibraryRoot }],
    internalLibraryRoot,
    projectProgrammingRoot: join(root, 'temp', 'cli', 'programming'),
  });
  return { root, projectLibraryRoot, extensionLibraryRoot, internalLibraryRoot, context };
}
```

- [ ] **Step 2: Add failing tests for unified namespace lookup**

Add these tests:

```ts
it('serves non-general import requests by tail from project library root', async () => {
  const { context, projectLibraryRoot } = await createResolverFixture();
  await createLibraryFile(projectLibraryRoot, '20/207a3957-d7e1-4fdb-8903-c63948195ada@f9941.json', '{"ok":true}');

  const resolved = await resolveLibraryRequest(
    context,
    '/assets/product/import/20/207a3957-d7e1-4fdb-8903-c63948195ada@f9941.json',
  );

  expect(resolved?.absolutePath).toBe(join(projectLibraryRoot, '20', '207a3957-d7e1-4fdb-8903-c63948195ada@f9941.json'));
});

it('serves extension library roots without deriving cli-extensions path in resolver', async () => {
  const { context, extensionLibraryRoot } = await createResolverFixture();
  await createLibraryFile(extensionLibraryRoot, 'aa/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.json', '{"extension":true}');

  const resolved = await resolveLibraryRequest(
    context,
    '/assets/view-state-group/import/aa/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.json',
  );

  expect(resolved?.absolutePath).toBe(join(extensionLibraryRoot, 'aa', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.json'));
});

it('does not map namespace or artifact kind into the physical path', async () => {
  const { context, projectLibraryRoot } = await createResolverFixture();
  await createLibraryFile(projectLibraryRoot, 'bb/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.json', '{"ok":true}');

  const resolved = await resolveLibraryRequest(
    context,
    '/assets/resources/import/bb/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.json',
  );

  expect(resolved?.absolutePath).toBe(join(projectLibraryRoot, 'bb', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.json'));
});
```

- [ ] **Step 3: Add failing tests for empty tail and minimal path safety**

Add these tests:

```ts
it('does not enter library file lookup for import or native base URLs', async () => {
  const { context } = await createResolverFixture();

  await expect(resolveLibraryRequest(context, '/assets/general/import/')).resolves.toBeNull();
  await expect(resolveLibraryRequest(context, '/assets/general/native/')).resolves.toBeNull();
});

it('rejects decoded traversal, backslash, drive, and absolute tails', async () => {
  const { context } = await createResolverFixture();

  await expect(resolveLibraryRequest(context, '/assets/general/import/%2e%2e/secret.json')).resolves.toBeNull();
  await expect(resolveLibraryRequest(context, '/assets/general/import/20%5csecret.json')).resolves.toBeNull();
  await expect(resolveLibraryRequest(context, '/assets/general/import/C%3a/secret.json')).resolves.toBeNull();
  await expect(resolveLibraryRequest(context, '/assets/general/import/%2fsecret.json')).resolves.toBeNull();
});
```

- [ ] **Step 4: Run focused test and verify failure**

Run:

```bat
npm --prefix vitests test -- suites/runtime-preview/on-demand-resolver.test.ts
```

Expected: FAIL because `RuntimePreviewContextOptions` lacks `extensionLibraryRoots`, non-general route still uses old authorization, and extension roots are not searched.

- [ ] **Step 5: Keep failing tests unstaged until implementation passes**

Do not commit this red state. Leave the failing tests in the worktree and continue to Task 2/4 so the first commit containing these tests is green.

---

### Task 2: Add Context and Server Extension Roots

**Files:**
- Modify: `src/runtime-preview/context/runtime-preview-context.ts`
- Modify: `src/runtime-preview/server/runtime-preview-server.ts`
- Modify: `vitests/suites/runtime-preview/cli-startup.test.ts`

- [ ] **Step 1: Add failing startup/health assertions**

In `vitests/suites/runtime-preview/cli-startup.test.ts`, add assertions to the existing server startup test:

```ts
expect(server.context.extensionLibraryRoots).toEqual([
  { name: 'view-state-group', root: join(paths.projectRoot, 'library', 'cli-extensions', 'view-state-group') },
]);

const health = await fetch(`${server.url}/__runtime-preview/health`).then((response) => response.json());
expect(health.extensionLibraryRoots).toEqual([
  { name: 'view-state-group', root: join(paths.projectRoot, 'library', 'cli-extensions', 'view-state-group') },
]);
expect(server.startupLogLines).toContain(
  `extensionLibraryRoots=view-state-group:${join(paths.projectRoot, 'library', 'cli-extensions', 'view-state-group')}`,
);
```

Pass the server option in the same test:

```ts
extensionLibraryRoots: [
  { name: 'view-state-group', root: join(paths.projectRoot, 'library', 'cli-extensions', 'view-state-group') },
],
```

- [ ] **Step 2: Run startup test and verify failure**

Run:

```bat
npm --prefix vitests test -- suites/runtime-preview/cli-startup.test.ts
```

Expected: FAIL because `startRuntimePreviewServer()` does not accept or expose `extensionLibraryRoots`.

- [ ] **Step 3: Update context types**

Modify `src/runtime-preview/context/runtime-preview-context.ts`:

```ts
export interface RuntimePreviewExtensionLibraryRoot {
    name: string;
    root: string;
}

export interface RuntimePreviewContextOptions {
    projectRoot: string;
    engineRoot: string;
    scene?: string;
    projectLibraryRoot: string;
    extensionLibraryRoots?: RuntimePreviewExtensionLibraryRoot[];
    internalLibraryRoot?: string;
    projectProgrammingRoot: string;
    cliProgrammingRoot?: string;
    editorLibraryRef?: string;
    editorProgrammingRef?: string;
}

export interface RuntimePreviewContext extends RuntimePreviewContextOptions {
    extensionLibraryRoots: RuntimePreviewExtensionLibraryRoot[];
    startupStrategy: 'lazy';
    preloadedLibraryFileCount: 0;
    preloadedProgrammingFileCount: 0;
}

export function createRuntimePreviewContext(options: RuntimePreviewContextOptions): RuntimePreviewContext {
    return {
        ...options,
        extensionLibraryRoots: options.extensionLibraryRoots ?? [],
        startupStrategy: 'lazy',
        preloadedLibraryFileCount: 0,
        preloadedProgrammingFileCount: 0,
    };
}
```

- [ ] **Step 4: Update server options, health, and startup logs**

Modify `src/runtime-preview/server/runtime-preview-server.ts`:

```ts
import type { RuntimePreviewExtensionLibraryRoot } from '../context/runtime-preview-context';

export interface RuntimePreviewServerOptions {
    projectRoot: string;
    engineRoot: string;
    projectLibraryRoot: string;
    extensionLibraryRoots?: RuntimePreviewExtensionLibraryRoot[];
    projectProgrammingRoot: string;
    cliProgrammingRoot?: string;
    internalLibraryRoot?: string;
    host?: string;
    port?: number;
    scene?: string;
    settingsProvider?: PreviewSettingsProvider;
    settingsBuildOptions?: Record<string, any>;
    capturedRuntimeUrls?: Array<{ url: string }>;
}
```

Pass the roots into context:

```ts
const context = createRuntimePreviewContext({
    projectRoot: options.projectRoot,
    engineRoot: options.engineRoot,
    scene: options.scene,
    projectLibraryRoot: options.projectLibraryRoot,
    extensionLibraryRoots: options.extensionLibraryRoots,
    projectProgrammingRoot: options.projectProgrammingRoot,
    cliProgrammingRoot: options.cliProgrammingRoot,
    internalLibraryRoot: options.internalLibraryRoot,
});
```

Add a deterministic log line:

```ts
const extensionRootSummary = context.extensionLibraryRoots
    .map((entry) => `${entry.name}:${entry.root}`)
    .join(';');
const startupLogLines = [
    `projectRoot=${context.projectRoot}`,
    `engineRoot=${context.engineRoot}`,
    `projectLibraryRoot=${context.projectLibraryRoot}`,
    `extensionLibraryRoots=${extensionRootSummary}`,
    `projectProgrammingRoot=${context.projectProgrammingRoot}`,
    `cliProgrammingRoot=${context.cliProgrammingRoot ?? ''}`,
    `internalLibraryRoot=${context.internalLibraryRoot ?? ''}`,
];
```

Add health field:

```ts
extensionLibraryRoots: context.extensionLibraryRoots,
```

- [ ] **Step 5: Run startup test and verify pass**

Run:

```bat
npm --prefix vitests test -- suites/runtime-preview/cli-startup.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit context/server roots**

```bat
git add src/runtime-preview/context/runtime-preview-context.ts src/runtime-preview/server/runtime-preview-server.ts vitests/suites/runtime-preview/cli-startup.test.ts
git commit -m "feat(runtime-preview): plumb extension library roots"
```

---

### Task 3: Resolve Extension Roots in Launcher

**Files:**
- Create: `src/core/assets/extension-asset-db-mounts.ts`
- Modify: `src/core/assets/asset-config.ts`
- Modify: `src/core/launcher.ts`
- Modify: `vitests/suites/runtime-preview/cli-generated-output-integration.test.ts`

- [ ] **Step 1: Add failing launcher integration assertions**

In `vitests/suites/runtime-preview/cli-generated-output-integration.test.ts`, extend the health response type:

```ts
extensionLibraryRoots: Array<{ name: string; root: string }>;
```

In the production-like CLI startup assertion, add:

```ts
const expectedExtensionLibraryRoot = join(
  paths.projectRoot,
  'library',
  'cli-extensions',
  'view-state-group',
);

expect(health.extensionLibraryRoots).toContainEqual({
  name: 'view-state-group',
  root: expectedExtensionLibraryRoot,
});
expect(normalizedStdout).toContain(`extensionLibraryRoots=view-state-group:${slash(expectedExtensionLibraryRoot)}`);
```

- [ ] **Step 2: Run launcher integration test and verify failure**

Run:

```bat
npm --prefix vitests test -- suites/runtime-preview/cli-generated-output-integration.test.ts
```

Expected: FAIL because launcher does not resolve extension library roots.

- [ ] **Step 3: Extract shared extension mount resolver**

Create `src/core/assets/extension-asset-db-mounts.ts`:

```ts
import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';

export interface ProjectExtensionAssetDbMount {
    name: string;
    target: string;
    library: string;
    readonly: boolean;
    visible: boolean;
}

export function resolveProjectExtensionAssetDbMounts(projectRoot: string): ProjectExtensionAssetDbMount[] {
    const extensionsDir = join(projectRoot, 'extensions');
    if (!existsSync(extensionsDir)) {
        return [];
    }

    const mounts: ProjectExtensionAssetDbMount[] = [];
    for (const entry of readdirSync(extensionsDir, { withFileTypes: true })) {
        if (!entry.isDirectory()) {
            continue;
        }
        const packageJsonPath = join(extensionsDir, entry.name, 'package.json');
        if (!existsSync(packageJsonPath)) {
            continue;
        }
        try {
            const pkgJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
                name?: string;
                contributions?: {
                    'asset-db'?: {
                        mount?: {
                            path?: string;
                        };
                    };
                };
            };
            const mountPath = pkgJson.contributions?.['asset-db']?.mount?.path;
            if (!mountPath) {
                continue;
            }
            const mountTarget = join(extensionsDir, entry.name, mountPath);
            if (!existsSync(mountTarget)) {
                continue;
            }
            const extensionName = pkgJson.name || entry.name;
            mounts.push({
                name: extensionName,
                target: mountTarget,
                readonly: pkgJson.contributions?.['asset-db']?.mount?.readonly ?? true,
                visible: pkgJson.contributions?.['asset-db']?.mount?.visible ?? false,
                library: join(projectRoot, 'library', 'cli-extensions', extensionName),
            });
        } catch {
            // Invalid extension package.json is ignored, matching AssetDB config scanning.
        }
    }

    return mounts;
}
```

Modify `src/core/assets/asset-config.ts` to replace its inline extension scan with:

```ts
for (const mount of resolveProjectExtensionAssetDbMounts(this._assetConfig.root)) {
    this._assetConfig.assetDBList.push({
        name: mount.name,
        target: mount.target,
        readonly: mount.readonly,
        visible: mount.visible,
        library: mount.library,
    });
}
```

Import the helper:

```ts
import { resolveProjectExtensionAssetDbMounts } from './extension-asset-db-mounts';
```

- [ ] **Step 4: Use shared extension roots in launcher**

Modify `src/core/launcher.ts`:

```ts
const { resolveProjectExtensionAssetDbMounts } = await import('./assets/extension-asset-db-mounts');
const extensionLibraryRoots = resolveProjectExtensionAssetDbMounts(this.projectPath).map((mount) => ({
    name: mount.name,
    root: mount.library,
}));
```

Pass to server:

```ts
extensionLibraryRoots,
```

Include in active output summary:

```ts
extensionLibraryRoots: extensionLibraryRoots.map((entry) => `${entry.name}:${entry.root}`).join(';'),
```

- [ ] **Step 5: Run launcher integration test and verify pass**

Run:

```bat
npm --prefix vitests test -- suites/runtime-preview/cli-generated-output-integration.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit shared extension root resolution**

```bat
git add src/core/assets/extension-asset-db-mounts.ts src/core/assets/asset-config.ts src/core/launcher.ts vitests/suites/runtime-preview/cli-generated-output-integration.test.ts
git commit -m "feat(runtime-preview): resolve extension library roots in launcher"
```

---

### Task 4: Implement Unified Library File Resolver

**Files:**
- Modify: `src/runtime-preview/library/resolve-library-request.ts`
- Modify: `vitests/suites/runtime-preview/on-demand-resolver.test.ts`

- [ ] **Step 1: Replace route parsing with raw-tail based parser**

Modify `src/runtime-preview/library/resolve-library-request.ts`:

```ts
import { isAbsolute, join, relative, resolve } from 'node:path';
```

Replace `decodePathname()` and `parseLibraryRoute()` with a raw pathname parser. Do not use `new URL(...).pathname` in this resolver, because WHATWG URL normalizes `.` / `..` path segments before `tail` validation and can turn `/assets/general/import/a/../secret.json` into `/assets/general/import/secret.json`.

```ts
function getRawUrlPathname(requestPath: string): string | null {
    if (requestPath.includes('\0')) {
        return null;
    }

    let pathname = requestPath.split('#', 1)[0].split('?', 1)[0];
    const absoluteUrlMatch = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^/]*(.*)$/.exec(pathname);
    if (absoluteUrlMatch) {
        pathname = absoluteUrlMatch[1] || '/';
    }
    if (!pathname.startsWith('/')) {
        return null;
    }
    return pathname;
}

function parseLibraryRoute(requestPath: string): LibraryRoute | null {
    const pathname = getRawUrlPathname(requestPath);
    if (!pathname) {
        return null;
    }

    const match = /^\/(?:assets|remote)\/([^/]+)\/(import|native)(?:\/(.*))?$/.exec(pathname);
    if (!match) {
        return null;
    }
    if (!match[3]) {
        return null;
    }

    let tail = '';
    try {
        tail = decodeURIComponent(match[3]);
    } catch {
        return null;
    }
    if (!isSafeLibraryTail(tail)) {
        return null;
    }

    return {
        bundleName: match[1],
        artifactKind: match[2] as 'import' | 'native',
        tail,
    };
}

function isSafeLibraryTail(tail: string): boolean {
    if (!tail || tail.includes('\0') || tail.includes('\\')) {
        return false;
    }
    if (isAbsolute(tail) || /^[a-zA-Z]:/.test(tail) || tail.startsWith('//')) {
        return false;
    }
    const segments = tail.split('/');
    return segments.every((segment) => segment !== '' && segment !== '.' && segment !== '..');
}
```

- [ ] **Step 2: Replace root list with explicit context roots**

Add helper:

```ts
function getLibraryLookupRoots(context: RuntimePreviewContext): string[] {
    return Array.from(new Set([
        context.projectLibraryRoot,
        ...context.extensionLibraryRoots.map((entry) => entry.root),
        context.internalLibraryRoot,
    ].filter((value): value is string => Boolean(value))));
}
```

Replace lookup roots inside `resolveLibraryRequest()`:

```ts
for (const root of getLibraryLookupRoots(context)) {
    const rootAbs = resolve(root);
    const candidate = resolve(rootAbs, ...route.tail.split('/'));
    const rootRelativePath = relative(rootAbs, candidate);
    if (rootRelativePath === '' || rootRelativePath.startsWith('..') || isAbsolute(rootRelativePath)) {
        continue;
    }
    try {
        const candidateStat = await stat(candidate);
        if (candidateStat.isFile()) {
            return { absolutePath: candidate };
        }
    } catch {
        // Try next explicit root.
    }
}
return null;
```

- [ ] **Step 3: Stop using production metadata allow-list for library file routes**

In `resolveLibraryRequest()`, keep `allowedRequestPaths` strict only when `options.allowedRequestPaths` is provided:

```ts
if (options.allowedRequestPaths && !(await isAllowedRequestPath(context, requestPath, options))) {
    return null;
}
```

Delete the production branch that requires `bundleConfigs[<bundle>].paths` when `allowedRequestPaths` is absent. After this change, the only authorization gate before direct lookup is:

```ts
if (options.allowedRequestPaths && !(await isAllowedRequestPath(context, requestPath, options))) {
    return null;
}
```

Also remove the server-layer production dependency on settings generation for library file routes. `handleRuntimePreviewRequest()` must pass only `capturedRuntimeUrls` as `allowedRequestPaths` when capture mode exists; when `capturedRuntimeUrls` is absent it must call `resolveLibraryRequest()` without calling `settingsProvider.getPreviewSettings()` only to fetch `bundleConfigs`.

- [ ] **Step 4: Keep metadata functions diagnostic-only or remove dead production gate**

If `isAssetDataBackedGeneralRequest()`, `getMetadataRoots()`, and related proof cache are no longer called by production resolver, either remove them or leave them only behind diagnostic code paths. The resolver must not call:

```ts
isAssetDataBackedGeneralRequest(context, route)
```

to decide whether to serve a file.

- [ ] **Step 5: Run resolver test and verify pass**

Run:

```bat
npm --prefix vitests test -- suites/runtime-preview/on-demand-resolver.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit resolver change**

```bat
git add src/runtime-preview/library/resolve-library-request.ts vitests/suites/runtime-preview/on-demand-resolver.test.ts
git commit -m "fix(runtime-preview): serve runtime library file routes by tail"
```

---

### Task 5: Update HTTP Route Contracts

**Files:**
- Modify: `vitests/suites/runtime-preview/preview-app-route-contract.test.ts`
- Modify: `vitests/suites/runtime-preview/http-contract.test.ts`
- Modify: `src/runtime-preview/server/runtime-preview-routes.ts`

- [ ] **Step 1: Add HTTP contract tests for non-general and extension roots**

In `vitests/suites/runtime-preview/preview-app-route-contract.test.ts`, add tests:

```ts
it('serves non-general import URL from library tail without physical namespace directory', async () => {
  const projectLibraryRoot = join(paths.projectRoot, 'library', 'http-contract-project');
  await mkdir(join(projectLibraryRoot, '20'), { recursive: true });
  await writeFile(join(projectLibraryRoot, '20', '207a3957-d7e1-4fdb-8903-c63948195ada@f9941.json'), '{"ok":true}', 'utf8');

  const server = await startRuntimePreviewServer({
    projectRoot: paths.projectRoot,
    engineRoot: paths.engineRoot,
    projectLibraryRoot,
    projectProgrammingRoot: join(paths.editorProgrammingRef, 'programming'),
    internalLibraryRoot: join(paths.engineRoot, 'editor', 'library'),
    settingsProvider: new PreviewSettingsProvider({
      loadPreviewSettings: async () => ({
        settings: { assets: {}, launch: {} },
        script2library: {},
        bundleConfigs: [],
      }),
    }),
  });
  try {
    const response = await fetch(`${server.url}/assets/product/import/20/207a3957-d7e1-4fdb-8903-c63948195ada@f9941.json`);
    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe('{"ok":true}');
  } finally {
    await server.close();
  }
});

it('serves extension library files from explicit extension roots', async () => {
  const projectLibraryRoot = join(paths.projectRoot, 'library', 'http-contract-project-empty');
  const extensionRoot = join(paths.projectRoot, 'library', 'http-contract-extension');
  await mkdir(join(extensionRoot, 'aa'), { recursive: true });
  await writeFile(join(extensionRoot, 'aa', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.json'), '{"extension":true}', 'utf8');

  const server = await startRuntimePreviewServer({
    projectRoot: paths.projectRoot,
    engineRoot: paths.engineRoot,
    projectLibraryRoot,
    extensionLibraryRoots: [{ name: 'view-state-group', root: extensionRoot }],
    projectProgrammingRoot: join(paths.editorProgrammingRef, 'programming'),
    internalLibraryRoot: join(paths.engineRoot, 'editor', 'library'),
    settingsProvider: new PreviewSettingsProvider({
      loadPreviewSettings: async () => ({
        settings: { assets: {}, launch: {} },
        script2library: {},
        bundleConfigs: [],
      }),
    }),
  });
  try {
    const response = await fetch(`${server.url}/assets/view-state-group/import/aa/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.json`);
    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe('{"extension":true}');
  } finally {
    await server.close();
  }
});
```

- [ ] **Step 2: Add `/query-extname` extension root coverage**

In `vitests/suites/runtime-preview/http-contract.test.ts`, add:

```ts
it('query-extname checks extension roots', async () => {
  const extensionRoot = join(paths.projectRoot, 'library', 'query-extname-extension');
  const uuid = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  await mkdir(join(extensionRoot, uuid.slice(0, 2)), { recursive: true });
  await writeFile(join(extensionRoot, uuid.slice(0, 2), `${uuid}.cconb`), 'payload', 'utf8');

  const server = await startRuntimePreviewServer({
    projectRoot: paths.projectRoot,
    engineRoot: paths.engineRoot,
    projectLibraryRoot: paths.editorLibraryRef,
    extensionLibraryRoots: [{ name: 'view-state-group', root: extensionRoot }],
    projectProgrammingRoot: paths.editorProgrammingRef,
    internalLibraryRoot: join(paths.engineRoot, 'editor', 'library'),
    settingsProvider: new PreviewSettingsProvider({
      loadPreviewSettings: async () => ({
        settings: { assets: {}, launch: {} },
        script2library: {},
        bundleConfigs: [],
      }),
    }),
  });
  try {
    const response = await fetch(`${server.url}/query-extname/${uuid}`);
    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe('.cconb');
  } finally {
    await server.close();
  }
});
```

- [ ] **Step 3: Run route tests and verify failure**

Run:

```bat
npm --prefix vitests test -- suites/runtime-preview/preview-app-route-contract.test.ts suites/runtime-preview/http-contract.test.ts
```

Expected: FAIL because `queryImportReplacementExtension()` currently checks only `context.projectLibraryRoot` and `context.internalLibraryRoot`; the new extension-root `.cconb` file is not found.

- [ ] **Step 4: Update query-extname root list**

Modify `src/runtime-preview/server/runtime-preview-routes.ts`:

```ts
function getImportPayloadLookupRoots(context: RuntimePreviewContext): string[] {
    return Array.from(new Set([
        context.projectLibraryRoot,
        ...context.extensionLibraryRoots.map((entry) => entry.root),
        context.internalLibraryRoot,
    ].filter((value): value is string => Boolean(value))));
}
```

Change `queryImportReplacementExtension()` loop:

```ts
for (const root of getImportPayloadLookupRoots(context)) {
    const bucket = join(root, uuid.slice(0, 2));
    for (const extension of ['.cconb', '.ccon']) {
        try {
            const fileStat = await stat(join(bucket, `${uuid}${extension}`));
            if (fileStat.isFile()) {
                return extension;
            }
        } catch {
            // Try the next import payload extension candidate.
        }
    }
}
```

- [ ] **Step 5: Run route tests and verify pass**

Run:

```bat
npm --prefix vitests test -- suites/runtime-preview/preview-app-route-contract.test.ts suites/runtime-preview/http-contract.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit route contracts**

```bat
git add src/runtime-preview/server/runtime-preview-routes.ts vitests/suites/runtime-preview/preview-app-route-contract.test.ts vitests/suites/runtime-preview/http-contract.test.ts
git commit -m "test(runtime-preview): cover non-general and extension asset routes"
```

---

### Task 6: Update Browser Diagnostics and Timeouts

**Files:**
- Modify: `vitests/shared/browser-runtime-smoke.ts`
- Modify: `vitests/scripts/listen-existing-preview-url.mjs`
- Modify: `vitests/scripts/runtime-preview-feature-c-diagnose.ts`

- [ ] **Step 1: Add unhandled rejection tracking to browser smoke**

Modify `BrowserRuntimeSmokeResult` in `vitests/shared/browser-runtime-smoke.ts`:

```ts
export interface BrowserRuntimeSmokeResult {
  ready: unknown;
  initialReady?: unknown;
  elapsedReadyMs: number;
  elapsedTotalMs: number;
  networkRequestCount: number;
  consoleErrors: BrowserConsoleMessage[];
  pageErrors: string[];
  unhandledRejections: string[];
  failedRequests: BrowserNetworkFailure[];
  badResponses: BrowserNetworkResponse[];
}
```

Before navigation, inject a listener for every new document:

```ts
const unhandledRejections: string[] = [];
await send(session, 'Page.addScriptToEvaluateOnNewDocument', {
  source: `
    window.addEventListener('unhandledrejection', (event) => {
      const reason = event.reason && (event.reason.stack || event.reason.message || String(event.reason));
      console.error('[runtime-preview-unhandledrejection] ' + reason);
    });
  `,
});
```

When collecting console errors, also classify:

```ts
if (params.type === 'error') {
  const text = consoleText(params);
  if (text.includes('[runtime-preview-unhandledrejection]')) {
    unhandledRejections.push(text);
  } else {
    consoleErrors.push({ type: params.type, text });
  }
}
```

Include `unhandledRejections` in success and failure evidence objects, and add:

```ts
if (unhandledRejections.length > 0) {
  throw new Error(`fail-browser-host-boundary: unhandled rejections: ${unhandledRejections.join('\n')}`);
}
```

Place this check before the generic `consoleErrors.length > 0` check.

- [ ] **Step 2: Update listen script evidence**

Modify `vitests/scripts/listen-existing-preview-url.mjs`:

```js
const unhandledRejections = [];

page.on('console', (message) => {
  if (message.type() === 'error' && message.text().includes('[runtime-preview-unhandledrejection]')) {
    unhandledRejections.push(message.text());
  }
});

await page.addInitScript(() => {
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason && (event.reason.stack || event.reason.message || String(event.reason));
    console.error(`[runtime-preview-unhandledrejection] ${reason}`);
  });
});
```

Place `page.addInitScript()` before the script calls `page.goto(url, ...)`.

Include `unhandledRejections` in the evidence JSON and summary:

```js
unhandledRejections,
unhandledRejections: unhandledRejections.length,
```

- [ ] **Step 3: Update feature-c diagnose default windows**

Modify `vitests/scripts/runtime-preview-feature-c-diagnose.ts`:

```ts
const readyTimeoutMs = Number(process.env.COCOS_CLI_FEATURE_C_READY_TIMEOUT_MS ?? 600_000);
const stableWindowMs = Number(process.env.COCOS_CLI_FEATURE_C_STABLE_WINDOW_MS ?? 300_000);
```

- [ ] **Step 4: Run browser smoke related tests**

Run:

```bat
npm --prefix vitests test -- suites/runtime-preview/browser-runtime-smoke.test.ts
```

Expected: PASS.

- [ ] **Step 5: Run TypeScript build to catch script type errors**

Run:

```bat
npm run build
```

Expected: PASS.

- [ ] **Step 6: Commit diagnostics changes**

```bat
git add vitests/shared/browser-runtime-smoke.ts vitests/scripts/listen-existing-preview-url.mjs vitests/scripts/runtime-preview-feature-c-diagnose.ts
git commit -m "test(runtime-preview): record browser unhandled rejections"
```

---

### Task 7: Full Runtime Preview Test Pass

**Files:**
- No source edits expected.
- Evidence target: `docs/dev/runtime-preview/acceptance/feedback-20260609.md` or a new dated evidence doc.

- [ ] **Step 1: Run full runtime-preview suite**

Run:

```bat
npm --prefix vitests test -- suites/runtime-preview
```

Expected: PASS.

- [ ] **Step 2: Run full build**

Run:

```bat
npm run build
```

Expected: PASS.

- [ ] **Step 3: Start feature-c runtime preview**

Run:

```powershell
node E:\own_space\engines\cocos-cli\dist\cli.js preview --runtime --project D:\ps_copy\p6\trunk\Project\GameClient\feature-c --host 127.0.0.1 --port 19530
```

Expected stdout includes:

```text
[runtime-preview] server:listening http://127.0.0.1:19530
[runtime-preview] preview:ready
```

- [ ] **Step 4: Listen to feature-c exact scene**

In a separate terminal, run:

$env:COCOS_CLI_LISTEN_PREVIEW_URL='http://127.0.0.1:19530/?scene=4c721bfe-0b6e-46c2-97f0-644adfdcba31'
$env:COCOS_CLI_LISTEN_READY_TIMEOUT_MS='600000'
$env:COCOS_CLI_LISTEN_STABLE_WINDOW_MS='300000'
$env:COCOS_CLI_LISTEN_EVIDENCE='D:\ps_copy\p6\trunk\Project\GameClient\feature-c\temp\runtime-preview-exact-scene-4c721bfe-browser-evidence.json'
npm --prefix E:\own_space\engines\cocos-cli\vitests run listen:preview-url
```

Expected summary:

```text
ready=true
sameOriginFailedRequests=0
sameOriginBadResponses=0
pageErrors=0
unhandledRejections=0
```

- [ ] **Step 5: Run restart-and-diagnose path**

Run:

```powershell
$env:COCOS_CLI_FEATURE_C_ENGINE_ROOT='D:/workspace/engines/cocos/3.8.6'
$env:COCOS_CLI_FEATURE_C_PROJECT_ROOT='D:/ps_copy/p6/trunk/Project/GameClient/feature-c'
$env:COCOS_CLI_FEATURE_C_SCENE='4c721bfe-0b6e-46c2-97f0-644adfdcba31'
$env:COCOS_CLI_FEATURE_C_STARTUP_TIMEOUT_MS='600000'
$env:COCOS_CLI_FEATURE_C_READY_TIMEOUT_MS='600000'
$env:COCOS_CLI_FEATURE_C_STABLE_WINDOW_MS='300000'
$env:COCOS_CLI_FEATURE_C_EVIDENCE='D:\ps_copy\p6\trunk\Project\GameClient\feature-c\temp\runtime-preview-feature-c-core-flow-evidence.json'
npm --prefix E:\own_space\engines\cocos-cli\vitests run diagnose:feature-c
```

Expected: strict acceptance exits `0` only when ready succeeds and `pageErrors` / `unhandledRejections` / same-origin failed requests / same-origin bad responses / `console.error` are all empty. If any strict field is non-empty, the command must exit `1` after writing evidence.

- [ ] **Step 6: Update evidence doc**

Append a dated evidence section to `docs/dev/runtime-preview/acceptance/feedback-20260609.md`:

```md
## 2026-06-10 core flow implementation evidence

- `npm --prefix vitests test -- suites/runtime-preview`: record actual result.
- `npm run build`: record actual result.
- feature-c exact scene:
  - scene: `4c721bfe-0b6e-46c2-97f0-644adfdcba31`
  - ready timeout: `600000`
  - stable window: `300000`
  - same-origin failed requests: `0`
  - same-origin bad responses: `0`
  - page errors: `0`
  - unhandled rejections: `0`
  - console errors: record actual count; non-zero means strict acceptance failed.
  - evidence: `D:\ps_copy\p6\trunk\Project\GameClient\feature-c\temp\runtime-preview-feature-c-core-flow-evidence.json`
```

Use the same evidence path passed through `COCOS_CLI_FEATURE_C_EVIDENCE`.

- [ ] **Step 7: Commit evidence**

```bat
git add docs/dev/runtime-preview/acceptance/feedback-20260609.md
git commit -m "docs(runtime-preview): record core flow evidence"
```

---

## Self-Review

- Spec coverage:
  - Unified `/assets/<namespace>/(import|native)/<tail>` direct lookup: Tasks 1, 4, 5.
  - No physical namespace path: Tasks 1, 4, 5.
  - Extension roots: Tasks 1, 2, 3, 5.
  - Old production allow-list superseded: Task 4.
  - Current Cocos script loading preserved: Task 6 and Task 7 verify through browser runtime; `preview-app` loads the packer-driver generated global prerequisite module before scene JSON, without scene-level dependency graph computation.
  - Ready timeout and stable observation: Tasks 6 and 7.
  - Feature-c path `D:\ps_copy\p6\trunk\Project\GameClient\feature-c`: Task 7.
- Placeholder scan:
  - Plan steps contain concrete file paths, commands, and code snippets.
- Type consistency:
  - `RuntimePreviewExtensionLibraryRoot`, `extensionLibraryRoots`, and `RuntimePreviewContextOptions` names are consistent across context, server, launcher, and tests.
## 2026-06-11 Execution Note: internal root

`Launcher.startRuntimePreview()` must resolve `internalLibraryRoot` before creating `RuntimePreviewContext`:

1. If `<project>/library/.internal-data.json` exists, pass `internalLibraryRoot=<project>/library`.
2. Otherwise pass `internalLibraryRoot=<engineRoot>/editor/library`.

This does not change resolver rules. `resolveLibraryRequest()` still only looks at explicit context roots and must not derive `<project>/library` internally. The reason is factual: the current engine source internal library has `default_sprite_splash@6c48a` with `content:null`, while the active project internal library has the runtime-ready `Texture2D` JSON.

## 2026-06-11 Execution Note: prerequisite imports

`preview-app` must explicitly wait for `System.import('cce:/internal/x/prerequisite-imports')` after `cc.game.init(option)` and before `cc.assetManager.loadWithJson()`.

This is not scene dependency preloading. The module is generated by Cocos packer-driver and exposed through preview `import-map.json`; it is the global project script registration entry for runtime preview. Runtime preview validates that every `__unresolved_N` referenced by the generated prerequisite chunk has a matching `./chunks/**.js` entry in `import-map.json#scopes`, but it does not directly import those scope chunks outside the generated prerequisite module. Individual script failures remain isolated by the generated tentative module; a failure to import the prerequisite module itself must fail-fast because it means the programming/import-map route chain is broken.

## 2026-06-11 Execution Note: feature-c CommonJS fallback and E2E

`feature-c` has a platform-only CommonJS dependency:

```text
assets/first_screen/thinking_analytics/tdanalytics.mg.cocoscreator.min.js
require("@tbmp/mp-cloud-sdk")
```

The package is not resolvable from project `node_modules`, and `build-templates/bytedance-mini-game/package.json` does not declare it. Runtime preview must not maintain a package allow-list or require `--script-stub`. The correct recovery point is packer-driver / QuickPack resolver fallback for CommonJS bare specifiers:

```bat
node E:\own_space\engines\cocos-cli\dist\cli.js preview --runtime --project D:\ps_copy\p6\trunk\Project\GameClient\feature-c --host 127.0.0.1 --port 19530
```

Rules:

- Fallback only applies when `moduleType === 'commonjs'` and `isBareSpecifier(specifier) === true`.
- The fallback module is a `data:text/javascript` module that exports `__cjsMetaURL`.
- The resolver error is recorded in `resolution-detail-map.json`; it is not silently swallowed.
- No runtime preview package allow-list.
- No `--script-stub`.
- No `/runtime-preview-stubs/*` route.
- Normal build and project `script.importMap` are not changed.

2026-06-11 correction: both explicit opt-in stub and default known stub were wrong directions. They reintroduced package-specific policy into runtime preview. Current startup also treats `asset-db:script-compile:error` as report-only and emits `asset-db:script-compile:report-only source=asset-db:script-compile:error` instead of failing before browser diagnostics.

Historical observation on 2026-06-11 before the internal physics builtinAssets fix:

- `asset-db:script-compile:done durationMs=414375 count=3259`
- `programming:stale-records:clear modules=3247`
- `programming:prerequisite-scope required=3242 mapped=3242 missing=0`
- `preview:ready durationMs=501417`
- browser evidence: `readyTimedOut=false`, `pageErrors=0`, `failedRequests=0`, `badResponses=0`, `previewLogBrowserErrors=0`, but `consoleMessages` contains 1 `error` from `[Physics] PhysicsSystem initDefaultMaterial() Failed to load builtinMaterial.`

Conclusion at that time: the core route/script/scene-ready chain reached browser ready, but strict feature-c acceptance was not complete because `console.error` was non-zero.

Updated verification on 2026-06-11 after adding internal `physicsConfig.defaultMaterial` to `settings.engine.builtinAssets`:

- `builtinAssets=24`
- `hasDefaultPhysicsMaterial=true`
- `readyTimedOut=false`
- `pageErrors=0`
- `failedRequests=0`
- `badResponses=0`
- `strictAcceptanceFailures=0`
- `previewLogBrowserErrors=0`

Current conclusion: `feature-c` strict acceptance passes for scene `4c721bfe-0b6e-46c2-97f0-644adfdcba31`.

Residual risk: feature-c worktree currently has many `assets/**/*.meta` modifications. This plan did not solve source `.meta` write prevention because the user explicitly deferred it to keep focus on core flow.
