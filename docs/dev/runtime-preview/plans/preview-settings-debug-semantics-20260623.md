# Runtime Preview Debug Semantics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 CLI runtime preview 对齐旧 Editor browser preview 的 `debug:true` settings 语义，避免把 normal build profile 的 `debug:false` 传播成半压缩 bundle config。

**Architecture:** `getPreviewSettings()` 仍以真实 `web-desktop` options 为基础，但 preview option 合并后显式覆盖 `debug:true`。`PreviewSettingsProvider` 增加已知半压缩 bundle config 防御，阻止当前复现的 `debug:false`、缺 `types`、字符串 asset type 组合进入 HTTP route；该防御不是完整 compressed config schema verifier。测试分为 builder option merge 单测、provider bad-shape rejection 单测和 focused 真实 CLI integration 对 `/assets/internal/config.json` 的自动断言。

**Tech Stack:** TypeScript、Jest、Vitest、Cocos builder preview settings、runtime preview HTTP settings provider。

---

## 事实依据

- 事实文档：[../facts/preview-settings-debug-semantics-20260623.md](../facts/preview-settings-debug-semantics-20260623.md)。
- 旧 Editor reference `index.js#generateSettings()` 显式调用 `builder.generate-preview-setting` 并传 `debug:!0`、`preview:!0`。
- 当前 CLI `src/core/builder/index.ts#getPreviewSettings()` 会把项目 `web-desktop` profile 的 `debug:false` 带入 preview。
- 当前 preview asset data task 不执行 `Bundle.compress()`，因此不能产出 `debug:false` compressed bundle config。

## 文件结构

- Modify: `src/core/builder/index.ts`
  - `getPreviewSettings()` 使用内部 preview options 合并函数，保证 `debug:true` 最后覆盖。
- Create: `src/core/builder/preview-options.ts`
  - 放置无副作用的 `createPreviewBuildOptions()`，方便单测验证且不加载完整 builder 链路。
- Create: `src/core/builder/test/preview-settings-debug-option.spec.ts`
  - 用 Jest 快速验证 preview options 合并语义，不启动真实 engine / AssetDB。
- Modify: `src/runtime-preview/settings/preview-settings-provider.ts`
  - 增加 `validatePreviewBundleConfigs()`，在 provider 接收 CLI output 后校验半压缩 config。
- Modify: `vitests/suites/runtime-preview/settings-generation.test.ts`
  - 增加 provider 对非法 `debug:false` preview bundle config 的清晰错误测试。
- Create: `vitests/suites/runtime-preview/preview-settings-debug-integration.test.ts`
  - 启动真实 CLI runtime preview，请求 `/assets/internal/config.json`，自动断言 preview bundle config 为 `debug:true`，不进入已知 failing 的 browser scene smoke。
- Modify: `docs/dev/runtime-preview/issues.md`
  - 将 `RP-ISSUE-020` 更新为计划中的问题，并引用事实和计划。

---

### Task 1: 登记 runtime preview issue 和事实

**Files:**
- Modify: `docs/dev/runtime-preview/issues.md`
- Create: `docs/dev/runtime-preview/facts/preview-settings-debug-semantics-20260623.md`
- Create: `docs/dev/runtime-preview/plans/preview-settings-debug-semantics-20260623.md`

- [ ] **Step 1: 确认台账新增 `RP-ISSUE-020`**

新增条目应放在 `RP-ISSUE-019` 后：

```markdown
| RP-ISSUE-020 | CLI runtime preview 继承 build profile `debug:false` 生成半压缩 bundle config | `in-progress` | 旧 Editor browser preview 生成 settings 时显式传 `debug:true`；当前 CLI 合并真实 `web-desktop` options 后继承主测试项目 profile 的 `debug:false`，但 preview 路径没有执行 `Bundle.compress()`，导致 `/assets/internal/config.json` 标记 `debug:false` 却缺少 `types`，浏览器 runtime 在 `cc.EffectAsset` 类型解析处崩溃。 | [facts/preview-settings-debug-semantics-20260623.md](facts/preview-settings-debug-semantics-20260623.md) | [plans/preview-settings-debug-semantics-20260623.md](plans/preview-settings-debug-semantics-20260623.md) | `src/core/builder/test/preview-settings-debug-option.spec.ts`、`vitests/suites/runtime-preview/settings-generation.test.ts`、主测试项目 browser smoke |
```

