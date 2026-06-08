# Runtime Preview Browser Entry Facts

记录时间：2026-06-08

本文只冻结 browser entry 事实，不设计新的 URL mapping。当前结论是：当前 CLI runtime preview 已有 `/settings.js`、bundle config/index、library、programming、scripting routes，但还没有事实来源足够完整的 root preview page 或 `/preview-app/*` production entry。因此 Task 8B 真实 browser smoke 不能声明 full preview 完成，只能在后续找到 production entry 或显式 diagnostic route 后继续。

## Fact Ledger

| Entry / route | Fact source | What it proves | What it does not prove | Status |
| --- | --- | --- | --- | --- |
| 当前 CLI root `/` | `src/runtime-preview/server/runtime-preview-routes.ts`、`vitests/suites/runtime-preview/browser-entry-contract.test.ts` | 当前 route handler 对 `/` 返回 `404 No runtime preview route handled`。当前分支没有 production root preview page。 | 不证明 root page 不需要实现；只证明当前不能基于不存在的 root page 做 browser completion。 | `blocked-by-fact-gap` |
| 当前 CLI `/preview-app/*` | `src/runtime-preview/server/runtime-preview-routes.ts`、`vitests/suites/runtime-preview/browser-entry-contract.test.ts` | 当前 route handler 对 `/preview-app/index.js` 返回 `404`。当前分支没有 preview-app dist route。 | 不证明 preview-app 方向错误；只证明当前没有可验收的 production preview-app entry。 | `blocked-by-fact-gap` |
| 当前 CLI `/settings.js` | `src/runtime-preview/server/runtime-preview-routes.ts`、`src/runtime-preview/settings/preview-settings-provider.ts` | `/settings.js` 是当前 runtime preview 的已实现 settings entry，内容来自 `PreviewSettingsProvider.getPreviewSettings()` 并输出 `window._CCSettings = ...;`。 | 不证明 browser page 已经存在；不证明 scene/resource runtime 已经完成加载。 | `active-route` |
| 当前 CLI `/assets|remote/<bundle>/config.json`、`/assets|remote/<bundle>/index.js` | `src/runtime-preview/server/runtime-preview-routes.ts`、`src/runtime-preview/library/resolve-library-request.ts`、`vitests/suites/runtime-preview/http-contract.test.ts` | 当前 route 从 provider `bundleConfigs` 提供 bundle config/index，并由 request-time resolver 服务 engine/runtime 生成的资源 URL。 | 不证明 root page 可以覆盖 `assets.importBase`、`assets.nativeBase`、bundle config 或 captured URL。 | `active-route` |
| 当前 CLI scripting routes | `src/runtime-preview/programming/resolve-programming-request.ts`、`vitests/suites/runtime-preview/script-runtime-map.test.ts`、`vitests/suites/runtime-preview/http-contract.test.ts` | `/scripting/systemjs/*`、`/scripting/userland/macro`、`/scripting/import-map-global`、`/scripting/x/*`、`/plugins/*` 已有 fact-backed route。 | 不证明浏览器已能启动完整 preview scene；只证明 browser entry 可消费这些 routes。 | `active-route` |
| 旧 editor root `/` | `E:\own_space\tmp-repos\runtime-preview-reference\cocos-cli-backup-runtime-preview-bad-20260606\docs\dev\reference\old_editor_preview_server\server.js` | 历史 editor preview server 在 root `/` render page，render data 包含 `settingsJs`、`packImportMapURL`、`packResolutionDetailMapURL`，并在 fallback template render 后发送 `preview ready`。 | 不证明当前 CLI 可以照搬 root route；不证明当前 URL mapping、library resolver 或 settings route 应按旧实现设计。 | `historical-reference` |
| 旧 editor project template fallback | `old_editor_preview_server/server.js` | 历史 editor preview 优先使用项目 `preview-template/index.ejs`，否则使用 Creator builtin static `views/index.ejs`。 | 不证明当前 CLI 已有同等 template source、toolbar、socket、profile 或 plugin hook 环境。 | `historical-reference` |
| 旧 editor `/preview-app/*` | `old_editor_preview_server/server.js` | 历史 editor preview server 有 `/preview-app/*` route，服务 Creator preview-app dist 文件。 | 不证明当前 CLI 的 preview-app dist 位置、构建流程、接口契约或 ready signal。 | `historical-reference` |
| 备份分支 `runtime-preview-template.ts` | `E:\own_space\tmp-repos\runtime-preview-reference\cocos-cli-backup-runtime-preview-bad-20260606\src\runtime-preview\runtime-preview-template.ts` | 之前 CLI 适配尝试过项目 `preview-template/index.ejs`、static runtime-preview index、`settings.js` render data。它证明业务意图和旧尝试边界。 | 不作为当前 route 或 URL mapping 权威；其中错误实现不能被复制为事实。 | `backup-intent-reference` |
| 备份分支 `preview-app-resolver.ts` / browser contract tests | `E:\own_space\tmp-repos\runtime-preview-reference\cocos-cli-backup-runtime-preview-bad-20260606\src\runtime-preview\preview-app-resolver.ts`、`E:\own_space\tmp-repos\runtime-preview-reference\cocos-cli-backup-runtime-preview-bad-20260606\src\runtime-preview\test\runtime-preview-browser-contract.test.ts` | 之前实现尝试过 preview-app resolver、DOM/browser contract 和 `System.import("/preview-app/index.js")` 启动形态。 | 不证明当前 CLI 已有可用 preview-app build output；不证明该 contract 与 current engine/runtime facts 匹配。 | `backup-intent-reference` |
| Engine/runtime consumed facts | `D:\workspace\engines\cocos\3.8.6\cocos\asset\asset-manager\*.ts`、`docs/dev/runtime-preview-architecture-facts-20260606.md` | Browser page 必须消费 `/settings.js`、bundle config、scripting routes，并让 engine runtime 根据 settings/config 生成 import/native/pack/redirect URL。 | 不允许 page 或 preview-app 自行重写 `assets.importBase`、`assets.nativeBase`、bundle config、internal route 或 captured runtime URL。 | `active-runtime-facts` |
| `window.__RUNTIME_PREVIEW_READY` | 当前 CLI `src/runtime-preview/**`、备份/旧实现检索 | 当前 production source 没有该 ready signal contract。 | 不证明可以用 network idle、固定 sleep 或打开瞬间无错误替代 ready signal。 | `missing-contract` |
| Diagnostic browser route | 当前 CLI `src/runtime-preview/**` | 当前没有显式 diagnostic route，例如 `/__runtime-preview/browser-smoke`。 | 未来若加入 diagnostic route，它只能证明 browser host/network/route subset，不能当作 root preview completion。 | `not-implemented` |

