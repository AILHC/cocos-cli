# Texture Compression Tool Resolver Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 CLI normal build 默认按仓库内 Creator 3.8.6 差异工具 overlay 选择匹配的 texture compression tool。当前必须让 PVRTC 默认使用 Creator 3.8.6 对应的 `PVRTexTool 4.20.0`，同时保留显式配置切换、旧 CLI bundled fallback 和诊断能力。

**Architecture:** 新增一个专用 `texture-compress` tool resolver，负责按具体工具相对路径解析 tool path、tool version、source，并向 `compress-tool.ts` 返回缓存后的稳定结果。`compressPVR()`、`compressWebp()`、`compressEtc()`、`compressAstc()` 均通过 resolver 查找具体工具；无显式 override 时先查 `static/tools/creator-3.8.6/<relativePath>`，overlay 中没有该工具时回退 `static/tools/<relativePath>`。

**Decision update:** 初版计划只实现显式 override，默认仍 fallback CLI bundled。后续确认目标后先误走过“复制整套 Editor 3.8.6 `resources/tools`”方案；最终决策修正为只复制与现有 `static/tools` 有差异且影响当前问题的工具文件。当前 `static/tools/creator-3.8.6` 只包含 `PVRTexTool_win32/PVRTexToolCLI.exe` 和 `PVRTexTool_win32/compare.exe`。

**Tech Stack:** TypeScript、Jest、Cocos CLI builder、PowerShell/rtk、Cocos Creator 3.8.6 texture compression tools。

---

## 背景事实

- 问题登记：`docs/dev/build/issues.md` 的 `BUILD-ISSUE-022`。
- 事实入口：`docs/dev/build/facts/auto-atlas-texture-compress-editor-cli-parity-20260617.md`。
- 当前 CLI PVRTC tool：`E:\own_space\engines\cocos-cli\static\tools\PVRTexTool_win32\PVRTexToolCLI.exe`，`ProductVersion=5.5.0`。
- Creator 3.8.6 PVRTC tool：`D:\cocos_editors\Creator\Creator\3.8.6\resources\tools\PVRTexTool_win32\PVRTexToolCLI.exe`，`ProductVersion=4.20.0`。
- 当前 `compressPVR()` 使用参数形态：`-f PVRTC1_4_RGB,UBN,lRGB`。
- clean rerun 中 Editor baseline 不报 `Invalid values chosen`；CLI bundled `PVRTexTool 5.5.0` 报 `Invalid values chosen for Encode Format`。
- 官方 `cocos-cli` `main` 当前仍固定从 `GlobalPaths.staticDir/tools/PVRTexTool_*` 取工具，没有 version-aware resolver。
- `BUILD-ISSUE-022` 的完整方向包含“与当前 Editor/engine 版本匹配的工具”。当前实现不从项目或 engine 自动推断 Creator 安装路径，而是在仓库内维护 Creator 3.8.6 差异 overlay；后续升级 Creator/engine 时按差异文件更新 overlay 并复验。

## 文件结构

- Create: `src/core/builder/worker/builder/asset-handler/texture-compress/tool-resolver.ts`
  - 负责解析 texture compression tool path。
  - 负责读取 Windows `VersionInfo.ProductVersion` 或通过可执行文件探测获得版本，并缓存解析结果，避免每个压缩任务重复 spawn 版本探测进程。
  - 负责输出 resolver source：`explicit-tool-path`、`explicit-tools-root`、`creator-resources`、`creator-root`、`bundled-creator-3.8.6`、`cli-bundled`。
- Test: `src/core/builder/test/texture-compress-tool-resolver.spec.ts`
  - 单测 resolver 优先级、平台路径、Creator root、fallback、版本读取失败降级和缓存。
- Modify: `src/core/builder/worker/builder/asset-handler/texture-compress/compress-tool.ts`
  - `compressPVR()`、`compressWebp()`、`compressEtc()`、`compressAstc()` 调用 resolver。
  - 日志输出 tool path、source、version。
  - error message 中继续使用实际 `toolsPath`。
- Modify: `docs/dev/build/issues.md`
  - 实现完成后更新 `BUILD-ISSUE-022` 状态和验证证据；本计划阶段不修改。
- Optional after implementation: `docs/dev/build/facts/auto-atlas-texture-compress-editor-cli-parity-20260617.md`
  - 若复跑 clean parity，追加 tool resolver 验证结果。

## Resolver 设计

支持以下输入，按优先级解析：

1. `COCOS_CLI_PVRTEXTOOL_PATH`
   - 指向完整可执行文件。
   - Windows 示例：`D:\cocos_editors\Creator\Creator\3.8.6\resources\tools\PVRTexTool_win32\PVRTexToolCLI.exe`
2. `COCOS_CLI_TEXTURE_TOOLS_ROOT`
   - 指向包含 `PVRTexTool_win32`、`PVRTexTool_darwin` 等目录的 tools root。
   - Windows 示例：`D:\cocos_editors\Creator\Creator\3.8.6\resources\tools`
