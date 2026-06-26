# Runtime Preview warm cache reload 性能事实记录（2026-06-26）

## 背景

用户反馈：`preview --runtime` 在浏览器刷新时体感明显慢于 Editor preview，并且 DevTools Network 面板中能看到大量 `200` status；Editor preview 在首次加载后，后续请求大量返回 `304`，二次加载接近秒开。

本记录只登记 2026-06-26 的本机诊断事实、数据和当前可证结论；不把当前数据直接等同为最终优化方案。

## 测试边界

- 测试层级：Browser/CDP diagnostic，不是自动化回归测试。
- Editor preview：`http://localhost:7457/`，由用户已打开的主测试项目 Editor preview 提供。
- CLI runtime preview：`http://127.0.0.1:19657/`，本次测试由 CLI 自行启动；未使用用户另作他用的 `9528`。
- 项目：`E:\own_space\engines\cocos-test-projects`。
- engine source：项目 `package.json` 中的 `cocos-cli.enginePath = D:\workspace\engines\cocos\3.8.6`。
- CLI 命令：`node dist\cli.js preview --runtime --project E:\own_space\engines\cocos-test-projects --host 127.0.0.1 --port 19657`。
- 浏览器：Playwright 驱动本机 Chrome，临时 user data dir，禁用扩展，保留浏览器默认 HTTP cache。
- 测量方法：每个 target 先打开一次作为 warm-up；后续普通 reload 才计入缓存测试。统计 `load`、runtime ready 近似值、network quiet、request count、DevTools surface status、CDP `Network.responseReceivedExtraInfo.statusCode` wire status。
- 原始数据：
  - `.codex-tmp/preview-speed-results.json`
  - `.codex-tmp/preview-concurrency-results.json`
  - `.codex-tmp/runtime-preview-speed-19657/stdout.log`
  - `.codex-tmp/runtime-preview-concurrency-19657/stdout.log`

## Editor preview 与 CLI runtime preview 对比

5 轮 warm cache reload 摘要：

| Target | warm-up | `networkQuietMs` min / median / max | `loadMs` min / median / max | `readyMs` min / median / max | request count | transfer bytes | DevTools surface status | wire status |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- |
| Editor preview `7457` | 3461ms | 2522 / 2550 / 3469ms | 199 / 220 / 1177ms | 135 / 137 / 150ms | 387 | 222599 | `200:118, 304:269` | `200:4, 304:383` |
| CLI runtime preview `19657` default | 4745ms | 5495 / 7150 / 7705ms | 153 / 205 / 322ms | 4536 / 6175 / 6736ms | 405 | 92375 | `200:135, 304:270` | `304:405` |

注意：

- Editor 的 `readyMs` 是脚本测量里对 canvas 出现的近似值，不等同于 CLI runtime ready。跨 target 更适合比较 `networkQuietMs`。
- CLI 的 warm cache reload 在 CDP wire status 层面全部是 `304`，不是重复下载大文件。
- CLI 的 `transferBytes` 低于 Editor，但 `networkQuietMs` 和 runtime ready 仍明显更慢，说明瓶颈不在网络传输字节数。

第一轮 reload 的请求分布：

| Target | 主要 bucket | 请求数 | wire status 事实 |
| --- | --- | ---: | --- |
| Editor preview | `/chunks/*.js` | 239 | 全部 `304` |
| Editor preview | `/assets/*` | 69 | 全部 `304` |
| Editor preview | `/query-extname/*` | 52 | 全部 `304` |
| Editor preview | `/scene/*.json` | 1 | `200` |
| Editor preview | `/socket.io/` | 2 | `200` |
| CLI runtime preview | `/chunks/*.js` | 240 | 全部 `304` |
| CLI runtime preview | `/assets/*` | 75 | 全部 `304` |
| CLI runtime preview | `/query-extname/*` | 54 | 全部 `304` |
| CLI runtime preview | `/scene/*.json` | 1 | `304` |
| CLI runtime preview | `/scene-list` | 1 | `304` |
| CLI runtime preview | `/scripting/x/...main-record.json` | 1 | `304` |

## DevTools 面板 `200` 与真实 wire status

