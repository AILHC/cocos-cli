# Runtime Preview Express Preview Server Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` 或 `superpowers:executing-plans` task-by-task 执行。步骤使用 checkbox (`- [ ]`) 跟踪。

**Goal:** 将 `preview --runtime` 的 HTTP serving layer 从裸 `node:http` handler 改为 Express，同时保留现有 runtime preview 业务路由语义，并恢复旧 Editor 类似的 file response validator / conditional request 能力。

**Architecture:** 保留 `handleRuntimePreviewRequest()` 作为唯一业务路由分发入口，不把 runtime preview 的业务规则拆成 Express route table。新增 Express adapter：file response 改为描述文件路径，由 Express `res.sendFile()` 输出；body response 继续使用原始 `writeHead()` / `end()` 写出，不走 Express `res.send()`，避免给 `/settings.js`、bundle config、`/scripting/import-map-global` 等动态 body route 引入新的 `ETag` / conditional `304` 语义。这样 library resolver、programming resolver、settings provider、preview error 上报、health route 和日志语义保持不变，只有 file response 写出层替换为 Express。

**Tech Stack:** TypeScript, Express 5.1, Node `http.Server`, Vitest, Fetch API。

---

## 事实和边界

- 当前 `src/runtime-preview/server/runtime-preview-server.ts` 使用 `import { createServer } from 'node:http'`，直接 `response.writeHead()` / `response.end()`。
- 当前 `src/runtime-preview/server/serve-on-demand-file.ts` 使用 `readFile()` 一次性读取文件，只设置 `content-type`。
- 旧 Editor 参考实现主要通过 Express `res.sendFile()` / `express.static()` 输出文件；没有手写 `Cache-Control` / `ETag` / `Last-Modified`。
- Express 底层 `send` 默认会为 file response 设置 `Cache-Control: public, max-age=0`、`Last-Modified`、`ETag`，并处理 `If-None-Match` / `If-Modified-Since`。
- Express `res.send()` 也可能为 body response 生成 `ETag` 并触发 freshness `304`。本计划不使用 `res.send()` 输出 runtime preview body response。
- 本计划不修改 script loading 顺序，不修改 prerequisite imports，不修改编译缓存默认策略，不修改 library root 选择规则。

## 文件结构

- Modify: `src/runtime-preview/server/serve-on-demand-file.ts`
  - 将 `RuntimePreviewHttpResponse` 改为 discriminated union。
  - `serveOnDemandFile()` 不再 `readFile()`，改为返回 `{ kind: 'file', absolutePath }`。
  - `textResponse()` 返回 `{ kind: 'body', body }`。

- Modify: `src/runtime-preview/server/runtime-preview-server.ts`
  - 使用 `express()` 作为 request handler。
  - 继续用 Node `http.createServer(app)` 创建 `Server`，保留 `StartedRuntimePreviewServer.server` 类型和 `listenOnFetchReachablePort()`。
  - 增加 `sendRuntimePreviewResponse()` adapter：`kind === 'file'` 时调用 `response.sendFile(absolutePath, { dotfiles: 'allow' })`；`kind === 'body'` 时调用原始 `response.writeHead(...)` / `response.end(...)`。
  - 保留 `/__runtime-preview/health` response 内容和 status。
  - 保留 `/preview-error` POST body 上限 `64 * 1024`，超过时返回 `413 text/plain`。

- Create: `vitests/suites/runtime-preview/runtime-preview-express-server.test.ts`
  - 覆盖 Express file response headers 和 conditional request。
  - 覆盖 hidden path segment，例如 `/scripting/engine/bin/.cache/...` 不因 Express dotfiles 默认策略被拒绝。
  - 覆盖 body response 不新增 Express `ETag`。
  - 覆盖 `/preview-error` body limit。
  - 覆盖 health route。

