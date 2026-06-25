# Runtime Preview Editor Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 CLI runtime preview 在 root template、Default device、preview prerequisite imports 和可验收浏览器证据上对齐 Cocos Creator 3.8.6 Editor preview。

**Architecture:** Root `/` 仍走 `handleRuntimePreviewRequest()`，但 `renderRuntimePreviewEntry()` 接收 `settingsProvider` 并优先渲染项目 `preview-template/index.ejs`。Preview target 的 prerequisite module 改回 static imports，使 packer-driver 生成 `System.register([...deps])` chunk。浏览器 smoke 扩展 CDP 采集 DOM/canvas size 和截图路径，facts/acceptance 文档承载最终证据。

**Tech Stack:** TypeScript, EJS, Vitest, PowerShell/rtk, Cocos Creator 3.8.6, `playwright-core`/CDP helper, runtime preview server。

---

## File Structure

- Modify: `src/runtime-preview/server/preview-entry-template.ts`
  - 负责选择项目 template / CLI fallback template。
  - 负责从 preview settings 派生 `devices.Default`。
  - 暴露小 helper 便于单测覆盖 device 逻辑。
- Modify: `src/runtime-preview/server/runtime-preview-routes.ts`
  - root `/` 调用 `renderRuntimePreviewEntry()` 时传入 `settingsProvider`。
  - 捕获项目 template render error，返回 500 并记录 log。
- Modify: `src/core/scripting/packer-driver/target-policy.ts`
  - 将 `preview` target 从 tentative dynamic imports 改为 static imports。
  - 保持 `editor` target 行为受测试锁定。
- Modify: `vitests/suites/runtime-preview/browser-entry-contract.test.ts`
  - 覆盖项目 template 正例、无 template fallback、项目 `script.ejs` 不接管、template render failure、device 派生。
- Modify: `vitests/suites/runtime-preview/preview-prerequisite-imports-policy.test.ts`
  - 改 policy 断言。
  - 增加产物级 chunk shape helper 或 fixture compile 验证。
- Create: `vitests/shared/runtime-preview-prerequisite-evidence.ts`
  - 读取 CLI preview output 的 `import-map.json` 和 prerequisite chunk。
  - 统计 static dependency 数量和 sequential dynamic import pattern。
- Modify: `vitests/shared/browser-runtime-smoke.ts`
  - 增加 DOM/canvas debug evidence。
  - 增加 screenshot output path。
  - evidence JSON 记录 viewport、DPR、canvas/container size、same-origin chunk summary。
- Modify: `vitests/suites/runtime-preview/main-test-project-cli-integration.test.ts`
  - 断言 root 使用项目 template marker。
  - 断言 `settings.engine.debug`、`settings.engine.platform`。
  - 断言 prerequisite chunk shape。
  - 保存截图和 debug evidence。
- Create: `docs/dev/runtime-preview/facts/runtime-preview-editor-parity-20260625.md`
  - 记录 Editor / CLI 对比、命令、证据文件、截图路径、结论。
- Modify: `docs/dev/runtime-preview/issues.md`
  - 回填 `RP-ISSUE-007` 和 `RP-ISSUE-019` 状态与结论。
- Modify: `docs/dev/runtime-preview/acceptance/matrix.md`
  - 回填相关 `partial` 项证据。

---

### Task 1: Root Template And Device Tests

**Files:**
- Modify: `vitests/suites/runtime-preview/browser-entry-contract.test.ts`

- [ ] **Step 1: Add route context helpers for temporary projects**

Add imports at the top:

```ts
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
```

Add this helper after `responseBodyText()`:

```ts
async function createTempProjectRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'cocos-runtime-preview-entry-'));
  await mkdir(join(root, 'preview-template'), { recursive: true });
  return root;
}

function createRouteContextForProject(projectRoot: string, loadPreviewSettings?: () => Promise<any>) {
  const paths = getFixturePaths();
  const runtimeContext = createRuntimePreviewContext({
    projectRoot,
    engineRoot: paths.engineRoot,
    projectLibraryRoot: paths.editorLibraryRef,
    internalLibraryRoot: join(paths.engineRoot, 'editor', 'library'),
    projectProgrammingRoot: join(paths.editorProgrammingRef, 'programming'),
    cliProgrammingRoot: join(projectRoot, 'temp', 'cli', 'programming'),
  });
  const settingsProvider = new PreviewSettingsProvider({
    loadPreviewSettings: loadPreviewSettings ?? (async () => ({
      settings: {
        assets: {},
        screen: {
          designResolution: {
            width: 1334,
            height: 750,
          },
        },
      },
      script2library: {},
      bundleConfigs: [],
    })),
  });

  return { runtimeContext, settingsProvider };
}
```

- [ ] **Step 2: Add failing project template priority test**

Append this test in the `describe('runtime preview browser entry contract', ...)` block:

```ts
it('uses project preview-template index while keeping CLI boot script', async () => {
  const projectRoot = await createTempProjectRoot();
  await writeFile(join(projectRoot, 'preview-template', 'index.ejs'), `