- [ ] **Step 2: 运行文档检查**

Run:

```bash
rtk pwsh -NoLogo -NoProfile -Command "[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new(); rg -n 'RP-ISSUE-020|preview-settings-debug-semantics' docs/dev/runtime-preview"
```

Expected:

```text
输出至少包含以下三类匹配：
docs/dev/runtime-preview/issues.md:<line>:| RP-ISSUE-020 | CLI runtime preview 继承 build profile `debug:false` 生成半压缩 bundle config
docs/dev/runtime-preview/facts/preview-settings-debug-semantics-20260623.md:<line>:# Runtime Preview `debug` 语义事实记录（2026-06-23）
docs/dev/runtime-preview/plans/preview-settings-debug-semantics-20260623.md:<line>:# Runtime Preview Debug Semantics Implementation Plan
```

---

### Task 2: 用 Jest 固化 preview options 合并语义

**Files:**
- Create: `src/core/builder/preview-options.ts`
- Create: `src/core/builder/test/preview-settings-debug-option.spec.ts`
- Modify: `src/core/builder/index.ts`

- [ ] **Step 1: 写失败测试**

创建 `src/core/builder/test/preview-settings-debug-option.spec.ts`：

```ts
import { createPreviewBuildOptions } from '../preview-options';

describe('createPreviewBuildOptions', () => {
    it('forces debug true for runtime preview even when web-desktop defaults are release-like', () => {
        const result = createPreviewBuildOptions(
            {
                platform: 'web-desktop',
                debug: false,
                sourceMaps: true,
                taskId: 'release-task',
            } as any,
            {
                startScene: 'scene-uuid',
            } as any,
        );

        expect(result.platform).toBe('web-desktop');
        expect(result.preview).toBe(true);
        expect(result.debug).toBe(true);
        expect(result.sourceMaps).toBe(true);
        expect(result.taskId).toBe('release-task');
        expect(result.startScene).toBe('scene-uuid');
    });

    it('does not allow caller override debug false in preview settings generation', () => {
        const result = createPreviewBuildOptions(
            {
                platform: 'web-desktop',
                debug: true,
            } as any,
            {
                debug: false,
                startScene: 'scene-uuid',
            } as any,
        );

        expect(result.preview).toBe(true);
        expect(result.debug).toBe(true);
    });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run:

```bash
rtk npm test -- --runTestsByPath src/core/builder/test/preview-settings-debug-option.spec.ts
```

Expected:

```text
FAIL src/core/builder/test/preview-settings-debug-option.spec.ts
createPreviewBuildOptions is not exported
```

- [ ] **Step 3: 增加 preview options 合并函数**

创建 `src/core/builder/preview-options.ts`：

```ts
import type { IBuildTaskOption, Platform } from './@types/private';