- Modify: `vitests/suites/runtime-preview/http-contract.test.ts`
- Modify: `vitests/suites/runtime-preview/preview-app-route-contract.test.ts`
- Modify: `vitests/suites/runtime-preview/browser-entry-contract.test.ts`
  - 只更新直接读取 file response body 的断言，使其适配 `{ kind: "file", absolutePath }`。
  - 仍保持 route-level 业务断言；真实 HTTP body 由 server-level test 覆盖。

- Run only: `vitests/suites/runtime-preview/launcher-runtime-preview.test.ts`
  - 不改已有断言，作为 regression suite 运行。

- Modify: `docs/dev/runtime-preview/facts/browser-loading-and-cache-20260611.md`
  - 追加迁移后事实：runtime preview server 已改为 Express adapter，file response 由 `sendFile()` 提供 validator。

## 不改变的业务意图

- `handleRuntimePreviewRequest()` 仍然接收完整 `request.url`，包括 query string。
- `resolveRuntimePreviewStaticFile()`、`handlePreviewAppRequiredRoute()`、`resolveProgrammingRequest()`、`resolveLibraryRequest()` 调用顺序不变。
- `/settings.js` 仍在请求时通过 `PreviewSettingsProvider` 生成。
- `/assets/<bundle>/config.json` 和 `/assets/<bundle>/index.js` 仍由当前 settings / dummy script 逻辑生成。
- `/settings.js`、bundle config、bundle index、`/scripting/import-map-global` 等 body response 不新增 Express `ETag` / conditional `304`。
- `/plugins/*` 仍走 `settings.scriptRuntimeMap.script2library`。
- `/scripting/x/*` 仍走 current programming resolver。
- `/assets/*/(import|native)/*` 仍只使用 `RuntimePreviewContext` 中显式 roots。
- `preview-error` 仍只接受 `POST` body，body limit 仍是 `64 KiB`。
- server startup log、`server:listening` 单次输出、`StartedRuntimePreviewServer.close()` 语义不变。

---

### Task 1: 增加 Express file response 测试

**Files:**
- Create: `vitests/suites/runtime-preview/runtime-preview-express-server.test.ts`

- [ ] **Step 1: 写 failing test，证明当前 server 缺少 Express file validator**

新增测试文件：