本次证据显示，CLI reload 后 DevTools surface status 仍有 `200:135`，但同一批请求的 CDP `responseReceivedExtraInfo.statusCode` 是 `304:405`。

当前判断：

- 用户看到的“很多 200”是可复现现象。
- 但这批 `200` 不能直接等同为 server 没有 HTTP validator 或浏览器重新下载。
- 至少在本次 warm cache reload 条件下，CLI file response 的 `ETag` / conditional request 生效，wire status 全部是 `304`。
- DevTools surface `200` 主要集中在已缓存的 XHR / script 资源展示层，后续问题分析需要同时记录 surface status 和 wire status。

这也解释了为什么 `RP-ISSUE-006` 的 HTTP cache 修复仍然成立，但用户体感慢的问题并未因此消失。

## CLI script load concurrency 对性能的影响

CLI preview app 当前通过 browser 侧 script load limiter 限制 preview chunk 加载并发，默认并发为 `32`。本次在同一个 CLI server 下使用 query override 测试：

| `runtimePreviewScriptLoadConcurrency` | warm-up | `readyMs` min / median / max | `networkQuietMs` min / median / max | limiter `maxActive` | `queuePeak` | completed | wire status |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| 32 | 5772ms | 3827 / 4067 / 4546ms | 4817 / 5079 / 5538ms | 32 | 202 | 239 | 全部 `304` |
| 64 | 5332ms | 3797 / 3797 / 4286ms | 4797 / 4799 / 5295ms | 64 | 170 | 239 | 全部 `304` |
| 128 | 5019ms | 3320 / 3537 / 3595ms | 4328 / 4541 / 4592ms | 128 | 106 | 239 | 全部 `304` |
| 240 | 4914ms | 2335 / 3261 / 3712ms | 3361 / 4272 / 4725ms | 234 | 0 | 239 | 全部 `304` |

当前可证结论：

- 默认 `32` 并发是主测试项目 warm cache reload 慢的一个明确因素。
- 提高并发到 `240` 后，CLI median `networkQuietMs` 从约 `5079ms` 降到约 `4272ms`，median `readyMs` 从约 `4067ms` 降到约 `3261ms`。
- 但提高并发后仍慢于 Editor preview 的 `networkQuietMs` median `2550ms`，所以并发限制不是唯一原因。
- 不能简单把默认并发改成无限或 `240`：`RP-ISSUE-022` 记录过 `feature-c` 在大量 chunk、禁缓存条件下触发浏览器资源限制，默认 `32` 是为避免 `ERR_INSUFFICIENT_RESOURCES` 选择的保守值。

## 当前原因判断

已确认：

1. 慢不是由 warm cache reload 下的网络重复下载主导。CLI reload 的 wire status 全部 `304`，transfer bytes 也低于 Editor。
2. CLI browser 侧 preview chunk script load limiter 默认并发 `32` 会拉长 reload 时间，是可优化点。
3. CLI 比 Editor 多了 preview app 自身的 runtime 流程和若干请求，例如 `/scene-list`、`/scripting/x/...main-record.json` 等；但这些额外请求数量很少，不足以单独解释数秒差距。
4. CLI server 日志显示 `/settings.js` 的 `settings:build` 只在首轮触发 provider cache build，耗时约 `71-148ms` 量级，不是 warm cache reload 的主要慢因。
5. 代码分析确认：`src/runtime-preview/preview-app/src/main.ts` 在 `cc.game.init(option)` 之前安装 limiter；engine `D:\workspace\engines\cocos\3.8.6\cocos\game\game.ts` 的 `cc.game.init` 链路内部会调用 `_loadCCEScripts()`，在 browser `PREVIEW && !EDITOR` 条件下 import `cce:/internal/x/prerequisite-imports`。因此本次 concurrency 结果里 `__RUNTIME_PREVIEW_PREREQUISITE_TIMINGS__.prerequisiteImportMs` 接近 `0ms`，不是 prerequisite import 没有耗时，而是耗时已经发生在 `cc.game.init` 阶段。
6. 主测试项目当前 CLI preview target 产物包含 `239` 个 JS chunk；`cce:/internal/x/prerequisite-imports` 对应 generated chunk 通过 `System.register([...])` 声明 `233` 个 dependency，其中 `224` 个来自项目脚本，`9` 个来自 engine `editor/assets/default_renderpipeline` 等脚本。也就是说每次页面 reload 都要在新 JS context 中重新解析、链接和执行这批脚本；HTTP `304` 只能省下载，不能省 JS module execution。
7. `/query-extname/<uuid>` 在 CLI route 中是动态 `textResponse`：每个 uuid 会遍历 project / extension / internal library root，并对 `.cconb`、`.ccon` 做 `stat()` 探测。即使 Express 最终可返回 `304`，handler 仍需先计算 body；Editor 同类路径通过 asset-db 内存查询。该项是可能的次要慢因，但本次尚未量化其占比。
8. 进一步代码分析确认：engine `cc.game.run` 的 onStart callback 会等 `SplashScreen.instance.isFinished`；`D:\workspace\engines\cocos\3.8.6\cocos\game\splash-screen.ts` 中 `isFinished` 取决于 `settings.splashScreen.totalTime`。本次读取 `http://localhost:7457/settings.js` 得到 Editor preview `splashScreen.totalTime=50`，而 CLI runtime preview 原始 `/settings.js` 为 `2000`，这解释了 CLI reload 中稳定约 `2s` 的 `gameRunCallbackDelay`。