3. `COCOS_CREATOR_RESOURCES_PATH`
   - 指向 Creator 的 `resources` 目录，resolver 自动拼 `tools/...`。
   - Windows 示例：`D:\cocos_editors\Creator\Creator\3.8.6\resources`
4. `COCOS_CREATOR_ROOT`
   - 指向 Creator 安装根，resolver 自动拼 `resources/tools/...`。
   - Windows 示例：`D:\cocos_editors\Creator\Creator\3.8.6`
   - resolver source 记录为 `creator-root`，与 `COCOS_CREATOR_RESOURCES_PATH` 区分。
5. `static/tools/creator-3.8.6/<relativePath>`
   - 仓库内 Creator 3.8.6 差异 overlay，只放与当前 `static/tools` 存在差异且影响构建的文件。
   - 当前包含 `PVRTexTool_win32/PVRTexToolCLI.exe` 与 `PVRTexTool_win32/compare.exe`。
6. CLI bundled fallback
   - 继续使用 `GlobalPaths.staticDir/tools/<relativePath>`。
   - overlay 中没有差异文件的工具，例如当前 `libwebp_win32/bin/cwebp.exe`，默认仍使用 CLI bundled 版本。

不在本轮做的事情：

- 不复制 Creator 3.8.6 的整套 `resources/tools`。
- 不修改 `workflow/download-tools.js` 的下载源。
- 不改 PVRTC 参数映射。若后续需要支持 `PVRTexTool 5.5.0`，应以单独任务验证新版 `Encode Format` 参数。
- 不自动扫描 `D:\cocos_editors` 之类本机目录，避免 production 行为依赖开发机约定。

## Task 1: 新增 resolver 单测

**Files:**
- Create: `src/core/builder/test/texture-compress-tool-resolver.spec.ts`
- Create later in Task 2: `src/core/builder/worker/builder/asset-handler/texture-compress/tool-resolver.ts`

- [ ] **Step 1: 写失败单测**

创建 `src/core/builder/test/texture-compress-tool-resolver.spec.ts`：