```ts
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtemp } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { PreviewSettingsProvider } from '@runtime-preview/settings/preview-settings-provider';
import { startRuntimePreviewServer } from '@runtime-preview/server/runtime-preview-server';

async function createServerFixture() {
  const root = await mkdtemp(join(tmpdir(), 'runtime-preview-express-server-'));
  const projectRoot = join(root, 'project');
  const engineRoot = join(root, 'engine');
  const projectLibraryRoot = join(projectRoot, 'library', 'cli');
  const projectProgrammingRoot = join(projectRoot, 'temp', 'cli', 'programming');

  await mkdir(join(projectLibraryRoot, 'ab'), { recursive: true });
  await mkdir(join(engineRoot, 'bin', '.cache', 'dev-cli', 'web'), { recursive: true });
  await mkdir(projectProgrammingRoot, { recursive: true });
  await writeFile(join(projectLibraryRoot, 'ab', 'abcdef.json'), '{"ok":true}', 'utf8');
  await writeFile(join(engineRoot, 'bin', '.cache', 'dev-cli', 'web', 'import-map.json'), '{"imports":{}}', 'utf8');

  const server = await startRuntimePreviewServer({
    projectRoot,
    engineRoot,
    projectLibraryRoot,
    projectProgrammingRoot,
    host: '127.0.0.1',
    port: 0,
    settingsProvider: new PreviewSettingsProvider({
      loadPreviewSettings: async () => ({
        settings: {
          assets: {
            server: '',
            importBase: '',
            nativeBase: '',
          },
        },
        script2library: {},
        bundleConfigs: [],
      }),
    }),
  });

  return { server };
}

describe('runtime preview express server adapter', () => {
  it('serves file responses with Express validators and supports ETag revalidation', async () => {
    const { server } = await createServerFixture();
    try {
      const first = await fetch(`${server.url}/assets/resources/import/ab/abcdef.json`);
      expect(first.status).toBe(200);
      expect(first.headers.get('content-type')).toContain('application/json');
      expect(first.headers.get('cache-control')).toBe('public, max-age=0');
      expect(first.headers.get('etag')).toBeTruthy();
      expect(first.headers.get('last-modified')).toBeTruthy();
      expect(await first.json()).toEqual({ ok: true });

      const second = await fetch(`${server.url}/assets/resources/import/ab/abcdef.json`, {
        headers: {
          'If-None-Match': first.headers.get('etag')!,
        },
      });
      expect(second.status).toBe(304);
      expect(await second.text()).toBe('');
    } finally {
      await server.close();
    }
  });

  it('allows engine files under dot path segments required by preview', async () => {
    const { server } = await createServerFixture();
    try {
      const response = await fetch(`${server.url}/scripting/engine/bin/.cache/dev-cli/web/import-map.json`);
      expect(response.status).toBe(200);
      expect(response.headers.get('etag')).toBeTruthy();
      expect(await response.json()).toEqual({ imports: {} });
    } finally {
      await server.close();
    }
  });

  it('keeps preview error POST body limit as plain 413', async () => {
    const { server } = await createServerFixture();
    try {
      const response = await fetch(`${server.url}/preview-error`, {
        method: 'POST',
        body: 'x'.repeat(64 * 1024 + 1),
      });
      expect(response.status).toBe(413);
      expect(response.headers.get('content-type')).toContain('text/plain');
      expect(await response.text()).toContain('Runtime preview request body is too large.');
    } finally {
      await server.close();
    }
  });

  it('does not add Express validators to dynamic body responses', async () => {
    const { server } = await createServerFixture();
    try {
      const response = await fetch(`${server.url}/settings.js`);
      expect(response.status).toBe(200);
      expect(response.headers.get('etag')).toBeNull();
      expect(response.headers.get('last-modified')).toBeNull();
    } finally {
      await server.close();
    }
  });

  it('keeps health route shape', async () => {
    const { server } = await createServerFixture();
    try {
      const response = await fetch(`${server.url}/__runtime-preview/health`);
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toMatchObject({
        ok: true,
        projectRoot: expect.any(String),
        engineRoot: expect.any(String),
        projectLibraryRoot: expect.any(String),
        projectProgrammingRoot: expect.any(String),
        logFilePath: expect.any(String),
      });
    } finally {
      await server.close();
    }
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```powershell
$env:COCOS_CLI_TEST_ENGINE_ROOT = 'D:/workspace/engines/cocos/3.8.6'
rtk npm --prefix vitests test -- suites/runtime-preview/runtime-preview-express-server.test.ts
```

Expected:

- `serves file responses with Express validators...` 失败。
- 当前失败点应是 `cache-control` / `etag` / `last-modified` 为 `null`，或第二次请求不是 `304`。
- 如果第一条请求 `404`，说明 fixture route 没对上，应先修 test fixture，不改 production。
- `does not add Express validators to dynamic body responses` 在当前裸 `node:http` server 下应通过；迁移后也必须继续通过。

---

### Task 2: 改造 RuntimePreviewHttpResponse 为 body/file union

**Files:**
- Modify: `src/runtime-preview/server/serve-on-demand-file.ts`

- [ ] **Step 1: 修改 response type 和 helper**

将文件改为：

```ts
import type { ResolvedRuntimePreviewFile } from '../library/resolve-library-request';

export type RuntimePreviewHttpResponse =
    | RuntimePreviewBodyResponse
    | RuntimePreviewFileResponse;

export interface RuntimePreviewBodyResponse {
    kind: 'body';
    statusCode: number;
    headers: Record<string, string>;
    body: string | Buffer;
}