## 2026-06-26 实现验证

已在 browser 侧补充 phase timing，并将 CLI runtime preview 的 browser override 对齐 Editor preview：`splashScreen.totalTime = 50`。

代码入口：

- `src/runtime-preview/preview-app/src/main.ts`
- `src/runtime-preview/preview-app/@types/type.d.ts`
- `static/runtime-preview/preview-app/main.js`
- `vitests/suites/runtime-preview/preview-prerequisite-imports-policy.test.ts`

实现后，使用同一个 CLI server `http://127.0.0.1:19657/`，临时 Chrome profile，先 warm-up 再 reload，读取 `window.__RUNTIME_PREVIEW_PHASE_TIMINGS__`：

| 阶段 | 修改前 default `32` reload | 修改后 default `32` reload |
| --- | ---: | ---: |
| `ccImport` | 0ms | 1ms |
| `gameInit` | 1059ms | 792ms |
| `postGamePrerequisiteImports` | 9ms | 9ms |
| `readyResources` | 0ms | 0ms |
| `postRunDelay` | 105ms | 101ms |
| `gameRunCallbackDelay` | 2022ms | 75ms |
| `sceneJsonFetch` | 12ms | 11ms |
| `sceneLoadWithJson` | 138ms | 115ms |
| `settingsSplashTotalTime` | 2000ms | 50ms |

注意：`postRunDelay` 与 `gameRunCallbackDelay` 不是严格线性阶段。`cc.game.run` 当前不会等待 async onStart callback 完成，`postRunDelay` 可能与 scene load callback 交错；它仍可用于观察 preview app 自身固定等待。

当前实现能消除约 `1.9s` 的稳定 splash 等待。剩余 reload 成本主要仍在：

- `cc.game.init` 内部重新 import / instantiate `239` 个 preview chunk，default limiter `32` 下 `queuePeak=202`；
- scene load / assetManager 资源加载；
- dynamic route handler，如 `/query-extname/<uuid>` 的文件系统探测。

重新运行 5 轮 speed 诊断后，整体 reload 对比为：

| Target | warm-up | `networkQuietMs` min / median / max | `loadMs` min / median / max | `readyMs` min / median / max | request count | wire status |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Editor preview `7457` | 3293ms | 2339 / 2468 / 2649ms | 156 / 231 / 263ms | 132 / 136 / 146ms | 387 | `200:4, 304:383` |
| CLI runtime preview `19657` after splash override | 2838ms | 2268 / 2529 / 3568ms | 75 / 84 / 166ms | 1290 / 1550 / 2596ms | 405 | `304:405` |