```ts
import { ensureDirSync, removeSync, writeFileSync } from 'fs-extra';
import { join } from 'path';
import { tmpdir } from 'os';

const originalEnv = { ...process.env };

jest.mock('../../../global', () => ({
    GlobalPaths: {
        staticDir: join(tmpdir(), 'cocos-cli-tool-resolver-static'),
    },
}));

function resetEnv() {
    process.env = { ...originalEnv };
    delete process.env.COCOS_CLI_PVRTEXTOOL_PATH;
    delete process.env.COCOS_CLI_TEXTURE_TOOLS_ROOT;
    delete process.env.COCOS_CREATOR_RESOURCES_PATH;
    delete process.env.COCOS_CREATOR_ROOT;
}

function touchTool(path: string) {
    ensureDirSync(path.replace(/[\\/][^\\/]+$/, ''));
    writeFileSync(path, 'fake tool');
}

function pvrRelativeToolPath() {
    return process.platform === 'win32'
        ? join('PVRTexTool_win32', 'PVRTexToolCLI.exe')
        : join('PVRTexTool_darwin', 'PVRTexToolCLI');
}

describe('texture compress tool resolver', () => {
    const root = join(tmpdir(), 'cocos-cli-tool-resolver-test');

    beforeEach(() => {
        jest.resetModules();
        resetEnv();
        removeSync(root);
        removeSync(join(tmpdir(), 'cocos-cli-tool-resolver-static'));
    });

    afterAll(() => {
        process.env = originalEnv;
        removeSync(root);
        removeSync(join(tmpdir(), 'cocos-cli-tool-resolver-static'));
    });

    test('prefers COCOS_CLI_PVRTEXTOOL_PATH over every root fallback', async () => {
        const explicitTool = join(root, 'explicit', 'PVRTexToolCLI.exe');
        const toolsRootTool = join(root, 'tools-root', pvrRelativeToolPath());
        touchTool(explicitTool);
        touchTool(toolsRootTool);
        process.env.COCOS_CLI_PVRTEXTOOL_PATH = explicitTool;
        process.env.COCOS_CLI_TEXTURE_TOOLS_ROOT = join(root, 'tools-root');

        const { resolveTextureCompressTool } = await import('../worker/builder/asset-handler/texture-compress/tool-resolver');
        const result = await resolveTextureCompressTool('pvr');

        expect(result.path).toBe(explicitTool);
        expect(result.source).toBe('explicit-tool-path');
        expect(result.version).toBeTruthy();
    });

    test('resolves PVRTexTool from COCOS_CLI_TEXTURE_TOOLS_ROOT', async () => {
        const tool = join(root, 'tools', pvrRelativeToolPath());
        touchTool(tool);
        process.env.COCOS_CLI_TEXTURE_TOOLS_ROOT = join(root, 'tools');

        const { resolveTextureCompressTool } = await import('../worker/builder/asset-handler/texture-compress/tool-resolver');
        const result = await resolveTextureCompressTool('pvr');

        expect(result.path).toBe(tool);
        expect(result.source).toBe('explicit-tools-root');
    });

    test('resolves PVRTexTool from Creator resources path', async () => {
        const resources = join(root, 'Creator', 'resources');
        const tool = join(resources, 'tools', pvrRelativeToolPath());
        touchTool(tool);
        process.env.COCOS_CREATOR_RESOURCES_PATH = resources;

        const { resolveTextureCompressTool } = await import('../worker/builder/asset-handler/texture-compress/tool-resolver');
        const result = await resolveTextureCompressTool('pvr');

        expect(result.path).toBe(tool);
        expect(result.source).toBe('creator-resources');
    });

    test('resolves PVRTexTool from Creator root and reports creator-root source', async () => {
        const creatorRoot = join(root, 'CreatorRoot');
        const tool = join(creatorRoot, 'resources', 'tools', pvrRelativeToolPath());
        touchTool(tool);
        process.env.COCOS_CREATOR_ROOT = creatorRoot;

        const { resolveTextureCompressTool } = await import('../worker/builder/asset-handler/texture-compress/tool-resolver');
        const result = await resolveTextureCompressTool('pvr');

        expect(result.path).toBe(tool);
        expect(result.source).toBe('creator-root');
    });

    test('Creator resources path has priority over Creator root', async () => {
        const resourcesTool = join(root, 'CreatorResources', 'tools', pvrRelativeToolPath());
        const rootTool = join(root, 'CreatorRoot', 'resources', 'tools', pvrRelativeToolPath());
        touchTool(resourcesTool);
        touchTool(rootTool);
        process.env.COCOS_CREATOR_RESOURCES_PATH = join(root, 'CreatorResources');
        process.env.COCOS_CREATOR_ROOT = join(root, 'CreatorRoot');

        const { resolveTextureCompressTool } = await import('../worker/builder/asset-handler/texture-compress/tool-resolver');
        const result = await resolveTextureCompressTool('pvr');

        expect(result.path).toBe(resourcesTool);
        expect(result.source).toBe('creator-resources');
    });

    test('falls back to CLI bundled PVRTexTool', async () => {
        const tool = join(tmpdir(), 'cocos-cli-tool-resolver-static', 'tools', pvrRelativeToolPath());
        touchTool(tool);

        const { resolveTextureCompressTool } = await import('../worker/builder/asset-handler/texture-compress/tool-resolver');
        const result = await resolveTextureCompressTool('pvr');

        expect(result.path).toBe(tool);
        expect(result.source).toBe('cli-bundled');
    });

    test('throws with checked candidates when no PVRTexTool exists', async () => {
        const { resolveTextureCompressTool } = await import('../worker/builder/asset-handler/texture-compress/tool-resolver');

        await expect(resolveTextureCompressTool('pvr')).rejects.toThrow(/Unable to resolve pvr texture compression tool/);
    });

    test('rejects unsupported tool kinds without affecting non-PVR compression selection', async () => {
        const { resolveTextureCompressTool } = await import('../worker/builder/asset-handler/texture-compress/tool-resolver');

        await expect(resolveTextureCompressTool('astc' as any)).rejects.toThrow(/Unsupported texture compression tool kind/);
    });
});
```

- [ ] **Step 2: 运行单测确认失败**

Run:

```powershell
rtk npm test -- --runTestsByPath src/core/builder/test/texture-compress-tool-resolver.spec.ts
```

Expected:

```text
FAIL src/core/builder/test/texture-compress-tool-resolver.spec.ts
Cannot find module '../worker/builder/asset-handler/texture-compress/tool-resolver'
```

## Task 2: 实现 resolver

**Files:**
- Create: `src/core/builder/worker/builder/asset-handler/texture-compress/tool-resolver.ts`
- Test: `src/core/builder/test/texture-compress-tool-resolver.spec.ts`

- [ ] **Step 1: 新增 resolver 实现**

创建 `src/core/builder/worker/builder/asset-handler/texture-compress/tool-resolver.ts`：

