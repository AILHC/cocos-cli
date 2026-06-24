# Runtime Preview Bundle Preload Script Index Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 `RP-ISSUE-021`，让 runtime preview 的 bundle `index.js` 注册 engine 运行时需要的 `virtual:///prerequisite-imports/<bundle>`，避免 `assetManager.loadBundle()` 报 `Get virtual:///prerequisite-imports/<bundle> failed!`。

**Architecture:** 不生成 per-bundle script chunk，不复制 build 管线的 `ChunkBundler`。runtime preview 继续使用 preview target 已生成并由 preview-app 预加载的全局 `cce:/internal/x/prerequisite-imports`；bundle `index.js` 只负责注册 bundle-specific virtual marker module，并把它衔接到全局 prerequisite module。`/assets/<bundle>/index.js` 与 `/remote/<bundle>/index.js` 共用同一个纯函数生成 JavaScript，route 是否可用仍由 `settings.bundleConfigs` 决定。

**Tech Stack:** TypeScript、SystemJS、Vitest、runtime preview HTTP route、Cocos 3.8.6 asset manager bundle loading。

---

## Facts To Preserve

- Engine `cocos/asset/asset-manager/factory.ts` 在 browser runtime 创建 bundle 时会执行 `import(\`virtual:///prerequisite-imports/${bundle.name}\`)`。
- 当前 `src/runtime-preview/preview-app/src/main.ts` 已在 scene load 前执行 `System.import('cce:/internal/x/prerequisite-imports')`。
- Editor preview output 与 CLI preview output 的 `temp/.../packer-driver/targets/preview/import-map.json` 均只生成全局 `cce:/internal/x/prerequisite-imports`，没有 `TestBundleZip` 专属 chunk。
- 当前 `src/runtime-preview/server/runtime-preview-routes.ts#createDummyBundleIndexScript()` 只返回注释，不能注册 bundle virtual module。
- 旧 Editor preview server 的 `/assets/*/index.js` 和 `/remote/*/index.js` 都走 `generateDummyScript(bundleName)`，不是空响应。
- 当前 `preview --runtime` 启动时会在 `AssetDBManager.afterStartDB()` 中 query all `cc.Script` 并调用 `scripting.compileScripts(changes)`，因此“启动时感知已有新增脚本”有源码链路。
- 当前 runtime preview server 没有实现真实 Socket.IO reload 服务；`/socket.io/socket.io.js` 返回 no-op client。`PreviewSettingsProvider` 也会 cache settings result。运行中新增脚本后的 watch、settings invalidation、browser reload 和 browser import-map refresh 不属于当前已闭环能力。

## Files

- Modify: `src/runtime-preview/server/runtime-preview-routes.ts`
  - 将 `createDummyBundleIndexScript()` 改为生成 bundle prerequisite registration script。
  - 使用 `JSON.stringify()` 生成 JavaScript string literal，避免 bundle name 中合法特殊字符破坏脚本。
- Modify: `vitests/suites/runtime-preview/http-contract.test.ts`
  - 更新 `/assets/resources/index.js` 断言，不再接受纯 dummy comment。
  - 断言返回脚本注册 `virtual:///prerequisite-imports/resources`。
  - 断言返回脚本引用 `cce:/internal/x/prerequisite-imports`。
- Modify: `vitests/suites/runtime-preview/main-test-project-cli-integration.test.ts`
  - 按本 issue 验收口径从固定三 scene 改为只验证 `TestBundleZip` scene `ea53723b-fbb6-46f9-bf18-eaf73a330fae`。
  - default isolated 与 `COCOS_CLI_SHARED_LIBRARY_OUTPUT=1` shared output 均覆盖同一目标 scene。
- Modify: `docs/dev/runtime-preview/issues.md`
  - 实现并验收后，将 `RP-ISSUE-021` 从 `open` 更新为已验证状态，记录测试命令和 evidence。
- Modify: `docs/dev/runtime-preview/facts/bundle-preload-script-index-20260624.md`
  - 实现后补充最终脚本形态和验证结果。

## Target Script Contract

`/assets/TestBundleZip/index.js` 和 `/remote/TestBundleZip/index.js` 应返回 JavaScript，核心语义如下：

```js
System.register(
    "virtual:///prerequisite-imports/TestBundleZip",
    ["cce:/internal/x/prerequisite-imports"],
    function () {
        return {
            setters: [function () {}],
            execute: function () {},
        };
    },
);
```

