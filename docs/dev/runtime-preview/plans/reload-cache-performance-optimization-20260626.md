# Runtime Preview Reload Cache Performance Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce `preview --runtime` warm-cache reload all-resource completion time toward Editor preview parity without regressing HTTP cache correctness or `feature-c` resource-limit protection.

**Architecture:** Treat `RP-ISSUE-026` as a measured performance issue, not a status-code issue. First preserve reproducible resource-completion diagnostics, then evaluate fact-backed optimization candidates (`/query-extname/*` filesystem probing and auxiliary preview UI requests) with before/after bucket deltas, and only then consider adaptive script-load concurrency under `RP-ISSUE-022` constraints.

**Tech Stack:** TypeScript, Express-style runtime preview route contract, SystemJS preview app, Vitest, Playwright/CDP diagnostics, Cocos Creator 3.8.6 Editor preview facts.

---

## 执行状态（2026-06-26）

- Task 1 已完成：诊断脚本 `vitests/scripts/runtime-preview-resource-completion-diagnostics.mjs` 已落库，并用 schema / `node --check` 验证。
- Task 2 已完成：`/query-extname/<uuid>` 已改为 server 生命周期内 cache，并通过 focused cache tests 与 route contract 验证。
- Task 3 已完成：`/scene-list` 已从 bootstrap 前热路径延后到 bootstrap settled 之后，并通过 browser entry contract 验证。
- Task 4 已完成：主测试项目在 `19657` 端口复测，原始结果为 `.codex-tmp/resource-completion-after-task3.json`；稳定 warm-cache round 2-5 的 `resourceResponseEndMs` median 为 `1089ms`，较 Task 2 / Task 3 前 `2323ms` 改善约 `1234ms`。
- Task 5 按计划停止：已超过 `300ms` 改善目标，且当前 CLI 稳定 warm-cache median 已低于同日 Editor preview median `1572ms`；本轮不推进 adaptive script-load concurrency 默认策略。
- Commit 步骤未执行：当前只完成实现、验证和文档回填，未按用户要求提交。

---

## Preconditions

- Read `docs/dev/testing-spec.md` and `docs/dev/runtime-preview/testing-spec.md` before implementation.
- Use `E:\own_space\engines\cocos-test-projects` as the main test project.
- Do not touch the user's `9528` server or unrelated local preview ports.
- Keep `RP-ISSUE-022` as a hard regression boundary: large chunk projects and disabled-cache runs must not reintroduce `net::ERR_INSUFFICIENT_RESOURCES`.
- Keep `RP-ISSUE-006` fixed: file responses must continue to support `ETag` / `Last-Modified` / conditional `304`.

## Current Facts

- Editor preview `http://localhost:7457/`:
  - `settings.js`: `splashScreen.totalTime=50`, `downloadMaxConcurrency=15`, `preloadBundles=[resources, main]`.
  - `/scripting/x/import-map.json`: `imports=235`, prerequisite scope dependencies `233`.
  - `/scene-list`: `404`; Editor preview does not expose the CLI scene selector route.
  - `/query-extname/<uuid>` uses `assetManager.queryAssetInfo(uuid)` in `src/core/scene/scene.middleware.ts`.
- CLI runtime preview:
  - Warm-cache wire status is already `304`; DevTools surface `200` is not sufficient evidence of repeated downloads.
  - After aligning browser splash to `50`, all-resource completion still shows CLI median `2323ms` vs Editor median `1572ms`.
  - Remaining drag is in `/assets/*`, `/query-extname/*`, `/scene/*.json`, and chunk import / instantiate ordering.
  - `/query-extname/<uuid>` currently performs filesystem `stat()` probes across project, extension, and internal library roots for `.cconb` / `.ccon`.
  - `/query-extname/*` cost has not been isolated; it is a fact-backed candidate, not a proven dominant cause.

## Non-Goals

- Do not remove the SystemJS load limiter by default.
- Do not claim Editor parity from route-contract tests alone.
- Do not change production cache invalidation or clean programming cache defaults to make a benchmark pass.
- Do not use frozen Editor references as the only acceptance evidence for real runtime behavior.

## Success Metrics

- Primary metric: warm reload `resourceResponseEndMs` median on the main test project.
- Target: reduce CLI median by at least `300ms`, or document evidence that the remaining difference is dominated by engine / assetManager behavior outside CLI route control.
- Required comparison: same script, same browser profile policy, same warm-up rule, 5 reload rounds minimum.
- Required status evidence: preserve both DevTools surface status and CDP wire status.

## Files

