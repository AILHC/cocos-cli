# Cocos CLI Tools Helper Scripts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Windows double-click helper scripts to the tools runtime release so users can install/link the published CLI and launch runtime preview from a copied project script.

**Architecture:** Keep helper scripts as static runtime assets under `workflow/tools-runtime-scripts/`, then make `workflow/release-tools.js` copy them to the release root and validate them. The install script runs in the published `tools/cocos-cli` directory and executes `npm install` then `npm link`; the preview script runs in the copied project directory, validates `package.json.creator.version`, then launches global `cocos preview --runtime --watch-assets --refresh-on-reload`.

**Tech Stack:** Windows `.cmd`, Node.js for JSON validation inside `.cmd`, existing `release:tools` workflow, Jest unit tests in `src/core/test/release-tools.spec.ts`.

---

## File Structure

- Create `workflow/tools-runtime-scripts/install-cocos-cli.cmd`
  - Static Windows entry script copied into the tools release root.
  - Owns Node/npm presence checks, `npm install`, and `npm link`.
- Create `workflow/tools-runtime-scripts/preview-runtime.cmd`
  - Static Windows entry script copied into the tools release root as a project-side template.
  - Owns project `package.json` validation and preview command invocation.
- Modify `workflow/release-tools.js`
  - Add helper script copy constants.
  - Copy helper scripts after normal release entries.
  - Validate helper scripts exist in `assertReleaseDirectory()`.
  - Mention helper scripts in generated README.
- Modify `src/core/test/release-tools.spec.ts`
  - Extend source fixture to include helper scripts.
  - Assert release output contains the scripts.
  - Assert release validation fails when a script is missing.
  - Assert README mentions install and preview helper flows.
- Modify `docs/usage.md`
  - Document published helper scripts for agents/users without duplicating CLI `--help`.

---

### Task 1: Add Release Tests For Helper Scripts

**Files:**
- Modify: `src/core/test/release-tools.spec.ts`

- [ ] **Step 1: Update the fixture source to include helper scripts**

In `createReleaseSourceFixture(repoRoot)`, after the existing `writeText(join(repoRoot, 'static', 'keep.txt'), 'static\n');` line, add:

```typescript
    writeText(join(repoRoot, 'workflow', 'tools-runtime-scripts', 'install-cocos-cli.cmd'), '@echo off\r\necho install\r\n');
    writeText(join(repoRoot, 'workflow', 'tools-runtime-scripts', 'preview-runtime.cmd'), '@echo off\r\necho preview\r\n');
```

- [ ] **Step 2: Add README expectations**

In the test `renders a Chinese README with runtime metadata and diagnostics`, after:

```typescript
        expect(readme).toContain('npm install');
```

add:

```typescript
        expect(readme).toContain('install-cocos-cli.cmd');
        expect(readme).toContain('preview-runtime.cmd');
        expect(readme).toContain('--watch-assets');
        expect(readme).toContain('--refresh-on-reload');
```

- [ ] **Step 3: Add validation fixture files to the complete release directory test**

In `validates a complete release directory and rejects bundled engine source`, after:

```typescript
        writeText(join(targetRoot, 'docs', 'usage.md'), '# usage\n');
```

add:

```typescript
        writeText(join(targetRoot, 'install-cocos-cli.cmd'), '@echo off\r\necho install\r\n');
        writeText(join(targetRoot, 'preview-runtime.cmd'), '@echo off\r\necho preview\r\n');
```

- [ ] **Step 4: Add a missing-script rejection test**

After `validates a complete release directory and rejects bundled engine source`, add:

