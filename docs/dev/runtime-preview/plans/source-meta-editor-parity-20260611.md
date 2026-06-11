# Source Meta Editor Parity 分阶段执行计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 CLI import 后写回的 `.anim.meta` 与 Cocos Creator Editor 3.8.6 在同一项目、同一 engine 下写回的 `.anim.meta` 一致。

**Architecture:** 先验证 `cc-editor/cce`、Editor 3.8.6 路径和 engine root 事实，再复制测试项目给 Editor 生成 baseline，随后把真实测试项目的 `package.json` 适配为 CLI 可启动项目，最后在真实测试项目仓库运行 CLI import 并比较 `.anim.meta`。Editor baseline 项目副本只用于 oracle；CLI 必须作用于 `E:\own_space\engines\cocos-test-projects` 真实仓库目录。

**Tech Stack:** TypeScript, Node.js, PowerShell, Git, `@xuyanfeng/cc-editor` / `cce`, Cocos Creator 3.8.6, `@cocos/asset-db`, Vitest.

---

## 范围边界

只处理：

- 项目：`E:\own_space\engines\cocos-test-projects`。
- Editor 应用目录：`D:\cocos_editors`。
- Editor / engine：Cocos Creator 3.8.6。
- 首轮验收范围：`assets/**/*.anim.meta`。
- 已知问题样本：`.anim.meta.files` 中 Editor 写 `.cconb`，CLI import 后写成 `.bin`。

不处理：

- 不要求 `library/cli` 与 Editor `library` 结构一致。
- 不要求 `temp/cli/programming` 与 Editor `temp/programming` 一致。
- 不冻结 `library`、`temp/programming` 或 source `.meta` 快照；Editor 项目副本本身就是 baseline。
- Editor baseline 副本不复制 `.git`、`library`、`temp`、`node_modules`、`.codex-tmp`，避免历史缓存影响 Editor import。
- 不检查这些项目配置文件：`assets/`、`settings/v2/packages/project.json`、`settings/v2/packages/engine.json`、`settings/v2/packages/builder.json`、`profiles/v2/packages/builder.json`、`profiles/v2/packages/web-desktop.json`、`profiles/v2/packages/web-mobile.json`。
- 不改 runtime preview route、browser smoke、URL resolver。
- 不通过阻止写 source `.meta` 规避问题。CLI 可以写 `.meta`，但结果必须与 Editor 3.8.6 一致。

---

## 阶段 Gate

每个阶段都有明确 gate。前一阶段没有通过，不进入后一阶段。

1. Phase 0：验证工具、Editor 路径、engine root 和 import 触发方式。
2. Phase 1：确认测试项目 git 状态，并创建 Editor baseline 副本。
3. Phase 2：用 Editor 3.8.6 打开副本并生成 baseline。
4. Phase 3：用 CLI 在真实测试项目仓库复现 `.anim.meta` diff。
5. Phase 4：只针对已确认差异做最小修复。
6. Phase 5：重新触发 CLI import 后验收和文档收口。

---

## Ignored Workspace

所有临时产物放到当前 CLI repo 的 ignored 目录：

```text
E:\own_space\engines\cocos-cli\.codex-tmp\source-meta-editor-parity\
```

每次执行使用独立 run 目录，避免旧 baseline 污染新结果：

```text
E:\own_space\engines\cocos-cli\.codex-tmp\source-meta-editor-parity\run-YYYYMMDD-HHMMSS\
```

子目录：

```text
editor-project\
run-info.json
```

执行前必须确认 `.codex-tmp/` 被当前 CLI repo 忽略：

```powershell
rtk git -C E:\own_space\engines\cocos-cli status --ignored --short .codex-tmp
```

Gate:

```text
如果 `.codex-tmp/` 未被忽略，不复制项目，不进入 Phase 1。
```

---

## Phase 0: 验证不确定工具和环境事实

**目的:** 先确认本机 `cc-editor/cce` 的真实命令、Cocos Creator 3.8.6 executable、Editor engine root、CLI engine root 和 CLI import 触发方式。本阶段不打开项目，不触发 import，不修改 source `.meta`。

**Files:**

- Create after verification: `docs/dev/runtime-preview/facts/source-meta-editor-baseline-20260611.md`
- No source modification in this phase.

- [ ] **Step 0.1: 确认 `cc-editor` npm 包和 CLI binary**