export interface RuntimePreviewFileResponse {
    kind: 'file';
    statusCode: number;
    headers: Record<string, string>;
    absolutePath: string;
}

export function guessContentType(filePath: string): string {
    const normalized = filePath.replace(/\\/g, '/');
    if (normalized.endsWith('.json')) {
        return 'application/json; charset=utf-8';
    }
    if (normalized.endsWith('.js')) {
        return 'application/javascript; charset=utf-8';
    }
    if (normalized.endsWith('.wasm')) {
        return 'application/wasm';
    }
    if (normalized.endsWith('.ttf')) {
        return 'font/ttf';
    }
    if (normalized.endsWith('.ccon') || normalized.endsWith('.cconb')) {
        return 'application/json; charset=utf-8';
    }
    if (normalized.endsWith('.png')) {
        return 'image/png';
    }
    if (normalized.endsWith('.jpg') || normalized.endsWith('.jpeg')) {
        return 'image/jpeg';
    }
    return 'application/octet-stream';
}

export function serveOnDemandFile(file: ResolvedRuntimePreviewFile): RuntimePreviewHttpResponse {
    return {
        kind: 'file',
        statusCode: 200,
        headers: {
            'content-type': guessContentType(file.absolutePath),
        },
        absolutePath: file.absolutePath,
    };
}

export function textResponse(statusCode: number, body: string, contentType = 'text/plain; charset=utf-8'): RuntimePreviewHttpResponse {
    return {
        kind: 'body',
        statusCode,
        headers: {
            'content-type': contentType,
        },
        body,
    };
}
```

注意：`serveOnDemandFile()` 从 async 变为 sync 后，现有 `return serveOnDemandFile(...)` 不需要 await，TypeScript 允许从 `async handleRuntimePreviewRequest()` 返回 plain value。

- [ ] **Step 2: 更新 route-level contract tests 的 file response 断言**

现有 route-level tests 中直接读取 `response.body` 的 file route 断言需要适配 union。做法：

- body route 仍断言 `response.kind === "body"` 并读取 `response.body`。
- file route 改为断言 `response.kind === "file"`、`response.absolutePath` 存在且位于预期 root。
- 如果测试确实需要验证 file 内容，测试 helper 可以基于 `absolutePath` 读取文件；但真实 HTTP response body、`Content-Type`、validator header 和 `304` 只在 server-level test 中验证。

覆盖文件：

- `vitests/suites/runtime-preview/http-contract.test.ts`
- `vitests/suites/runtime-preview/preview-app-route-contract.test.ts`
- `vitests/suites/runtime-preview/browser-entry-contract.test.ts`

- [ ] **Step 3: 运行类型检查定位调用方问题**

Run:

```powershell
rtk npx tsc -p tsconfig.json --noEmit
```

Expected:

- 如果只有 `RuntimePreviewHttpResponse` union 相关错误，继续 Task 3。
- 如果出现 unrelated dirty-worktree 错误，记录文件名，不在本计划中修复。

---

### Task 3: 将 runtime preview server adapter 改为 Express

**Files:**
- Modify: `src/runtime-preview/server/runtime-preview-server.ts`

- [ ] **Step 1: 替换 import**

将顶部 import 调整为：

```ts
import { createServer, type Server } from 'node:http';
import { join } from 'node:path';
import express, { type NextFunction, type Request, type Response } from 'express';
import {
    createRuntimePreviewContext,
    type RuntimePreviewContext,
    type RuntimePreviewExtensionLibraryRoot,
} from '../context/runtime-preview-context';
import { createRuntimePreviewLogger, type RuntimePreviewLogger } from '../logging/runtime-preview-logger';
import { PreviewSettingsProvider } from '../settings/preview-settings-provider';
import { handleRuntimePreviewRequest } from './runtime-preview-routes';
import type { RuntimePreviewHttpResponse } from './serve-on-demand-file';
```

删除 `IncomingMessage` import。

- [ ] **Step 2: 删除旧 readRequestBody()**

删除 `readRequestBody()` 函数。保留：

```ts
const maxPreviewErrorBodyBytes = 64 * 1024;
```

- [ ] **Step 3: 增加 Express response adapter**

在 `maxPreviewErrorBodyBytes` 后加入：

```ts
function applyHeaders(response: Response, headers: Record<string, string>): void {
    for (const [name, value] of Object.entries(headers)) {
        response.setHeader(name, value);
    }
}

