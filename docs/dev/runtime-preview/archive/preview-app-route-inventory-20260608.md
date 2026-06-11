# Runtime Preview Preview-App Route Inventory

记录时间：2026-06-08

本文只记录当前已经迁入的 `preview-app` source 和 `static/runtime-preview` template 会实际请求的 routes。它不是 URL mapping 设计文档；Task 8C 的 route contract 和实现只能以本清单、engine source、CLI AssetDB output、当前依赖和冻结 editor 产物为输入，不能因为旧实现曾经存在某个 route 就直接实现。

## Route Inventory

| Route or request source | Source file | Required by production entry | Fact owner | Implementation status |
| --- | --- | --- | --- | --- |
| `/` | `src/runtime-preview/server/runtime-preview-routes.ts`, `static/runtime-preview/index.ejs` | yes | CLI root entry | `implemented-task-8b` |
| `/favicon.ico` | `static/runtime-preview/index.ejs` | yes, static page resource | CLI static resource | `implemented-task-8b` |
| `/index.css` | `static/runtime-preview/index.ejs` | yes, static page resource | CLI static resource | `implemented-task-8b` |
| `/settings.js` | `static/runtime-preview/script.ejs` via `settingsJs` render data | yes | CLI settings provider | `implemented-before-task-8b` |
| `/preview-app/index.js` | `static/runtime-preview/script.ejs` | yes | Creator preview-app build output | `implemented-task-8b` |
| `/scripting/polyfills/bundle.js` | `static/runtime-preview/script.ejs` | yes | current `@cocos/build-polyfills` dependency, with `@editor/build-polyfills` fallback | `implemented-task-8c` |
| `/scripting/engine/bin/.cache/dev-cli/web/import-map.json` | `static/runtime-preview/script.ejs` | yes | engine build/cache artifact under `engineRoot` | `implemented-task-8c` |
| `/scripting/engine/bin/.cache/dev-cli/web/bundled/index.js` | `static/runtime-preview/script.ejs` | yes | engine build/cache artifact under `engineRoot` | `implemented-task-8c` |
| `/scripting/import-map-global` | `static/runtime-preview/script.ejs` | yes | CLI programming route | `implemented-before-task-8b` |
| `/scripting/systemjs/system.js` | `static/runtime-preview/script.ejs` | yes | CLI programming route / frozen programming reference | `implemented-before-task-8b` |
| `/scripting/x/packer-driver/targets/preview/import-map.json` | `src/runtime-preview/server/preview-entry-template.ts` as `packImportMapURL` | yes | CLI programming route | `implemented-before-task-8b` |
| `/scripting/x/packer-driver/targets/preview/main-record.json` | `src/runtime-preview/server/preview-entry-template.ts` as current `packResolutionDetailMapURL` | yes, but shape must be verified | CLI programming route | `implemented-before-task-8b; needs-shape-review-before-browser-smoke` |
| `/assets/<bundle>/index.js` | `static/runtime-preview/script.ejs` `registerPrerequisiteImports()` | conditional: when `window._CCSettings.assets.projectBundles` is non-empty | bundle config / current settings | `partially-implemented-before-task-8b` |
| `/scene-list` | `static/runtime-preview/script.ejs` `installSceneSelector()` | yes for toolbar scene selector | project AssetDB/library facts | `implemented-task-8c` |
| `/scene/<uuid>.json` | `src/runtime-preview/preview-app/src/main.ts#getCurrentScene()` | conditional: when `settings.launch.launchScene` is non-empty | project AssetDB/library facts | `implemented-task-8c` |
| `/missing-asset/<uuid>` | `src/runtime-preview/preview-app/src/main.ts#onAssetMissing()` | diagnostic runtime route | project AssetDB facts when available | `implemented-task-8c-fallback-only` |
| `/preview-error` | `static/runtime-preview/script.ejs#reportPreviewError()` | diagnostic browser error route | CLI runtime preview log | `implemented-task-8c` |
| `/socket.io/socket.io.js` | `src/runtime-preview/preview-app/src/index.ts#createSocket()` | yes unless source is explicitly adapted to no-op socket | Socket.IO client dependency | `implemented-task-8c-client-file-only` |
| `assets/general/import` | `src/runtime-preview/preview-app/src/main.ts` official bootstrap override | source-owned asset base | official Creator preview-app source + engine asset manager | `source-owned; still validated by library route/browser smoke` |
| `assets/general/native` | `src/runtime-preview/preview-app/src/main.ts` official bootstrap override | source-owned asset base | official Creator preview-app source + engine asset manager | `source-owned; still validated by library route/browser smoke` |
| `/node_modules/vconsole/dist/vconsole.min.js` | `static/runtime-preview/script.ejs` guarded by `enableDebugger` | optional | debugger dependency | `optional-or-deferred` |

## Task 8C Boundaries

- Task 8C 新增的 required/diagnostic routes are covered by `vitests/suites/runtime-preview/preview-app-route-contract.test.ts`; root entry and older programming/library routes are covered by the earlier runtime-preview suites.
- Scripting engine files are served on demand from `engineRoot`; this uses exact request paths and root containment checks, not startup scans.
- Polyfills are served on demand from installed build-polyfills dependencies. Empty placeholder JS is forbidden.
- Scene list is derived from `.assets-data.json` scene entries under the current project library roots. When production passes `project/library`, CLI output `project/library/cli` is preferred first; explicit frozen editor references remain usable for reference tests. `/scene/<uuid>.json` only serves a serialized scene file when the same metadata proves the uuid is a scene.
- `/missing-asset/<uuid>` currently returns an explicit CLI fallback object when no AssetDB missing-asset service is available. This is diagnostic-only and must not be used as preview success evidence.
- `/preview-error` writes POST payloads into the runtime preview log. Direct handler tests verify the logging path; browser smoke still needs to prove real browser errors arrive after startup wait.
- `/socket.io/socket.io.js` serves the real Socket.IO client file. This proves the browser import route exists, but it does not yet prove live socket events; that belongs to browser integration verification.
- `assets/general/import` and `assets/general/native` are source-owned by preview-app bootstrap. Server/library mapping for actual resources remains validated by existing library route tests and later browser smoke, not by hardcoded URL guessing.
- `packResolutionDetailMapURL` currently points at an existing programming JSON route to keep root rendering fact-backed. Its shape still needs review before browser smoke can rely on `System.setResolutionDetailMapCallback()`.
- No route in this inventory permits startup recursive scans over `library`, `temp`, `assets`, engine root or generated output.