Run:

```powershell
rtk npm view @xuyanfeng/cc-editor version bin
rtk npx @xuyanfeng/cc-editor -h
rtk where.exe cce
rtk cce -h
```

Expected:

```text
记录实际可用入口：
- `npx @xuyanfeng/cc-editor ...` 是否可用；
- 全局 `cce` 是否可用；
- help 输出中用于登记 Editor、列出 Editor、打开指定项目的真实命令。
```

Gate:

```text
如果无法确认“指定 Editor 3.8.6 + 指定项目路径”的启动方式，不进入 Phase 2。
```

- [ ] **Step 0.2: 只从 `D:\cocos_editors` 定位 Cocos Creator 3.8.6**

Run:

```powershell
rtk powershell -NoProfile -Command 'Get-ChildItem -LiteralPath "D:\cocos_editors" -Recurse -ErrorAction SilentlyContinue -Filter "CocosCreator.exe" | Select-Object FullName'
```

Expected:

```text
找到版本明确为 3.8.6 的 `CocosCreator.exe`，并把完整路径记录到 facts 文档。
不做 `C:\`、`D:\`、`E:\` 全盘扫描。
```

Gate:

```text
没有确认 Editor 3.8.6 executable，不进入 Phase 2。
```

- [ ] **Step 0.3: 记录 Editor 3.8.6 与 CLI 使用的 engine root**

Run:

```powershell
rtk cce list
rtk cce cfg
rtk rg -n "COCOS_CLI_TEST_ENGINE_ROOT|engineRoot|enginePath|source" src vitests docs -g "*.ts" -g "*.md" -g "*.json"
```

Expected:

```text
在 facts 文档记录：
- Editor 3.8.6 实际使用的 engine root；
- CLI import 将使用的 engine root，本专项使用用户指定的 `D:\workspace\engines\cocos\3.8.6`；
- 如果 Editor bundled engine root 与 CLI 自定义 engine root 不是同一路径，必须记录二者版本与差异风险，不能把“同版本”写成“同一路径”。
本步骤不扫描 `E:\own_space\engines\cocos-test-projects` 下已排除的 `settings/`、`profiles/` 或 `assets/` 配置。
```

Gate:

```text
无法证明 Editor 与 CLI 使用同一 engine root，不进入 Phase 2 或 Phase 3。
```

- [ ] **Step 0.4: 确认 CLI import 触发方式必须可终止**

Run:

```powershell
rtk rg -n "import\\(|startRuntimePreview|preview --runtime|class Launcher|program\\.command|commander" src vitests -g "*.ts"
rtk rg -n "Start-Process|spawn\\(|preview --runtime|ready|health" vitests src docs -g "*.ts" -g "*.md"
```

Expected:

```text
确认一个可终止流程：
- 优先使用直接 import 入口；
- 如果只能通过 `preview --runtime` 触发，则必须使用后台进程、ready 检测、timeout 和 cleanup；
- 不把长驻 `node .\dist\cli.js preview --runtime ...` 作为前台阻塞命令。
```

Gate:

```text
没有可终止的 CLI import 流程，不进入 Phase 3。
```

---

## Phase 1: 确认测试项目状态并创建 Editor baseline 副本

**目的:** 确认 `E:\own_space\engines\cocos-test-projects` 的 git 分支和干净状态。Editor baseline 使用副本，CLI import 使用真实仓库目录。

**Files:**

- Create/modify: `docs/dev/runtime-preview/facts/source-meta-editor-baseline-20260611.md`
- Create: `.codex-tmp/source-meta-editor-parity/run-*/editor-project/`
- Create: `.codex-tmp/source-meta-editor-parity/run-*/run-info.json`

- [ ] **Step 1.1: 检查项目仓库分支和工作树**

Run:

```powershell
rtk git -C E:\own_space\engines\cocos-test-projects status --short
rtk git -C E:\own_space\engines\cocos-test-projects branch --show-current
rtk git -C E:\own_space\engines\cocos-test-projects branch --all
```

Expected:

```text
确认当前分支是用于 Cocos Creator 3.8.6 的测试项目分支，或先切到对应分支。
工作树必须干净；如果不干净，记录状态并等待确认，不生成 baseline。
```

- [ ] **Step 1.2: 从 3.8.6 对应分支切本专项分支**

Run only after Step 1.1 确认当前分支就是 3.8.6 对应分支：

