# Runtime Preview `debug` 语义事实记录（2026-06-23）

## 背景

主测试项目用 CLI runtime preview 打开 `http://127.0.0.1:9527` 时，浏览器启动阶段报错：

```text
TypeError: Cannot read properties of undefined (reading 'cc.EffectAsset')
```

报错栈位于 Cocos engine 3.8.6 `cocos/asset/asset-manager/config.ts#processOptions()`。该函数在 bundle config `debug === false` 时按 compressed config 解析，要求 `options.types` 存在，并要求 `paths[*][1]` 是 `types` 数组下标。

## 当前 CLI 产物事实

采样环境：

- worktree：`E:\own_space\engines\cocos-cli\.worktrees\rebase-adapter-to-386-origin-main-20260622`
- branch：`codex/rebase-adapter-to-386-origin-main-20260622`
- HEAD：`87ea932`
- project：`E:\own_space\engines\cocos-test-projects`
- preview URL：`http://127.0.0.1:9527`
- 端口监听进程：`127.0.0.1:9527`，PID `49824`

采样命令：

```powershell
Invoke-WebRequest -UseBasicParsing "http://127.0.0.1:9527/assets/internal/config.json" |
    Select-Object -ExpandProperty Content |
    ConvertFrom-Json
```

采样摘要：

```json
{
  "name": "internal",
  "debug": false,
  "hasTypes": false,
  "firstPathKey": "60f7195c-ec2a-45eb-ba94-8955f60e81d0",
  "firstPathValue": ["db:/internal/effects/for2d/builtin-sprite", "cc.EffectAsset", 1]
}
```

因此当前 CLI runtime preview 的 `/assets/internal/config.json` 返回了不自洽的半压缩 config：

```json
{
  "name": "internal",
  "debug": false,
  "paths": {
    "uuid": ["db:/internal/effects/for2d/builtin-sprite", "cc.EffectAsset", 1]
  }
}
```

该 config 标记 `debug:false`，但没有 `types` 字段，且 `paths` 里的类型仍是字符串 `"cc.EffectAsset"`。因此 engine runtime 按 compressed config 读取时访问 `types["cc.EffectAsset"]`，触发 `types` 为 `undefined` 的错误。

## CLI 源码链路

- `src/core/builder/index.ts#getPreviewSettings()` 当前先读取 `pluginManager.getOptionsByPlatform("web-desktop")`，再合并传入 options 并设置 `preview:true`。
- 主测试项目本地 `profiles/v2/packages/builder.json` 中 `web-desktop` task options 含 `debug:false`。
- `src/core/builder/worker/builder/tasks/data-task/asset.ts` 在 `options.preview` 下执行 `bundleManager.initAsset()` 后直接 return，不执行 `bundleManager.bundleDataTask()`。
- `BundleManager.initBundleConfig()` 在 preview 下执行 `bundle.initConfig()` 和 `bundle.initAssetPaths()`。
- `Bundle.initConfig()` 把 `bundle.debug` 写入 `config.debug`。
- `Bundle.compress()` 才会在 `debug:false` 时生成 `config.types` 并把 `paths[*][1]` 转成 number，但 preview 路径没有执行该步骤。

因此当前问题不是 shared library cache 改写直接导致，而是 CLI preview 合并真实 build profile 后，把 normal build 的 `debug:false` 带进 preview bundle config，但 preview 路径没有生成 compressed config。

## 旧 Editor preview reference

参考源码：

`E:\own_space\tmp-repos\runtime-preview-reference\cocos-cli-backup-runtime-preview-bad-20260606\docs\dev\reference\old_editor_preview_server`

可见行为：

- `index.js#generateSettings()` 调用：

```js
Editor.Message.request("builder", "generate-preview-setting", {
    debug: !0,
    platform: e.platform || "web-desktop",
    preview: !0,
    startScene: e.startScene || ""
})
```

- `server.js#/settings.js` 调 `Editor.Message.request("preview", "generate-settings", { type: "browser", startScene })`，缓存返回的 `bundleConfigs`。
- `server.js#/assets/*/config.json` 按 bundle name 从 `bundleConfigs` 查找并直接 `JSON.stringify()` 返回，没有在 server route 层修正 `debug` 或压缩格式。
- `myps.ts` 旧链路中 `gulpBuild.buildSettings()` 和 `gulpBuild.buildConfig()` 也显式传 `debug: !0`、`preview: !0`。

结论：旧 Editor browser preview 的 settings / bundle config 生成入口显式使用 `debug:true`。它不是继承 build profile 的 `debug:false` 后再由 server 层修补 bundle config。

## 当前裁决

CLI runtime preview 应继续读取真实 `web-desktop` options，以保留项目配置、scene、bundleConfig、includeModules 等事实；但 preview settings generation 应对齐旧 Editor preview 语义，在进入 `BuildTask#getPreviewSettings()` 前强制 `debug:true`。

此外，`PreviewSettingsProvider` 或相邻边界应增加已知半压缩形态的防御校验：如果 provider 收到 `debug:false` 的 preview bundle config，至少必须存在 `types` 且 `paths[*][1]` 必须是 number。该校验不是完整 compressed config schema verifier；它的目标是阻止当前已复现的 `debug:false`、缺 `types`、字符串 asset type 组合进入浏览器 runtime。

## 实施后验证

实现采用 `src/core/builder/preview-options.ts#createPreviewBuildOptions()`，在 `getPreviewSettings()` 合并 `web-desktop` 默认 options 和调用方 options 后最终覆盖 `preview:true`、`debug:true`。该 helper 不从 `src/core/builder/index.ts` 公共导出，避免把内部 preview 语义暴露成外部 API。

已通过验证：

- `rtk npm test -- --runTestsByPath src/core/builder/test/preview-settings-debug-option.spec.ts`
- `rtk pwsh -NoLogo -NoProfile -Command '$env:COCOS_CLI_TEST_ENGINE_ROOT="D:\workspace\engines\cocos\3.8.6"; $env:COCOS_CLI_TEST_PROJECT_ROOT="E:\own_space\engines\cocos-test-projects"; $env:COCOS_CLI_TEST_EDITOR_LIBRARY_REF="E:\own_space\engines\cocos-test-projects\library"; $env:COCOS_CLI_TEST_EDITOR_PROGRAMMING_REF="E:\own_space\engines\cocos-test-projects\temp\programming"; npm --prefix vitests test -- suites/runtime-preview/settings-generation.test.ts'`
- `rtk npm run build`
- `rtk pwsh -NoLogo -NoProfile -Command '$env:COCOS_CLI_TEST_ENGINE_ROOT="D:\workspace\engines\cocos\3.8.6"; $env:COCOS_CLI_TEST_PROJECT_ROOT="E:\own_space\engines\cocos-test-projects"; $env:COCOS_CLI_TEST_EDITOR_LIBRARY_REF="E:\own_space\engines\cocos-test-projects\library"; $env:COCOS_CLI_TEST_EDITOR_PROGRAMMING_REF="E:\own_space\engines\cocos-test-projects\temp\programming"; npm --prefix vitests test -- suites/runtime-preview/preview-settings-debug-integration.test.ts'`

`vitests/suites/runtime-preview/main-test-project-cli-integration.test.ts` 仍失败于既有 `RP-ISSUE-016`：browser smoke 进入 scene 后报 `cc.TiledLayer` / `cc.TiledMap` class missing。该失败发生在 `/assets/internal/config.json` 已变为 `debug:true` 之后，不再是本 issue 的 `cc.EffectAsset` 半压缩 config 崩溃。