该 script 的作用是：

- 让 engine 后续 `System.import('virtual:///prerequisite-imports/TestBundleZip')` 能 resolve。
- 依赖已有全局 `cce:/internal/x/prerequisite-imports`，保证 bundle marker 与 preview 全局 prerequisite 语义一致。
- 不导出 bundle-specific symbols；正常 build 的 bundle index mapping 也只用于让 prerequisite module resolve，而不是给 game code 提供 API。

## Runtime Script Update Scope

本计划必须覆盖“启动/重启后新增 bundle 脚本可被感知并加载”，不承诺“server 运行中新增脚本自动热更新”。

启动/重启后的验收标准：

- 新增一个非 plugin `cc.Script` 到 `TestBundleZip` bundle 目录，并确保该脚本有有效 AssetDB meta。
- 启动 runtime preview 时，`asset-db:script-sync:collect:done` 的集合应包含该脚本。
- `temp/.../packer-driver/targets/preview/import-map.json` 应出现该脚本的 `file:///...` module URL，且 `cce:/internal/x/prerequisite-imports` 对应 scope 能映射它的 unresolved specifier 到 `./chunks/...js`。
- 浏览器中先加载 `assetManager.loadBundle('TestBundleZip')`，再 `System.import('virtual:///prerequisite-imports/TestBundleZip')` 应 resolve。
- 浏览器中 `System.import('<new-script-file-url>')` 应返回该脚本 module，并能调用测试导出的函数或静态方法。

运行中新增脚本若要完整支持，需要另立 issue 或扩大本计划，至少包括：

- AssetDB filesystem change watch 到 script asset add/change/delete 的可靠事件。
- `scripting.compileScripts()` 增量执行后的 `PreviewSettingsProvider.invalidate()`。
- runtime preview server 向浏览器发送真实 `browser:reload` 或等价 refresh 信号。
- 浏览器侧刷新 import-map / resolution detail map，清理旧 SystemJS module cache，重新导入 `cce:/internal/x/prerequisite-imports`。
- 验证新增脚本在不重启 CLI 进程时可调用。

## Task 1: HTTP Contract Test First

**Files:**
- Modify: `vitests/suites/runtime-preview/http-contract.test.ts`

- [x] **Step 1: 修改 failing assertion**

将当前断言：

```ts
expect(await responseBodyText(indexResponse)).toContain('Runtime preview dummy bundle index for resources');
```

改为：

```ts
const indexBody = await responseBodyText(indexResponse);
expect(indexBody).toContain('System.register');
expect(indexBody).toContain(JSON.stringify('virtual:///prerequisite-imports/resources'));
expect(indexBody).toContain(JSON.stringify('cce:/internal/x/prerequisite-imports'));
expect(indexBody).not.toContain('Runtime preview dummy bundle index for resources');
```

- [x] **Step 2: 运行单测确认失败**

Run:

```powershell
rtk pwsh -NoLogo -NoProfile -Command '$env:COCOS_CLI_TEST_PROJECT_ROOT="E:\own_space\cocos_work_lab_38x"; $env:COCOS_CLI_TEST_ENGINE_ROOT="D:\workspace\engines\cocos\3.8.6"; $env:COCOS_CLI_TEST_EDITOR_LIBRARY_REF="E:\own_space\engines\cocos-cli\.codex-tmp\reference-library\cocos_work_lab_38x-editor-library-20260606"; $env:COCOS_CLI_TEST_EDITOR_PROGRAMMING_REF="E:\own_space\engines\cocos-cli\.codex-tmp\reference-temp\cocos_work_lab_38x-editor-programming-20260606"; npm --prefix vitests test -- suites/runtime-preview/http-contract.test.ts'
```

Expected: FAIL，原因是当前 body 仍为 `/* Runtime preview dummy bundle index for resources. */`，不包含 `System.register`。

## Task 2: Implement Bundle Index Registration Script

**Files:**
- Modify: `src/runtime-preview/server/runtime-preview-routes.ts`

- [x] **Step 1: 替换 helper 实现**

将：

```ts
function createDummyBundleIndexScript(bundleName: string): string {
    return `/* Runtime preview dummy bundle index for ${bundleName}. */`;
}
```

替换为：

