# Runtime Preview Browser Entry Facts

记录时间：2026-06-08

本文只冻结 browser entry 事实，不设计新的 URL mapping。当前结论是：Creator 3.8.6 `preview-app` 源码和备份分支中的 CLI adapted static template 已经接入当前 CLI，root `/` 和 `/preview-app/*` 已成为 production browser entry。真实 browser smoke 仍不能声明完成，因为 preview-app required routes、ready signal 和稳定观察窗口尚未闭环。

## Fact Ledger

| Entry / route | Fact source | What it proves | What it does not prove | Status |
| --- | --- | --- | --- | --- |
| 当前 CLI root `/` | `src/runtime-preview/server/runtime-preview-routes.ts`、`src/runtime-preview/server/preview-entry-template.ts`、`static/runtime-preview/index.ejs`、`static/runtime-preview/script.ejs`、`vitests/suites/runtime-preview/browser-entry-contract.test.ts` | 当前 route handler 对 `/` 返回 production root HTML；页面加载 `/settings.js` 并通过 `System.import("/preview-app/index.js")` 启动 preview-app。 | 不证明 preview-app 后续 required routes、scene load、ready signal 或 browser smoke 已完成。 | `active-production-entry` |
| 当前 CLI `/preview-app/*` | `src/runtime-preview/server/runtime-preview-routes.ts`、`src/runtime-preview/server/preview-entry-template.ts`、`static/runtime-preview/preview-app/*.js`、`vitests/suites/runtime-preview/browser-entry-contract.test.ts` | 当前 route handler 对 `/preview-app/index.js` 返回构建脚本生成的 preview-app JavaScript。 | 不证明 preview-app 请求的 `/scene-list`、`/scene/<uuid>.json`、`/socket.io/socket.io.js` 或 `assets/general/import/native` 资源服务已完成。 | `active-production-entry` |
| Creator 3.8.6 preview-app source + CLI adaptation | `E:\own_space\tmp-repos\runtime-preview-reference\cocos-cli-backup-runtime-preview-bad-20260606\src\runtime-preview\preview-app\**`、备份分支 `docs/dev/runtime-preview-integration-alignment.md`、`docs/dev/runtime-preview-execution-plan.md` | `preview-app` 是 runtime preview 的 production browser entry 源码输入；当前实现应迁入源码并由 build script 生成 `static/runtime-preview/preview-app/*.js`。 | 不证明备份分支的所有 route/base mapping 正确；编译后的 JS 只能作为 build output/reference，不能手改后当源码。 | `production-entry-input` |
| CLI adapted static template / resources | `E:\own_space\tmp-repos\runtime-preview-reference\cocos-cli-backup-runtime-preview-bad-20260606\static\runtime-preview\script.ejs`、`toolbar.ejs`、`resources\**` | 备份分支 static template 证明 root page 的 browser boot shape，包括加载 `/settings.js` 和 `System.import("/preview-app/index.js")`。 | 不证明其中每个 URL route 都已经被当前 CLI 实现；route 清单必须在迁入 template/source 后按实际请求逐项确认。 | `production-entry-input` |
| 当前 CLI `/settings.js` | `src/runtime-preview/server/runtime-preview-routes.ts`、`src/runtime-preview/settings/preview-settings-provider.ts` | `/settings.js` 是当前 runtime preview 的已实现 settings entry，内容来自 `PreviewSettingsProvider.getPreviewSettings()` 并输出 `window._CCSettings = ...;`。 | 不证明 browser page 已经存在；不证明 scene/resource runtime 已经完成加载。 | `active-route` |
| 当前 CLI `/assets|remote/<bundle>/config.json`、`/assets|remote/<bundle>/index.js` | `src/runtime-preview/server/runtime-preview-routes.ts`、`src/runtime-preview/library/resolve-library-request.ts`、`vitests/suites/runtime-preview/http-contract.test.ts` | 当前 route 从 provider `bundleConfigs` 提供 bundle config/index，并由 request-time resolver 服务 engine/runtime 生成的资源 URL。 | 不证明 CLI server/template glue 可以覆盖 `assets.importBase`、`assets.nativeBase`、bundle config 或 captured URL。 | `active-route` |
| 当前 CLI scripting routes | `src/runtime-preview/programming/resolve-programming-request.ts`、`vitests/suites/runtime-preview/script-runtime-map.test.ts`、`vitests/suites/runtime-preview/http-contract.test.ts` | `/scripting/systemjs/*`、`/scripting/userland/macro`、`/scripting/import-map-global`、`/scripting/x/*`、`/plugins/*` 已有 fact-backed route。 | 不证明浏览器已能启动完整 preview scene；只证明 browser entry 可消费这些 routes。 | `active-route` |
| 旧 editor root `/` | `E:\own_space\tmp-repos\runtime-preview-reference\cocos-cli-backup-runtime-preview-bad-20260606\docs\dev\reference\old_editor_preview_server\server.js` | 历史 editor preview server 在 root `/` render page，render data 包含 `settingsJs`、`packImportMapURL`、`packResolutionDetailMapURL`，并在 fallback template render 后发送 `preview ready`。 | 不证明当前 CLI 可以照搬 root route；不证明当前 URL mapping、library resolver 或 settings route 应按旧实现设计。 | `historical-reference` |
| 旧 editor project template fallback | `old_editor_preview_server/server.js` | 历史 editor preview 优先使用项目 `preview-template/index.ejs`，否则使用 Creator builtin static `views/index.ejs`。 | 不证明当前 CLI 已有同等 template source、toolbar、socket、profile 或 plugin hook 环境。 | `historical-reference` |
| 旧 editor `/preview-app/*` | `old_editor_preview_server/server.js` | 历史 editor preview server 有 `/preview-app/*` route，服务 Creator preview-app dist 文件。 | 不证明当前 CLI 的 preview-app dist 位置、构建流程、接口契约或 ready signal。 | `historical-reference` |
| 备份分支 `runtime-preview-template.ts` | `E:\own_space\tmp-repos\runtime-preview-reference\cocos-cli-backup-runtime-preview-bad-20260606\src\runtime-preview\runtime-preview-template.ts` | 之前 CLI 适配尝试过项目 `preview-template/index.ejs`、static runtime-preview index、`settings.js` render data。它证明业务意图和旧尝试边界。 | 不作为当前 route 或 URL mapping 权威；其中错误实现不能被复制为事实。 | `backup-intent-reference` |
| 备份分支 `preview-app-resolver.ts` / browser contract tests | `E:\own_space\tmp-repos\runtime-preview-reference\cocos-cli-backup-runtime-preview-bad-20260606\src\runtime-preview\preview-app-resolver.ts`、`E:\own_space\tmp-repos\runtime-preview-reference\cocos-cli-backup-runtime-preview-bad-20260606\src\runtime-preview\test\runtime-preview-browser-contract.test.ts` | 之前实现尝试过 preview-app resolver、DOM/browser contract 和 `System.import("/preview-app/index.js")` 启动形态。 | 不证明当前 CLI 已有可用 preview-app build output；不证明该 contract 与 current engine/runtime facts 匹配。 | `backup-intent-reference` |
| Engine/runtime consumed facts | `D:\workspace\engines\cocos\3.8.6\cocos\asset\asset-manager\*.ts`、`docs/dev/runtime-preview/facts/architecture.md` | Browser page 必须消费 `/settings.js`、bundle config、scripting routes，并让 engine runtime 根据 settings/config 生成 import/native/pack/redirect URL。 | 不允许 CLI server/template glue 自行重写 `assets.importBase`、`assets.nativeBase`、bundle config、internal route 或 captured runtime URL。 | `active-runtime-facts` |
| `window.__RUNTIME_PREVIEW_READY` | 当前 CLI `src/runtime-preview/**`、备份/旧实现检索 | 当前 production source 没有该 ready signal contract。 | 不证明可以用 network idle、固定 sleep 或打开瞬间无错误替代 ready signal。 | `missing-contract` |
| Diagnostic browser route | 当前 CLI `src/runtime-preview/**` | 当前没有显式 diagnostic route，例如 `/__runtime-preview/browser-smoke`。 | 未来若加入 diagnostic route，它只能证明 browser host/network/route subset，不能替代 production root preview completion。 | `not-implemented` |