- Create: `src/runtime-preview/server/import-replacement-extension-cache.ts`
- Modify: `src/runtime-preview/server/runtime-preview-routes.ts`
- Modify: `src/runtime-preview/server/runtime-preview-server.ts`
- Modify: `static/runtime-preview/script.ejs`
- Modify: `vitests/suites/runtime-preview/preview-app-route-contract.test.ts`
- Modify: `vitests/suites/runtime-preview/browser-entry-contract.test.ts`
- Create: `vitests/suites/runtime-preview/import-replacement-extension-cache.test.ts`
- Create: `vitests/suites/runtime-preview/runtime-preview-resource-completion-diagnostics.test.ts`
- Create: `vitests/suites/runtime-preview/script-load-concurrency-policy.test.ts`
- Create: `vitests/scripts/runtime-preview-resource-completion-diagnostics.mjs`
- Create: `src/runtime-preview/server/script-load-concurrency-policy.ts`
- Modify: `docs/dev/runtime-preview/facts/reload-cache-performance-20260626.md`
- Modify: `docs/dev/runtime-preview/issues.md`

---

### Task 1: Add A Repeatable Resource-Completion Diagnostic Script

**Files:**
- Create: `vitests/scripts/runtime-preview-resource-completion-diagnostics.mjs`
- Create: `vitests/suites/runtime-preview/runtime-preview-resource-completion-diagnostics.test.ts`
- Modify: `docs/dev/runtime-preview/facts/reload-cache-performance-20260626.md`

- [ ] **Step 1: Add the diagnostic script contract**

Create `vitests/scripts/runtime-preview-resource-completion-diagnostics.mjs` with this CLI contract:

```js
#!/usr/bin/env node

import { writeFile } from 'node:fs/promises';

function parseArgs(argv) {
  const options = {
    rounds: 5,
    warmup: 1,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === '--url') {
      options.url = next;
      index += 1;
    } else if (arg === '--label') {
      options.label = next;
      index += 1;
    } else if (arg === '--output') {
      options.output = next;
      index += 1;
    } else if (arg === '--rounds') {
      options.rounds = Number(next);
      index += 1;
    } else if (arg === '--warmup') {
      options.warmup = Number(next);
      index += 1;
    }
  }
  if (!options.url || !options.label || !options.output || !Number.isInteger(options.rounds) || options.rounds < 1) {
    throw new Error('Usage: node vitests/scripts/runtime-preview-resource-completion-diagnostics.mjs --url <url> --label <label> --output <json> [--rounds 5] [--warmup 1]');
  }
  return options;
}

function summarize(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    min: sorted[0],
    median: sorted[Math.floor(sorted.length / 2)],
    max: sorted[sorted.length - 1],
  };
}

export function validateResourceCompletionResult(result) {
  const numericSummaryKeys = ['resourceResponseEndMs', 'sameOriginLastFinishMs', 'networkQuietMs'];
  for (const key of numericSummaryKeys) {
    for (const field of ['min', 'median', 'max']) {
      if (typeof result?.[key]?.[field] !== 'number' || !Number.isFinite(result[key][field])) {
        throw new Error(`Invalid ${key}.${field}`);
      }
    }
  }
  if (typeof result?.target !== 'string' || result.target.length === 0) {
    throw new Error('Invalid target');
  }
  if (!Number.isInteger(result?.rounds) || result.rounds < 1) {
    throw new Error('Invalid rounds');
  }
  if (!result.wireStatus || typeof result.wireStatus !== 'object') {
    throw new Error('Invalid wireStatus');
  }
  if (!result.surfaceStatus || typeof result.surfaceStatus !== 'object') {
    throw new Error('Invalid surfaceStatus');
  }
  if (!result.bucketMaxResponseEnd || typeof result.bucketMaxResponseEnd !== 'object') {
    throw new Error('Invalid bucketMaxResponseEnd');
  }
}

export function createSummary(target, rounds) {
  const result = {
    target,
    rounds: rounds.length,
    resourceResponseEndMs: summarize(rounds.map((round) => round.resourceResponseEndMs)),
    sameOriginLastFinishMs: summarize(rounds.map((round) => round.sameOriginLastFinishMs)),
    networkQuietMs: summarize(rounds.map((round) => round.networkQuietMs)),
    wireStatus: rounds.reduce((acc, round) => Object.assign(acc, round.wireStatus), {}),
    surfaceStatus: rounds.reduce((acc, round) => Object.assign(acc, round.surfaceStatus), {}),
    bucketMaxResponseEnd: rounds.reduce((acc, round) => Object.assign(acc, round.bucketMaxResponseEnd), {}),
    roundsRaw: rounds,
  };
  validateResourceCompletionResult(result);
  return result;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  page.addInitScript(() => performance.setResourceTimingBufferSize(5000));

  const rounds = [];
  try {
    for (let index = 0; index < options.warmup + options.rounds; index += 1) {
      const startedAt = Date.now();
      await page.goto(options.url, { waitUntil: 'load' });
      await page.waitForLoadState('networkidle');
      const resourceResponseEndMs = await page.evaluate(() => {
        const resources = performance.getEntriesByType('resource');
        return Math.max(0, ...resources.map((entry) => entry.responseEnd));
      });
      if (index >= options.warmup) {
        rounds.push({
          resourceResponseEndMs,
          sameOriginLastFinishMs: Date.now() - startedAt,
          networkQuietMs: Date.now() - startedAt,
          wireStatus: {},
          surfaceStatus: {},
          bucketMaxResponseEnd: {},
        });
      }
    }
  } finally {
    await browser.close();
  }

  const result = createSummary(options.label, rounds);
  await writeFile(options.output, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
}

if (import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}`) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
```

The first implementation may start with empty `wireStatus`, `surfaceStatus`, and `bucketMaxResponseEnd`, but Task 4 is not complete until those fields are populated from CDP and browser resource buckets. Do not accept a performance claim from a script that only records `page.goto()` timing.

- [ ] **Step 2: Add a schema test for saved diagnostic output**

Create `vitests/suites/runtime-preview/runtime-preview-resource-completion-diagnostics.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createSummary, validateResourceCompletionResult } from '../../scripts/runtime-preview-resource-completion-diagnostics.mjs';