```ts
import { existsSync } from 'fs';
import { dirname, join } from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { GlobalPaths } from '../../../../../../global';

const execFileAsync = promisify(execFile);

export type TextureCompressToolKind = 'pvr';

export type TextureCompressToolSource =
    | 'explicit-tool-path'
    | 'explicit-tools-root'
    | 'creator-resources'
    | 'creator-root'
    | 'cli-bundled';

export interface TextureCompressToolResolution {
    kind: TextureCompressToolKind;
    path: string;
    source: TextureCompressToolSource;
    version: string;
    checkedPaths: string[];
}

interface ToolCandidate {
    path: string;
    source: TextureCompressToolSource;
}

const resolutionCache = new Map<TextureCompressToolKind, Promise<TextureCompressToolResolution>>();

function getPvrRelativeToolPath() {
    if (process.platform === 'win32') {
        return join('PVRTexTool_win32', 'PVRTexToolCLI.exe');
    }

    // Preserve the previous CLI behavior: non-Windows platforms use the darwin tool path.
    return join('PVRTexTool_darwin', 'PVRTexToolCLI');
}

function getPvrCandidates(): ToolCandidate[] {
    const candidates: ToolCandidate[] = [];
    const relativeToolPath = getPvrRelativeToolPath();

    if (process.env.COCOS_CLI_PVRTEXTOOL_PATH) {
        candidates.push({
            path: process.env.COCOS_CLI_PVRTEXTOOL_PATH,
            source: 'explicit-tool-path',
        });
    }

    if (process.env.COCOS_CLI_TEXTURE_TOOLS_ROOT) {
        candidates.push({
            path: join(process.env.COCOS_CLI_TEXTURE_TOOLS_ROOT, relativeToolPath),
            source: 'explicit-tools-root',
        });
    }

    if (process.env.COCOS_CREATOR_RESOURCES_PATH) {
        candidates.push({
            path: join(process.env.COCOS_CREATOR_RESOURCES_PATH, 'tools', relativeToolPath),
            source: 'creator-resources',
        });
    }

    if (process.env.COCOS_CREATOR_ROOT) {
        candidates.push({
            path: join(process.env.COCOS_CREATOR_ROOT, 'resources', 'tools', relativeToolPath),
            source: 'creator-root',
        });
    }

    candidates.push({
        path: join(GlobalPaths.staticDir, 'tools', relativeToolPath),
        source: 'cli-bundled',
    });

    return candidates;
}

async function readToolVersion(toolPath: string): Promise<string> {
    if (process.platform === 'win32') {
        try {
            const { stdout } = await execFileAsync('powershell.exe', [
                '-NoProfile',
                '-NonInteractive',
                '-Command',
                `(Get-Item -LiteralPath '${toolPath.replace(/'/g, "''")}').VersionInfo.ProductVersion`,
            ]);
            const version = stdout.trim();
            if (version) {
                return version;
            }
        } catch {
            // Fall through to CLI probing.
        }
    }

    try {
        const { stdout, stderr } = await execFileAsync(toolPath, ['-version']);
        const output = `${stdout}\n${stderr}`.trim();
        return output || 'unknown';
    } catch {
        return 'unknown';
    }
}

export async function resolveTextureCompressTool(kind: TextureCompressToolKind): Promise<TextureCompressToolResolution> {
    const cached = resolutionCache.get(kind);
    if (cached) {
        return cached;
    }

    const resolution = resolveTextureCompressToolUncached(kind);
    resolutionCache.set(kind, resolution);
    return resolution;
}

async function resolveTextureCompressToolUncached(kind: TextureCompressToolKind): Promise<TextureCompressToolResolution> {
    if (kind !== 'pvr') {
        throw new Error(`Unsupported texture compression tool kind: ${kind}`);
    }

    const candidates = getPvrCandidates();
    const checkedPaths = candidates.map((candidate) => candidate.path);
    const candidate = candidates.find((item) => existsSync(item.path));

    if (!candidate) {
        throw new Error(`Unable to resolve pvr texture compression tool. Checked paths: ${checkedPaths.join(', ')}`);
    }

    return {
        kind,
        path: candidate.path,
        source: candidate.source,
        version: await readToolVersion(candidate.path),
        checkedPaths,
    };
}