```typescript
    it('requires helper scripts in the release directory', () => {
        const targetRoot = createDir(join(fixtureRoot, 'tools', 'cocos-cli'));
        writeText(join(targetRoot, '.gitignore'), 'node_modules/\n');
        writeJson(join(targetRoot, 'package.json'), {
            name: 'cocos-cli',
            version: '1.2.3',
            dependencies: {
                cc: 'file:./packages/cc-module',
                '@cocos/asset-db': 'file:./packages/asset-db',
            },
        });
        writeJson(join(targetRoot, 'package-lock.json'), {
            packages: {
                '': {},
            },
        });
        createDir(join(targetRoot, 'packages', 'asset-db'));
        createDir(join(targetRoot, 'packages', 'cc-module'));
        writeText(join(targetRoot, 'docs', 'usage.md'), '# usage\n');
        for (const toolDir of [
            'static/tools/creator-3.8.6/PVRTexTool_win32',
            'static/tools/PVRTexTool_win32',
            'static/tools/libwebp_win32',
            'static/tools/mali_win32',
            'static/tools/astc-encoder',
            'static/tools/cmft',
            'static/tools/LightFX',
            'static/tools/lightmap-tools',
            'static/tools/cmake',
            'static/tools/keystore',
        ]) {
            createDir(join(targetRoot, toolDir));
        }

        expect(() => assertReleaseDirectory(targetRoot)).toThrow('Release directory is missing install-cocos-cli.cmd');

        writeText(join(targetRoot, 'install-cocos-cli.cmd'), '@echo off\r\necho install\r\n');
        expect(() => assertReleaseDirectory(targetRoot)).toThrow('Release directory is missing preview-runtime.cmd');

        writeText(join(targetRoot, 'preview-runtime.cmd'), '@echo off\r\necho preview\r\n');
        expect(() => assertReleaseDirectory(targetRoot)).not.toThrow();
    });
```

- [ ] **Step 5: Add release output assertions**

In `clears stale target content before writing release output`, after:

```typescript
        expect(existsSync(join(targetRoot, 'dist', 'cli.js'))).toBe(true);
```

add:

```typescript
        expect(readFileSync(join(targetRoot, 'install-cocos-cli.cmd'), 'utf8')).toBe('@echo off\r\necho install\r\n');
        expect(readFileSync(join(targetRoot, 'preview-runtime.cmd'), 'utf8')).toBe('@echo off\r\necho preview\r\n');
```

Also in `excludes nested node_modules and packages/engine while copying release entries`, after:

```typescript
        expect(existsSync(join(targetRoot, 'packages', 'engine'))).toBe(false);
```

add:

```typescript
        expect(existsSync(join(targetRoot, 'install-cocos-cli.cmd'))).toBe(true);
        expect(existsSync(join(targetRoot, 'preview-runtime.cmd'))).toBe(true);
```

- [ ] **Step 6: Run tests and verify they fail**

Run:

```powershell
rtk pwsh -NoLogo -NoProfile -Command "npm run test -- src/core/test/release-tools.spec.ts --runInBand"
```

Expected: tests fail because `workflow/release-tools.js` does not copy helper scripts, `assertReleaseDirectory()` does not require them, and README does not mention them.

---

### Task 2: Implement Release Script Integration

**Files:**
- Modify: `workflow/release-tools.js`

- [ ] **Step 1: Add helper script constants**

After `const COPY_ENTRIES = [` block, add:

```javascript
const HELPER_SCRIPT_ENTRIES = [
    {
        source: ['workflow', 'tools-runtime-scripts', 'install-cocos-cli.cmd'],
        destination: ['install-cocos-cli.cmd'],
    },
    {
        source: ['workflow', 'tools-runtime-scripts', 'preview-runtime.cmd'],
        destination: ['preview-runtime.cmd'],
    },
];
```

- [ ] **Step 2: Validate helper scripts in release directory**

In `assertReleaseDirectory(targetRoot)`, after:

```javascript
    assertPathExists(resolvedTargetRoot, 'package-lock.json', 'file');
```

add:

```javascript
    assertPathExists(resolvedTargetRoot, 'install-cocos-cli.cmd', 'file');
    assertPathExists(resolvedTargetRoot, 'preview-runtime.cmd', 'file');
```

- [ ] **Step 3: Add README helper sections**

