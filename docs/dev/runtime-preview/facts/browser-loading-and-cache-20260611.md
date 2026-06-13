# Runtime Preview 浏览器加载与缓存事实 2026-06-11

本文只记录当前已确认事实和待验证问题，不作为实现计划。

## 结论

- 脚本加载性能问题当前只记录，不执行实现修改。
- 旧 Editor preview server 参考代码中没有显式设置 `Cache-Control`、`ETag`、`Last-Modified`、`If-None-Match`、`If-Modified-Since`。
- 旧 Editor preview server 大量使用 Express `res.sendFile()` / `express.static()` 返回脚本、engine、library、plugin 和 preview-app 文件。
- Express `send` 默认会为 file response 设置 `Cache-Control: public, max-age=0`、`Last-Modified`、`ETag`，并基于请求 header 做 conditional request 判断。
- 迁移前 runtime preview 自写 HTTP server 的 `serveOnDemandFile()` / `textResponse()` 只设置 `content-type`，没有设置 `Cache-Control`、`Last-Modified`、`ETag`，也没有处理 `If-None-Match` / `If-Modified-Since`。
- 2026-06-12 已将 runtime preview file response 迁移到 Express `res.sendFile(..., { dotfiles: "allow" })`；随后将 body response 也迁移到 Express `res.send()`，对齐 old preview server 的 body `ETag` / conditional `304` 路径。
- feature-c 真实 `/scripting/x/.../chunks/*.js` 已验证：首次请求返回 `200` 且带 `Cache-Control: public, max-age=0`、`ETag`、`Last-Modified`，第二次带 `If-None-Match` 返回 `304`。

## 旧 Editor 参考路径

参考目录：

`E:\own_space\tmp-repos\runtime-preview-reference\cocos-cli-backup-runtime-preview-bad-20260606\docs\dev\reference\old_editor_preview_server`

关键文件：

- `server.js`
- `myps.ts`
- `preview_ctrl.ts`
- `Facet.js`
- `FacetInstance.js`

## 旧 Editor Preview Server 事实

`server.js` 中的 browser preview route：

- `/assets/*/import/*`、`/assets/*/native/*`、`/remote/*/import/*`、`/remote/*/native/*` 使用 `t.sendFile(s)` 返回 library 文件。
- `/plugins/*` 使用 `t.sendFile(n)` 返回脚本 library 文件。
- `/preview-app/*` 使用 `t.sendFile(...)` 返回 preview-app dist 文件。
- `/scripting/polyfills/*`、`/scripting/systemjs/*`、`/scripting/userland/macro` 使用 `t.sendFile(...)`。
- `/scripting/x/*` 通过 `ProgrammingFacet.loadPackResource()` 读取 QuickPack resource；`type === "json"` 时 `t.json(i.json)`，`type === "chunk"` 时 `t.sendFile(i.chunk.path)`。
- `/scripting/engine/*` 从 `ProgrammingFacet.engineRoot` 取文件，存在则 `t.sendFile(s, { dotfiles: "allow" })`。

`server.js` 搜索计数：

- `Cache-Control`: 0
- `ETag`: 0
- `Last-Modified`: 0
- `If-None-Match`: 0
- `If-Modified-Since`: 0
- `sendFile`: 14
- `setHeader`: 0

`myps.ts` 中旧版 express preview server：

- server 初始化使用 `expressIns = eps()).use(compression())`。
- `/app/engine/*`、`/engine/*`、`/engine-dev/*`、`/app/editor/static/*`、`/app/*`、`/project/*`、`/preview-scripts/*`、`/plugins/*` 使用 `sendFile()`。
- `/assets/*/import/*`、`/assets/*/native/*` 通过 helper `S()` 从 `Editor.importPath` 取文件并 `sendFile()`。
- fallback 使用 `eps.static(w)`。
- `setPreviewBuildPath()` / `setPreviewAndroidInstantPath()` 使用 `express.static(e)`。
- 未发现显式 `Cache-Control`、`ETag`、`Last-Modified`、`setHeader`。

`preview_ctrl.ts` 是扩展注入的 preview middleware：

- bundle config / index / resource 命中后使用 `res.sendFile(...)`。
- 注入 `express.static(Editor.Project.path)`。
- 未发现显式 `Cache-Control`、`ETag`、`Last-Modified`、`setHeader`。

## Express 默认行为事实

本仓库 `node_modules/express/lib/response.js` 中 `res.sendFile()` 会把 app 的 `etag` 设置传给 `send`：

```js
opts.etag = this.app.enabled('etag');
var file = send(req, pathname, opts);
```

本仓库 `node_modules/send/index.js` 中 file response 默认行为包括：

```js
res.setHeader('Cache-Control', cacheControl)
res.setHeader('Last-Modified', modified)
res.setHeader('ETag', val)
```

并读取请求条件 header：

