# Runtime Preview Bundle Preload Script 缺失事实记录

日期：2026-06-24

## 背景

在 `BUILD-ISSUE-023` shared library output 手动验证中，使用主测试项目：

- project：`E:\own_space\engines\cocos-test-projects`
- CLI worktree：`E:\own_space\engines\cocos-cli\.worktrees\rebase-adapter-to-386-origin-main-20260622`
- preview URL：`http://127.0.0.1:9527/?scene=ea53723b-fbb6-46f9-bf18-eaf73a330fae`
- shared output gate：`COCOS_CLI_SHARED_LIBRARY_OUTPUT=1`
- preview server library root：`COCOS_CLI_TEST_EDITOR_LIBRARY_REF=E:\own_space\engines\cocos-test-projects\library`

本次 preview server 日志确认：

```text
projectLibraryRoot=E:\own_space\engines\cocos-test-projects\library
libraryRoot: E:\own_space\engines\cocos-test-projects\library
preview:ready durationMs=27034
```

## 现象

打开目标 scene 后，browser error 被 runtime preview server 捕获并写入：

`E:\own_space\engines\cocos-test-projects\temp\preview-logs\runtime-preview-20260624-122525.log`

关键错误：

```text
settings:build:start scene=ea53723b-fbb6-46f9-bf18-eaf73a330fae
settings:build:done durationMs=68 scene=ea53723b-fbb6-46f9-bf18-eaf73a330fae scripts=235 bundles=11
browser:preview-error {"message":"Get virtual:///prerequisite-imports/TestBundleZip failed!","stack":""}
browser:preview-error {"message":{},"stack":""}
browser:preview-error {"stack":""}
```

这说明该 scene 的 settings 生成成功，失败发生在浏览器运行时加载 bundle preload script 阶段。

## 直接证据

`TestBundleZip` bundle config 可由 runtime preview server 正常返回：

```text
GET http://127.0.0.1:9527/assets/TestBundleZip/config.json
HTTP/1.1 200 OK
```

返回内容中存在：

```json
{
  "name": "TestBundleZip",
  "debug": true,
  "hasPreloadScript": true
}
```

但 `TestBundleZip` bundle index 当前只返回 dummy script：

```text
GET http://127.0.0.1:9527/assets/TestBundleZip/index.js
HTTP/1.1 200 OK
```

内容：

```js
/* Runtime preview dummy bundle index for TestBundleZip. */
```

## Engine 触发点

本地 3.8.6 engine 源码 `D:\workspace\engines\cocos\3.8.6\cocos\asset\asset-manager\factory.ts` 存在运行时逻辑：

```ts
import(`virtual:///prerequisite-imports/${bundle.name}`).then((): void => {
```

因此在 browser runtime 创建 bundle 时，engine 会尝试加载：

```text
virtual:///prerequisite-imports/TestBundleZip
```

正常 build 产物中的 bundle `index.*.js` 会注册该 virtual module 到 bundle script chunk。例如既有 build smoke output 中存在：

```js
r('virtual:///prerequisite-imports/main', 'chunks:///_virtual/main.js');
```

当前 runtime preview 的 dummy index 没有注册：

```text
virtual:///prerequisite-imports/TestBundleZip -> chunks:///_virtual/TestBundleZip.js
```

## 当前判断

根因方向不是 `config.json` route 缺失，也不是 `settings.js` 生成失败；当前证据指向 runtime preview 对 bundle `index.js` 的模拟不完整：

- `src/runtime-preview/server/runtime-preview-routes.ts` 中 `createDummyBundleIndexScript()` 只返回注释。
- dummy `index.js` 不能满足 engine `asset-manager/factory.ts` 的 `virtual:///prerequisite-imports/<bundle.name>` 加载语义。
- `TestBundleZip` 是本次可复现样本，但风险不局限于该 bundle；所有运行时通过 `assetManager.loadBundle()` 加载且 bundle index 未注册该 virtual module 的 bundle 都可能触发。

## 待确认问题

1. runtime preview 是否应生成 Editor preview 等价的 bundle index script，而不是 dummy script。
2. bundle script chunk 在 preview programming output 中的真实位置和 bundle name / bundle id 映射关系。
3. 对 `debug=true` preview output，`virtual:///prerequisite-imports/<bundle>` 应映射到哪类 URL：`chunks:///_virtual/<bundle>.js`、`/scripting/x/...` 下的 chunk，还是 SystemJS import-map scope 中已有 chunk。
4. remote bundle、zip bundle、subpackage bundle 是否共享同一 index 语义。

## 2026-06-24 补充：Editor Preview 生成物事实

补查主测试项目已有 Editor/preview 生成物：