与本记录开头的修改前 CLI default 数据相比，CLI median `networkQuietMs` 约 `7150ms -> 2529ms`，median runtime ready 约 `6175ms -> 1550ms`。本轮 Editor median `networkQuietMs` 为 `2468ms`，CLI median 为 `2529ms`，二者已接近。CLI `readyMs` 与 Editor canvas ready 仍不是同一语义，不应直接等同。

按用户要求改用“所有资源加载完成”口径重新测量。该口径使用：

- browser `performance.getEntriesByType('resource').responseEnd` 的最大值；
- CDP `Network.loadingFinished` / `Network.loadingFailed` 的同源最后网络事件时间；
- 同时保留 `networkQuietMs` 作为 Playwright `networkidle` 的辅助口径。

后续复测必须使用仓库内脚本 `vitests/scripts/runtime-preview-resource-completion-diagnostics.mjs`，`.codex-tmp/` 只允许保存临时输出，不允许作为唯一脚本来源。命令模板：

```powershell
node vitests/scripts/runtime-preview-resource-completion-diagnostics.mjs --url <preview-url> --label <label> --output .codex-tmp/<result>.json --warmup 1 --rounds 5
```

输出 JSON 必须保留并记录以下字段：

- `target`、`rounds` 和 `roundsRaw`；
- `resourceResponseEndMs`：来自 `performance.getEntriesByType('resource')` 的最大 `responseEnd` 摘要；
- `sameOriginLastFinishMs`：来自 CDP `Network.loadingFinished` / `Network.loadingFailed` 的同源最后网络事件时间摘要；字段名沿用 `Finish`，但语义包含 failed / canceled / aborted 请求；
- `networkQuietMs`：`load` 后等待 `networkidle` 的辅助摘要；
- `loadingFailedCount`：同源 `Network.loadingFailed` 请求计数摘要；
- `surfaceStatus`：browser / DevTools surface status 计数；
- `wireStatus`：CDP wire status 计数；
- `bucketMaxResponseEnd`：至少包含 `/assets/*`、`/query-extname/*`、`/scene/*.json`、`/chunks/*.js`、`/scene-list`、`/scripting/x/*`、`other` 的 count 和最大 `responseEnd`。

事实文档记录新的性能结论时，必须同时写明 CLI 端口、Editor 端口、warm-up 策略、5 轮原始 JSON 路径和诊断脚本 git path。

原始数据：`.codex-tmp/resource-completion-results.json`。本次已把 `performance.setResourceTimingBufferSize(5000)` 提前注入，避免默认 resource timing buffer 截断。

5 轮结果：

| Target | `resourceResponseEndMs` min / median / max | CDP same-origin last finish min / median / max | `networkQuietMs` min / median / max | request count | wire status |
| --- | ---: | ---: | ---: | ---: | --- |
| Editor preview `7457` | 1243 / 1572 / 3807ms | 1246 / 1575 / 3816ms | 2263 / 2609 / 4836ms | 388 左右 | warm cache 主要 `304`，少量 `200` / unknown |
| CLI runtime preview `19657` after splash override | 1469 / 2323 / 4371ms | 1475 / 2338 / 4387ms | 2512 / 3379 / 5391ms | 406 | `304:402, unknown:4` |

按所有资源加载完成口径，CLI 当前仍慢于 Editor，median 差距约 `2323ms - 1572ms = 751ms`。

每轮最后拖尾的 bucket 形态一致：

| Target | 拖尾顺序 |
| --- | --- |
| Editor preview | `/assets/*` 最晚，随后 `/query-extname/*`、`/scene/*.json`、`/chunks/*.js` |
| CLI runtime preview | `/assets/*` 最晚，随后 `/query-extname/*`、`/scene/*.json`、`/chunks/*.js`、`/scripting/x/.../import-map.json` |

CLI 第一轮 bucket 示例：

| Bucket | count | max `responseEnd` |
| --- | ---: | ---: |
| `/assets/*` | 75 | 1541ms |
| `/query-extname/*` | 54 | 1518ms |
| `/scene/*.json` | 1 | 1393ms |
| `/chunks/*.js` | 240 | 1302ms |

CLI 中位轮附近的拖尾更明显：