```powershell
rtk git -C E:\own_space\engines\cocos-test-projects switch -c codex/source-meta-editor-parity-386
```

Expected:

```text
后续 CLI import 直接作用于 `E:\own_space\engines\cocos-test-projects` 的专项分支。
Editor 不打开该真实仓库目录，只打开 `.codex-tmp` 下的副本。
```

- [ ] **Step 1.3: 适配真实测试项目 `package.json` 供 CLI 使用**

Run:

```powershell
rtk powershell -NoProfile -Command 'Test-Path "E:\own_space\engines\cocos-test-projects\package.json"'
rtk powershell -NoProfile -Command 'Get-Content -LiteralPath "E:\own_space\engines\cocos-test-projects\package.json" -Encoding UTF8'
```

Expected:

```text
`package.json` 存在。
在真实测试项目专项分支中只做 CLI 必需字段适配：
- 根字段 `version` 和 `creator.version` 都改为 `3.8.6`，与目标 Editor / engine 版本一致；
- 增加 `package.json["cocos-cli"].enginePath = "D:\\workspace\\engines\\cocos\\3.8.6"`，让 production CLI path 从项目配置解析 engine root。
不检查或修改用户已排除的 `assets/`、`settings/`、`profiles/` 配置文件。
```

Gate:

```text
`package.json` 不存在，不进入 Phase 2。
```

- [ ] **Step 1.4: 创建 run 目录并复制 Editor baseline 项目**

Run:

```powershell
rtk powershell -NoProfile -Command '$root = "E:\own_space\engines\cocos-cli\.codex-tmp\source-meta-editor-parity"; $source = "E:\own_space\engines\cocos-test-projects"; $runRoot = Join-Path $root ("run-" + (Get-Date -Format "yyyyMMdd-HHmmss")); $editorProject = Join-Path $runRoot "editor-project"; New-Item -ItemType Directory -Force -Path $runRoot | Out-Null; robocopy $source $editorProject /E /XD ".git" "library" "temp" "node_modules" ".codex-tmp"; if ($LASTEXITCODE -gt 7) { exit $LASTEXITCODE }; @{ runRoot = $runRoot; editorProject = $editorProject; cliProject = $source; createdAt = (Get-Date).ToString("o") } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $runRoot "run-info.json") -Encoding UTF8; Get-Content -LiteralPath (Join-Path $runRoot "run-info.json") -Encoding UTF8'
```

Expected:

```text
`run-info.json` 中记录本次 `runRoot`、`editorProject` 和 `cliProject`。
Editor baseline 副本存在于 `runRoot\editor-project`。
副本不包含 `.git`、`library`、`temp`、`node_modules`、`.codex-tmp`。
```

Gate:

```text
如果复制失败，或 `runRoot` 不在 `.codex-tmp\source-meta-editor-parity\` 下，不进入 Phase 2。
```

---

## Phase 2: 用 Editor 3.8.6 生成 baseline

**目的:** 用 Editor 3.8.6 打开 `.codex-tmp` 下的 `editor-project` 副本，生成 Editor baseline。真实 `E:\own_space\engines\cocos-test-projects` 不被 Editor 打开。

**Files:**

- Modify: `.codex-tmp/source-meta-editor-parity/run-*/editor-project/assets/**/*.anim.meta`
- Modify: `docs/dev/runtime-preview/facts/source-meta-editor-baseline-20260611.md`

- [ ] **Step 2.1: 用 Phase 0 验证的完整命令打开 Editor 副本**

Run:

```text
执行 Phase 0 已记录到 facts 文档的完整命令。
命令必须同时显式包含：
- Cocos Creator 3.8.6 Editor 标识或 executable；
- `runRoot\editor-project` 项目路径。
```

Expected:

```text
Editor 3.8.6 打开 `.codex-tmp\source-meta-editor-parity\run-*\editor-project`。
等待 AssetDB import 完成。
```

Gate:

```text
如果命令不能显式指定项目路径，或实际打开了真实测试项目仓库，不继续。
```

- [ ] **Step 2.2: 确认 Editor baseline `.anim.meta`**

Run after Editor import completes, using the `editorProject` path from `run-info.json`:

```powershell
rtk powershell -NoProfile -Command '$runInfo = Get-ChildItem -LiteralPath "E:\own_space\engines\cocos-cli\.codex-tmp\source-meta-editor-parity" -Directory | Sort-Object Name -Descending | Select-Object -First 1 | ForEach-Object { Join-Path $_.FullName "run-info.json" }; $info = Get-Content -LiteralPath $runInfo -Encoding UTF8 | ConvertFrom-Json; Get-ChildItem -LiteralPath (Join-Path $info.editorProject "assets") -Recurse -Filter "*.anim.meta" | Select-Object FullName'
```

Expected:

```text
输出至少一个 `.anim.meta`。
```

- [ ] **Step 2.3: 记录 Editor `.anim.meta.files` 事实**

在 facts 文档记录：

```markdown
## Editor `.anim.meta` 事实

| Meta path | importer | ver | files |
| --- | --- | --- | --- |
| `assets/.../*.anim.meta` | `animation-clip` | `...` | `[...]` |
```

Gate:

```text
未记录 Editor `.anim.meta.files` 真实值，不进入 Phase 3。
```

---

## Phase 3: 复现 CLI import 后 `.anim.meta` diff

**目的:** 在真实测试项目仓库 `E:\own_space\engines\cocos-test-projects` 上运行 CLI import，然后与 Editor 副本 baseline 比较 `.anim.meta`。

**当前执行状态（2026-06-11）:** `package.json["cocos-cli"].enginePath` 已验证生效，CLI 日志显示 `engineRootSource=project-config`。但真实测试项目旧 `settings/v2/packages/engine.json` 缺少 `modules.configs`，触发 `src/core/configuration/migration/register-migration.ts` 中 `engine` 迁移器 `Object.keys(oldConfig.modules.configs)` 报错，CLI import 未到 `preview:ready`。在确认是否修 CLI 迁移兼容或允许用 Editor 升级后的配置前，不进入 Phase 4。

**Files:**

- Create: `vitests/shared/source-meta-parity.ts`
- Create: `vitests/suites/runtime-preview/source-meta-editor-parity.test.ts`
- Modify: `docs/dev/runtime-preview/facts/source-meta-editor-baseline-20260611.md`

- [ ] **Step 3.1: 建立 `.anim.meta` 比较 helper**

Create `vitests/shared/source-meta-parity.ts`:

```ts
import { readFile } from 'node:fs/promises';
import { relative } from 'node:path';
import { globby } from 'globby';

export interface SourceMetaSnapshot {
  relativePath: string;
  json: unknown;
}

export async function collectSourceMetaSnapshot(root: string, pattern = 'assets/**/*.anim.meta'): Promise<SourceMetaSnapshot[]> {
  const files = await globby(pattern, {
    cwd: root,
    absolute: true,
    onlyFiles: true,
    gitignore: false,
  });

  const snapshots = await Promise.all(files.map(async (file) => ({
    relativePath: relative(root, file).replace(/\\/g, '/'),
    json: JSON.parse(await readFile(file, 'utf8')),
  })));

  return snapshots.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

export function findMeta(snapshot: SourceMetaSnapshot[], relativePath: string): SourceMetaSnapshot | undefined {
  const normalized = relativePath.replace(/\\/g, '/');
  return snapshot.find((entry) => entry.relativePath === normalized);
}
```

- [ ] **Step 3.2: 写 `.anim.meta` parity fail gate**

Create `vitests/suites/runtime-preview/source-meta-editor-parity.test.ts`:

```ts
import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { collectSourceMetaSnapshot, findMeta } from '@shared/source-meta-parity';

const projectRoot = process.env.COCOS_CLI_SOURCE_META_PROJECT_ROOT;
const editorProjectRoot = process.env.COCOS_CLI_EDITOR_PROJECT_ROOT;