## Root Page / Preview-App Boundary

Root preview page / preview-app may:

- load `/settings.js` and consume `window._CCSettings`.
- load current CLI scripting routes: SystemJS、macro、global import map、preview records/chunks、`/plugins/*`。
- let engine runtime generate bundle/import/native/pack/redirect URLs from settings and bundle config.
- keep official Creator preview-app source behavior that sets `assets/general/import` and `assets/general/native` as browser preview bootstrap base.
- expose a test-observable ready signal only after real runtime facts have been consumed.

Root page / CLI template glue must not:

- assign or overwrite `assets.importBase`、`assets.nativeBase`、`assets.server`、bundle config、internal route、native route、pack route or captured runtime URL。
- copy old editor or backup URL/base/route mapping logic as authority.
- scan `library`、`temp`、`assets` or generated output at startup.
- convert a diagnostic browser harness into production preview page.

## Ready Signal Ownership

`window.__RUNTIME_PREVIEW_READY` must be classified before Task 8D browser smoke:

| Class | Allowed meaning | Acceptance impact |
| --- | --- | --- |
| `production-contract` | Production root page or preview-app sets it after real settings、scripting files、bundle config、representative resources and scene/resource marker are loaded. | May support final browser preview completion after a stable observation window. |
| `test-injection` | Browser test injects it only after verifying required HTTP/runtime facts. | Supports early browser host/network validation only; matrix status stays `partial`。 |
| `diagnostic-harness` | Dedicated diagnostic route sets it for a bounded route subset. | Supports diagnostic smoke only; cannot be documented as root preview. |

当前状态是 `missing-contract`。因此 Task 8D 真实 browser smoke 必须等 Task 8C 按 preview-app/template 实际请求确认 required routes 后再继续。

## Current Decision

当前不直接实现 browser smoke。下一步不是二选一，也不是新造 diagnostic page；必须先按 Task 8C 建立 preview-app/template route inventory，并按事实补齐 required routes。diagnostic route 如果后续需要，只能作为独立诊断入口，不能替代 production preview。