describe('runtime preview resource completion diagnostics', () => {
  it('validates the resource completion result schema', () => {
    const result = createSummary('schema-sample', [
      {
        resourceResponseEndMs: 100,
        sameOriginLastFinishMs: 110,
        networkQuietMs: 1110,
        wireStatus: { 304: 10 },
        surfaceStatus: { 200: 1, 304: 9 },
        bucketMaxResponseEnd: { '/assets/*': 100 },
      },
      {
        resourceResponseEndMs: 200,
        sameOriginLastFinishMs: 210,
        networkQuietMs: 1210,
        wireStatus: { 304: 10 },
        surfaceStatus: { 304: 10 },
        bucketMaxResponseEnd: { '/assets/*': 200 },
      },
    ]);

    expect(result.resourceResponseEndMs).toEqual({ min: 100, median: 200, max: 200 });
    expect(() => validateResourceCompletionResult(result)).not.toThrow();
  });

  it('rejects missing timing fields', () => {
    expect(() => validateResourceCompletionResult({
      target: 'bad',
      rounds: 1,
      resourceResponseEndMs: { min: 1, median: 1, max: 1 },
      sameOriginLastFinishMs: { min: 1, median: 1, max: 1 },
      wireStatus: {},
      surfaceStatus: {},
      bucketMaxResponseEnd: {},
    })).toThrow('Invalid networkQuietMs.min');
  });
});
```

- [ ] **Step 3: Run the diagnostic schema test**

Run:

```powershell
rtk pwsh -NoProfile -Command "npm --prefix vitests run test -- suites/runtime-preview/runtime-preview-resource-completion-diagnostics.test.ts"
```

Expected: pass.

- [ ] **Step 4: Document the exact manual measurement command**

Append to `docs/dev/runtime-preview/facts/reload-cache-performance-20260626.md` under the measurement section:

```md
后续复测必须同时记录：

- `vitests/scripts/runtime-preview-resource-completion-diagnostics.mjs` 输出 JSON 路径；
- `performance.getEntriesByType('resource')` 的最大 `responseEnd`；
- CDP `Network.loadingFinished` 同源最后完成时间；
- DevTools surface status；
- CDP wire status；
- 每个 bucket 的 count 和最大 `responseEnd`。