export function getTextureCompressToolDirectory(resolution: TextureCompressToolResolution) {
    return dirname(resolution.path);
}
```

`readToolVersion()` 使用 `powershell.exe` 是 production runtime 的 Windows version probe，不能加 `rtk`。`rtk` 只用于本计划中的开发和验证命令。

- [ ] **Step 2: 运行 resolver 单测**

Run:

```powershell
rtk npm test -- --runTestsByPath src/core/builder/test/texture-compress-tool-resolver.spec.ts
```

Expected:

```text
PASS src/core/builder/test/texture-compress-tool-resolver.spec.ts
```

## Task 3: 接入 `compressPVR()`

**Files:**
- Modify: `src/core/builder/worker/builder/asset-handler/texture-compress/compress-tool.ts`
- Test: `src/core/builder/test/texture-compress-tool-resolver.spec.ts`

- [ ] **Step 1: 修改 import**

在 `compress-tool.ts` 顶部新增 import：

```ts
import { resolveTextureCompressTool } from './tool-resolver';
```

- [ ] **Step 2: 替换 `compressPVR()` 中硬编码工具路径**

将 `compressPVR()` 中这段：

```ts
let pvrTool = Path.join(GlobalPaths.staticDir, 'tools/PVRTexTool_darwin/PVRTexToolCLI');
if (process.platform === 'win32') {
    pvrTool = Path.join(GlobalPaths.staticDir, 'tools/PVRTexTool_win32/PVRTexToolCLI.exe');
}
```

替换为：

```ts
const pvrToolResolution = await resolveTextureCompressTool('pvr');
const pvrTool = pvrToolResolution.path;
console.debug(
    `pvrtc tool resolved: path=${pvrToolResolution.path}, source=${pvrToolResolution.source}, version=${pvrToolResolution.version}`,
);
```

- [ ] **Step 3: 确认 error path 仍使用实际工具**

保留当前 error message：

```ts
toolsPath: `{file(${pvrTool})}`,
```

Expected: 构建失败时用户看到的是 resolver 选中的真实 `PVRTexToolCLI.exe`，不是 fallback 或静态路径。

- [ ] **Step 4: 运行 resolver 单测和 TypeScript build**

Run:

```powershell
rtk npm test -- --runTestsByPath src/core/builder/test/texture-compress-tool-resolver.spec.ts
rtk npm run build
```

Expected:

```text
PASS src/core/builder/test/texture-compress-tool-resolver.spec.ts
...
Exit code 0
```

- [ ] **Step 5: 增加非 PVR 分支轻量回归**

在 `src/core/builder/test/texture-compress-tool-resolver.spec.ts` 追加：

```ts
test('keeps non-PVR compression function selection unchanged', async () => {
    const { getCompressFunc, compressAstc, compressEtc, compressWebp } = await import('../worker/builder/asset-handler/texture-compress/compress-tool');

    expect(getCompressFunc('astc_4x4' as any)).toBe(compressAstc);
    expect(getCompressFunc('etc2_rgba' as any)).toBe(compressEtc);
    expect(getCompressFunc('webp' as any)).toBe(compressWebp);
});
```

Run:

```powershell
rtk npm test -- --runTestsByPath src/core/builder/test/texture-compress-tool-resolver.spec.ts
```

Expected:

```text
PASS src/core/builder/test/texture-compress-tool-resolver.spec.ts
```

## Task 4: 本机工具选择 smoke 验证

**Files:**
- No code changes.
- Evidence update later: `docs/dev/build/facts/auto-atlas-texture-compress-editor-cli-parity-20260617.md`

- [ ] **Step 1: 验证默认 fallback 仍解析 CLI bundled tool**

Run:

```powershell
rtk pwsh -NoProfile -Command "Remove-Item Env:COCOS_CLI_PVRTEXTOOL_PATH -ErrorAction SilentlyContinue; Remove-Item Env:COCOS_CLI_TEXTURE_TOOLS_ROOT -ErrorAction SilentlyContinue; Remove-Item Env:COCOS_CREATOR_RESOURCES_PATH -ErrorAction SilentlyContinue; Remove-Item Env:COCOS_CREATOR_ROOT -ErrorAction SilentlyContinue; npm test -- --runTestsByPath src/core/builder/test/texture-compress-tool-resolver.spec.ts"
```

Expected:

```text
PASS src/core/builder/test/texture-compress-tool-resolver.spec.ts
```

- [ ] **Step 2: 验证 build 后默认无 env 指向 Creator 3.8.6 overlay**

Run:

```powershell
rtk pwsh -NoProfile -Command "Remove-Item Env:COCOS_CLI_PVRTEXTOOL_PATH -ErrorAction SilentlyContinue; Remove-Item Env:COCOS_CLI_TEXTURE_TOOLS_ROOT -ErrorAction SilentlyContinue; Remove-Item Env:COCOS_CREATOR_RESOURCES_PATH -ErrorAction SilentlyContinue; Remove-Item Env:COCOS_CREATOR_ROOT -ErrorAction SilentlyContinue; node -e \"const r=require('./dist/core/builder/worker/builder/asset-handler/texture-compress/tool-resolver.js'); r.resolveTextureCompressTool('pvr').then(x=>console.log(JSON.stringify({path:x.path,source:x.source,version:x.version}))).catch(e=>{console.error(e); process.exit(1);})\""
```

Expected:

```json
{"path":"E:\\own_space\\engines\\cocos-cli\\static\\tools\\creator-3.8.6\\PVRTexTool_win32\\PVRTexToolCLI.exe","source":"bundled-creator-3.8.6","version":"4.20.0"}
```

该步骤必须在 `rtk npm run build` 成功后执行。当前 overlay 只验证 Windows `PVRTexTool_win32`；非 Windows 环境需要先补对应 Creator 3.8.6 差异工具事实和文件。

- [ ] **Step 3: 验证 Creator resources root 能选择 4.20.0**

Run:

```powershell
rtk pwsh -NoProfile -Command "$env:COCOS_CREATOR_RESOURCES_PATH='D:\cocos_editors\Creator\Creator\3.8.6\resources'; $tool='D:\cocos_editors\Creator\Creator\3.8.6\resources\tools\PVRTexTool_win32\PVRTexToolCLI.exe'; (Get-Item -LiteralPath $tool).VersionInfo.ProductVersion"
```

Expected:

```text
4.20.0
```

- [ ] **Step 4: 验证显式 `COCOS_CLI_TEXTURE_TOOLS_ROOT=static/tools` 可切换旧 CLI bundled 5.5.0**

Run:

```powershell
rtk pwsh -NoProfile -Command "$env:COCOS_CLI_TEXTURE_TOOLS_ROOT='E:\own_space\engines\cocos-cli\static\tools'; node -e \"const r=require('./dist/core/builder/worker/builder/asset-handler/texture-compress/tool-resolver.js'); r.resolveTextureCompressTool('pvr').then(x=>console.log(JSON.stringify({path:x.path,source:x.source,version:x.version}))).catch(e=>{console.error(e); process.exit(1);})\""
```

Expected:

```json
{"path":"E:\\own_space\\engines\\cocos-cli\\static\\tools\\PVRTexTool_win32\\PVRTexToolCLI.exe","source":"explicit-tools-root","version":"5.5.0"}
```

## Task 5: Clean parity 复跑

**Files:**
- No code changes unless verification exposes new facts.
- Update after success/failure: `docs/dev/build/facts/auto-atlas-texture-compress-editor-cli-parity-20260617.md`
- Update after success/failure: `docs/dev/build/issues.md`

- [ ] **Step 1: 确认无 texture tool override env**

Run:

```powershell
rtk pwsh -NoProfile -Command "Remove-Item Env:COCOS_CLI_PVRTEXTOOL_PATH -ErrorAction SilentlyContinue; Remove-Item Env:COCOS_CLI_TEXTURE_TOOLS_ROOT -ErrorAction SilentlyContinue; Remove-Item Env:COCOS_CREATOR_RESOURCES_PATH -ErrorAction SilentlyContinue; Remove-Item Env:COCOS_CREATOR_ROOT -ErrorAction SilentlyContinue; node .\dist\cli.js --help"
```

Expected:

```text
Usage:
```

命令退出码为 `0`。这里验证 default production 路径不依赖外部 Editor 安装目录或显式 override。

- [ ] **Step 2: 生成本轮唯一 config、日志路径和 current pointer**

Run:

```powershell
rtk pwsh -NoProfile -Command "$project='E:\own_space\engines\cocos-test-projects'; $runId='overlay-creator-tools-' + (Get-Date -Format 'yyyyMMdd-HHmmss'); $root=Join-Path (Get-Location) '.codex-tmp'; $dir=Join-Path $root $runId; New-Item -ItemType Directory -Force -Path $dir | Out-Null; $pathsFile=Join-Path $dir 'paths.json'; $summary=[pscustomobject]@{ runId=$runId; dir=$dir; webLog=(Join-Path $dir 'cli-web-mobile.log'); wechatLog=(Join-Path $dir 'cli-wechatgame.log'); webConfig=(Join-Path $dir 'buildConfig_web-mobile-autoatlas-compress.json'); wechatConfig=(Join-Path $dir 'buildConfig_wechatgame-autoatlas-compress.json'); webOutput=(Join-Path $project ('build\' + $runId + '-web-mobile')); wechatOutput=(Join-Path $project ('build\' + $runId + '-wechatgame')) }; $srcWeb='.codex-tmp\auto-atlas-texture-compress-20260617\buildConfig_web-mobile-autoatlas-compress.json'; $srcWechat='.codex-tmp\auto-atlas-texture-compress-20260617\buildConfig_wechatgame-autoatlas-compress.json'; if (!(Test-Path $srcWeb) -or !(Test-Path $srcWechat)) { throw 'missing source auto-atlas compress config' }; if ((Test-Path $summary.webOutput) -or (Test-Path $summary.wechatOutput)) { throw 'target output already exists' }; $web=Get-Content $srcWeb -Raw | ConvertFrom-Json; $wechat=Get-Content $srcWechat -Raw | ConvertFrom-Json; $web.outputName=$runId + '-web-mobile'; $web.logDest=$summary.webLog; $wechat.outputName=$runId + '-wechatgame'; $wechat.logDest=$summary.wechatLog; $web | ConvertTo-Json -Depth 100 | Set-Content -Encoding UTF8 $summary.webConfig; $wechat | ConvertTo-Json -Depth 100 | Set-Content -Encoding UTF8 $summary.wechatConfig; $summary | ConvertTo-Json | Set-Content -Encoding UTF8 $pathsFile; $pathsFile | Set-Content -Encoding UTF8 '.codex-tmp\tool-resolver-current-paths.txt'; Get-Content $pathsFile"
```

Expected:

```json
{
  "runId": "overlay-creator-tools-...",
  "dir": "E:\\own_space\\engines\\cocos-cli\\.codex-tmp\\overlay-creator-tools-...",
  "webLog": "E:\\own_space\\engines\\cocos-cli\\.codex-tmp\\overlay-creator-tools-...\\cli-web-mobile.log",
  "wechatLog": "E:\\own_space\\engines\\cocos-cli\\.codex-tmp\\overlay-creator-tools-...\\cli-wechatgame.log",
  "webConfig": "E:\\own_space\\engines\\cocos-cli\\.codex-tmp\\overlay-creator-tools-...\\buildConfig_web-mobile-autoatlas-compress.json",
  "wechatConfig": "E:\\own_space\\engines\\cocos-cli\\.codex-tmp\\overlay-creator-tools-...\\buildConfig_wechatgame-autoatlas-compress.json",
  "webOutput": "E:\\own_space\\engines\\cocos-test-projects\\build\\overlay-creator-tools-...-web-mobile",
  "wechatOutput": "E:\\own_space\\engines\\cocos-test-projects\\build\\overlay-creator-tools-...-wechatgame"
}
```

该步骤同时生成本轮 config，并写入 `.codex-tmp\tool-resolver-current-paths.txt`。后续命令必须读取这个 pointer，不能用“最新目录”推断，避免并行会话串台。

- [ ] **Step 3: 复跑 `web-mobile` CLI build**

Run:

```powershell
rtk pwsh -NoProfile -Command "$pathsFile=Get-Content '.codex-tmp\tool-resolver-current-paths.txt' -Raw; $paths=Get-Content $pathsFile.Trim() -Raw | ConvertFrom-Json; Remove-Item Env:COCOS_CLI_PVRTEXTOOL_PATH -ErrorAction SilentlyContinue; Remove-Item Env:COCOS_CLI_TEXTURE_TOOLS_ROOT -ErrorAction SilentlyContinue; Remove-Item Env:COCOS_CREATOR_RESOURCES_PATH -ErrorAction SilentlyContinue; Remove-Item Env:COCOS_CREATOR_ROOT -ErrorAction SilentlyContinue; node .\dist\cli.js build --project 'E:\own_space\engines\cocos-test-projects' --platform web-mobile --build-config $paths.webConfig *> $paths.webLog; exit $LASTEXITCODE"
```

Expected:

```text
Exit code 0
```

该命令读取 `.codex-tmp\tool-resolver-current-paths.txt` 指向的固定 `paths.json`。

- [ ] **Step 4: 复跑 `wechatgame` CLI build**

Run:

```powershell
rtk pwsh -NoProfile -Command "$pathsFile=Get-Content '.codex-tmp\tool-resolver-current-paths.txt' -Raw; $paths=Get-Content $pathsFile.Trim() -Raw | ConvertFrom-Json; Remove-Item Env:COCOS_CLI_PVRTEXTOOL_PATH -ErrorAction SilentlyContinue; Remove-Item Env:COCOS_CLI_TEXTURE_TOOLS_ROOT -ErrorAction SilentlyContinue; Remove-Item Env:COCOS_CREATOR_RESOURCES_PATH -ErrorAction SilentlyContinue; Remove-Item Env:COCOS_CREATOR_ROOT -ErrorAction SilentlyContinue; node .\dist\cli.js build --project 'E:\own_space\engines\cocos-test-projects' --platform wechatgame --build-config $paths.wechatConfig *> $paths.wechatLog; exit $LASTEXITCODE"
```

Expected:

```text
Exit code 0
```

该命令读取 `.codex-tmp\tool-resolver-current-paths.txt` 指向的固定 `paths.json`。

- [ ] **Step 5: 检查日志关键计数**

Run:

```powershell
rtk pwsh -NoProfile -Command "$pathsFile=Get-Content '.codex-tmp\tool-resolver-current-paths.txt' -Raw; $paths=Get-Content $pathsFile.Trim() -Raw | ConvertFrom-Json; $invalid=(Select-String -LiteralPath $paths.webLog,$paths.wechatLog -Pattern 'Invalid values chosen').Count; $width=(Select-String -LiteralPath $paths.webLog,$paths.wechatLog -Pattern 'texture compress task width asset').Count; $resolved=Select-String -LiteralPath $paths.webLog,$paths.wechatLog -Pattern 'pvrtc tool resolved'; $success=(Select-String -LiteralPath $paths.webLog,$paths.wechatLog -Pattern 'Compress image success').Count; [pscustomobject]@{InvalidValuesChosen=$invalid; TextureCompressTaskWidthAsset=$width; ResolverLines=$resolved.Count; CompressImageSuccess=$success}; $resolved.Line"
```

Expected:

```text
pvrtc tool resolved: path=E:\own_space\engines\cocos-cli\static\tools\creator-3.8.6\PVRTexTool_win32\PVRTexToolCLI.exe, source=bundled-creator-3.8.6, version=4.20.0
InvalidValuesChosen: 0
TextureCompressTaskWidthAsset: 0
ResolverLines: >= 1
CompressImageSuccess: >= 1
```

如果自动图集 `BUILD-ISSUE-021` 尚未修复，允许 `ReferenceError: Editor is not defined` 仍存在；本任务只验收 PVRTC tool resolver 不再造成 `Invalid values chosen`。

- [ ] **Step 6: 复跑 wechatgame parity test**

Run:

```powershell
rtk npm --prefix "E:\own_space\engines\cocos-cli\vitests" test -- suites/build/wechatgame-editor-baseline-parity.test.ts
```

Expected:

```text
PASS suites/build/wechatgame-editor-baseline-parity.test.ts
```

如果仍失败，需要区分失败原因：

- 若仍有 `Invalid values chosen`，回到 Task 2/3 排查 resolver 是否选错工具。
- 若仅因自动图集产物差异失败，记录为 `BUILD-ISSUE-021` 未解决，不阻塞 `BUILD-ISSUE-022` 的 tool resolver 结论。

## Task 6: 更新文档和问题状态

**Files:**
- Modify: `docs/dev/build/facts/auto-atlas-texture-compress-editor-cli-parity-20260617.md`
- Modify: `docs/dev/build/issues.md`

- [ ] **Step 1: 追加事实记录**

在事实文档追加章节：

```md
## Creator 3.8.6 差异工具 overlay 默认验证：overlay-creator-tools-YYYYMMDD-HHMMSS