```ts
const prerequisiteImportsModURL = 'cce:/internal/x/prerequisite-imports';

function createBundlePrerequisiteIndexScript(bundleName: string): string {
    const virtualModuleId = `virtual:///prerequisite-imports/${bundleName}`;
    return `
// Runtime preview bundle prerequisite marker.
System.register(
    ${JSON.stringify(virtualModuleId)},
    [${JSON.stringify(prerequisiteImportsModURL)}],
    function () {
        return {
            setters: [function () {}],
            execute: function () {},
        };
    },
);
`;
}
```

- [x] **Step 2: 更新 route 调用**

将：

```ts
return textResponse(200, createDummyBundleIndexScript(bundleIndexName), 'application/javascript; charset=utf-8');
```

改为：

```ts
return textResponse(200, createBundlePrerequisiteIndexScript(bundleIndexName), 'application/javascript; charset=utf-8');
```

- [x] **Step 3: 运行 HTTP contract 测试**

Run:

```powershell
rtk pwsh -NoLogo -NoProfile -Command '$env:COCOS_CLI_TEST_PROJECT_ROOT="E:\own_space\cocos_work_lab_38x"; $env:COCOS_CLI_TEST_ENGINE_ROOT="D:\workspace\engines\cocos\3.8.6"; $env:COCOS_CLI_TEST_EDITOR_LIBRARY_REF="E:\own_space\engines\cocos-cli\.codex-tmp\reference-library\cocos_work_lab_38x-editor-library-20260606"; $env:COCOS_CLI_TEST_EDITOR_PROGRAMMING_REF="E:\own_space\engines\cocos-cli\.codex-tmp\reference-temp\cocos_work_lab_38x-editor-programming-20260606"; npm --prefix vitests test -- suites/runtime-preview/http-contract.test.ts'
```

Expected: PASS。

## Task 3: Add Focused Route Coverage For Remote Bundle

**Files:**
- Modify: `vitests/suites/runtime-preview/http-contract.test.ts`

- [x] **Step 1: 添加 remote index assertion**

在现有 `/assets/resources/index.js` 断言附近增加：

```ts
const remoteIndexResponse = await handleRuntimePreviewRequest(routeContext, '/remote/resources/index.js');
expect(remoteIndexResponse.kind).toBe('body');
expect(remoteIndexResponse.statusCode).toBe(200);
expect(remoteIndexResponse.headers['content-type']).toBe('application/javascript; charset=utf-8');
const remoteIndexBody = await responseBodyText(remoteIndexResponse);
expect(remoteIndexBody).toContain('System.register');
expect(remoteIndexBody).toContain(JSON.stringify('virtual:///prerequisite-imports/resources'));
expect(remoteIndexBody).toContain(JSON.stringify('cce:/internal/x/prerequisite-imports'));
```

- [x] **Step 2: 运行 HTTP contract 测试**

Run:

```powershell
rtk pwsh -NoLogo -NoProfile -Command '$env:COCOS_CLI_TEST_PROJECT_ROOT="E:\own_space\cocos_work_lab_38x"; $env:COCOS_CLI_TEST_ENGINE_ROOT="D:\workspace\engines\cocos\3.8.6"; $env:COCOS_CLI_TEST_EDITOR_LIBRARY_REF="E:\own_space\engines\cocos-cli\.codex-tmp\reference-library\cocos_work_lab_38x-editor-library-20260606"; $env:COCOS_CLI_TEST_EDITOR_PROGRAMMING_REF="E:\own_space\engines\cocos-cli\.codex-tmp\reference-temp\cocos_work_lab_38x-editor-programming-20260606"; npm --prefix vitests test -- suites/runtime-preview/http-contract.test.ts'
```

Expected: PASS。若 `/remote/resources/index.js` 当前返回 404，需要先确认 fixture settings 是否包含 remote bundle；如果当前 route 只用 `settings.bundleConfigs`，该测试应使用已有 bundle name，不引入手写 remote-only fixture。

## Task 4: Main Project Integration Verification

**Files:**
- Modify: `vitests/suites/runtime-preview/main-test-project-cli-integration.test.ts`
- Modify: `docs/dev/runtime-preview/facts/bundle-preload-script-index-20260624.md`

- [x] **Step 1: 查找现有 scene 参数测试**

Run:

```powershell
rtk rg -n "ea53723b-fbb6-46f9-bf18-eaf73a330fae|runtime-preview|shared|COCOS_CLI_SHARED_LIBRARY_OUTPUT|scene" vitests/suites/runtime-preview/main-test-project-cli-integration.test.ts -S
```

Expected: 找到主测试项目 runtime preview integration 的启动 helper 和环境变量组织方式。

- [x] **Step 2: 增加或更新 `TestBundleZip` scene 验证**

测试目标：

```text
scene=ea53723b-fbb6-46f9-bf18-eaf73a330fae
bundle=TestBundleZip
failure message must not contain: Get virtual:///prerequisite-imports/TestBundleZip failed!
```

若现有 helper 支持 shared output 参数，覆盖：

```text
default isolated runtime preview
COCOS_CLI_SHARED_LIBRARY_OUTPUT=1 runtime preview
```

若现有 helper 不支持浏览器点击触发 `assetManager.loadBundle('TestBundleZip')`，本 task 不新增 Playwright UI 操作；先记录手动 verification 命令和 evidence file，避免写无法稳定触发业务按钮的伪自动化测试。

- [x] **Step 3: 运行相关 integration 测试或记录阻塞**

Run:

```powershell
rtk pwsh -NoLogo -NoProfile -Command '$env:COCOS_CLI_TEST_PROJECT_ROOT="E:\own_space\engines\cocos-test-projects"; $env:COCOS_CLI_TEST_ENGINE_ROOT="D:\workspace\engines\cocos\3.8.6"; npm --prefix vitests test -- suites/runtime-preview/main-test-project-cli-integration.test.ts'
```

Actual: PASS。按用户确认后的验收口径，integration suite 不再执行无关三 scene，只验证 `TestBundleZip` scene。default isolated 与 `COCOS_CLI_SHARED_LIBRARY_OUTPUT=1` shared output 均通过；evidence file 为 `E:\own_space\engines\cocos-test-projects\temp\runtime-preview-main-test-project-cli-test-bundle-zip-scene.json`。

## Task 5: Added Bundle Script Startup Verification

**Files:**
- Modify: `vitests/suites/runtime-preview/main-test-project-cli-integration.test.ts`
- Modify: `docs/dev/runtime-preview/facts/bundle-preload-script-index-20260624.md`

- [ ] **Step 1: 准备新增脚本样本**

在测试隔离项目或可恢复的主测试项目副本中，为 `TestBundleZip` bundle 增加一个非 plugin TypeScript 脚本，例如：

```ts
export function runtimePreviewAddedBundleScriptProbe(): string {
    return 'runtime-preview-added-bundle-script-ok';
}
```

脚本必须作为 AssetDB asset 存在，不能只写裸 `.ts` 文件后跳过 meta/import 流程。

- [ ] **Step 2: 启动 runtime preview 并检查 programming output**

Run:

```powershell
rtk npm --prefix vitests test -- suites/runtime-preview/main-test-project-cli-integration.test.ts
```

Expected:

```text
asset-db:script-sync:collect:done ... count=<includes new script>
```

并且 `temp/.../packer-driver/targets/preview/import-map.json` 包含新增脚本的 `file:///...runtime-preview-added-bundle-script.ts` module URL。