<html>
  <body>
    <div id="project-preview-template-marker">project template</div>
    <%- include(cocosTemplate, {}) %>
  </body>
</html>
`, 'utf8');
  await writeFile(join(projectRoot, 'preview-template', 'script.ejs'), `
<script>window.__PROJECT_SCRIPT_TEMPLATE_SHOULD_NOT_LOAD__ = true;</script>
`, 'utf8');

  const response = await handleRuntimePreviewRequest(createRouteContextForProject(projectRoot), '/');
  const html = await responseBodyText(response);

  expect(response.kind).toBe('body');
  expect(response.statusCode).toBe(200);
  expect(html).toContain('id="project-preview-template-marker"');
  expect(html).toContain('System.import("/preview-app/index.js")');
  expect(html).not.toContain('__PROJECT_SCRIPT_TEMPLATE_SHOULD_NOT_LOAD__');
});
```

- [ ] **Step 3: Add failing fallback and render error tests**

Append these tests:

```ts
it('falls back to builtin runtime preview index when project template is missing', async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), 'cocos-runtime-preview-entry-no-template-'));
  const response = await handleRuntimePreviewRequest(createRouteContextForProject(projectRoot), '/');
  const html = await responseBodyText(response);

  expect(response.statusCode).toBe(200);
  expect(html).toContain('System.import("/preview-app/index.js")');
  expect(html).toContain('id="GameCanvas"');
});

it('returns 500 when project preview-template index render fails', async () => {
  const projectRoot = await createTempProjectRoot();
  await writeFile(join(projectRoot, 'preview-template', 'index.ejs'), `
<html><body><%= missing.value %></body></html>
`, 'utf8');

  const response = await handleRuntimePreviewRequest(createRouteContextForProject(projectRoot), '/');
  const body = await responseBodyText(response);

  expect(response.kind).toBe('body');
  expect(response.statusCode).toBe(500);
  expect(body).toContain('runtime-preview-template-error');
  expect(body).toContain('preview-template');
  expect(body).toContain('index.ejs');
});
```

- [ ] **Step 4: Add failing Default device derivation tests**

Append these tests:

```ts
it('derives Default device from preview settings design resolution', async () => {
  const projectRoot = await createTempProjectRoot();
  await writeFile(join(projectRoot, 'preview-template', 'index.ejs'), `
<html><body><script id="devices-json" type="application/json"><%- JSON.stringify(devices) %></script></body></html>
`, 'utf8');

  const response = await handleRuntimePreviewRequest(createRouteContextForProject(projectRoot, async () => ({
    settings: {
      assets: {},
      screen: {
        designResolution: {
          width: 1920,
          height: 1080,
        },
      },
    },
    script2library: {},
    bundleConfigs: [],
  })), '/');
  const html = await responseBodyText(response);

  expect(html).toContain('"Default":{"name":"Default","width":1920,"height":1080');
});

it('does not use hardcoded 960x640 when settings design resolution exists', async () => {
  const projectRoot = await createTempProjectRoot();
  await writeFile(join(projectRoot, 'preview-template', 'index.ejs'), `
<html><body><script id="devices-json" type="application/json"><%- JSON.stringify(devices) %></script></body></html>
`, 'utf8');

  const response = await handleRuntimePreviewRequest(createRouteContextForProject(projectRoot, async () => ({
    settings: {
      assets: {},
      screen: {
        designResolution: {
          width: 1280,
          height: 720,
        },
      },
    },
    script2library: {},
    bundleConfigs: [],
  })), '/');
  const html = await responseBodyText(response);

  expect(html).toContain('"width":1280');
  expect(html).toContain('"height":720');
  expect(html).not.toContain('"width":960,"height":640');
});
```

- [ ] **Step 5: Run failing test**

Run:

```powershell
rtk pwsh -NoProfile -Command "$env:COCOS_CLI_TEST_ENGINE_ROOT='D:\workspace\engines\cocos\3.8.6'; npm --prefix vitests test -- suites/runtime-preview/browser-entry-contract.test.ts"
```

Expected now: FAIL on the new project template priority / render error / device tests.

---

### Task 2: Implement Root Template Selection And Device Derivation

**Files:**
- Modify: `src/runtime-preview/server/preview-entry-template.ts`
- Modify: `src/runtime-preview/server/runtime-preview-routes.ts`
- Test: `vitests/suites/runtime-preview/browser-entry-contract.test.ts`

- [ ] **Step 1: Change `renderRuntimePreviewEntry()` signature**

In `src/runtime-preview/server/preview-entry-template.ts`, add the type import:

```ts
import type { PreviewSettingsProvider } from '../settings/preview-settings-provider';
```

Replace the current signature:

```ts
export async function renderRuntimePreviewEntry(context: RuntimePreviewContext, requestPath: string): Promise<string> {
```

with:

```ts
export async function renderRuntimePreviewEntry(
    context: RuntimePreviewContext,
    settingsProvider: PreviewSettingsProvider,
    requestPath: string,
): Promise<string> {
```

- [ ] **Step 2: Add project template resolver**

Add this helper before `renderRuntimePreviewEntry()`:

```ts
async function resolveRuntimePreviewEntryTemplate(context: RuntimePreviewContext): Promise<string> {
    const projectTemplate = join(context.projectRoot, 'preview-template', 'index.ejs');
    try {
        const templateStat = await stat(projectTemplate);
        if (templateStat.isFile()) {
            return projectTemplate;
        }
    } catch {
        // Fall back to the CLI adapted builtin template.
    }
    return join(runtimePreviewStaticRoot, 'index.ejs');
}
```

- [ ] **Step 3: Add design resolution parser**

Add this helper:

```ts
function readDesignResolution(settings: Record<string, any> | undefined): { width: number; height: number } | null {
    const candidates = [
        settings?.screen?.designResolution,
        settings?.screen?.resolution,
        settings?.designResolution,
    ];
    for (const candidate of candidates) {
        const width = Number(candidate?.width);
        const height = Number(candidate?.height);
        if (Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0) {
            return { width, height };
        }
    }
    return null;
}
```

- [ ] **Step 4: Let devices use settings resolution**

Replace:

```ts
async function loadRuntimePreviewDevices(): Promise<Record<string, RuntimePreviewDevice>> {
```

with:

```ts
async function loadRuntimePreviewDevices(settings?: Record<string, any>): Promise<Record<string, RuntimePreviewDevice>> {
```

After `const devices = ...` is computed, apply the resolution:

```ts
const resolution = readDesignResolution(settings);
if (resolution) {
    devices.Default = {
        name: 'Default',
        width: resolution.width,
        height: resolution.height,
    };
}
return devices;
```

Keep the existing fallback behavior when `devices.json` cannot be read.

- [ ] **Step 5: Render selected template with settings-backed devices**

Inside `renderRuntimePreviewEntry()`, replace:

```ts
const devices = await loadRuntimePreviewDevices();
const sceneQuery = await getSceneQuery(context, requestPath);
const html = await ejs.renderFile(join(runtimePreviewStaticRoot, 'index.ejs'), {
```

with:

```ts
const previewSettings = await settingsProvider.getPreviewSettings();
const devices = await loadRuntimePreviewDevices(previewSettings.settings as Record<string, any>);
const sceneQuery = await getSceneQuery(context, requestPath);
const templatePath = await resolveRuntimePreviewEntryTemplate(context);
const html = await ejs.renderFile(templatePath, {
```

- [ ] **Step 6: Return 500 on project template render error**

In `src/runtime-preview/server/runtime-preview-routes.ts`, replace the root route block:

```ts
if (pathname === '/') {
    return textResponse(
        200,
        'text/html; charset=utf-8',
        await renderRuntimePreviewEntry(context.runtimeContext, requestPath),
    );
}
```

with:

```ts
if (pathname === '/') {
    try {
        return textResponse(
            200,
            'text/html; charset=utf-8',
            await renderRuntimePreviewEntry(context.runtimeContext, context.settingsProvider, requestPath),
        );
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const line = `runtime-preview-template-error ${message}`;
        await context.logger?.write(line);
        return textResponse(500, 'text/plain; charset=utf-8', line);
    }
}
```

- [ ] **Step 7: Run focused test**

Run:

```powershell
rtk pwsh -NoProfile -Command "$env:COCOS_CLI_TEST_ENGINE_ROOT='D:\workspace\engines\cocos\3.8.6'; npm --prefix vitests test -- suites/runtime-preview/browser-entry-contract.test.ts"
```

Expected: PASS.

- [ ] **Step 8: Commit Task 2**

```powershell
rtk git add src/runtime-preview/server/preview-entry-template.ts src/runtime-preview/server/runtime-preview-routes.ts vitests/suites/runtime-preview/browser-entry-contract.test.ts
rtk git commit -m "fix: align runtime preview entry template"
```

---

### Task 3: Preview Prerequisite Policy Tests And Implementation

**Files:**
- Modify: `vitests/suites/runtime-preview/preview-prerequisite-imports-policy.test.ts`
- Modify: `src/core/scripting/packer-driver/target-policy.ts`

- [ ] **Step 1: Update failing policy tests**

Replace the first test in `preview-prerequisite-imports-policy.test.ts`:

```ts
it('uses tentative dynamic imports for preview target to avoid loading all chunks at once', () => {
  expect(shouldUseTentativePrerequisiteImportsMod('preview', { isEditor: false })).toBe(true);
});
```

with:

```ts
it('uses static prerequisite imports for preview target to match Editor browser preview output', () => {
  expect(shouldUseTentativePrerequisiteImportsMod('preview', { isEditor: false })).toBe(false);
});
```

Keep the `editor` target test:

```ts
it('keeps editor target tentative behavior', () => {
  expect(shouldUseTentativePrerequisiteImportsMod('editor', { isEditor: true })).toBe(true);
});
```

- [ ] **Step 2: Run failing policy test**

Run:

```powershell
rtk pwsh -NoProfile -Command "$env:COCOS_CLI_TEST_ENGINE_ROOT='D:\workspace\engines\cocos\3.8.6'; npm --prefix vitests test -- suites/runtime-preview/preview-prerequisite-imports-policy.test.ts"
```