| Round | `resourceResponseEndMs` | `/assets/*` max | `/query-extname/*` max | `/scene/*.json` max | `/chunks/*.js` max | `gameInit` | `sceneLoadWithJson` |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 2 | 1469ms | 1469ms | 1452ms | 1362ms | 1272ms | 837ms | 128ms |
| 3 | 2323ms | 2323ms | 2270ms | 1857ms | 1748ms | 931ms | 492ms |
| 5 | 2431ms | 2431ms | 2384ms | 2206ms | 2112ms | 1538ms | 253ms |

因此，若问题定义为“所有资源加载完成时间”，当前更准确的判断是：

1. HTTP validator 仍不是问题，CLI warm cache wire status 仍为 `304`。
2. 当前剩余差距主要体现在资源加载链路的阶段顺序和拖尾：CLI 需要完成 preview chunk import / instantiate 后才进入 scene JSON、assets、`query-extname` 的加载；最后完成的通常是 `/assets/*` 和 `/query-extname/*`。
3. `splashScreen.totalTime=2000` 会推迟 `cc.game.run` onStart，从而推迟 scene/assets 请求启动；但在已对齐为 `50` 后，按所有资源 completion 仍有约 `751ms` median 差距，后续应优先分析 chunk execution、assetManager load 队列、`query-extname` dynamic route handler，而不是继续围绕 splash。

## Task 2 / Task 3 后复测

实现项：

- `/query-extname/<uuid>` 从每次请求 filesystem `stat()` 改为 server 生命周期内的 `uuid -> Promise<extension>` cache。正向命中缓存；miss 不长期缓存；并发同 uuid 请求共享同一个 in-flight lookup；`clear()` 后不回填旧 generation 结果。
- CLI root template 把 `/scene-list` 的 scene selector 安装从 bootstrap 前热路径移动到 `bootstrap(...).catch(...).then(scheduleSceneSelectorInstall)` 之后，并优先使用 `requestIdleCallback`，无该 API 时 fallback `setTimeout(0)`。该改动不删除 scene selector，只改变首屏 reload 的请求时机。

复测边界：

- CLI 端口：`http://127.0.0.1:19657/`，命令仍为 `node dist/cli.js preview --runtime --project E:\own_space\engines\cocos-test-projects --host 127.0.0.1 --port 19657`。
- Editor 对照端口：`http://localhost:7457/`，沿用上文同日 Editor preview 数据。
- warm-up 策略：同一个 browser context，先 `warmup=1`，再记录 `rounds=5`。
- 诊断脚本：`vitests/scripts/runtime-preview-resource-completion-diagnostics.mjs`。
- 原始 JSON：`.codex-tmp/resource-completion-after-task3.json`。
- CLI server 日志：`.codex-tmp/runtime-preview-measure-after-task3/stdout.log`、`.codex-tmp/runtime-preview-measure-after-task3/stderr.log`。

5 轮记录摘要：

| Target | `resourceResponseEndMs` min / median / max | CDP same-origin last finish min / median / max | `networkQuietMs` min / median / max | `loadingFailedCount` min / median / max | wire status |
| --- | ---: | ---: | ---: | ---: | --- |
| CLI after `/query-extname` cache + deferred `/scene-list` | 1002 / 1089 / 2085ms | 1006 / 1094 / 2095ms | 1517 / 1607 / 2609ms | 0 / 0 / 1 | `200:374, 206:1, 304:1633, unknown:26, loadingFailed:1` |

recorded round 1 已在脚本 warm-up 之后，但仍包含大量 wire `200`。当前只可证明 round 2-5 的 wire status 已稳定为 `304` 为主；recorded round 1 未稳定的具体原因仍需文件变更、日志或 mtime diff 进一步确认。因此按用户指定的“启动后打开一次，第二次才是缓存测试”语义，稳定 warm-cache 更应看 round 2-5：

