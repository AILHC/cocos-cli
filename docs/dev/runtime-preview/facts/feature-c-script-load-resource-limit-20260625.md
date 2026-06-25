# feature-c 脚本加载资源上限事实记录

日期：2026-06-25

## 背景

本记录对应 `feature-c` 使用 CLI runtime preview 时，在 Edge DevTools 开启后刷新或首次加载页面出现的浏览器脚本加载错误。

当前预览地址：

`http://127.0.0.1:19530/?scene=4c721bfe-0b6e-46c2-97f0-644adfdcba31`

当前项目：

`D:\ps_copy\p6\trunk\Project\GameClient\feature-c`

当前 runtime preview log：

`D:\ps_copy\p6\trunk\Project\GameClient\feature-c\temp\preview-logs\runtime-preview-20260625-123627.log`

## 浏览器观察

用户在 Edge DevTools 中观察到下列错误形态：

```text
script-load.js:86 GET http://127.0.0.1:19530/scripting/x/packer-driver/targets/preview/chunks/7e/7ec1cf0f4e0e279457a1fe06ec87e6cb68e8b1b9.js net::ERR_INSUFFICIENT_RESOURCES
script-load.js:86 GET http://127.0.0.1:19530/scripting/x/packer-driver/targets/preview/chunks/93/93466fc2136f50e81860b8afa6961a2a83e8317c.js net::ERR_INSUFFICIENT_RESOURCES
script-load.js:86 GET http://127.0.0.1:19530/scripting/x/packer-driver/targets/preview/chunks/3b/3bcd02fcf0f9496ba42a9b573f2f8f6a03311900.js net::ERR_INSUFFICIENT_RESOURCES
```

此前还观察到 SystemJS 报错：

```text
script-load.js:69 Uncaught (in promise) Error: Error loading http://127.0.0.1:19530/scripting/x/packer-driver/targets/preview/chunks/d5/d52968c8252b39704faac908f9ca7a8f0cb48a87.js from http://127.0.0.1:19530/scripting/x/packer-driver/targets/preview/chunks/6d/6d8fd2b0177941b032ddc0733af48a561fb60657.js
```

同一 chunk URL 由命令行直接请求可返回 `200`，说明当前证据不支持“文件稳定缺失”判断。

## 产物规模

使用当前 server 直接请求：

`http://127.0.0.1:19530/scripting/x/packer-driver/targets/preview/import-map.json`

得到：

| 指标 | 值 |
| --- | --- |
| import-map raw length | `3549866` |
| `imports` count | `3255` |
| `cce:/internal/x/prerequisite-imports` | `./chunks/6d/6d8fd2b0177941b032ddc0733af48a561fb60657.js` |
| prerequisite scope count | `3253` |
| preview chunk scope count | `3253` |

使用当前 server 直接请求 prerequisite chunk：

`http://127.0.0.1:19530/scripting/x/packer-driver/targets/preview/chunks/6d/6d8fd2b0177941b032ddc0733af48a561fb60657.js`

得到：

| 指标 | 值 |
| --- | --- |
| chunk length | `170382` |
| unique `__unresolved_*` count | `3253` |
| 是否为 static `System.register([...])` | `true` |

## server log 证据

当前 runtime preview log 中统计：

| 指标 | 值 |
| --- | --- |
| `browser:preview-error` 行数 | `659` |
| chunk `Get ... failed` 行数 | `284` |

## 当前判断

`feature-c` 当前 preview target 的 prerequisite module 是 static `System.register([...deps])`，一次声明 `3253` 个 unresolved chunk 依赖。浏览器在 `System.import('cce:/internal/x/prerequisite-imports')` 阶段可能同时创建大量 script 加载请求，在 Edge / Chromium 下触发 `net::ERR_INSUFFICIENT_RESOURCES`。

这不是 RP-ISSUE-007 的目标回退。RP-ISSUE-007 解决的是 CLI preview target 不应使用 sequential dynamic import request list，而应对齐 Editor preview 的 static prerequisite 产物。本问题是 static prerequisite 在大项目下需要浏览器加载层限流和可观测指标。

## 统一实验条件

后续修复验证应使用以下固定条件：

- 保持 `feature-c` runtime preview 端口为 `19530`。
- 保持当前 Edge 页面和 DevTools，用真实页面刷新观察。
- Edge DevTools Network 开启 `Disable cache`，保证每轮实验不被浏览器缓存掩盖。
- 仅有人工开启 `Disable cache` 的描述不足以作为验收证据；每轮应至少满足以下一种证据：
  - CDP 执行 `Network.setCacheDisabled({ cacheDisabled: true })`。
  - Network evidence 中 preview chunk response 的 `fromDiskCache=false` 且 `fromMemoryCache=false`。
- 每轮刷新记录：
  - Network 是否出现 `net::ERR_INSUFFICIENT_RESOURCES`。
  - Console 是否出现 `SystemJS Error#3` 或 chunk `Get ... failed`。
  - runtime preview log 是否新增 `browser:preview-error`。
  - `System.instantiate` / `System.fetchScript` / `System.createScript` hook probe 结果。
  - prerequisite import 耗时、validation 耗时、ready 耗时和截图。