Expected now: FAIL because preview still returns `true`.

- [ ] **Step 3: Implement policy**

In `src/core/scripting/packer-driver/target-policy.ts`, replace:

```ts
return target.isEditor === true || targetId === 'preview';
```

with:

```ts
return target.isEditor === true;
```

- [ ] **Step 4: Run policy test**

Run:

```powershell
rtk pwsh -NoProfile -Command "$env:COCOS_CLI_TEST_ENGINE_ROOT='D:\workspace\engines\cocos\3.8.6'; npm --prefix vitests test -- suites/runtime-preview/preview-prerequisite-imports-policy.test.ts"
```

Expected: PASS.

- [ ] **Step 5: Commit Task 3**

```powershell
rtk git add src/core/scripting/packer-driver/target-policy.ts vitests/suites/runtime-preview/preview-prerequisite-imports-policy.test.ts
rtk git commit -m "fix: use static preview prerequisite imports"
```

---

### Task 4: Product-Level Prerequisite Evidence Helper

**Files:**
- Create: `vitests/shared/runtime-preview-prerequisite-evidence.ts`
- Modify: `vitests/suites/runtime-preview/preview-prerequisite-imports-policy.test.ts`

- [ ] **Step 1: Create helper**

Create `vitests/shared/runtime-preview-prerequisite-evidence.ts`:

```ts
import { readFile } from 'node:fs/promises';
import { dirname, join, normalize } from 'node:path';

export interface RuntimePreviewPrerequisiteEvidence {
  importMapPath: string;
  chunkPath: string;
  chunkSource: string;
  dependencyCount: number;
  unresolvedMappingCount: number;
  hasStaticSystemRegister: boolean;
  hasSequentialDynamicImportLoop: boolean;
}

function getChunkDependencies(source: string): string[] {
  const match = source.match(/System\.register\(\s*\[([\s\S]*?)\]/);
  if (!match) {
    return [];
  }
  return Array.from(match[1].matchAll(/"(__unresolved_\d+)"/g), (entry) => entry[1]);
}

function getChunkScope(importMap: any, chunkImportPath: string): Record<string, string> {
  const scopes = importMap.scopes ?? {};
  const normalizedChunkPath = chunkImportPath.replace(/\\/g, '/');
  return scopes[normalizedChunkPath]
    ?? scopes[`./${normalizedChunkPath.replace(/^\.\//, '')}`]
    ?? {};
}

export async function readRuntimePreviewPrerequisiteEvidence(importMapPath: string): Promise<RuntimePreviewPrerequisiteEvidence> {
  const importMap = JSON.parse(await readFile(importMapPath, 'utf8'));
  const chunkImport = importMap.imports?.['cce:/internal/x/prerequisite-imports'];
  if (typeof chunkImport !== 'string') {
    throw new Error(`Missing cce:/internal/x/prerequisite-imports in ${importMapPath}`);
  }

  const chunkPath = normalize(join(dirname(importMapPath), chunkImport));
  const chunkSource = await readFile(chunkPath, 'utf8');
  const dependencies = getChunkDependencies(chunkSource);
  const scope = getChunkScope(importMap, chunkImport);

  return {
    importMapPath,
    chunkPath,
    chunkSource,
    dependencyCount: dependencies.length,
    unresolvedMappingCount: Object.keys(scope).filter((key) => /^__unresolved_\d+$/.test(key)).length,
    hasStaticSystemRegister: /System\.register\(\s*\[/.test(chunkSource),
    hasSequentialDynamicImportLoop: /await\s+import\(|\(\)\s*=>\s*import\(|const\s+requests|for\s*\(\s*const\s+request/.test(chunkSource),
  };
}
```

- [ ] **Step 2: Add helper unit test with temp files**

Append to `preview-prerequisite-imports-policy.test.ts` imports:

```ts
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { readRuntimePreviewPrerequisiteEvidence } from '@shared/runtime-preview-prerequisite-evidence';
```

Append this test:

```ts
it('classifies generated prerequisite chunk shape from import-map output', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cocos-prerequisite-evidence-'));
  await mkdir(join(root, 'chunks', '6d'), { recursive: true });
  await writeFile(join(root, 'import-map.json'), JSON.stringify({
    imports: {
      'cce:/internal/x/prerequisite-imports': './chunks/6d/prereq.js',
    },
    scopes: {
      './chunks/6d/prereq.js': {
        __unresolved_0: './chunks/a.js',
        __unresolved_1: './chunks/b.js',
      },
    },
  }), 'utf8');
  await writeFile(join(root, 'chunks', '6d', 'prereq.js'), `
System.register(["__unresolved_0", "__unresolved_1"], function () {
  return { setters: [function () {}, function () {}], execute: function () {} };
});
`, 'utf8');

  const evidence = await readRuntimePreviewPrerequisiteEvidence(join(root, 'import-map.json'));

  expect(evidence.hasStaticSystemRegister).toBe(true);
  expect(evidence.hasSequentialDynamicImportLoop).toBe(false);
  expect(evidence.dependencyCount).toBe(2);
  expect(evidence.unresolvedMappingCount).toBe(2);
});
```

- [ ] **Step 3: Run helper test**

Run:

```powershell
rtk pwsh -NoProfile -Command "$env:COCOS_CLI_TEST_ENGINE_ROOT='D:\workspace\engines\cocos\3.8.6'; npm --prefix vitests test -- suites/runtime-preview/preview-prerequisite-imports-policy.test.ts"
```

Expected: PASS.

- [ ] **Step 4: Commit Task 4**

```powershell
rtk git add vitests/shared/runtime-preview-prerequisite-evidence.ts vitests/suites/runtime-preview/preview-prerequisite-imports-policy.test.ts
rtk git commit -m "test: inspect preview prerequisite output"
```

---

### Task 5: Browser Smoke Debug Evidence And Screenshots

**Files:**
- Modify: `vitests/shared/browser-runtime-smoke.ts`

- [ ] **Step 1: Extend interfaces**

Add interfaces near existing network interfaces:

```ts
interface BrowserElementRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface BrowserCanvasDebugEvidence {
  viewport: {
    innerWidth: number;
    innerHeight: number;
    devicePixelRatio: number;
  };
  elements: {
    gameCanvas: BrowserElementRect | null;
    gameDiv: BrowserElementRect | null;
    cocos3dGameContainer: BrowserElementRect | null;
  };
  canvas: {
    width: number | null;
    height: number | null;
    computedWidth: string | null;
    computedHeight: string | null;
  };
  screenshotFilePath?: string;
}
```

Extend `BrowserRuntimeSmokeResult`:

```ts
  canvasDebugEvidence?: BrowserCanvasDebugEvidence;
```

Extend `BrowserRuntimeSmokeOptions`:

```ts
  screenshotFilePath?: string;
```

- [ ] **Step 2: Add CDP helpers**

Add helper before `runBrowserRuntimeSmoke()`:

```ts
async function collectCanvasDebugEvidence(
  session: CdpSession,
  screenshotFilePath: string | undefined,
): Promise<BrowserCanvasDebugEvidence> {
  const evaluation = await session.send('Runtime.evaluate', {
    expression: `(() => {
      const rectOf = (selector) => {
        const element = document.querySelector(selector);
        if (!element) return null;
        const rect = element.getBoundingClientRect();
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
      };
      const canvas = document.querySelector('#GameCanvas');
      const canvasStyle = canvas ? getComputedStyle(canvas) : null;
      return {
        viewport: {
          innerWidth: window.innerWidth,
          innerHeight: window.innerHeight,
          devicePixelRatio: window.devicePixelRatio,
        },
        elements: {
          gameCanvas: rectOf('#GameCanvas'),
          gameDiv: rectOf('#GameDiv'),
          cocos3dGameContainer: rectOf('#Cocos3dGameContainer'),
        },
        canvas: {
          width: canvas ? canvas.width : null,
          height: canvas ? canvas.height : null,
          computedWidth: canvasStyle ? canvasStyle.width : null,
          computedHeight: canvasStyle ? canvasStyle.height : null,
        },
      };
    })()`,
    returnByValue: true,
  });
  const evidence = evaluation.result?.value as BrowserCanvasDebugEvidence;
  if (!evidence || typeof evidence !== 'object') {
    throw new Error(`Unable to collect canvas debug evidence: ${JSON.stringify(evaluation)}`);
  }
  if (screenshotFilePath) {
    await mkdir(dirname(screenshotFilePath), { recursive: true });
    const screenshot = await session.send('Page.captureScreenshot', { format: 'png', fromSurface: true });
    await writeFile(screenshotFilePath, Buffer.from(String(screenshot.data), 'base64'));
    evidence.screenshotFilePath = screenshotFilePath;
  }
  return evidence;
}
```

- [ ] **Step 3: Collect evidence after stable window**

After the bad response checks and before `const result = { ... }`, add:

```ts
const canvasDebugEvidence = await collectCanvasDebugEvidence(session, options.screenshotFilePath);
```

Add to `result`:

```ts
canvasDebugEvidence,
```

Add to successful `writeSmokeEvidence()` payload:

```ts
canvasDebugEvidence: result.canvasDebugEvidence,
```

Add to failed `writeSmokeEvidence()` payload:

```ts
screenshotFilePath: options.screenshotFilePath,
```

- [ ] **Step 4: Run typecheck via build**

Run:

```powershell
rtk npm run compile
```

Expected: PASS.

- [ ] **Step 5: Commit Task 5**

```powershell
rtk git add vitests/shared/browser-runtime-smoke.ts
rtk git commit -m "test: capture runtime preview browser evidence"
```

---

### Task 6: Main Test Project Integration Evidence

**Files:**
- Modify: `vitests/suites/runtime-preview/main-test-project-cli-integration.test.ts`
- Use: `vitests/shared/runtime-preview-prerequisite-evidence.ts`

- [ ] **Step 1: Add imports**

Add:

```ts
import { existsSync } from 'node:fs';
import { readRuntimePreviewPrerequisiteEvidence } from '@shared/runtime-preview-prerequisite-evidence';
```

- [ ] **Step 2: Assert root template and settings**

After fetching `defaultEntryResponse`, replace:

```ts
expect(await defaultEntryResponse.text()).toContain(`/settings.js?scene=${targetScene.uuid}`);
```

with:

```ts
const defaultEntryHtml = await defaultEntryResponse.text();
expect(defaultEntryHtml).toContain(`/settings.js?scene=${targetScene.uuid}`);
expect(defaultEntryHtml).toContain('Cocos Creator');
expect(defaultEntryHtml).toContain('System.import("/preview-app/index.js")');
expect(defaultEntryHtml).not.toContain('__PROJECT_SCRIPT_TEMPLATE_SHOULD_NOT_LOAD__');

const settingsResponse = await fetch(`${cli.url}/settings.js?scene=${encodeURIComponent(targetScene.uuid)}`);
expect(settingsResponse.status).toBe(200);
const settingsJs = await settingsResponse.text();
expect(settingsJs).toContain('window._CCSettings = ');
const settings = JSON.parse(settingsJs.replace(/^window\._CCSettings\s*=\s*/, '').replace(/;\s*$/, ''));
expect(settings.engine.debug).toBe(true);
expect(settings.engine.platform).toBe('web-desktop');
```

- [ ] **Step 3: Add prerequisite output assertions**

Before `const sceneSmoke = await runBrowserRuntimeSmoke({ ... })`, add:

```ts
const importMapPath = join(
  paths.projectRoot,
  'temp',
  'cli',
  'programming',
  'packer-driver',
  'targets',
  'preview',
  'import-map.json',
);
expect(existsSync(importMapPath)).toBe(true);
const prerequisiteEvidence = await readRuntimePreviewPrerequisiteEvidence(importMapPath);
expect(prerequisiteEvidence.hasStaticSystemRegister).toBe(true);
expect(prerequisiteEvidence.hasSequentialDynamicImportLoop).toBe(false);
expect(prerequisiteEvidence.dependencyCount).toBeGreaterThan(0);
expect(prerequisiteEvidence.unresolvedMappingCount).toBe(prerequisiteEvidence.dependencyCount);
```

- [ ] **Step 4: Pass screenshot path into browser smoke**

In `runBrowserRuntimeSmoke()` options, add:

```ts
screenshotFilePath: join(paths.projectRoot, 'temp', 'runtime-preview-main-test-project-cli-test-bundle-zip-scene.png'),
```

Extend `evidenceContext`:

```ts
prerequisiteEvidence: {
  importMapPath: prerequisiteEvidence.importMapPath,
  chunkPath: prerequisiteEvidence.chunkPath,
  dependencyCount: prerequisiteEvidence.dependencyCount,
  unresolvedMappingCount: prerequisiteEvidence.unresolvedMappingCount,
},
```

- [ ] **Step 5: Assert canvas evidence**

After `expect(sceneSmoke.badResponses).toEqual([]);`, add:

```ts
expect(sceneSmoke.canvasDebugEvidence?.viewport.innerWidth).toBeGreaterThan(0);
expect(sceneSmoke.canvasDebugEvidence?.viewport.innerHeight).toBeGreaterThan(0);
expect(sceneSmoke.canvasDebugEvidence?.elements.gameCanvas?.width).toBeGreaterThan(0);
expect(sceneSmoke.canvasDebugEvidence?.elements.gameCanvas?.height).toBeGreaterThan(0);
expect(sceneSmoke.canvasDebugEvidence?.canvas.width).toBeGreaterThan(0);
expect(sceneSmoke.canvasDebugEvidence?.canvas.height).toBeGreaterThan(0);
expect(sceneSmoke.canvasDebugEvidence?.screenshotFilePath).toBeTruthy();
```

- [ ] **Step 6: Add evidence summary fields**

In the `writeFile(evidenceSummaryFilePath, ...)` payload, add:

```ts
prerequisiteEvidence: {
  importMapPath: prerequisiteEvidence.importMapPath,
  chunkPath: prerequisiteEvidence.chunkPath,
  dependencyCount: prerequisiteEvidence.dependencyCount,
  unresolvedMappingCount: prerequisiteEvidence.unresolvedMappingCount,
},
canvasDebugEvidence: sceneSmoke.canvasDebugEvidence,
```

- [ ] **Step 7: Run integration test**

Run:

```powershell
rtk pwsh -NoProfile -Command "$env:COCOS_CLI_TEST_ENGINE_ROOT='D:\workspace\engines\cocos\3.8.6'; npm --prefix vitests test -- suites/runtime-preview/main-test-project-cli-integration.test.ts"
```

Expected: PASS. Evidence files should appear under `E:\own_space\engines\cocos-test-projects\temp\`.

- [ ] **Step 8: Commit Task 6**

```powershell
rtk git add vitests/suites/runtime-preview/main-test-project-cli-integration.test.ts
rtk git commit -m "test: verify runtime preview editor parity evidence"
```

---

### Task 7: Facts And Runtime Preview Issue Updates

**Files:**
- Create: `docs/dev/runtime-preview/facts/runtime-preview-editor-parity-20260625.md`
- Modify: `docs/dev/runtime-preview/issues.md`
- Modify: `docs/dev/runtime-preview/acceptance/matrix.md`

- [ ] **Step 1: Extract evidence values**

Run after Task 6 passes:

```powershell
rtk pwsh -NoProfile -Command "$summary='E:\own_space\engines\cocos-test-projects\temp\runtime-preview-main-test-project-cli-evidence.json'; $scene='E:\own_space\engines\cocos-test-projects\temp\runtime-preview-main-test-project-cli-test-bundle-zip-scene.json'; $summaryJson=Get-Content -LiteralPath $summary -Raw | ConvertFrom-Json; $sceneJson=Get-Content -LiteralPath $scene -Raw | ConvertFrom-Json; [pscustomobject]@{ summary=$summary; scene=$scene; serverUrl=$summaryJson.serverUrl; logFilePath=$summaryJson.logFilePath; elapsedStartupMs=$summaryJson.elapsedStartupMs; elapsedReadyMs=$sceneJson.elapsedReadyMs; networkRequestCount=$sceneJson.networkRequestCount; screenshot=$sceneJson.canvasDebugEvidence.screenshotFilePath; canvasWidth=$sceneJson.canvasDebugEvidence.canvas.width; canvasHeight=$sceneJson.canvasDebugEvidence.canvas.height; dpr=$sceneJson.canvasDebugEvidence.viewport.devicePixelRatio; prereqDeps=$summaryJson.prerequisiteEvidence.dependencyCount; prereqChunk=$summaryJson.prerequisiteEvidence.chunkPath } | ConvertTo-Json -Depth 8"
```

Expected:

- `serverUrl` is the CLI runtime preview URL.
- `screenshot` points to an existing `.png`.
- `canvasWidth` and `canvasHeight` are greater than 0.
- `prereqDeps` is greater than 0.
- `prereqChunk` points to the CLI generated prerequisite chunk.

- [ ] **Step 2: Write facts document**

Create `docs/dev/runtime-preview/facts/runtime-preview-editor-parity-20260625.md`:

```md
# Runtime preview Editor parity 事实记录

## 范围

本文记录 `RP-ISSUE-007` 与 `RP-ISSUE-019` 的 Editor / CLI 对齐事实。

## Editor baseline

- Editor：Cocos Creator 3.8.6。
- Project：`E:\own_space\engines\cocos-test-projects`。
- Preview URL：`http://localhost:7457/`。
- root `/`：使用项目 `preview-template/index.ejs`。
- `/settings.js`：`engine.debug === true`，`engine.platform === "web-desktop"`。
- prerequisite import：`cce:/internal/x/prerequisite-imports` 映射到 preview target chunk。
- prerequisite chunk shape：`System.register([...deps], ...)` static dependency array。
- sequential dynamic import：未发现 `await import(`、`() => import(`、`const requests`、`for (const request`。

## CLI validation

- CLI command：来自 `runtime-preview-main-test-project-cli-evidence.json#cliCommand`。
- root `/`：使用项目 `preview-template/index.ejs`，boot script 来自 CLI `static/runtime-preview/script.ejs`。
- `/settings.js`：`engine.debug === true`，`engine.platform === "web-desktop"`。
- prerequisite import-map：来自 `runtime-preview-main-test-project-cli-evidence.json#prerequisiteEvidence.importMapPath`。
- prerequisite chunk：来自 `runtime-preview-main-test-project-cli-evidence.json#prerequisiteEvidence.chunkPath`。
- prerequisite dependency count：来自 `runtime-preview-main-test-project-cli-evidence.json#prerequisiteEvidence.dependencyCount`。
- prerequisite unresolved mapping count：来自 `runtime-preview-main-test-project-cli-evidence.json#prerequisiteEvidence.unresolvedMappingCount`。
- Browser smoke：120 秒 ready timeout，10 秒 stable window。
- Browser errors：`consoleErrors=[]`、`pageErrors=[]`、`failedRequests=[]`、`badResponses=[]`。

## 分辨率与截图证据

- Editor browser debug：来自本轮 Editor capture evidence 的 viewport、DPR、`#GameCanvas`、`#GameDiv`、`#Cocos3dGameContainer`、canvas backing store。
- Editor screenshot：保存到 `docs/dev/runtime-preview/facts/artifacts/` 或项目 `temp/` 中，并在本文列出绝对路径。
- CLI browser debug：来自 `runtime-preview-main-test-project-cli-test-bundle-zip-scene.json#canvasDebugEvidence`。
- CLI screenshot：来自 `runtime-preview-main-test-project-cli-test-bundle-zip-scene.json#canvasDebugEvidence.screenshotFilePath`。

## 结论

- `RP-ISSUE-007` 本轮解决的是 CLI sequential dynamic import 与 Editor preview static deps 不一致；不是引入全并发加载策略。
- `RP-ISSUE-019` 本轮覆盖 project template、CLI boot script 和 Default device 实际浏览器尺寸证据。
```

Before committing, paste the JSON output from Step 1 into the facts document under a `## CLI evidence summary` section, then write the factual conclusion from those values.

- [ ] **Step 3: Update issues ledger**

In `docs/dev/runtime-preview/issues.md`:

- Update `RP-ISSUE-007` from `deferred` to `fixed` only if all tests and facts pass.
- The conclusion must say:

```md
已按 Editor preview fact 修正：CLI preview target 不再生成 sequential dynamic import request list，而是输出 `System.register([...deps])` static prerequisite chunk。本条不是“全并发加载”策略。
```

- Update `RP-ISSUE-019` from `open` to `fixed` only if template, boot script and device browser evidence are complete.

- [ ] **Step 4: Update acceptance matrix**

In `docs/dev/runtime-preview/acceptance/matrix.md`, update the rows for:

- Browser entry/root template.
- Scripting/prerequisite imports.
- Browser runtime smoke.
- Main test-project integration acceptance.

Each updated row must reference:

```md
docs/dev/runtime-preview/facts/runtime-preview-editor-parity-20260625.md
vitests/suites/runtime-preview/browser-entry-contract.test.ts
vitests/suites/runtime-preview/preview-prerequisite-imports-policy.test.ts
vitests/suites/runtime-preview/main-test-project-cli-integration.test.ts
```

- [ ] **Step 5: Commit Task 7**

```powershell
rtk git add docs/dev/runtime-preview/facts/runtime-preview-editor-parity-20260625.md docs/dev/runtime-preview/issues.md docs/dev/runtime-preview/acceptance/matrix.md
rtk git commit -m "docs: record runtime preview editor parity"
```

---

### Task 8: Final Verification And Review

**Files:**
- No planned code edits unless verification reveals a defect.

- [ ] **Step 1: Run focused runtime preview tests**

Run:

```powershell
rtk pwsh -NoProfile -Command "$env:COCOS_CLI_TEST_ENGINE_ROOT='D:\workspace\engines\cocos\3.8.6'; npm --prefix vitests test -- suites/runtime-preview/browser-entry-contract.test.ts suites/runtime-preview/preview-prerequisite-imports-policy.test.ts suites/runtime-preview/main-test-project-cli-integration.test.ts"
```

Expected: PASS.

- [ ] **Step 2: Run build/type verification**

Run:

```powershell
rtk npm run compile
```

Expected: PASS.

- [ ] **Step 3: Inspect evidence files**

Run:

```powershell
rtk pwsh -NoProfile -Command "$e='E:\own_space\engines\cocos-test-projects\temp\runtime-preview-main-test-project-cli-test-bundle-zip-scene.json'; $s='E:\own_space\engines\cocos-test-projects\temp\runtime-preview-main-test-project-cli-test-bundle-zip-scene.png'; Get-Item -LiteralPath $e,$s | Select-Object FullName,Length,LastWriteTime | Format-Table -AutoSize; Get-Content -LiteralPath $e -Raw | ConvertFrom-Json | Select-Object status,elapsedReadyMs,networkRequestCount | Format-List"
```

Expected:

- JSON evidence exists.
- PNG screenshot exists and has non-zero length.
- `status` is `pass`.
- `elapsedReadyMs` is less than 120000.
- `networkRequestCount` is greater than 0.

- [ ] **Step 4: Request code review**

Dispatch a reviewer with this prompt:

```md
Review runtime preview Editor parity implementation against docs/superpowers/specs/2026-06-25-runtime-preview-editor-parity-design.md and docs/superpowers/plans/2026-06-25-runtime-preview-editor-parity.md.

Focus on:
- root preview-template parity
- Default device browser debug and screenshot evidence
- preview prerequisite chunk product-level shape
- browser smoke correctness
- facts/issues/acceptance matrix consistency

Report findings only. Do not modify files.
```

- [ ] **Step 5: Fix review findings**

If review finds P1/P2 issues, fix them with focused tests first. Re-run Step 1 and Step 2 before continuing.

- [ ] **Step 6: Final status check**

Run:

```powershell
rtk git status --short
rtk git log --oneline -8
```

Expected:

- Working tree clean.
- Recent commits show Task 2 through Task 7 implementation commits.

---

## Self-Review

- Spec coverage:
  - Root template priority: Task 1, Task 2, Task 6, Task 7.
  - Project `script.ejs` non-authority: Task 1, Task 2.
  - Template render failure: Task 1, Task 2.
  - Device settings/fallback and browser evidence: Task 1, Task 2, Task 5, Task 6, Task 7.
  - Preview prerequisite static deps: Task 3, Task 4, Task 6, Task 7.
  - Browser smoke: Task 5, Task 6, Task 8.
  - Facts/issues/acceptance docs: Task 7.
- Red-flag scan:
  - The plan contains no deferred-content sections. Task 7 derives facts from concrete evidence JSON paths.
- Type consistency:
  - `BrowserCanvasDebugEvidence` is added to `BrowserRuntimeSmokeResult` and reused in `main-test-project-cli-integration.test.ts`.
  - `readRuntimePreviewPrerequisiteEvidence()` returns the fields consumed by Task 6.