function sendRuntimePreviewResponse(
    response: Response,
    routeResponse: RuntimePreviewHttpResponse,
    next: NextFunction,
): void {
    applyHeaders(response, routeResponse.headers);
    response.status(routeResponse.statusCode);

    if (routeResponse.kind === 'file') {
        response.sendFile(routeResponse.absolutePath, { dotfiles: 'allow' }, (error) => {
            if (error) {
                next(error);
            }
        });
        return;
    }

    response.writeHead(routeResponse.statusCode, routeResponse.headers);
    response.end(routeResponse.body);
}

function isBodyTooLargeError(error: unknown): boolean {
    return !!error
        && typeof error === 'object'
        && (error as { type?: string }).type === 'entity.too.large';
}
```

- [ ] **Step 4: 用 Express app 包装现有业务 handler**

在 `startRuntimePreviewServer()` 中，替换 `const server = createServer(async (request, response) => { ... })` 整块为：

```ts
    const app = express();

    app.post('/preview-error', express.text({
        type: () => true,
        limit: maxPreviewErrorBodyBytes,
    }));

    app.use(async (request: Request, response: Response, next: NextFunction) => {
        let pathname = '';
        try {
            const requestUrl = new URL(request.originalUrl || request.url || '/', `http://${host}`);
            pathname = requestUrl.pathname;
            if (pathname === '/__runtime-preview/health') {
                response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
                response.end(JSON.stringify({
                    ok: true,
                    projectRoot: context.projectRoot,
                    engineRoot: context.engineRoot,
                    engineRootSource: context.engineRootSource,
                    projectLibraryRoot: context.projectLibraryRoot,
                    extensionLibraryRoots: context.extensionLibraryRoots,
                    projectProgrammingRoot: context.projectProgrammingRoot,
                    cliProgrammingRoot: context.cliProgrammingRoot,
                    logFilePath: logger.logFilePath,
                }));
                return;
            }

            const routeResponse = await handleRuntimePreviewRequest({
                runtimeContext: context,
                settingsProvider: getSettingsProvider(),
                capturedRuntimeUrls: options.capturedRuntimeUrls,
                logger,
                method: request.method,
                body: typeof request.body === 'string' ? request.body : undefined,
            }, request.originalUrl || request.url || '/');
            sendRuntimePreviewResponse(response, routeResponse, next);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            if (pathname === '/settings.js') {
                console.error(`[runtime-preview] settings:generation:error ${message}`);
            }
            next(error);
        }
    });

    app.use((error: unknown, request: Request, response: Response, next: NextFunction) => {
        if (response.headersSent) {
            next(error);
            return;
        }

        if (isBodyTooLargeError(error)) {
            response.writeHead(413, { 'content-type': 'text/plain; charset=utf-8' });
            response.end('Runtime preview request body is too large.');
            return;
        }

        const message = error instanceof Error ? error.message : String(error);
        response.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
        response.end(message);
    });

    const server = createServer(app);