export function createPreviewBuildOptions<P extends Platform>(
    defaultBuildOptions: IBuildTaskOption<P>,
    options?: IBuildTaskOption<P>,
): IBuildTaskOption<P> {
    return {
        ...defaultBuildOptions,
        ...(options ?? {}),
        preview: true,
        debug: true,
    };
}
```

在 `src/core/builder/index.ts` 顶部导入：

```ts
import { createPreviewBuildOptions } from './preview-options';
```

修改 `getPreviewSettings()`：

```ts
export async function getPreviewSettings<P extends Platform>(options?: IBuildTaskOption<P>): Promise<IPreviewSettingsResult> {
    const defaultBuildOptions = await pluginManager.getOptionsByPlatform('web-desktop');
    const buildOptions = createPreviewBuildOptions(defaultBuildOptions as IBuildTaskOption<P>, options);
    await fillIncludeModulesFromProjectConfig(buildOptions);
    const { BuildTask } = await import('./worker/builder/index');
    const buildTask = new BuildTask(buildOptions.taskId || 'v', buildOptions as unknown as IBuildTaskOption<Platform>);
}
```

只替换 `buildOptions` 的构造方式；`console.time()`、`buildTask.getPreviewSettings()`、`script2library` 生成和 return object 保持现有代码不变。关键要求：`debug:true` 必须在 spread 最后，不能被 `options.debug=false` 覆盖。

- [ ] **Step 4: 跑 Jest 测试确认通过**

Run:

```bash
rtk npm test -- --runTestsByPath src/core/builder/test/preview-settings-debug-option.spec.ts
```

Expected:

```text
PASS src/core/builder/test/preview-settings-debug-option.spec.ts
```

---

### Task 3: 增加已知半压缩 preview bundle config 防御

**Files:**
- Modify: `src/runtime-preview/settings/preview-settings-provider.ts`
- Modify: `vitests/suites/runtime-preview/settings-generation.test.ts`

- [ ] **Step 1: 写失败测试**

在 `vitests/suites/runtime-preview/settings-generation.test.ts` 的 `describe('runtime preview settings provider', () => {` 代码块内、现有 timeout 测试之前新增：

```ts
  it('rejects debug false bundle configs that are not compressed', async () => {
    const provider = new PreviewSettingsProvider({
      loadPreviewSettings: async () => ({
        settings: { assets: {} },
        script2library: {},
        bundleConfigs: [
          {
            name: 'internal',
            debug: false,
            paths: {
              'ba21476f-2866-4f81-9c4d-6e359316e448': [
                'db:/internal/physics/default-physics-material',
                'cc.PhysicsMaterial',
                1,
              ],
            },
          },
        ],
      }),
    });

    await expect(provider.getPreviewSettings()).rejects.toThrow(
      'Invalid preview bundle config "internal": debug=false requires a compressed types array',
    );
  });
```

- [ ] **Step 2: 跑测试确认失败**

Run:

```bash
rtk npm --prefix vitests test -- suites/runtime-preview/settings-generation.test.ts
```

Expected:

```text
FAIL suites/runtime-preview/settings-generation.test.ts
Expected promise to reject, but it resolved
```

- [ ] **Step 3: 实现 `debug:false` 已知半压缩防御**

在 `src/runtime-preview/settings/preview-settings-provider.ts` 中添加：

```ts
function validatePreviewBundleConfigs(bundleConfigs: Array<Record<string, any>>): void {
    for (const config of bundleConfigs) {
        if (config?.debug !== false) {
            continue;
        }

        const bundleName = typeof config.name === 'string' ? config.name : '<unnamed>';
        if (!Array.isArray(config.types)) {
            throw new Error(`Invalid preview bundle config "${bundleName}": debug=false requires a compressed types array`);
        }

        const paths = config.paths && typeof config.paths === 'object' ? config.paths : {};
        for (const [id, entry] of Object.entries(paths)) {
            if (!Array.isArray(entry)) {
                continue;
            }

            if (typeof entry[1] !== 'number') {
                throw new Error(`Invalid preview bundle config "${bundleName}": path "${id}" keeps string asset type while debug=false`);
            }
        }
    }
}
```

在 `PreviewSettingsProvider.getPreviewSettings()` 中，`cliResult` 返回后、构造 `result` 前调用：

```ts
validatePreviewBundleConfigs(cliResult.bundleConfigs);
```

- [ ] **Step 4: 跑 Vitest 确认通过**

Run:

```bash
rtk npm --prefix vitests test -- suites/runtime-preview/settings-generation.test.ts
```

Expected:

```text
PASS suites/runtime-preview/settings-generation.test.ts
```

---

### Task 4: 增加 focused 真实 CLI 自动回归断言

**Files:**
- Create: `vitests/suites/runtime-preview/preview-settings-debug-integration.test.ts`

- [ ] **Step 1: 写真实 `/assets/internal/config.json` focused integration**

创建 `vitests/suites/runtime-preview/preview-settings-debug-integration.test.ts`：

```ts
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { getCliIntegrationFixturePaths } from '@shared/fixture-paths';
import {
  canListen,
  startRuntimePreviewCliProcess,
} from '@shared/runtime-preview-cli-process';

async function findAvailablePort(startPort: number, attempts: number): Promise<number> {
  for (let offset = 0; offset < attempts; offset += 1) {
    const port = startPort + offset;
    if (await canListen(port)) {
      return port;
    }
  }

  throw new Error(`No available runtime preview test port in range ${startPort}-${startPort + attempts - 1}.`);
}

describe('runtime preview debug settings semantics', () => {
  it('serves uncompressed debug bundle config from real CLI preview settings', async () => {
    const paths = getCliIntegrationFixturePaths();
    const repoRoot = join(process.cwd(), '..');
    const port = await findAvailablePort(19701, 50);

    const cli = await startRuntimePreviewCliProcess({
      repoRoot,
      projectRoot: paths.projectRoot,
      engineRoot: paths.engineRoot,
      editorLibraryRef: paths.editorLibraryRef,
      editorProgrammingRef: paths.editorProgrammingRef,
      host: '127.0.0.1',
      port,
      startupTimeoutMs: 120_000,
    });

    let closeResult: Awaited<ReturnType<typeof cli.close>> | null = null;
    try {
      const internalConfigResponse = await fetch(`${cli.url}/assets/internal/config.json`);
      expect(internalConfigResponse.status).toBe(200);
      const internalConfig = await internalConfigResponse.json() as {
        name: string;
        debug?: boolean;
        types?: unknown[];
        paths?: Record<string, unknown[]>;
      };
      expect(internalConfig.name).toBe('internal');
      expect(internalConfig.debug).toBe(true);
      expect(internalConfig.types).toBeUndefined();
      const firstInternalPath = Object.values(internalConfig.paths ?? {})[0];
      expect(Array.isArray(firstInternalPath)).toBe(true);
      expect(typeof firstInternalPath?.[1]).toBe('string');
    } finally {
      closeResult = await cli.close();
    }

    expect(closeResult.portReleased).toBe(true);
  }, 180_000);
});
```

这条 focused integration 验证真实 CLI / BuildTask / HTTP route 组合输出的是 Editor-like preview debug config，而不是只验证 helper 函数。它不复用 `main-test-project-cli-integration.test.ts`，因为该 acceptance 当前还会被已知 `cc.TiledLayer` / `cc.TiledMap` browser smoke 问题阻塞。

- [ ] **Step 2: 跑真实 CLI integration**

Run:

```bash
rtk npm --prefix vitests test -- suites/runtime-preview/preview-settings-debug-integration.test.ts
```

Expected:

```text
PASS suites/runtime-preview/preview-settings-debug-integration.test.ts
```

---

### Task 5: 手工回归当前 browser crash

**Files:**
- No source file changes beyond Task 2 / Task 3 / Task 4.

- [ ] **Step 1: 编译 CLI**

Run:

```bash
rtk npm run build
```

Expected:

```text
exit code 0
```

- [ ] **Step 2: 终端 A 用共享模式启动主测试项目 runtime preview**

Run in terminal A:

```bash
rtk pwsh -NoLogo -NoProfile -Command '$env:COCOS_CLI_SHARED_LIBRARY_OUTPUT="1"; $env:COCOS_CLI_TEST_EDITOR_LIBRARY_REF="E:\own_space\engines\cocos-test-projects\library"; node .\dist\cli.js preview --project E:\own_space\engines\cocos-test-projects --runtime --port 9527'
```

Expected:

```text
preview:ready
```

- [ ] **Step 3: 终端 B 检查 `/assets/internal/config.json`**

Run in terminal B while terminal A is still running:

```bash
rtk pwsh -NoLogo -NoProfile -Command "[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new(); (Invoke-WebRequest 'http://127.0.0.1:9527/assets/internal/config.json').Content | ConvertFrom-Json | Select-Object name,debug"
```

Expected:

```text
name     debug
----     -----
internal  True
```

- [ ] **Step 4: 打开浏览器 smoke**

用 Playwright 或现有 in-app/browser 工具打开：

```text
http://127.0.0.1:9527
```

Expected:

```text
不再出现 Cannot read properties of undefined (reading 'cc.EffectAsset')
```

如果出现新的 runtime error，必须按新栈登记或继续追根因，不得把本 issue 标记为 fixed。

- [ ] **Step 5: 停止终端 A 的 preview 进程**

在终端 A 按 `Ctrl+C`。如果端口未释放，用下列命令查看占用进程后按 PID 精确停止：

```bash
rtk pwsh -NoLogo -NoProfile -Command "Get-NetTCPConnection -LocalPort 9527 -ErrorAction SilentlyContinue | Select-Object LocalAddress,LocalPort,State,OwningProcess"
```

---

### Task 6: 最终验证和台账回填

**Files:**
- Modify: `docs/dev/runtime-preview/issues.md`

- [ ] **Step 1: 跑 focused tests**

Run:

```bash
rtk npm test -- --runTestsByPath src/core/builder/test/preview-settings-debug-option.spec.ts
rtk npm --prefix vitests test -- suites/runtime-preview/settings-generation.test.ts
rtk npm --prefix vitests test -- suites/runtime-preview/preview-settings-debug-integration.test.ts
```

Expected:

```text
PASS src/core/builder/test/preview-settings-debug-option.spec.ts
PASS suites/runtime-preview/settings-generation.test.ts
PASS suites/runtime-preview/preview-settings-debug-integration.test.ts
```

- [ ] **Step 2: 回填 issue 状态**

如果 Task 4 自动 integration 通过，并且 `/assets/internal/config.json` 已确认返回 Editor-like `debug:true` config，将 `docs/dev/runtime-preview/issues.md` 中 `RP-ISSUE-020` 状态从 `in-progress` 改为 `fixed`。完整 browser scene smoke 若仍失败，必须按实际错误归属判断；当前已知 `cc.TiledLayer` / `cc.TiledMap` 属于 `RP-ISSUE-016`，不能反向否定本 issue 的 config-level 修复。

- [ ] **Step 3: 提交**

Run:

```bash
rtk git status --short
rtk git add src/core/builder/index.ts src/core/builder/preview-options.ts src/core/builder/test/preview-settings-debug-option.spec.ts src/runtime-preview/settings/preview-settings-provider.ts vitests/suites/runtime-preview/settings-generation.test.ts vitests/suites/runtime-preview/preview-settings-debug-integration.test.ts docs/dev/runtime-preview/issues.md docs/dev/runtime-preview/facts/preview-settings-debug-semantics-20260623.md docs/dev/runtime-preview/plans/preview-settings-debug-semantics-20260623.md
rtk git commit -m "fix(runtime-preview): force preview debug settings"
```

Expected:

```text
[codex/rebase-adapter-to-386-origin-main-20260622 <sha>] fix(runtime-preview): force preview debug settings
```

---

## Plan 自检

- 覆盖事实：旧 Editor preview 显式 `debug:true`、当前 CLI 半压缩 config、engine runtime `debug:false` contract。
- 覆盖实现：preview options 最终覆盖 `debug:true`，provider 防御已知 `debug:false` 半压缩 bad shape。
- 覆盖测试：Jest 测合并语义，Vitest 测 provider failure，真实 CLI integration 测 HTTP config，browser smoke 测当前用户复现。
- 非目标：不回滚真实 `web-desktop` options 合并；不让 preview 跑完整 normal build；不在 engine runtime 容错非法 config；不改 shared library cache 策略。

## 执行记录

- 已创建 `src/core/builder/preview-options.ts`，`getPreviewSettings()` 通过 `createPreviewBuildOptions()` 最终覆盖 `preview:true`、`debug:true`。
- 已创建 `src/core/builder/test/preview-settings-debug-option.spec.ts`，覆盖默认 `debug:false` 和调用方 `debug:false` 都不能穿透 preview settings 生成边界。
- 已在 `src/runtime-preview/settings/preview-settings-provider.ts` 增加 `validatePreviewBundleConfigs()`，拒绝已知 `debug:false` 半压缩 bad shape。
- 已在 `vitests/suites/runtime-preview/settings-generation.test.ts` 增加 provider rejection 测试。
- 已创建 `vitests/suites/runtime-preview/preview-settings-debug-integration.test.ts`，用真实 CLI child process 请求 `/assets/internal/config.json`，断言 `internal.debug === true`、`types` 不存在、`paths[*][1]` 仍为 string。
- 已验证 `rtk npm run build` 通过；API Extractor / Rollup 输出存在当前仓库既有 warning，但 build exit code 为 0。
- `vitests/suites/runtime-preview/main-test-project-cli-integration.test.ts` 仍失败于 `RP-ISSUE-016` 的 `cc.TiledLayer` / `cc.TiledMap`，不作为 `RP-ISSUE-020` 的剩余阻塞。