- `If-Match`
- `If-Unmodified-Since`
- `If-None-Match`
- `If-Modified-Since`

所以旧 Editor 参考代码虽然没有手写 cache header，但通过 Express `sendFile()` / `express.static()` 具备 validator header 和 conditional request 的默认路径。

## 迁移前 Runtime Preview Server 事实

`src/runtime-preview/server/serve-on-demand-file.ts`：

```ts
export async function serveOnDemandFile(file: ResolvedRuntimePreviewFile): Promise<RuntimePreviewHttpResponse> {
    return {
        statusCode: 200,
        headers: {
            'content-type': guessContentType(file.absolutePath),
        },
        body: await readFile(file.absolutePath),
    };
}
```

`textResponse()` 同样只设置 `content-type`。

`src/runtime-preview/server/runtime-preview-server.ts` 只把 route response headers 原样写出：

```ts
response.writeHead(routeResponse.statusCode, routeResponse.headers);
```

因此迁移前 server 不会自动生成 `ETag` / `Last-Modified`，也不会对 `If-None-Match` / `If-Modified-Since` 返回 `304`。

## 2026-06-12 Express adapter 迁移结果

- runtime preview server 的 request handling 已从裸 `node:http` callback 改为 Express app。
- `StartedRuntimePreviewServer.server` 仍是 Node `http.Server`，用于保持 listen / close / port allocation 语义。
- 业务 route dispatcher 仍是 `handleRuntimePreviewRequest()`。
- file response 由 Express `res.sendFile(..., { dotfiles: "allow" })` 输出。
- body response 使用 Express `res.send()` 写出；Express 默认 body `ETag` 生效，带匹配 `If-None-Match` 的请求可返回 `304`，但不会生成 file response 才有的 `Last-Modified`。
- Express 默认 `X-Powered-By` 已禁用，避免引入与目标无关的新增 header。
- 未变化 file response 已验证返回 `Cache-Control: public, max-age=0`、`ETag`、`Last-Modified`，带 `If-None-Match` 请求返回 `304`。
- 未变化 body response 已验证返回 `ETag`，不返回 `Last-Modified`，带匹配 `If-None-Match` 请求返回 `304`。
- `/preview-error` 正常 POST 已通过真实 HTTP adapter 验证会写入 runtime preview log；超过 `64 KiB` 仍返回 plain text `413`。
- feature-c 验证样本：`http://127.0.0.1:19630/scripting/x/packer-driver/targets/preview/chunks/00/00058acb9fa7c504e2af7956b6de2e0036373fdb.js` 首次 `200`，`Cache-Control=public, max-age=0`，`ETag=W/"1fec-19eb72cd9ed"`，`Last-Modified=Thu, 11 Jun 2026 14:53:50 GMT`，二次 `If-None-Match` 返回 `304`。
- 该迁移不改变默认 programming cache 策略，不改变 prerequisite scripts 加载顺序。

## 脚本加载问题记录

当前 `preview-app` 在 `cc.game.init()` 后等待：

```ts
await System.import('cce:/internal/x/prerequisite-imports');
```

`preview` target 当前使用 `makeTentativePrerequisiteImports()`，生成的 prerequisite module 使用动态 import 请求列表，并按顺序：

```ts
for (const request of requests) {
    try {
        await request();
    } catch (_err) {}
}
```

这意味着大项目首次加载会按 `System.import()` 顺序等待大量 prerequisite scripts。`feature-c` 真实产物中，`cce:/internal/x/prerequisite-imports` 关联的 unresolved chunk 数量约 3261。

当前不能直接改成全并发加载。原因是 `System.import()` 的并发化可能改变模块求值时序，影响脚本副作用、全局变量初始化、decorator / class registration 顺序。没有 browser performance trace 和等价性验证前，不执行加载顺序修改。

## 待验证问题

- 浏览器打开 preview 时，大量 `/scripting/x/.../chunks/*.js` 请求是否主要受浏览器缓存策略、DevTools disable cache、还是 module graph 加载时序影响。
- Express file response 已能让未变化的真实 feature-c script chunk 在 HTTP 条件请求下返回 `304`；浏览器 Network 面板中的实际缓存命中比例仍需浏览器 trace 验证。
- `settings.js`、bundle `config.json`、`/scripting/import-map-global`、QuickPack import map / resolution detail map 当前通过 Express body `ETag` 只允许 revalidate；是否需要更细的 `Cache-Control` 仍需结合 browser trace 验证。
- prerequisite scripts 的耗时到底来自网络请求串行、模块求值串行、browser cache miss，还是 SystemJS resolver / import map 解析开销。

## 禁止事项

- 不因加载慢默认清理编译缓存。
- 不因加载慢默认禁用浏览器缓存。
- 不在没有证据时把 prerequisite scripts 改为全并发导入。
- 不用测试便利性改变 production 默认策略。