- [ ] **Step 3: 浏览器验证新增脚本可调用**

在 browser context 中执行：

```js
const cc = await System.import('cc');
await new Promise((resolve, reject) => {
    cc.assetManager.loadBundle('TestBundleZip', (err, bundle) => {
        if (err) {
            reject(err);
        } else {
            resolve(bundle);
        }
    });
});
await System.import('virtual:///prerequisite-imports/TestBundleZip');
const mod = await System.import('file:///.../runtime-preview-added-bundle-script.ts');
if (mod.runtimePreviewAddedBundleScriptProbe() !== 'runtime-preview-added-bundle-script-ok') {
    throw new Error('Added bundle script probe failed');
}
```

Expected: no `Get virtual:///prerequisite-imports/TestBundleZip failed!`，并且 probe 返回目标字符串。

## Task 6: Documentation And Issue State

**Files:**
- Modify: `docs/dev/runtime-preview/facts/bundle-preload-script-index-20260624.md`
- Modify: `docs/dev/runtime-preview/issues.md`

- [x] **Step 1: 回填实现事实**

在 facts 文档追加：

```markdown
## 2026-06-24 实现结果

- `/assets/<bundle>/index.js` 与 `/remote/<bundle>/index.js` 返回 `System.register("virtual:///prerequisite-imports/<bundle>", ["cce:/internal/x/prerequisite-imports"], ...)`。
- 不生成 per-bundle chunk；沿用 preview target 全局 `cce:/internal/x/prerequisite-imports`。
- `TestBundleZip` scene browser 验收已完成；default isolated 与 shared output 均未再出现 `Get virtual:///prerequisite-imports/TestBundleZip failed!`。
```

- [x] **Step 2: 更新 issue 台账**

在 `docs/dev/runtime-preview/issues.md` 的 `RP-ISSUE-021` 行记录：

```text
已修复并验证：bundle index route 注册 `virtual:///prerequisite-imports/<bundle>`，依赖全局 `cce:/internal/x/prerequisite-imports`；HTTP contract、prerequisite policy、`TestBundleZip` scene default isolated 与 shared output 验收均通过。
```

- [x] **Step 3: 运行文档相关 grep 确认没有旧断言残留**

Run:

```powershell
rtk rg -n "Runtime preview dummy bundle index|createDummyBundleIndexScript|Get virtual:///prerequisite-imports/TestBundleZip failed" src vitests docs/dev/runtime-preview -S
```

Expected:

- `src` 和 `vitests` 不再保留旧 dummy comment 断言。
- `docs/dev/runtime-preview/facts/bundle-preload-script-index-20260624.md` 可保留历史错误文本作为事实记录。

## Final Verification

Run:

```powershell
rtk pwsh -NoLogo -NoProfile -Command '$env:COCOS_CLI_TEST_PROJECT_ROOT="E:\own_space\cocos_work_lab_38x"; $env:COCOS_CLI_TEST_ENGINE_ROOT="D:\workspace\engines\cocos\3.8.6"; $env:COCOS_CLI_TEST_EDITOR_LIBRARY_REF="E:\own_space\engines\cocos-cli\.codex-tmp\reference-library\cocos_work_lab_38x-editor-library-20260606"; $env:COCOS_CLI_TEST_EDITOR_PROGRAMMING_REF="E:\own_space\engines\cocos-cli\.codex-tmp\reference-temp\cocos_work_lab_38x-editor-programming-20260606"; npm --prefix vitests test -- suites/runtime-preview/http-contract.test.ts'
rtk pwsh -NoLogo -NoProfile -Command '$env:COCOS_CLI_TEST_ENGINE_ROOT="D:\workspace\engines\cocos\3.8.6"; npm --prefix vitests test -- suites/runtime-preview/preview-prerequisite-imports-policy.test.ts'
rtk pwsh -NoLogo -NoProfile -Command '$env:COCOS_CLI_TEST_PROJECT_ROOT="E:\own_space\engines\cocos-test-projects"; $env:COCOS_CLI_TEST_ENGINE_ROOT="D:\workspace\engines\cocos\3.8.6"; npm --prefix vitests test -- suites/runtime-preview/main-test-project-cli-integration.test.ts'
rtk pwsh -NoLogo -NoProfile -Command '$env:COCOS_CLI_SHARED_LIBRARY_OUTPUT="1"; $env:COCOS_CLI_TEST_PROJECT_ROOT="E:\own_space\engines\cocos-test-projects"; $env:COCOS_CLI_TEST_ENGINE_ROOT="D:\workspace\engines\cocos\3.8.6"; npm --prefix vitests test -- suites/runtime-preview/main-test-project-cli-integration.test.ts'
```

Expected:

- HTTP contract PASS。
- prerequisite imports policy PASS，确认全局 `cce:/internal/x/prerequisite-imports` 仍按 preview 策略生成。
- main test project integration 按本 issue 验收口径只执行 `TestBundleZip` scene；default isolated 与 `COCOS_CLI_SHARED_LIBRARY_OUTPUT=1` shared output 均 PASS。

## Review Checklist Before Implementation

- 不调用 builder `packMods()` 或 `ChunkBundler`。
- 不新增 per-bundle script chunk output。
- 不改变 `settings.bundleConfigs` 的来源和默认策略。
- 不把测试环境缓存、旧 engineRoot、resolver record 残留作为 production 默认行为。
- 不修改生成物、项目资源 `.meta` 或 `library` 内容。