describe('source .meta editor parity', () => {
  it('matches Editor 3.8.6 for .anim source meta after CLI import', async () => {
    expect(projectRoot, 'COCOS_CLI_SOURCE_META_PROJECT_ROOT is required').toBeTruthy();
    expect(editorProjectRoot, 'COCOS_CLI_EDITOR_PROJECT_ROOT is required').toBeTruthy();
    expect(existsSync(projectRoot!), `missing CLI project root ${projectRoot}`).toBe(true);
    expect(existsSync(editorProjectRoot!), `missing Editor project root ${editorProjectRoot}`).toBe(true);

    const editorSnapshot = await collectSourceMetaSnapshot(editorProjectRoot!);
    const cliSnapshot = await collectSourceMetaSnapshot(projectRoot!);

    expect(editorSnapshot.length).toBeGreaterThan(0);

    for (const editorMeta of editorSnapshot) {
      const cliMeta = findMeta(cliSnapshot, editorMeta.relativePath);
      expect(cliMeta, `missing CLI meta ${editorMeta.relativePath}`).toBeDefined();
      expect(cliMeta!.json).toEqual(editorMeta.json);
    }
  });
});
```

- [ ] **Step 3.3: 运行 CLI import 并确认测试失败原因**

Run:

```powershell
rtk npm run build
```

然后执行 Phase 0 已验证的可终止 CLI import 流程。该流程必须通过真实测试项目 `package.json["cocos-cli"].enginePath` 解析 engine root；不得只依赖 `COCOS_CLI_TEST_ENGINE_ROOT` 掩盖项目配置缺失。

```text
Project path: E:\own_space\engines\cocos-test-projects
Engine root: Phase 0 已验证且与 Editor 一致的 engine root
```

然后运行 parity 测试：

```powershell
rtk powershell -NoProfile -Command '$runInfo = Get-ChildItem -LiteralPath "E:\own_space\engines\cocos-cli\.codex-tmp\source-meta-editor-parity" -Directory | Sort-Object Name -Descending | Select-Object -First 1 | ForEach-Object { Join-Path $_.FullName "run-info.json" }; $info = Get-Content -LiteralPath $runInfo -Encoding UTF8 | ConvertFrom-Json; $env:COCOS_CLI_SOURCE_META_PROJECT_ROOT = "E:\own_space\engines\cocos-test-projects"; $env:COCOS_CLI_EDITOR_PROJECT_ROOT = $info.editorProject; npm --prefix vitests test -- suites/runtime-preview/source-meta-editor-parity.test.ts'
```

Expected:

```text
测试失败，并显示 `.anim.meta` 的实际 diff。
如果失败是 Editor baseline 缺失、CLI 启动失败、engine root 配置未生效或 import 未完成，回到对应阶段，不进入 Phase 4。
```

Gate:

```text
只有确认 diff 是 CLI importer 写回 source `.anim.meta` 与 Editor 不一致，才进入 Phase 4。
```

---

## Phase 4: 最小修复 `.anim` source `.meta` parity

**目的:** 只修已经复现并定位的 `.anim.meta` 差异。

**Files:**

- Inspect/Modify: `src/core/assets/asset-handler/assets/animation-clip.ts`
- Inspect/Modify only if needed: `src/core/assets/asset-handler/assets/utils/serialize-library.ts`
- Inspect only unless separately confirmed: `src/core/assets/asset-handler/assets/gltf/animation.ts`

- [ ] **Step 4.1: 用 CodeGraph 确认最小链路**

Run:

```text
codegraph_trace from startRuntimePreview to initAssetDB
codegraph_context task="分析 .anim import 后 source .meta.files 与 Editor 3.8.6 不一致的最小链路"
```

Expected:

```text
确认链路经过 `animation-clip.ts`、`serializeForLibrary()`、`asset.saveToLibrary()`、`@cocos/asset-db` 的 `asset.save()`。
```

- [ ] **Step 4.2: 实施最小代码修改**

允许的修改形态：

```text
1. 在 `animation-clip` importer 中按 Editor 3.8.6 规则传给 `saveToLibrary()` 正确 extension。
2. 只有在确认不会扩大到非 `.anim` 资源时，才在 `serializeForLibrary()` 中修正共享逻辑。
```

禁止：

```text
导入后回滚 `.meta`。
运行时字符串替换 `.bin` / `.cconb`。
通过禁止写 source `.meta` 规避问题。
修改 runtime preview route 或 server resolver。
未确认影响面时扩大到非 `.anim` 资源。
```

- [ ] **Step 4.3: 重新触发 CLI import 并运行 parity 测试**

Run:

```powershell
rtk npm run build
```

然后重新执行 Phase 0 已验证的可终止 CLI import 流程：

```text
Project path: E:\own_space\engines\cocos-test-projects
Engine root: Phase 0 已验证且与 Editor 一致的 engine root
```

然后运行 parity 测试：

```powershell
rtk powershell -NoProfile -Command '$runInfo = Get-ChildItem -LiteralPath "E:\own_space\engines\cocos-cli\.codex-tmp\source-meta-editor-parity" -Directory | Sort-Object Name -Descending | Select-Object -First 1 | ForEach-Object { Join-Path $_.FullName "run-info.json" }; $info = Get-Content -LiteralPath $runInfo -Encoding UTF8 | ConvertFrom-Json; $env:COCOS_CLI_SOURCE_META_PROJECT_ROOT = "E:\own_space\engines\cocos-test-projects"; $env:COCOS_CLI_EDITOR_PROJECT_ROOT = $info.editorProject; npm --prefix vitests test -- suites/runtime-preview/source-meta-editor-parity.test.ts'
```

Expected:

```text
`.anim.meta` parity 测试通过。
```

---

## Phase 5: 文档和验收收口

**Files:**

- Modify: `docs/dev/runtime-preview/facts/source-meta-editor-baseline-20260611.md`
- Modify: `docs/dev/runtime-preview/acceptance/feedback-20260609.md`

- [ ] **Step 5.1: 更新 facts 结论**

记录：

```markdown
## 结论