In `renderReadme(metadata)`, replace the current `## 首次安装` section:

```markdown
## 首次安装

在 `<p6Root>/tools/cocos-cli` 目录执行：

```powershell
npm install
```

查看 CLI 帮助：

```powershell
node .\dist\cli.js --help
```
```

with:

````markdown
## 首次安装

在 `<p6Root>/tools/cocos-cli` 目录双击：

```text
install-cocos-cli.cmd
```

该脚本会先执行 `npm install` 安装运行依赖，再执行 `npm link` 将全局 `cocos` 命令指向当前发布目录。

查看 CLI 帮助：

```powershell
cocos --help
```
````

Then replace the current runtime preview example:

```markdown
runtime preview 示例：

```powershell
node .\dist\cli.js preview --runtime --project <projectRoot> --port <port>
```
```

with:

````markdown
runtime preview 常用启动：

1. 将 `<p6Root>/tools/cocos-cli/preview-runtime.cmd` 复制到 Cocos 项目根目录。
2. 双击项目根目录下的 `preview-runtime.cmd`。

脚本默认执行：

```powershell
cocos preview --runtime --project <projectRoot> --watch-assets --refresh-on-reload
```
````

Keep the existing `assertNoLocalAbsolutePaths(readme);` call.

- [ ] **Step 4: Add a helper copy function**

After `copyReleaseEntry(...)`, add:

```javascript
function copyHelperScript(targetRoot, helperEntry, repoRoot = REPO_ROOT) {
    const source = path.join(repoRoot, ...helperEntry.source);
    const destination = path.join(targetRoot, ...helperEntry.destination);
    if (!fs.existsSync(source)) {
        throw new Error(`Release helper script is missing: ${helperEntry.source.join('/')}`);
    }
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(source, destination);
}
```

- [ ] **Step 5: Copy helper scripts during release**

In `releaseToolsWithOptions(targetRoot, options = {})`, after:

```javascript
    for (const entry of copyEntries) {
        copyReleaseEntry(resolvedTargetRoot, entry, resolvedRepoRoot);
    }
```

add:

```javascript
    for (const helperEntry of HELPER_SCRIPT_ENTRIES) {
        copyHelperScript(resolvedTargetRoot, helperEntry, resolvedRepoRoot);
    }
```

- [ ] **Step 6: Export helper copy helper for focused tests and future diagnostics**

In `_internals`, after:

```javascript
        copyReleaseEntry,
```

add:

```javascript
        copyHelperScript,
```

- [ ] **Step 7: Run release-tools tests**

Run:

```powershell
rtk pwsh -NoLogo -NoProfile -Command "npm run test -- src/core/test/release-tools.spec.ts --runInBand"
```

Expected: tests still fail because helper source scripts do not exist yet.

- [ ] **Step 8: Commit release integration tests and workflow changes after scripts are added in Task 3**

Do not commit this task alone if the test suite is red. Commit together with Task 3 after tests pass:

```powershell
rtk pwsh -NoLogo -NoProfile -Command "git add src/core/test/release-tools.spec.ts workflow/release-tools.js workflow/tools-runtime-scripts && git commit -m 'feat: add cocos cli tools helper scripts'"
```

---

### Task 3: Add Helper Script Files

**Files:**
- Create: `workflow/tools-runtime-scripts/install-cocos-cli.cmd`
- Create: `workflow/tools-runtime-scripts/preview-runtime.cmd`

- [ ] **Step 1: Create install script**

Create `workflow/tools-runtime-scripts/install-cocos-cli.cmd` with exactly:

```cmd
@echo off
setlocal

cd /d "%~dp0"
if errorlevel 1 (
    echo [cocos-cli] Failed to enter script directory.
    pause
    exit /b 1
)

where node >nul 2>nul
if errorlevel 1 (
    echo [cocos-cli] Node.js was not found. Install Node.js and try again.
    pause
    exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
    echo [cocos-cli] npm was not found. Check your Node.js installation and try again.
    pause
    exit /b 1
)

echo [cocos-cli] Installing runtime dependencies in:
echo %CD%
call npm install
if errorlevel 1 (
    echo [cocos-cli] npm install failed.
    pause
    exit /b 1
)

echo [cocos-cli] Linking global cocos command to this directory.
call npm link
if errorlevel 1 (
    echo [cocos-cli] npm link failed.
    pause
    exit /b 1
)

echo [cocos-cli] Install complete. Run "cocos --help" to verify the global command.
pause
exit /b 0
```

- [ ] **Step 2: Create preview script**

Create `workflow/tools-runtime-scripts/preview-runtime.cmd` with exactly:

```cmd
@echo off
setlocal

cd /d "%~dp0"
if errorlevel 1 (
    echo [cocos-preview] Failed to enter script directory.
    pause
    exit /b 1
)

where node >nul 2>nul
if errorlevel 1 (
    echo [cocos-preview] Node.js was not found. Install Node.js and try again.
    pause
    exit /b 1
)

node -e "const fs=require('fs');const p='package.json';if(!fs.existsSync(p)){console.error('[cocos-preview] package.json was not found. Put this script in a Cocos project root.');process.exit(2);}let pkg;try{pkg=JSON.parse(fs.readFileSync(p,'utf8'));}catch(e){console.error('[cocos-preview] Failed to parse package.json: '+e.message);process.exit(3);}if(!pkg.creator||typeof pkg.creator.version!=='string'||!pkg.creator.version){console.error('[cocos-preview] package.json does not contain creator.version. Put this script in a Cocos project root.');process.exit(4);}"
if errorlevel 1 (
    pause
    exit /b 1
)

where cocos >nul 2>nul
if errorlevel 1 (
    echo [cocos-preview] Global "cocos" command was not found.
    echo [cocos-preview] Run install-cocos-cli.cmd from the published tools/cocos-cli directory first.
    pause
    exit /b 1
)

echo [cocos-preview] Starting runtime preview for:
echo %CD%
call cocos preview --runtime --project "%CD%" --watch-assets --refresh-on-reload
set PREVIEW_EXIT_CODE=%ERRORLEVEL%
if not "%PREVIEW_EXIT_CODE%"=="0" (
    echo [cocos-preview] Runtime preview exited with code %PREVIEW_EXIT_CODE%.
    pause
    exit /b %PREVIEW_EXIT_CODE%
)

pause
exit /b 0
```

- [ ] **Step 3: Run release-tools tests**

Run:

```powershell
rtk pwsh -NoLogo -NoProfile -Command "npm run test -- src/core/test/release-tools.spec.ts --runInBand"
```

Expected: PASS.

- [ ] **Step 4: Commit Task 1-3**

Run:

```powershell
rtk pwsh -NoLogo -NoProfile -Command "git add workflow/tools-runtime-scripts src/core/test/release-tools.spec.ts workflow/release-tools.js && git commit -m 'feat: add cocos cli tools helper scripts'"
```

Expected: commit succeeds.

---

### Task 4: Update User-Facing Docs

**Files:**
- Modify: `docs/usage.md`

- [ ] **Step 1: Add tools helper script usage**

In `docs/usage.md`, after the `## 发布包边界` bullet list and before `## Engine 解析`, add this Chinese section:

```markdown
## Tools helper scripts

- 发布目录 `<p6Root>/tools/cocos-cli` 包含 `install-cocos-cli.cmd`。
- Windows 用户可双击该脚本；脚本会在发布目录执行 `npm install`，成功后执行 `npm link`，把全局 `cocos` 命令指向当前发布目录。
- 发布目录还包含 `preview-runtime.cmd`。将它复制到 Cocos 项目根目录后双击，可执行：

```powershell
cocos preview --runtime --project <projectRoot> --watch-assets --refresh-on-reload
```

- `preview-runtime.cmd` 只通过当前目录的 `package.json.creator.version` 判断是否为 Cocos 项目；不要把它放在子目录或非项目目录运行。
- 如果提示找不到 `cocos` 命令，先回到 `<p6Root>/tools/cocos-cli` 运行 `install-cocos-cli.cmd`。
```