- Editor preview programming output：
  `E:\own_space\engines\cocos-test-projects\temp\programming\packer-driver\targets\preview`
- CLI runtime preview programming output：
  `E:\own_space\engines\cocos-test-projects\temp\cli\programming\packer-driver\targets\preview`

两者的 `import-map.json` 均存在全局 preview prerequisite module：

```json
{
  "imports": {
    "cce:/internal/x/prerequisite-imports": "./chunks/6d/6d8fd2b0177941b032ddc0733af48a561fb60657.js"
  }
}
```

该 chunk 是 `System.register([], ...)`，在 `execute` 中按顺序执行 `_context.import("__unresolved_N")`。对应 import-map scope 中确认：

```text
__unresolved_33 => ./chunks/3e/3e4b77beeb097bb3b3024c603a0b2cdbe7ffeeaf.js
__unresolved_43 => ./chunks/eb/ebaa288e552ff4a0a3f375801a0d4e1879d01c68.js
```

这两个 unresolved specifier 分别覆盖：

```text
file:///E:/own_space/engines/cocos-test-projects/assets/cases/asset/asset-bundle-zip.ts
file:///E:/own_space/engines/cocos-test-projects/assets/cases/asset/test-bundle-zip/back-to-asset-bundle-zip.ts
```

因此，当前 Editor preview / CLI preview 的 scripting 生成物事实是：

- preview target 生成全局 `cce:/internal/x/prerequisite-imports`，并包含主 scene 脚本与 `TestBundleZip` 内脚本。
- preview target 没有为 `TestBundleZip` 生成独立的 per-bundle `virtual:///prerequisite-imports/TestBundleZip` chunk 文件。
- runtime preview 的 bundle `index.js` 修复不应发明 per-bundle chunk 生成链路；更接近当前 preview 事实的修复是：bundle `index.js` 注册 `virtual:///prerequisite-imports/<bundle>`，并让该 marker module 依赖或等价衔接已有的 `cce:/internal/x/prerequisite-imports`。

旧 Editor preview server 参考：

`E:\own_space\tmp-repos\runtime-preview-reference\cocos-cli-backup-runtime-preview-bad-20260606\docs\dev\reference\old_editor_preview_server\server.js`

该参考中：

- `/assets/*/config.json` 从 `bundleConfigs` 按 bundle name 返回 config。
- `/assets/*/index.js` 在 bundle 存在时返回 `generateDummyScript(e.params[0])`。
- `/remote/*/config.json` 从 `gameviewBundleConfigs` 按 bundle name 返回 config。
- `/remote/*/index.js` 在 remote bundle 存在时同样返回 `generateDummyScript(e.params[0])`。

该参考目录没有包含 `generateDummyScript` 的函数定义，不能直接证明其函数体；但它能证明旧 Editor preview server 的 bundle index route 不是空注释 route，而是有专门的 dummy script 生成入口。

## 2026-06-24 补充后的判断

`RP-ISSUE-021` 的正式修复边界应调整为：

- 保留 runtime preview 现有全局 `cce:/internal/x/prerequisite-imports` 预加载语义。
- 修复 `/assets/<bundle>/index.js` 与 `/remote/<bundle>/index.js`，使其返回可注册 `virtual:///prerequisite-imports/<bundle>` 的 JavaScript，而不是纯注释。
- 不在本 issue 中引入 per-bundle script chunk 生成流程；现有 Editor preview 生成物没有该事实支持。
- 对 `/assets` 与 `/remote` 共享同一 registration script 生成逻辑；是否返回 200 仍由当前 `settings.bundleConfigs` 中 bundle 是否存在决定。

## 验收建议

- 用主测试项目 scene `ea53723b-fbb6-46f9-bf18-eaf73a330fae` 作为最小回归入口。
- 运行 shared 和默认 isolated 两种 runtime preview，确认 `assetManager.loadBundle('TestBundleZip')` 不再报：

```text
Get virtual:///prerequisite-imports/TestBundleZip failed!
```

- 增加 route / integration 测试，覆盖：
  - `GET /assets/TestBundleZip/config.json` 返回 `hasPreloadScript: true`。
  - `GET /assets/TestBundleZip/index.js` 返回可注册 `virtual:///prerequisite-imports/TestBundleZip` 的脚本，而不是纯 dummy。
  - 浏览器 error 日志不再出现 `browser:preview-error` 的该 virtual module failure。

## 2026-06-24 实现结果