- CLI import 后 `.anim.meta` 已与 Editor 3.8.6 baseline 一致。
- 本专项首轮只验证 source `.anim.meta` parity。
- Editor baseline 来自 `.codex-tmp/source-meta-editor-parity/run-*/editor-project` 项目副本。
- CLI import 作用于真实测试项目仓库 `E:\own_space\engines\cocos-test-projects`。
```

- [ ] **Step 5.2: 修正旧反馈措辞**

在 `docs/dev/runtime-preview/acceptance/feedback-20260609.md` 的 `6.8` 下补充：

```markdown
本问题的目标不是禁止 CLI 写 source `.meta`。正确目标是：CLI import 后写回的 source `.meta` 必须与 Editor 3.8.6 对同一项目、同一 engine 的写回结果一致。
```

- [ ] **Step 5.3: 最终验证**

Run:

```powershell
rtk npm run build
```

然后对 `E:\own_space\engines\cocos-test-projects` 重新执行 Phase 0 已验证的可终止 CLI import 流程。

然后运行最终验证：

```powershell
rtk powershell -NoProfile -Command '$runInfo = Get-ChildItem -LiteralPath "E:\own_space\engines\cocos-cli\.codex-tmp\source-meta-editor-parity" -Directory | Sort-Object Name -Descending | Select-Object -First 1 | ForEach-Object { Join-Path $_.FullName "run-info.json" }; $info = Get-Content -LiteralPath $runInfo -Encoding UTF8 | ConvertFrom-Json; $env:COCOS_CLI_SOURCE_META_PROJECT_ROOT = "E:\own_space\engines\cocos-test-projects"; $env:COCOS_CLI_EDITOR_PROJECT_ROOT = $info.editorProject; npm --prefix vitests test -- suites/runtime-preview/source-meta-editor-parity.test.ts'
rtk git -C E:\own_space\engines\cocos-test-projects diff -- assets
rtk git -C E:\own_space\engines\cocos-cli diff -- docs/dev/runtime-preview/facts/source-meta-editor-baseline-20260611.md docs/dev/runtime-preview/acceptance/feedback-20260609.md src/core/assets/asset-handler/assets/animation-clip.ts src/core/assets/asset-handler/assets/utils/serialize-library.ts vitests/shared/source-meta-parity.ts vitests/suites/runtime-preview/source-meta-editor-parity.test.ts
```

Expected:

```text
测试通过。
测试项目 diff 只包含本专项预期的 source `.anim.meta` 变化，或修复后没有残留 diff。
CLI repo diff 只包含 source `.anim.meta` parity 相关修改。
```

---

## 当前未确认项

执行前必须先确认或验证：

1. `@xuyanfeng/cc-editor` / `cce` 在本机的真实可用命令。
2. `D:\cocos_editors` 下 Cocos Creator 3.8.6 executable path。
3. Editor 3.8.6 实际 engine root。
4. CLI import 将使用的 engine root，并明确其来自 `package.json["cocos-cli"].enginePath` 还是 test env；本专项有效 CLI import 必须验证项目配置路径。
5. `E:\own_space\engines\cocos-test-projects` 当前 3.8.6 对应分支名称。
6. 可终止的 CLI import 触发方式。

未完成 Phase 0 前，不运行会写 source `.meta` 的 Editor import 或 CLI import。