| 轮次 | `resourceResponseEndMs` | CDP same-origin last finish | `networkQuietMs` | wire status | 最晚 bucket |
| ---: | ---: | ---: | ---: | --- | --- |
| 2 | 1228ms | 1239ms | 1755ms | `304:399, unknown:6` | `/assets/*` 1228ms；`/scene-list` 1220ms；`/query-extname/*` 1216ms |
| 3 | 1089ms | 1094ms | 1607ms | `304:402, unknown:3` | `/assets/*` 1089ms；`/scene-list` 1085ms；`/query-extname/*` 1066ms |
| 4 | 1023ms | 1047ms | 1553ms | `304:402, unknown:3` | `/scene-list` 1023ms；`/assets/*` 1023ms；`/query-extname/*` 999ms |
| 5 | 1002ms | 1006ms | 1517ms | `304:402, unknown:3` | `/assets/*` 1002ms；`/scene-list` 992ms；`/query-extname/*` 980ms |

round 2-5 稳定 warm-cache 摘要：

| Target | `resourceResponseEndMs` min / median / max | CDP same-origin last finish min / median / max | `networkQuietMs` min / median / max | `loadingFailedCount` min / median / max | wire status |
| --- | ---: | ---: | ---: | ---: | --- |
| CLI stable warm-cache round 2-5 | 1002 / 1089 / 1228ms | 1006 / 1094 / 1239ms | 1517 / 1607 / 1755ms | 0 / 0 / 0 | `304:1605, unknown:15` |

与 Task 2 / Task 3 前的 CLI `resourceResponseEndMs` median `2323ms` 相比，稳定 warm-cache median 降为 `1089ms`，改善约 `1234ms`。与同日 Editor preview `resourceResponseEndMs` median `1572ms` 相比，当前 CLI 稳定 warm-cache median 反而低约 `483ms`。这满足计划中“至少降低 `300ms`”的目标，因此本轮不继续执行更高风险的 adaptive script load concurrency 默认策略改动。

仍需保留的事实：

- DevTools surface status 仍会显示大量 `200`；round 2-5 的真实 wire status 仍以 `304` 为主，说明不能只用 DevTools surface status 判断是否重复下载。
- `/scene-list` 虽已从 bootstrap 前移出，但当前 round 2-5 仍各出现 1 次，且有时接近最后完成资源。原因是该请求被安排在 bootstrap settled 后的 idle / timer 阶段，仍属于页面最终资源集合；它不再阻塞 bootstrap，但会影响“所有资源加载完成”口径。
- CLI server stderr 仍出现并发 `settings.js` 构建导致的 `console.time` label 冲突警告，以及一次 `Request aborted`。这些属于日志 / ready gate / 并发请求治理问题，不是本轮 cache 性能修复的主因，但应在后续问题中单独处理。

## Editor preview 对照事实

用户指出：没有说明 Editor preview 的实际加载形态，就不能给出可靠优化方向。因此补充 `http://localhost:7457/` 当前事实：

- `settings.js` 中 `splashScreen.totalTime=50`，`downloadMaxConcurrency=15`，`assets.preloadBundles=[{"bundle":"resources"},{"bundle":"main"}]`，`projectBundles` 包含 `internal`、`resources`、`main` 以及多个测试 bundle；`launch.launchScene=""`。
- `/scripting/x/import-map.json` 中 `imports=235`、`scopes=236`，`cce:/internal/x/prerequisite-imports` 对应 chunk 的 scope dependency 数量为 `233`。这说明 Editor preview 并不是通过减少主测试项目 prerequisite dependency 数量来取得当前速度。
- Editor preview root 页面使用项目 `preview-template`，包含 toolbar/device selector；当前未观察到 CLI runtime preview 的 `/scene-list` route，`http://localhost:7457/scene-list` 返回 `404`。
- Editor 的 `/query-extname/<uuid>` 由 `src/core/scene/scene.middleware.ts` 通过 `assetManager.queryAssetInfo(uuid)` 查询内存态 AssetDB 信息；CLI runtime preview 的同名 route 当前在 `src/runtime-preview/server/runtime-preview-routes.ts` 通过 project / extension / internal library roots 做 `.cconb` / `.ccon` filesystem `stat()` 探测。
- Editor 的 `/scripting/x/*` 由 `src/core/scene/scene.scripting.middleware.ts` 通过 `waitForProgrammingFacet()` 和 `facet.loadPackResource(...)` 提供 pack resource；CLI runtime preview root template 使用 `/scripting/x/packer-driver/targets/preview/import-map.json` 和 `/scripting/x/packer-driver/targets/preview/main-record.json`。