```

关键点：

- 使用 `request.originalUrl`，保留 query string。
- `app.use()` 不指定 wildcard path，避免 Express 5 path-to-regexp wildcard 语法差异。
- `sendFile(..., { dotfiles: 'allow' })` 必须保留，否则 `/scripting/engine/bin/.cache/...` 可能被 Express 默认 dotfiles 策略拒绝。
- body response 不使用 `res.send()` / `res.json()`，避免 Express 给动态 body route 增加新的 `ETag` / conditional `304`。
- 不全局 `app.disable('etag')`，否则会同时关闭 `sendFile()` 需要的 file validator。
- 不加 `compression()`，因为当前 runtime preview server 没有 compression；本任务只对齐 Express file serving validator，避免改变 content encoding。

- [ ] **Step 5: 运行 focused test**

Run:

```powershell
$env:COCOS_CLI_TEST_ENGINE_ROOT = 'D:/workspace/engines/cocos/3.8.6'
rtk npm --prefix vitests test -- suites/runtime-preview/runtime-preview-express-server.test.ts
```

Expected:

- 7 tests pass。
- 第一条测试第二次请求返回 `304`。
- `.cache` path 返回 `200`。
- `/settings.js` 不返回 `ETag` / `Last-Modified`。

---

### Task 4: 运行现有 runtime preview regression suite

**Files:**
- No code changes.

- [ ] **Step 0: 运行 route contract tests**

Run:

```powershell
rtk cmd /c "set COCOS_CLI_TEST_PROJECT_ROOT=E:/own_space/cocos_work_lab_38x&& set COCOS_CLI_TEST_ENGINE_ROOT=D:/workspace/engines/cocos/3.8.6&& set COCOS_CLI_TEST_EDITOR_LIBRARY_REF=E:/own_space/engines/cocos-cli/.codex-tmp/reference-library/cocos_work_lab_38x-editor-library-20260606&& set COCOS_CLI_TEST_EDITOR_PROGRAMMING_REF=E:/own_space/engines/cocos-cli/.codex-tmp/reference-temp/cocos_work_lab_38x-editor-programming-20260606&& npm --prefix vitests test -- suites/runtime-preview/http-contract.test.ts suites/runtime-preview/preview-app-route-contract.test.ts suites/runtime-preview/browser-entry-contract.test.ts"
```

Expected:

- route-level tests 通过。
- file route 断言已明确区分 `kind === "file"`。
- body route 仍能读取原有 body 内容。

- [ ] **Step 1: 运行 launcher regression**

Run:

```powershell
rtk cmd /c "set COCOS_CLI_TEST_PROJECT_ROOT=E:/own_space/cocos_work_lab_38x&& set COCOS_CLI_TEST_ENGINE_ROOT=D:/workspace/engines/cocos/3.8.6&& set COCOS_CLI_TEST_EDITOR_LIBRARY_REF=E:/own_space/engines/cocos-cli/.codex-tmp/reference-library/cocos_work_lab_38x-editor-library-20260606&& set COCOS_CLI_TEST_EDITOR_PROGRAMMING_REF=E:/own_space/engines/cocos-cli/.codex-tmp/reference-temp/cocos_work_lab_38x-editor-programming-20260606&& npm --prefix vitests test -- suites/runtime-preview/launcher-runtime-preview.test.ts"
```

Expected:

- 所有现有测试通过。
- `server:listening` 仍只出现一次。
- 默认不出现 `programming:cache-clear:start` / `programming:cache-clear:done`。
- script compile error 仍 report-only，不阻塞 `preview:ready`。

- [ ] **Step 2: 运行 browser smoke**

Run:

```powershell
rtk cmd /c "set COCOS_CLI_TEST_PROJECT_ROOT=E:/own_space/cocos_work_lab_38x&& set COCOS_CLI_TEST_ENGINE_ROOT=D:/workspace/engines/cocos/3.8.6&& set COCOS_CLI_TEST_EDITOR_LIBRARY_REF=E:/own_space/engines/cocos-cli/.codex-tmp/reference-library/cocos_work_lab_38x-editor-library-20260606&& set COCOS_CLI_TEST_EDITOR_PROGRAMMING_REF=E:/own_space/engines/cocos-cli/.codex-tmp/reference-temp/cocos_work_lab_38x-editor-programming-20260606&& npm --prefix vitests test -- suites/runtime-preview/browser-runtime-smoke.test.ts"
```

Expected:

- Browser ready。
- `consoleErrors=[]`。
- `pageErrors=[]`。
- `failedRequests=[]`。
- `badResponses=[]`。

- [ ] **Step 3: 运行 cli startup regression**

Run:

```powershell
rtk cmd /c "set COCOS_CLI_TEST_PROJECT_ROOT=E:/own_space/cocos_work_lab_38x&& set COCOS_CLI_TEST_ENGINE_ROOT=D:/workspace/engines/cocos/3.8.6&& set COCOS_CLI_TEST_EDITOR_LIBRARY_REF=E:/own_space/engines/cocos-cli/.codex-tmp/reference-library/cocos_work_lab_38x-editor-library-20260606&& set COCOS_CLI_TEST_EDITOR_PROGRAMMING_REF=E:/own_space/engines/cocos-cli/.codex-tmp/reference-temp/cocos_work_lab_38x-editor-programming-20260606&& npm --prefix vitests test -- suites/runtime-preview/cli-startup.test.ts"
```

Expected:

- CLI startup tests pass。
- 输出格式不新增重复 root summary 或重复 `server:listening`。

---

### Task 5: 真实 feature-c 验证缓存有效性

**Files:**
- No code changes.

- [ ] **Step 1: 启动 feature-c runtime preview**

Run:

```powershell
rtk node node_modules/tsx/dist/cli.mjs src/cli.ts preview --runtime --project "D:\ps_copy\p6\trunk\Project\GameClient\feature-c" --port 19530
```

Expected:

- 输出 `preview:ready`。
- 不默认清理 programming cache。
- 不出现 `asset-db:script-compile:error` 阻塞启动。

- [ ] **Step 2: 用 HTTP 复现 file validator**

选一个实际存在的 script chunk URL。可从启动后的 preview 页面 network 或 `import-map.json` 取 `/scripting/x/.../chunks/...js`。

Run:

```powershell
$url = "http://127.0.0.1:19530/scripting/x/packer-driver/targets/preview/chunks/<two-hex>/<chunk>.js"
$first = Invoke-WebRequest -Uri $url -UseBasicParsing
$etag = $first.Headers.ETag
$lastModified = $first.Headers.'Last-Modified'
$second = Invoke-WebRequest -Uri $url -Headers @{ 'If-None-Match' = $etag } -SkipHttpErrorCheck -UseBasicParsing
[PSCustomObject]@{
  FirstStatus = [int]$first.StatusCode
  CacheControl = $first.Headers.'Cache-Control'
  ETag = $etag
  LastModified = $lastModified
  SecondStatus = [int]$second.StatusCode
}
```

Expected:

- `FirstStatus = 200`
- `CacheControl = public, max-age=0`
- `ETag` 非空
- `LastModified` 非空
- `SecondStatus = 304`

- [ ] **Step 3: 用浏览器验证业务不破坏**

在浏览器打开：

```text
http://127.0.0.1:19530
```

Expected:

- 页面进入 runtime preview。
- 没有新增同源 `404` / `500`。
- 没有因 `.cache` path、`/scripting/x/*`、`/assets/*` 被 Express 拒绝而导致的 failed request。
- 第二次刷新时，未变化的 file response 在 DevTools Network 中出现 `304` 或 memory/disk cache 命中；如果浏览器禁用缓存，则用 Step 2 的 HTTP validator 结果作为缓存有效性证据。

---

### Task 6: 更新事实文档

**Files:**
- Modify: `docs/dev/runtime-preview/facts/browser-loading-and-cache-20260611.md`
- Modify: `docs/dev/runtime-preview/README.md` only if current conclusion wording needs更新

- [ ] **Step 1: 更新迁移结果**

在 `docs/dev/runtime-preview/facts/browser-loading-and-cache-20260611.md` 增加：

```md
## 2026-06-12 Express adapter 迁移结果

- runtime preview server 的 request handling 已从裸 `node:http` callback 改为 Express app。
- `StartedRuntimePreviewServer.server` 仍是 Node `http.Server`，用于保持 listen / close / port allocation 语义。
- 业务 route dispatcher 仍是 `handleRuntimePreviewRequest()`。
- file response 由 Express `res.sendFile(..., { dotfiles: "allow" })` 输出。
- body response 继续使用原始 `writeHead()` / `end()` 写出，不新增 Express body `ETag` / conditional `304`。
- 未变化 file response 已验证返回 `Cache-Control: public, max-age=0`、`ETag`、`Last-Modified`，带 `If-None-Match` 请求返回 `304`。
- 该迁移不改变默认 programming cache 策略，不改变 prerequisite scripts 加载顺序。
```

- [ ] **Step 2: 运行文档 diff 检查**

Run:

```powershell
rtk git diff -- docs/dev/runtime-preview/facts/browser-loading-and-cache-20260611.md docs/dev/runtime-preview/README.md
```

Expected:

- 文档只记录事实和验证结果。
- 不出现“默认清缓存”“默认禁用浏览器缓存”“全并发 prerequisite imports”之类未批准策略。

---

## 验收标准

- `preview --runtime` server 入口使用 Express app 处理请求。
- File response 使用 Express `sendFile()`，不是 `readFile()` 后 `response.end()`。
- 文件请求返回 `Cache-Control: public, max-age=0`、`ETag`、`Last-Modified`。
- 带 `If-None-Match` 的相同文件请求返回 `304`。
- `/scripting/engine/bin/.cache/...` 路径返回 `200`，不被 Express dotfiles 默认策略拦截。
- `/settings.js` 等动态 body response 不新增 `ETag` / `Last-Modified`，带任意条件请求也不因为 Express freshness 变成 `304`。
- `/preview-error` 超过 `64 KiB` 仍返回 plain text `413`。
- `/__runtime-preview/health` JSON shape 不变。
- 现有 runtime preview launcher tests 通过。
- Browser smoke 通过，且 `consoleErrors`、`pageErrors`、`failedRequests`、`badResponses` 全空。
- feature-c 手动或诊断验证不出现新增同源 404/500。
- feature-c 选定的真实 `/scripting/x/.../chunks/*.js` URL 首次请求返回 `200` 且带 validator，第二次带 `If-None-Match` 请求返回 `304`。
- 默认不清理 programming cache。
- 不修改 script compile report-only 语义。
- 不修改 prerequisite scripts 顺序加载语义。

## 风险和防护

- Express 5 wildcard route 语法和 Express 4 不同：使用无 path 的 `app.use()`，避免 `*` / `/*` 语法差异。
- Express 默认 dotfiles 策略可能拒绝 `.cache` 路径：所有 `sendFile()` 统一传 `{ dotfiles: "allow" }`，并用 `/scripting/engine/bin/.cache/...` 测试覆盖。
- Express body parser 默认错误格式可能变成 HTML：自定义 error middleware 将 `entity.too.large` 转成 plain `413`。
- `res.sendFile()` 异步 callback 里可能出错：callback 必须 `next(error)`，不能吞错误。
- 不能为了让测试通过改变 resolver 规则；如果 file route `404`，先检查 fixture 是否真实存在，再分析 resolver，不扩大 library root。

## 自检

- 本计划有明确测试先行步骤。
- 本计划没有改变 runtime preview 核心业务分发。
- 本计划没有把开发机缓存污染变成默认策略。
- 本计划没有修改 script loading 顺序。
- 本计划的缓存有效性验收是二元的：同一 file URL 首次 `200` 且带 validator，二次 `If-None-Match` 返回 `304`。
