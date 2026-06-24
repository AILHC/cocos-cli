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

因此当 bundle config 标记 `hasPreloadScript: true` 时，engine 会尝试加载：

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
- 对 `hasPreloadScript: true` 的 bundle，dummy `index.js` 不能满足 engine `asset-manager/factory.ts` 的 `virtual:///prerequisite-imports/<bundle.name>` 加载语义。
- `TestBundleZip` 是本次可复现样本，但风险不局限于该 bundle；所有带 `hasPreloadScript: true` 且运行时通过 `assetManager.loadBundle()` 加载的 bundle 都可能触发。

## 待确认问题

1. runtime preview 是否应生成 Editor preview 等价的 bundle index script，而不是 dummy script。
2. bundle script chunk 在 preview programming output 中的真实位置和 bundle name / bundle id 映射关系。
3. 对 `debug=true` preview output，`virtual:///prerequisite-imports/<bundle>` 应映射到哪类 URL：`chunks:///_virtual/<bundle>.js`、`/scripting/x/...` 下的 chunk，还是 SystemJS import-map scope 中已有 chunk。
4. remote bundle、zip bundle、subpackage bundle 是否共享同一 index 语义。

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