## Root Page / Preview-App Boundary

Root preview page / preview-app may:

- load `/settings.js` and consume `window._CCSettings`.
- load current CLI scripting routes: SystemJS、macro、global import map、preview records/chunks、`/plugins/*`。
- let engine runtime generate bundle/import/native/pack/redirect URLs from settings and bundle config.
- expose a test-observable ready signal only after real runtime facts have been consumed.

Root preview page / preview-app must not:

- assign or overwrite `assets.importBase`、`assets.nativeBase`、`assets.server`、bundle config、internal route、native route、pack route or captured runtime URL。
- copy old editor or backup URL/base/route mapping logic as authority.
- scan `library`、`temp`、`assets` or generated output at startup.
- convert a diagnostic browser harness into production preview page.

## Ready Signal Ownership

`window.__RUNTIME_PREVIEW_READY` must be classified before Task 8B:

| Class | Allowed meaning | Acceptance impact |
| --- | --- | --- |
| `production-contract` | Production root page or preview-app sets it after real settings、scripting files、bundle config、representative resources and scene/resource marker are loaded. | May support final browser preview completion after a stable observation window. |
| `test-injection` | Browser test injects it only after verifying required HTTP/runtime facts. | Supports early browser host/network validation only; matrix status stays `partial`。 |
| `diagnostic-harness` | Dedicated diagnostic route sets it for a bounded route subset. | Supports diagnostic smoke only; cannot be documented as root preview. |

当前状态是 `missing-contract`。因此 Task 8B 必须保持 `blocked-by-fact-gap`，直到 production entry 或显式 diagnostic route 的事实来源被确认。

## Current Decision

当前不实现 browser smoke。原因不是浏览器测试不重要，而是当前缺少可作为 production contract 的 root preview page / preview-app entry。下一步可以二选一，但必须先更新计划或在 Task 8B 中显式声明范围：

1. 基于 current engine/runtime facts、当前 CLI settings/scripting routes、旧 editor historical reference 和备份分支 business intent，设计 production root preview page / preview-app entry。
2. 先加独立 diagnostic route，例如 `/__runtime-preview/browser-smoke`，只验证 browser host、settings、scripting、representative resource route，并在验收矩阵中保持 `partial`。