- `src/runtime-preview/server/runtime-preview-routes.ts` 已将 bundle `index.js` route 从纯 dummy comment 改为返回 `System.register("virtual:///prerequisite-imports/<bundle>", ["cce:/internal/x/prerequisite-imports"], ...)`。
- `/assets/<bundle>/index.js` 与 `/remote/<bundle>/index.js` 继续共用同一个 route matcher 和同一个脚本生成逻辑；是否返回 200 仍由当前 `settings.bundleConfigs` 中是否存在对应 bundle 决定。
- 实现没有调用 builder `packMods()` 或 `ChunkBundler`，也没有生成 per-bundle chunk；只派生当前 preview 全局 `cce:/internal/x/prerequisite-imports` 语义。
- 生成脚本的 module id 和依赖 id 使用 `JSON.stringify()` 输出 JavaScript string literal；注释不直接插入原始 bundle name，避免特殊字符破坏脚本。

## 2026-06-24 验证结果

- RED：使用 frozen reference fixture 运行 `http-contract.test.ts`，在实现前失败于新增断言：`expected '/* Runtime preview dummy bundle index for resources. */' to contain 'System.register'`。
- GREEN：以下命令通过，覆盖 `/assets/resources/index.js`、`/remote/resources/index.js` 和带换行/引号的 bundle name string literal 安全：

```powershell
rtk pwsh -NoLogo -NoProfile -Command '$env:COCOS_CLI_TEST_PROJECT_ROOT="E:\own_space\cocos_work_lab_38x"; $env:COCOS_CLI_TEST_ENGINE_ROOT="D:\workspace\engines\cocos\3.8.6"; $env:COCOS_CLI_TEST_EDITOR_LIBRARY_REF="E:\own_space\engines\cocos-cli\.codex-tmp\reference-library\cocos_work_lab_38x-editor-library-20260606"; $env:COCOS_CLI_TEST_EDITOR_PROGRAMMING_REF="E:\own_space\engines\cocos-cli\.codex-tmp\reference-temp\cocos_work_lab_38x-editor-programming-20260606"; npm --prefix vitests test -- suites/runtime-preview/http-contract.test.ts'
```

- GREEN：以下命令通过，确认 preview-app 仍在 scene load 前 import 全局 `cce:/internal/x/prerequisite-imports`：

```powershell
rtk pwsh -NoLogo -NoProfile -Command '$env:COCOS_CLI_TEST_ENGINE_ROOT="D:\workspace\engines\cocos\3.8.6"; npm --prefix vitests test -- suites/runtime-preview/preview-prerequisite-imports-policy.test.ts'
```

- 环境校正：`http-contract.test.ts` 若使用 `E:\own_space\engines\cocos-test-projects\library` 作为 `COCOS_CLI_TEST_EDITOR_LIBRARY_REF`，会失败于 `No JsonAsset sample found in frozen editor library.`；该失败是 fixture 选择错误，不是本次 route 实现失败。
- GREEN：按当前验收口径，`main-test-project-cli-integration.test.ts` 已收窄为只验证 `TestBundleZip` scene `ea53723b-fbb6-46f9-bf18-eaf73a330fae`。以下 default isolated 命令通过，evidence file 为 `E:\own_space\engines\cocos-test-projects\temp\runtime-preview-main-test-project-cli-test-bundle-zip-scene.json`，目标 scene ready，`consoleErrorCount=0`、`pageErrorCount=0`、`failedRequestCount=0`、`badResponseCount=0`。

```powershell
rtk pwsh -NoLogo -NoProfile -Command '$env:COCOS_CLI_TEST_PROJECT_ROOT="E:\own_space\engines\cocos-test-projects"; $env:COCOS_CLI_TEST_ENGINE_ROOT="D:\workspace\engines\cocos\3.8.6"; npm --prefix vitests test -- suites/runtime-preview/main-test-project-cli-integration.test.ts'
```

- GREEN：以下 shared output 命令通过，同样只验证 `TestBundleZip` scene，不再执行无关三 scene。

```powershell
rtk pwsh -NoLogo -NoProfile -Command '$env:COCOS_CLI_SHARED_LIBRARY_OUTPUT="1"; $env:COCOS_CLI_TEST_PROJECT_ROOT="E:\own_space\engines\cocos-test-projects"; $env:COCOS_CLI_TEST_ENGINE_ROOT="D:\workspace\engines\cocos\3.8.6"; npm --prefix vitests test -- suites/runtime-preview/main-test-project-cli-integration.test.ts'
```

最新 runtime preview log 中目标 scene 记录为：

```text
settings:build:done durationMs=1199 scene=ea53723b-fbb6-46f9-bf18-eaf73a330fae scripts=235 bundles=11
```

旧错误 `Get virtual:///prerequisite-imports/TestBundleZip failed!` 只存在于修复前日志 `runtime-preview-20260624-122525.log`，本轮 default isolated / shared output 验收未再出现。
