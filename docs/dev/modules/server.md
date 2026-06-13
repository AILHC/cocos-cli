# Server Module

## Responsibility

`src/server/` 负责 HTTP server、middleware、response handling 和 cache validators。它为 CLI、runtime preview 和其他本地服务能力提供 HTTP 层。

## Non-Goals

Server 模块不决定 AssetDB、scripting、builder 的业务语义，也不从请求 URL 反推资源依赖。

## Main Entry Points

- `src/server/`

## Inputs

输入包括 route request、runtime context、static file path、dynamic body response、route headers 和服务配置。

## Outputs

输出包括 HTTP status、headers、file response、body response、cache validators 和 error response。

## Dependencies

依赖 Express、filesystem 和下游模块提供的 response descriptor。`src/runtime-preview/server/runtime-preview-server.ts` 是 runtime-preview 对 server 能力的 consumer/adaptor，归属 `runtime-preview.md`。

## Current Constraints

File response 应走 Express `sendFile()` validator 路径。Dynamic body response 通过 Express `res.send()` 处理时可以生成 body `ETag`，满足条件请求时可以返回 `304`。Server 层只提供 HTTP 缓存语义，不保证浏览器一定会发送 conditional request。

## Related Evidence

当前 evidence 主要来自 runtime preview HTTP server 迁移专项；后续通用 server 专项结束后应补充模块自己的 facts 文档。

- `../runtime-preview/facts/browser-loading-and-cache-20260611.md`
- `../runtime-preview/plans/express-preview-server-migration-20260612.md`