基于这些事实，当前不能把优化归因写成“Editor 少加载 chunk”。更可靠的差异点是：

1. `settings.js` / preload policy 需要继续逐字段对齐，避免 CLI 多 preload bundle 或多触发 start-scene 相关资源。
2. `/query-extname/*` 应优先优化为 server 生命周期内的 uuid -> import replacement extension cache/map，或复用 AssetDB / library metadata，避免 warm reload 时对每个 uuid 重复 filesystem 探测。
3. CLI preview app 的 `/scene-list`、`main-record.json`、resolution detail map 等辅助请求应核对是否在首屏 reload 热路径中必要；不必要的应延迟到 UI 交互或首个 resolution miss。
4. script load limiter 只能做 adaptive concurrency，不能直接删除；`RP-ISSUE-022` 的 `feature-c` 大 chunk / 禁缓存资源限制场景必须作为回归约束。

尚未闭环：

1. `cc.game.init` 内部各阶段、`loadRuntimePreviewReadyResources`、scene `loadWithJson`、assetManager XHR 与首帧 ready 之间的逐阶段耗时尚未完整记录。
2. 当前 prerequisite timing 打点位置在 `cc.game.init` 之后，不能解释真实 prerequisite import wall time；需要把 performance marks 前移到 `cc.game.init` 外层，并在 engine import 前后或 SystemJS hook 中记录。
3. Editor preview 的 browser phase timing 还没有像 CLI 一样完整注入记录；当前只完成了 settings / import-map / route 形态对照，后续仍需补 Editor 页面内阶段指标。

## 优化方向

候选方向按风险从低到高：

1. 补齐 runtime phase instrumentation：在 browser 侧记录 `cc import`、`cc.game.init`、prerequisite import、validation、ready resources、scene load、first canvas frame、limiter queue metrics、assetManager request counts，并输出到 console 或 debug endpoint。没有阶段数据前，不应直接改默认策略。
2. 对齐 Editor preview 已确认的 settings / preload policy：`splashScreen.totalTime=50` 已验证，下一步继续确认 CLI 是否额外 preload `start-scene` 或多余 bundle。
3. 优化 `/query-extname/*`：从逐请求 filesystem `stat()` 改成启动期或首次请求构建的内存 cache/map，并定义清晰失效边界。
4. 检查 CLI preview app 是否有可省略的 reload 阶段：例如 scene list / main record 查询时机、resolution detail map 是否必须首屏请求。只能基于 engine / preview app 源码和阶段数据裁剪，不能靠猜测跳过。
5. 做 adaptive script load concurrency：保留 `feature-c` 这类大 chunk / 禁缓存场景的保护，同时在 warm cache、chunk 数较少或本地 HTTP cache 命中条件下提升并发。候选策略必须回归 `RP-ISSUE-022` 的 feature-c 资源限制用例。
6. 改进测量脚本并纳入诊断入口：保留 surface status 与 wire status 双记录，否则会再次把 DevTools 展示层 `200` 误判为真实下载。

## 当前结论

本问题不是 `RP-ISSUE-006` 的“HTTP validator 未生效”复发。主测试项目下，CLI runtime preview warm cache reload 的真实 wire status 已是 `304`。本轮已确认两个可控慢因并完成低风险优化：`splashScreen.totalTime=2000` 的稳定等待、以及 `/query-extname/*` filesystem 探测和 `/scene-list` 首屏热路径带来的拖尾。Task 2 / Task 3 后，CLI 稳定 warm-cache `resourceResponseEndMs` median 已从 `2323ms` 降到 `1089ms`，同日 Editor preview median 为 `1572ms`。因此，本轮性能问题已达到计划目标；后续不应在没有新证据时继续推进更高风险的 adaptive concurrency 默认策略。剩余可记录为后续项的是：`/scene-list` 在 all-resource 口径仍会进入最终资源集合、启动 ready 前并发 `settings.js` 构建和 `console.time` label 冲突、以及更细的 assetManager / engine phase instrumentation。