事实文档必须记录 CLI 端口、Editor 端口、warm-up 策略、5 轮原始 JSON 路径和诊断脚本 git path。`.codex-tmp/` 只允许保存临时输出，不允许作为唯一脚本来源。
```

- [ ] **Step 5: Commit**

```powershell
rtk pwsh -NoProfile -Command "git add vitests/scripts/runtime-preview-resource-completion-diagnostics.mjs vitests/suites/runtime-preview/runtime-preview-resource-completion-diagnostics.test.ts docs/dev/runtime-preview/facts/reload-cache-performance-20260626.md; git commit -m 'test: add runtime preview resource completion diagnostics'"
```

---

### Task 2: Cache `/query-extname/*` Import Replacement Extension Lookups

**Files:**
- Create: `src/runtime-preview/server/import-replacement-extension-cache.ts`
- Modify: `src/runtime-preview/server/runtime-preview-routes.ts`
- Modify: `src/runtime-preview/server/runtime-preview-server.ts`
- Create: `vitests/suites/runtime-preview/import-replacement-extension-cache.test.ts`
- Modify: `vitests/suites/runtime-preview/preview-app-route-contract.test.ts`

- [ ] **Step 1: Write focused cache tests**

Create `vitests/suites/runtime-preview/import-replacement-extension-cache.test.ts`:

```ts
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { createRuntimePreviewContext } from '@runtime-preview/context/runtime-preview-context';
import { createImportReplacementExtensionResolver } from '@runtime-preview/server/import-replacement-extension-cache';

describe('runtime preview import replacement extension cache', () => {
  it('returns .cconb before .ccon and caches the result per uuid', async () => {
    const root = await mkdtemp(join(tmpdir(), 'runtime-preview-ext-cache-'));
    const uuid = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
    const bucket = join(root, uuid.slice(0, 2));
    await mkdir(bucket, { recursive: true });
    await writeFile(join(bucket, `${uuid}.cconb`), 'binary');
    await writeFile(join(bucket, `${uuid}.ccon`), 'json');

    const context = createRuntimePreviewContext({
      projectRoot: root,
      engineRoot: root,
      projectLibraryRoot: root,
      internalLibraryRoot: join(root, 'internal'),
      projectProgrammingRoot: join(root, 'programming'),
    });
    const resolver = createImportReplacementExtensionResolver(context);

    await expect(resolver.query(uuid)).resolves.toBe('.cconb');
    await rm(join(bucket, `${uuid}.cconb`));
    await expect(resolver.query(uuid)).resolves.toBe('.cconb');
  });

  it('checks project, extension, then internal library roots', async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'runtime-preview-ext-cache-order-'));
    const uuid = 'bbbbbbbb-bbbb-4ccc-8ddd-eeeeeeeeeeee';
    const projectRoot = join(tempRoot, 'project-library');
    const extensionRoot = join(tempRoot, 'cli-extensions', 'view-state-group');
    const internalRoot = join(tempRoot, 'internal');
    await mkdir(join(projectRoot, uuid.slice(0, 2)), { recursive: true });
    await mkdir(join(extensionRoot, uuid.slice(0, 2)), { recursive: true });
    await mkdir(join(internalRoot, uuid.slice(0, 2)), { recursive: true });
    await writeFile(join(projectRoot, uuid.slice(0, 2), `${uuid}.ccon`), 'project');
    await writeFile(join(extensionRoot, uuid.slice(0, 2), `${uuid}.ccon`), 'extension');
    await writeFile(join(internalRoot, uuid.slice(0, 2), `${uuid}.cconb`), 'internal');

    const context = createRuntimePreviewContext({
      projectRoot: tempRoot,
      engineRoot: tempRoot,
      projectLibraryRoot: projectRoot,
      extensionLibraryRoots: [{ name: 'view-state-group', root: extensionRoot }],
      internalLibraryRoot: internalRoot,
      projectProgrammingRoot: join(tempRoot, 'programming'),
    });
    const resolver = createImportReplacementExtensionResolver(context);

    await expect(resolver.query(uuid)).resolves.toBe('.ccon');
  });

  it('does not cache missing payloads', async () => {
    const root = await mkdtemp(join(tmpdir(), 'runtime-preview-ext-cache-miss-'));
    const uuid = 'cccccccc-cccc-4ccc-8ddd-eeeeeeeeeeee';
    const context = createRuntimePreviewContext({
      projectRoot: root,
      engineRoot: root,
      projectLibraryRoot: root,
      internalLibraryRoot: join(root, 'internal'),
      projectProgrammingRoot: join(root, 'programming'),
    });
    const resolver = createImportReplacementExtensionResolver(context);

    await expect(resolver.query('../bad')).resolves.toBe('');
    await expect(resolver.query(uuid)).resolves.toBe('');
    await mkdir(join(root, uuid.slice(0, 2)), { recursive: true });
    await writeFile(join(root, uuid.slice(0, 2), `${uuid}.ccon`), 'created after miss');
    await expect(resolver.query(uuid)).resolves.toBe('.ccon');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```powershell
rtk pwsh -NoProfile -Command "npm --prefix vitests run test -- suites/runtime-preview/import-replacement-extension-cache.test.ts"
```

Expected: fail because `@runtime-preview/server/import-replacement-extension-cache` does not exist.

- [ ] **Step 3: Implement the cache module**

Create `src/runtime-preview/server/import-replacement-extension-cache.ts`:

```ts
import { join } from 'node:path';
import { stat } from 'node:fs/promises';
import type { RuntimePreviewContext } from '../context/runtime-preview-context';

export interface ImportReplacementExtensionResolver {
    query(uuid: string): Promise<string>;
    clear(): void;
}

function getLookupRoots(context: RuntimePreviewContext): string[] {
    return Array.from(new Set([
        context.projectLibraryRoot,
        ...context.extensionLibraryRoots.map((entry) => entry.root),
        context.internalLibraryRoot,
    ].filter((value): value is string => Boolean(value))));
}

async function resolveImportReplacementExtension(context: RuntimePreviewContext, uuid: string): Promise<string> {
    if (!/^[0-9a-fA-F-]+$/.test(uuid)) {
        return '';
    }

    for (const root of getLookupRoots(context)) {
        const bucket = join(root, uuid.slice(0, 2));
        for (const extension of ['.cconb', '.ccon']) {
            try {
                const fileStat = await stat(join(bucket, `${uuid}${extension}`));
                if (fileStat.isFile()) {
                    return extension;
                }
            } catch {
                // Try the next payload extension candidate.
            }
        }
    }

    return '';
}

export function createImportReplacementExtensionResolver(
    context: RuntimePreviewContext,
): ImportReplacementExtensionResolver {
    const cache = new Map<string, Promise<string>>();
    return {
        query(uuid: string): Promise<string> {
            const cached = cache.get(uuid);
            if (cached) {
                return cached;
            }
            const result = resolveImportReplacementExtension(context, uuid);
            result.then((extension) => {
                if (extension) {
                    cache.set(uuid, Promise.resolve(extension));
                }
            }, () => {
                cache.delete(uuid);
            });
            return result;
        },
        clear(): void {
            cache.clear();
        },
    };
}
```

- [ ] **Step 4: Wire cache into runtime preview route context**

Modify `src/runtime-preview/server/runtime-preview-routes.ts`:

```ts
import {
    createImportReplacementExtensionResolver,
    type ImportReplacementExtensionResolver,
} from './import-replacement-extension-cache';
```

Extend `RuntimePreviewRouteContext`:

```ts
    importReplacementExtensionResolver?: ImportReplacementExtensionResolver;
```

Replace the `/query-extname/*` branch:

```ts
    const queryExtnameUuid = getQueryExtnameUuid(pathname);
    if (queryExtnameUuid) {
        const resolver = context.importReplacementExtensionResolver
            ?? createImportReplacementExtensionResolver(context.runtimeContext);
        return textResponse(200, await resolver.query(queryExtnameUuid));
    }
```

- [ ] **Step 5: Create one resolver per started server**

Modify `src/runtime-preview/server/runtime-preview-server.ts`:

```ts
import { createImportReplacementExtensionResolver } from './import-replacement-extension-cache';
```

After `context` is created:

```ts
    const importReplacementExtensionResolver = createImportReplacementExtensionResolver(context);
```

Pass it into every request:

```ts
            const routeResponse = await handleRuntimePreviewRequest({
                runtimeContext: context,
                settingsProvider: getSettingsProvider(),
                capturedRuntimeUrls: options.capturedRuntimeUrls,
                importReplacementExtensionResolver,
                logger,
                method: request.method,
                body: typeof request.body === 'string' ? request.body : undefined,
            }, request.originalUrl || request.url || '/');
```

This is the critical performance part: route-level fallback is only for tests and direct `handleRuntimePreviewRequest(...)` callers; production server must reuse the resolver for the full server lifetime.

- [ ] **Step 6: Add a server-lifetime reuse test**

Add a focused test to `vitests/suites/runtime-preview/preview-app-route-contract.test.ts` or a server contract suite:

```ts
it('reuses the import replacement extension resolver for the server lifetime', async () => {
  const paths = getFixturePaths();
  const uuid = 'dddddddd-dddd-4ccc-8ddd-eeeeeeeeeeee';
  const tempRoot = await mkdtemp(join(tmpdir(), 'runtime-preview-server-ext-cache-'));
  const projectLibraryRoot = join(tempRoot, 'project-library');
  await mkdir(join(projectLibraryRoot, uuid.slice(0, 2)), { recursive: true });
  await writeFile(join(projectLibraryRoot, uuid.slice(0, 2), `${uuid}.cconb`), 'binary');

  const resolver = createImportReplacementExtensionResolver(createRuntimePreviewContext({
    projectRoot: tempRoot,
    engineRoot: paths.engineRoot,
    projectLibraryRoot,
    internalLibraryRoot: join(tempRoot, 'internal'),
    projectProgrammingRoot: join(tempRoot, 'programming'),
  }));
  const routeContext = {
    ...createRouteContext(),
    runtimeContext: createRuntimePreviewContext({
      projectRoot: tempRoot,
      engineRoot: paths.engineRoot,
      projectLibraryRoot,
      internalLibraryRoot: join(tempRoot, 'internal'),
      projectProgrammingRoot: join(tempRoot, 'programming'),
    }),
    importReplacementExtensionResolver: resolver,
  };

  await expect(responseBodyText(await handleRuntimePreviewRequest(routeContext, `/query-extname/${uuid}`))).resolves.toBe('.cconb');
  await rm(join(projectLibraryRoot, uuid.slice(0, 2), `${uuid}.cconb`));
  await expect(responseBodyText(await handleRuntimePreviewRequest(routeContext, `/query-extname/${uuid}`))).resolves.toBe('.cconb');
});
```

This direct route test proves the resolver object can preserve positive hits across requests. The production wiring in Step 5 is still required to make this true for the Express server.

- [ ] **Step 7: Preserve extension root route contract**

Update `vitests/suites/runtime-preview/preview-app-route-contract.test.ts` test `queries import replacement extensions from explicit extension library roots` only if type errors require the new optional context field. Do not weaken the existing assertion:

```ts
expect(await responseBodyText(response)).toBe('.ccon');
```

- [ ] **Step 8: Run focused tests**

Run:

```powershell
rtk pwsh -NoProfile -Command "npm --prefix vitests run test -- suites/runtime-preview/import-replacement-extension-cache.test.ts suites/runtime-preview/preview-app-route-contract.test.ts"
```

Expected: both suites pass.

- [ ] **Step 9: Run TypeScript build**

Run:

```powershell
rtk pwsh -NoProfile -Command "npx tsc -b --pretty false"
```

Expected: pass.

- [ ] **Step 10: Commit**

```powershell
rtk pwsh -NoProfile -Command "git add src/runtime-preview/server/import-replacement-extension-cache.ts src/runtime-preview/server/runtime-preview-routes.ts src/runtime-preview/server/runtime-preview-server.ts vitests/suites/runtime-preview/import-replacement-extension-cache.test.ts vitests/suites/runtime-preview/preview-app-route-contract.test.ts; git commit -m 'perf: cache runtime preview import replacement extension lookups'"
```

---

### Task 3: Move Scene Selector `/scene-list` Fetch After Preview Bootstrap

**Files:**
- Modify: `static/runtime-preview/script.ejs`
- Modify: `vitests/suites/runtime-preview/browser-entry-contract.test.ts`

- [ ] **Step 1: Add a template contract test**

In `vitests/suites/runtime-preview/browser-entry-contract.test.ts`, add a test near the existing template tests:

```ts
it('schedules scene-list after preview app bootstrap instead of before bootstrap', async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), 'runtime-preview-lazy-scene-list-'));
  const templateRoot = join(projectRoot, 'preview-template');
  await mkdir(templateRoot, { recursive: true });
  await writeFile(
    join(templateRoot, 'index.ejs'),
    [
      '<select id="scene-select"></select>',
      '<%- include(cocosTemplate, {}) %>',
    ].join('\n'),
    'utf8',
  );
  const routeContext = createRouteContextForProject(projectRoot);
  const rootResponse = await handleRuntimePreviewRequest(routeContext, '/');
  const html = await responseBodyText(rootResponse);
  const installStart = html.indexOf('function installSceneSelector()');
  const fetchStart = html.indexOf('fetch(sceneListUrl.href)', installStart);
  const bootstrapStart = html.indexOf('return mod.bootstrap({');
  const scheduledInstallStart = html.indexOf('scheduleSceneSelectorInstall();', bootstrapStart);

  expect(rootResponse.statusCode).toBe(200);
  expect(html).toContain("new URL('/scene-list', window.location)");
  expect(html).toContain('function scheduleSceneSelectorInstall()');
  expect(installStart).toBeGreaterThan(-1);
  expect(fetchStart).toBeGreaterThan(installStart);
  expect(bootstrapStart).toBeGreaterThan(fetchStart);
  expect(scheduledInstallStart).toBeGreaterThan(bootstrapStart);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```powershell
rtk pwsh -NoProfile -Command "npm --prefix vitests run test -- suites/runtime-preview/browser-entry-contract.test.ts"
```

Expected: fail because `scheduleSceneSelectorInstall` is not present and `installSceneSelector()` currently runs before preview app bootstrap.

- [ ] **Step 3: Move scene selector installation after bootstrap**

In `static/runtime-preview/script.ejs`, keep the existing `installSceneSelector()` behavior, but add:

```js
    function scheduleSceneSelectorInstall() {
        var install = function() {
            installSceneSelector();
        };
        if (typeof window.requestIdleCallback === 'function') {
            window.requestIdleCallback(install, { timeout: 1000 });
            return;
        }
        setTimeout(install, 0);
    }
```

Then replace the `window.onload` body so `installSceneSelector()` runs only after `mod.bootstrap(...)` resolves:

```js
    window.onload = function() {
        System.import("/preview-app/index.js").then(function (mod) {
            return mod.bootstrap({
                engineBaseUrl: '/scripting/engine',
                settings: window._CCSettings,
                devices: <%-JSON.stringify(devices)%>,
            });
        }).then(function() {
            scheduleSceneSelectorInstall();
        }).catch(function(err) {
            console.error(err);
        });
    };
```

This preserves automatic selector population and keyboard/pointer UX. It only moves the auxiliary `/scene-list` fetch after runtime bootstrap so the change remains a measured candidate, not a claimed root cause.

- [ ] **Step 4: Run focused tests**

Run:

```powershell
rtk pwsh -NoProfile -Command "npm --prefix vitests run test -- suites/runtime-preview/browser-entry-contract.test.ts"
```

Expected: pass.

- [ ] **Step 5: Commit**

```powershell
rtk pwsh -NoProfile -Command "git add static/runtime-preview/script.ejs vitests/suites/runtime-preview/browser-entry-contract.test.ts; git commit -m 'perf: lazy-load runtime preview scene list'"
```

---

### Task 4: Re-Measure Main Test Project Before Considering Concurrency Changes

**Files:**
- Modify: `docs/dev/runtime-preview/facts/reload-cache-performance-20260626.md`
- Modify: `docs/dev/runtime-preview/issues.md`

- [ ] **Step 1: Start CLI runtime preview on a non-user port**

Use a port that is not `9528`:

```powershell
rtk pwsh -NoProfile -Command "npm run cli -- preview --runtime --project E:\own_space\engines\cocos-test-projects --engine D:\workspace\engines\cocos\3.8.6 --port 19657"
```

Expected: server starts and prints runtime preview URL. Keep this process open only for measurement, then stop it.

- [ ] **Step 2: Warm load once, then measure 5 reloads**

Run the checked-in diagnostic script from Task 1:

```powershell
rtk pwsh -NoProfile -Command "node vitests/scripts/runtime-preview-resource-completion-diagnostics.mjs --url http://127.0.0.1:19657/ --label cli-after-query-extname-cache-and-bootstrap-deferred-scene-list --output .codex-tmp/resource-completion-after-route-candidates.json --warmup 1 --rounds 5"
```

Expected output JSON fields:

- target label: `cli-after-query-extname-cache-and-bootstrap-deferred-scene-list`;
- `rounds`: exactly `5` measured reloads after one warm load;
- `resourceResponseEndMs.min`, `resourceResponseEndMs.median`, `resourceResponseEndMs.max`: numeric milliseconds;
- `sameOriginLastFinishMs.min`, `sameOriginLastFinishMs.median`, `sameOriginLastFinishMs.max`: numeric milliseconds;
- `networkQuietMs.min`, `networkQuietMs.median`, `networkQuietMs.max`: numeric milliseconds;
- `wireStatus`: status-code count object from CDP;
- `bucketMaxResponseEnd`: per-bucket maximum `responseEnd` values.

Before updating docs, inspect the JSON and verify every timing value is a number, not a string or missing field. Record bucket deltas for `/query-extname/*` and `/scene-list` separately; if their max `responseEnd` or count does not move meaningfully, document that negative result instead of claiming the candidate solved the issue.

- [ ] **Step 3: Update facts and issue status**

If median `resourceResponseEndMs` improves by at least `300ms`, update `RP-ISSUE-026` current conclusion with the measured delta. If it does not, write the negative result and keep the next optimization candidate fact-gated.

- [ ] **Step 4: Commit**

```powershell
rtk pwsh -NoProfile -Command "git add docs/dev/runtime-preview/facts/reload-cache-performance-20260626.md docs/dev/runtime-preview/issues.md; git commit -m 'docs: record runtime preview reload optimization measurement'"
```

---

### Task 5: Design Adaptive Script-Load Concurrency Only If Route Optimizations Are Insufficient

**Files:**
- Create: `src/runtime-preview/server/script-load-concurrency-policy.ts`
- Create: `vitests/suites/runtime-preview/script-load-concurrency-policy.test.ts`
- Modify: `src/runtime-preview/server/runtime-preview-server.ts`
- Modify: `vitests/suites/runtime-preview/browser-entry-contract.test.ts`
- Regenerate: `static/runtime-preview/preview-app/main.js`
- Regenerate: `static/runtime-preview/preview-app/main.d.ts`
- Regenerate: `static/runtime-preview/preview-app/main.js.map`

- [ ] **Step 1: Stop if Task 4 meets the target**

If Task 4 reduces CLI median `resourceResponseEndMs` by at least `300ms`, do not implement Task 5 in the same change set. Open a separate follow-up only if user confirms.

- [ ] **Step 2: Stop unless dependency count can be computed without parsing generated JavaScript**

Before creating a policy, identify a structured source for prerequisite dependency count. Acceptable sources:

- a typed packer-driver record that already contains dependency count;
- structured import-map JSON where the prerequisite module URL and its scope can be resolved without parsing generated JavaScript;
- a new explicit field emitted by the programming output pipeline.

If none exists, stop Task 5 and update `RP-ISSUE-026` with `fact-gap`; do not parse `System.register([...])` JavaScript strings.

- [ ] **Step 3: Write injection-boundary policy tests**

Create `vitests/suites/runtime-preview/script-load-concurrency-policy.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { resolveRuntimePreviewScriptLoadConcurrency } from '@runtime-preview/server/script-load-concurrency-policy';

describe('runtime preview script load concurrency policy', () => {
  it('preserves explicit user concurrency', () => {
    expect(resolveRuntimePreviewScriptLoadConcurrency({
      requestedConcurrency: 12,
      prerequisiteDependencyCount: 233,
    })).toBe(12);
  });

  it('raises concurrency for small prerequisite graphs only when count is known', () => {
    expect(resolveRuntimePreviewScriptLoadConcurrency({
      prerequisiteDependencyCount: 233,
    })).toBe(96);
  });

  it('keeps default limiter behavior for unknown or large graphs', () => {
    expect(resolveRuntimePreviewScriptLoadConcurrency({})).toBeUndefined();
    expect(resolveRuntimePreviewScriptLoadConcurrency({
      prerequisiteDependencyCount: 3253,
    })).toBeUndefined();
  });
});
```

- [ ] **Step 4: Run tests before implementation**

Run:

```powershell
rtk pwsh -NoProfile -Command "npm --prefix vitests run test -- suites/runtime-preview/script-load-concurrency-policy.test.ts"
```

Expected: fail because `script-load-concurrency-policy.ts` does not exist.

- [ ] **Step 5: Add policy at the injection boundary, not inside the limiter**

If measurement proves concurrency is still a bottleneck, prefer setting `scriptLoadConcurrency` before rendering the template, while preserving explicit user override. Do not change `DEFAULT_CONCURRENCY = 32` until feature-c disabled-cache measurements justify a new default.

Create `src/runtime-preview/server/script-load-concurrency-policy.ts`:

```ts
export interface RuntimePreviewScriptLoadConcurrencyPolicyInput {
    requestedConcurrency?: number;
    prerequisiteDependencyCount?: number;
}

export function resolveRuntimePreviewScriptLoadConcurrency(
    options: RuntimePreviewScriptLoadConcurrencyPolicyInput,
): number | undefined {
    if (options.requestedConcurrency !== undefined) {
        return options.requestedConcurrency;
    }
    if (typeof options.prerequisiteDependencyCount === 'number' && options.prerequisiteDependencyCount <= 300) {
        return 96;
    }
    return undefined;
}
```

Wire this policy only if Step 2 found a reliable `prerequisiteDependencyCount`. Otherwise, leave this task unimplemented.

- [ ] **Step 6: Run feature-c regression before accepting**

Run the same matrix recorded in `docs/dev/runtime-preview/facts/feature-c-script-load-resource-limit-20260625.md` for disabled-cache browser reloads.

Expected: no `net::ERR_INSUFFICIENT_RESOURCES`, no `SystemJS Error#3`, no preview chunk `Get ... failed`.

- [ ] **Step 7: Commit only if Task 5 is implemented and verified**

```powershell
rtk pwsh -NoProfile -Command "git add src/runtime-preview/server/script-load-concurrency-policy.ts src/runtime-preview/server/runtime-preview-server.ts vitests/suites/runtime-preview/script-load-concurrency-policy.test.ts vitests/suites/runtime-preview/browser-entry-contract.test.ts; git commit -m 'perf: adapt runtime preview script load concurrency'"
```

---

## Verification Matrix

- Focused route tests:

```powershell
rtk pwsh -NoProfile -Command "npm --prefix vitests run test -- suites/runtime-preview/import-replacement-extension-cache.test.ts suites/runtime-preview/preview-app-route-contract.test.ts"
```

- Template contract tests:

```powershell
rtk pwsh -NoProfile -Command "npm --prefix vitests run test -- suites/runtime-preview/browser-entry-contract.test.ts"
```

- Existing prerequisite / splash tests:

```powershell
rtk pwsh -NoProfile -Command "npm --prefix vitests run test -- suites/runtime-preview/preview-prerequisite-imports-policy.test.ts"
```

- Express file cache regression for `RP-ISSUE-006`:

```powershell
rtk pwsh -NoProfile -Command "npm --prefix vitests run test -- suites/runtime-preview/runtime-preview-express-server.test.ts"
```

- Diagnostic schema test:

```powershell
rtk pwsh -NoProfile -Command "npm --prefix vitests run test -- suites/runtime-preview/runtime-preview-resource-completion-diagnostics.test.ts"
```

- TypeScript build:

```powershell
rtk pwsh -NoProfile -Command "npx tsc -b --pretty false"
```

- Runtime app rebuild if preview-app files change:

```powershell
rtk pwsh -NoProfile -Command "npm run build:runtime-preview-app"
```

- Real browser measurement:
  - Editor preview: `http://localhost:7457/`
  - CLI runtime preview: dedicated port such as `19657`
  - warm load once, then measure 5 reloads
  - run `node vitests/scripts/runtime-preview-resource-completion-diagnostics.mjs ...`
  - record all-resource completion, CDP wire status, DevTools surface status, bucket tails, and raw JSON path

- Conditional `RP-ISSUE-022` feature-c regression:
  - Required if Task 5 adaptive concurrency is implemented.
  - Use the disabled-cache browser reload matrix from `docs/dev/runtime-preview/facts/feature-c-script-load-resource-limit-20260625.md`.
  - Required result: no `net::ERR_INSUFFICIENT_RESOURCES`, no `SystemJS Error#3`, no preview chunk `Get ... failed`.

## Rollback Criteria

- Any route optimization that changes `/query-extname/*` response content for extension library roots must be reverted.
- Any scene selector change that prevents manual scene switching must be reverted or moved behind an option.
- Any concurrency policy that reintroduces `feature-c` `ERR_INSUFFICIENT_RESOURCES` must not land.
- Any optimization that improves `networkQuietMs` but worsens `resourceResponseEndMs` must be treated as suspect until explained.