- 设置：未设置任何 texture tool override env。
- Overlay 文件：`static/tools/creator-3.8.6/PVRTexTool_win32/PVRTexToolCLI.exe`、`static/tools/creator-3.8.6/PVRTexTool_win32/compare.exe`。
- Resolver 选中：`E:\own_space\engines\cocos-cli\static\tools\creator-3.8.6\PVRTexTool_win32\PVRTexToolCLI.exe`
- Resolver source：`bundled-creator-3.8.6`
- Resolver version：`4.20.0`
- `web-mobile`：
  - `Invalid values chosen=0`
  - `texture compress task width asset=0`
  - `Compress image success=N`
- `wechatgame`：
  - `Invalid values chosen=0`
  - `texture compress task width asset=0`
  - `Compress image success=N`
- 判断：PVRTC tool version mismatch 已由 resolver 消除；若仍存在自动图集差异，归属 `BUILD-ISSUE-021`。
```

- [ ] **Step 2: 更新 `BUILD-ISSUE-022`**

如果 Task 5 的 PVRTC 计数通过，且默认无 override 选中 `static/tools/creator-3.8.6` overlay 的 `PVRTexTool 4.20.0`，则可将 `BUILD-ISSUE-022` 改为 `fixed`。当前结论应明确这是 Creator 3.8.6 PVRTC 差异 overlay 修复，不是复制整套 Editor tools：

```md
已新增 texture compression tool resolver。默认无 texture tool override env 时，CLI PVRTC 选择 `static/tools/creator-3.8.6/PVRTexTool_win32/PVRTexToolCLI.exe`，source 为 `bundled-creator-3.8.6`，version 为 `4.20.0`；`web-mobile` / `wechatgame` clean rerun 不再出现 `Invalid values chosen` 或 `texture compress task width asset`。`static/tools/creator-3.8.6` 只存放差异文件，overlay 不存在的工具继续 fallback 到旧 `static/tools`。旧 CLI bundled `PVRTexTool 5.5.0` 可通过显式 `COCOS_CLI_TEXTURE_TOOLS_ROOT=E:\own_space\engines\cocos-cli\static\tools` 切换。
```

如果 Task 5 未通过，保持 `open`，追加具体失败事实，不得写“已修复”。如果 parity test 只剩 `assets` 分区差异，继续归属 `BUILD-ISSUE-021`，不阻塞 `BUILD-ISSUE-022` 的 fixed 结论。

- [ ] **Step 3: 运行文档 diff 检查**

Run:

```powershell
rtk git diff --check -- docs/dev/build/issues.md docs/dev/build/facts/auto-atlas-texture-compress-editor-cli-parity-20260617.md
```

Expected:

```text
```

退出码为 `0`，无 trailing whitespace 报错。

## 验收标准

- `compressPVR()` 不再硬编码 `GlobalPaths.staticDir/tools/PVRTexTool_*`。
- resolver 支持显式 tool path、tools root、Creator resources path、Creator root、CLI bundled fallback。
- resolver 日志包含实际 `path`、`source`、`version`。
- 默认 fallback 不破坏无 Editor 环境的 CLI 使用。
- 使用 Creator 3.8.6 resources override 时，PVRTC tool version 为 `4.20.0`。
- clean rerun 中 `Invalid values chosen=0`。
- 若 `wechatgame` parity test 仍失败，失败原因必须归类到自动图集或其它 issue，不能把 texture tool resolver 判为失败。

## 风险和边界

- Windows `VersionInfo.ProductVersion` 读取依赖 PowerShell；读取失败时 resolver 应返回 `unknown`，不能阻塞构建。
- `PVRTexTool 5.5.0` 可能需要新版 `Encode Format` 参数，本计划不处理参数映射，只让 CLI 可切换到与 Creator baseline 一致的工具版本。
- `COCOS_CREATOR_ROOT` / `COCOS_CREATOR_RESOURCES_PATH` 是显式 opt-in；不要自动扫描本机安装目录。
- 这项修复不解决 `BUILD-ISSUE-021` 的自动图集 `Editor.Message` 问题。

## Self-Review

- Spec coverage：覆盖了工具版本切换、原因记录、Creator 3.8.6 对齐、后续升级可切换、日志诊断、clean rerun 验证。
- Placeholder scan：计划未使用 `TBD`、`TODO`、`自行处理`。Task 5 通过 `.codex-tmp/tool-resolver-current-paths.txt` 读取固定 `paths.json`，没有需要人工替换的路径占位，也不依赖“最新目录”推断。
- Type consistency：`resolveTextureCompressTool('pvr')`、`TextureCompressToolResolution`、`source` 字段在任务中命名一致。