Keep the existing guidance that CLI `--help` owns detailed parameter documentation.

- [ ] **Step 2: Scan docs for local absolute paths**

Run:

```powershell
rtk pwsh -NoLogo -NoProfile -Command "$content = Get-Content -Raw -Encoding UTF8 docs/usage.md; if ($content -match '(?:[A-Za-z]:[\\/]|\\\\[^\\]+\\[^\\]+)') { throw 'docs/usage.md contains local absolute path' }"
```

Expected: no output.

- [ ] **Step 3: Commit docs**

Run:

```powershell
rtk pwsh -NoLogo -NoProfile -Command "git add docs/usage.md && git commit -m 'docs: document cocos cli helper scripts'"
```

Expected: commit succeeds.

---

### Task 5: Build And Release Verification

**Files:**
- Read/verify only unless generated artifacts unexpectedly differ.

- [ ] **Step 1: Run build**

Run:

```powershell
rtk pwsh -NoLogo -NoProfile -Command "npm run build"
```

Expected: exit code 0. Existing API Extractor warnings may appear; build must still pass.

- [ ] **Step 2: Release to a temporary target**

Use a temp directory first, not the real tools repo:

```powershell
rtk pwsh -NoLogo -NoProfile -Command "$target = Join-Path $env:TEMP ('cocos-cli-tools-release-' + [guid]::NewGuid().ToString('N')); npm run release:tools -- --target $target; if(!(Test-Path (Join-Path $target 'install-cocos-cli.cmd'))){ throw 'missing install-cocos-cli.cmd' }; if(!(Test-Path (Join-Path $target 'preview-runtime.cmd'))){ throw 'missing preview-runtime.cmd' }; Get-Content -LiteralPath (Join-Path $target 'README.md') -Encoding UTF8 | Select-String -Pattern 'install-cocos-cli.cmd|preview-runtime.cmd|--watch-assets|--refresh-on-reload'; Remove-Item -LiteralPath $target -Recurse -Force"
```

Expected: command exits 0 and prints README matches.

- [ ] **Step 3: Validate preview script accepts a Cocos project**

Copy the script to a temp directory with a minimal Cocos `package.json`, stub `cocos.cmd`, and run it with a timeout-safe command:

```powershell
rtk pwsh -NoLogo -NoProfile -Command "$root = Join-Path $env:TEMP ('cocos-preview-script-ok-' + [guid]::NewGuid().ToString('N')); New-Item -ItemType Directory -Force $root | Out-Null; Copy-Item workflow/tools-runtime-scripts/preview-runtime.cmd (Join-Path $root 'preview-runtime.cmd'); '{\"creator\":{\"version\":\"3.8.6\"}}' | Set-Content -LiteralPath (Join-Path $root 'package.json') -Encoding UTF8; $bin = Join-Path $root 'bin'; New-Item -ItemType Directory -Force $bin | Out-Null; '@echo off' + \"`r`n\" + 'echo cocos %*' + \"`r`n\" + 'exit /b 0' | Set-Content -LiteralPath (Join-Path $bin 'cocos.cmd') -Encoding ASCII; $env:PATH = $bin + ';' + $env:PATH; cmd /d /s /c 'cd /d \"' + $root + '\" && echo. | preview-runtime.cmd' | Tee-Object -Variable output; $text = $output -join \"`n\"; if($text -notmatch 'preview --runtime'){ throw 'preview command missing' }; if($text -notmatch '--watch-assets'){ throw 'watch-assets missing' }; if($text -notmatch '--refresh-on-reload'){ throw 'refresh-on-reload missing' }; Remove-Item -LiteralPath $root -Recurse -Force"
```

Expected: output contains `preview --runtime`, `--watch-assets`, and `--refresh-on-reload`.

- [ ] **Step 4: Validate preview script rejects non-Cocos directories**

Run:

```powershell
rtk pwsh -NoLogo -NoProfile -Command "$root = Join-Path $env:TEMP ('cocos-preview-script-bad-' + [guid]::NewGuid().ToString('N')); New-Item -ItemType Directory -Force $root | Out-Null; Copy-Item workflow/tools-runtime-scripts/preview-runtime.cmd (Join-Path $root 'preview-runtime.cmd'); '{}' | Set-Content -LiteralPath (Join-Path $root 'package.json') -Encoding UTF8; cmd /d /s /c 'cd /d \"' + $root + '\" && echo. | preview-runtime.cmd' | Tee-Object -Variable output; $text = $output -join \"`n\"; if($text -notmatch 'creator.version'){ throw 'expected creator.version rejection' }; Remove-Item -LiteralPath $root -Recurse -Force"
```

Expected: output mentions `creator.version` and command does not start `cocos preview`.

- [ ] **Step 5: Inspect git status**

Run:

```powershell
rtk pwsh -NoLogo -NoProfile -Command "git status --short --branch"
```

Expected: clean or only intentional generated files. Do not commit unrelated generated line-ending noise.

---

### Task 6: Publish To Real Tools Target

**Files:**
- Real target repo: `<p6Root>/tools/cocos-cli`

- [ ] **Step 1: Confirm real tools target**

Run:

```powershell
rtk pwsh -NoLogo -NoProfile -Command "if(!(Test-Path 'D:\ps_copy\p6\tools\cocos-cli')){ throw 'tools target not found' }; git -C D:\ps_copy\p6\tools status --short --branch"
```

Expected: target exists. If `git status` is not clean, stop and ask user before overwriting.

- [ ] **Step 2: Release to real target**

Run:

```powershell
rtk pwsh -NoLogo -NoProfile -Command "npm run release:tools -- --target D:\ps_copy\p6\tools\cocos-cli"
```

Expected: exit code 0.

- [ ] **Step 3: Verify real target scripts and README**

Run:

```powershell
rtk pwsh -NoLogo -NoProfile -Command "Test-Path D:\ps_copy\p6\tools\cocos-cli\install-cocos-cli.cmd; Test-Path D:\ps_copy\p6\tools\cocos-cli\preview-runtime.cmd; Select-String -LiteralPath D:\ps_copy\p6\tools\cocos-cli\README.md -Pattern 'install-cocos-cli.cmd|preview-runtime.cmd|--watch-assets|--refresh-on-reload'; Select-String -LiteralPath D:\ps_copy\p6\tools\cocos-cli\package.json -Pattern '\"cocos\"'"
```

Expected: both script paths print `True`; README matches print; `package.json` still exposes `cocos`.

- [ ] **Step 4: Stage and commit tools repo release**

Run forbidden-path guard:

```powershell
rtk pwsh -NoLogo -NoProfile -Command "git -C D:\ps_copy\p6\tools add -- cocos-cli; $bad = git -C D:\ps_copy\p6\tools diff --cached --name-only -- cocos-cli | Select-String -Pattern '(^|/)cocos-cli/node_modules/|(^|/)cocos-cli/packages/engine/'; if ($bad) { git -C D:\ps_copy\p6\tools reset -- cocos-cli; throw 'release commit would include node_modules or packages/engine' }; git -C D:\ps_copy\p6\tools diff --cached --name-status -- cocos-cli"
```

Expected: staged files include helper scripts and no forbidden paths.

Commit:

```powershell
rtk pwsh -NoLogo -NoProfile -Command "git -C D:\ps_copy\p6\tools commit -m 'tools: add cocos cli helper scripts'"
```

Expected: commit succeeds.

- [ ] **Step 5: Final status**

Run:

```powershell
rtk pwsh -NoLogo -NoProfile -Command "git status --short --branch; git -C D:\ps_copy\p6\tools status --short --branch"
```

Expected: source repo clean; tools repo clean.
