# Runtime Preview 核心流程设计

记录时间：2026-06-10
编码修复：2026-06-12

本文定义 production `preview --runtime` 核心预览流程的目标、边界、route 规则、script loading、ready 语义、测试策略和 strict acceptance。本文不处理 `assets/**/*.meta` 默认写入副作用；该问题记录在 [issues.md](../issues.md) 的 `RP-ISSUE-008`。

## 目标

让真实 production preview entry 跑通：

```bat
node E:\own_space\engines\cocos-cli\dist\cli.js preview --runtime --project D:\ps_copy\p6\trunk\Project\GameClient\feature-c --host 127.0.0.1 --port 19530
```

浏览器打开：

```text
http://127.0.0.1:19530/?scene=4c721bfe-0b6e-46c2-97f0-644adfdcba31
```

必须完成：

1. server 启动并输出 `server:listening`。
2. CLI 默认 preview settings warm-up 完成并输出 `preview:ready`。
3. browser production root page 启动 preview-app。
4. current Cocos preview bootstrap 按现有 import-map / loader 流程加载脚本；本轮不新增 scene script dependency preloading。
5. scene 加载完成并执行 `runSceneImmediate()`。
6. 页面设置 `window.__RUNTIME_PREVIEW_READY`。
7. ready 后稳定观察窗口内没有同源资源请求失败、page error、unhandled rejection 或 `console.error`。

## 非目标

- 本轮不处理 `assets/**/*.meta` 是否被 AssetDB / importer 改写。
- 本轮不修改 `preview-app` 的 `assets/general/import`、`assets/general/native` bootstrap 行为。
- 本轮不通过硬编码 feature-c UUID、scene UUID 或具体报错 URL 修复问题。
- 本轮不做启动时递归扫描 `library`、`temp`、`assets` 或 generated output。
- 本轮不把旧 editor preview server 的 route 实现复制为当前权威逻辑。
- 本轮不把测试环境污染、旧路径、旧 `engineRoot`、旧 `projectRoot` 或旧 resolver record 残留变成 production 默认策略。

## 已确认事实

### preview-app general base 是源码事实

当前 preview-app 在浏览器启动时设置：

```ts
option.overrideSettings.assets.importBase = 'assets/general/import';
option.overrideSettings.assets.nativeBase = 'assets/general/native';
```

备份 preview-app source 中也存在同样逻辑。因此本轮必须按该行为设计 server route。不能删除这段，也不能改为直接使用 `settings.assets.importBase/nativeBase`。

### URL namespace 不等于 library 物理目录

[../facts/architecture.md](../facts/architecture.md) 已记录：当前 CLI project library root 是 `<project>/library/cli`，资源文件是 uuid/hash bucket layout。engine runtime 生成的 `/assets/<namespace>/(import|native)/<tail>` 中，`<namespace>` 是 HTTP URL namespace / bundle config 语义，不是 `library/cli` 下的目录。

因此本设计只把 `<tail>` 作为 library 相对路径。`import` / `native` 是 engine 已生成的 HTTP route segment，不是 physical directory，也不参与拼接 disk path。

```text
/assets/general/import/20/<uuid>@<version>.json
=> resolve(context.projectLibraryRoot, '20/<uuid>@<version>.json')
```

禁止映射为：

```text
resolve(context.projectLibraryRoot, 'general/import/20/<uuid>@<version>.json')
resolve(context.projectLibraryRoot, 'product/import/20/<uuid>@<version>.json')
resolve(context.projectLibraryRoot, 'resources/import/20/<uuid>@<version>.json')
```

### resolver 不拥有 project library 默认路径规则

`LibraryRequestResolver` 只处理已经传入 `RuntimePreviewContext` 的 roots。它不能自行追加或猜测：

```text
<projectRoot>/library/cli
<projectRoot>/library
```

如果 production 需要使用 `D:\ps_copy\p6\trunk\Project\GameClient\feature-c\library\cli`，启动链路必须在创建 `RuntimePreviewContext` 前解析好，并作为 `context.projectLibraryRoot` 传入。

extension library 同理。启动链路必须根据 AssetDB mount 解析出 extension output root，并显式传入 context，例如：

```ts
extensionLibraryRoots: Array<{ name: string; root: string }>
```

`LibraryRequestResolver` 不能自行拼接 `<projectRoot>/library/cli-extensions/<name>`。

### ready 必须拆分

| 名称 | 触发位置 | 证明内容 | 不证明 |
| --- | --- | --- | --- |
| `server:listening` | HTTP server listen 成功 | socket 已监听 | settings、AssetDB、script、scene 可用 |
| `preview:ready` | CLI 默认 settings warm-up 完成 | 默认 preview settings 已生成，engine / AssetDB / builder 主链路已跑通 | 浏览器 scene 已加载 |
| `browser scene ready` | preview-app 设置 `window.__RUNTIME_PREVIEW_READY` | scene load callback 已执行，`runSceneImmediate()` 已回调 | ready 后不会再出现异步 runtime error |

稳定观察窗口从 `browser scene ready` 后开始计时。

### 编译错误不等于启动失败

`asset-db:script-compile:error` 在 runtime preview startup 中是 report-only。Launcher 可以继续进入 `preview:ready`，但 strict acceptance 仍必须由 browser evidence 判定。

CommonJS bare specifier resolver 失败由 packer-driver / QuickPack fallback 处理。runtime preview 不维护 package allow-list，不提供 `--script-stub`。

### 缓存策略默认对齐 CLI

runtime preview 默认遵循 CLI / PackerDriver / QuickPack 原有缓存与失效策略。开发机缓存污染、路径迁移、旧 `engineRoot`、旧 `projectRoot` 或旧 resolver record 残留只能通过显式参数或人工诊断处理，不能反向改变 production 默认策略。

## Route 设计

### import/native library file route

#### 输入

```text
/assets/<namespace>/import/<tail>
/assets/<namespace>/native/<tail>
```

`<namespace>` 是 engine URL namespace。`<tail>` 是 engine 已生成的 library 相对路径。

#### 二元判断规则

1. URL path 必须匹配 `/assets/<namespace>/(import|native)/<tail>`。
2. `<tail>` 允许为空；空 tail 只是一个请求事实，resolver 应按统一路径安全规则处理，而不是在设计层预先拒绝。
3. resolver 只在 `context.projectLibraryRoot`、`context.extensionLibraryRoots[]`、`context.internalLibraryRoot` 中查找。
4. 命中真实文件则返回 file response。
5. 未命中真实文件则返回 404，并记录 diagnostic。

#### 禁止行为

- 禁止根据 URL namespace 推导物理目录。
- 禁止在 resolver 内部扫描外部固定 root 列表。
- 禁止启动时递归索引整个 `library` 或 `temp`。
- 禁止用硬编码 bundle name、UUID、scene UUID 或报错 URL 补洞。
- 禁止把不存在的资源伪造为空文件或成功响应。

### 非 general bundle route

对 `product`、`resources`、`internal`、extension bundle 等非 `general` namespace，处理规则和 `general` 相同：namespace 不参与 disk path 拼接，resolver 只消费 engine 已经生成的 `<tail>` 和 context 显式传入的 roots。

如果某个 bundle 的资源实际位于 extension library，则必须通过 `extensionLibraryRoots[]` 提供 root；如果某个 internal 资源实际位于项目级 `library`，则必须通过 `internalLibraryRoot` 指向项目级 `library`。

## Script loading

runtime preview 不按 scene 计算脚本依赖，也不主动枚举加载所有 scope chunks。

preview-app 在 `cc.game.init()` 后只导入 Cocos packer-driver 生成的：

```text
cce:/internal/x/prerequisite-imports
```

该模块由 Cocos programming output / import-map / loader 负责展开。runtime preview 只负责提供 import-map、SystemJS、macro、chunks、project scripts、`script2library` 等 HTTP route。

如果 generated prerequisite module 自身无法导入，说明 programming / import-map route 链路断裂，应 fail-fast。单个脚本内部的 platform-only dependency 恢复由 packer-driver / QuickPack resolver 层处理，runtime preview 不维护业务 package allow-list。

## Browser ready 语义

`window.__RUNTIME_PREVIEW_READY` 必须由 preview-app 在 scene load callback 和 `runSceneImmediate()` 后设置。ready payload 至少应包含：

```ts
{
  scene: string;
  elapsedMs: number;
}
```

strict acceptance 不能只等待 DOM load、`server:listening` 或 `preview:ready`。这些信号都早于 scene runtime ready。

## 测试策略

### 1. Resolver contract

覆盖：

- namespace 不参与 disk path。
- resolver 只使用 context roots。
- project library、extension library、internal library 的明确 root。
- missing file 返回 404。
- 空 tail 走统一路径安全和文件命中规则。

### 2. Existing runtime-preview suite

继续覆盖：

- `/settings.js` 来自 `PreviewSettingsProvider`。
- `/scripting/*` route 服务真实 programming output。
- `/assets/*/(import|native)/*` route 服务真实 library output。
- `/preview-error` 记录 browser error。
- `/__runtime-preview/health` 输出当前 roots 和 server 状态。
- Express file response 的 `ETag` / `Last-Modified` / conditional `304`。

### 3. feature-c exact scene E2E

验收 URL：

```text
http://127.0.0.1:19530/?scene=4c721bfe-0b6e-46c2-97f0-644adfdcba31
```

必须监听：

- `pageerror`
- `unhandledrejection`
- `console.error`
- same-origin failed request
- same-origin HTTP >= 400 response
- `/preview-error` 回传

ready 后继续观察稳定窗口。稳定窗口内任一 strict field 非空都判失败。

## 验收标准

### 必须通过

- `preview --runtime` 使用 production entry 启动。
- stdout 输出 `server:listening`、`preview:preparing`、`preview:ready`。
- `engineRoot` 来自项目配置或 CLI 初始化链路；测试环境只允许显式 test env override。
- 浏览器设置 `window.__RUNTIME_PREVIEW_READY`。
- strict evidence 中：
  - `readyTimedOut=false`
  - `pageErrors=0`
  - `unhandledRejections=0`
  - same-origin `failedRequests=0`
  - same-origin `badResponses=0`
  - `console.error=0`

### 可以暂不阻断，但必须记录

- `asset-db:script-compile:error`：report-only，不阻塞 `preview:ready`，但必须输出日志并进入 evidence。
- 浏览器脚本加载性能：当前只记录，不做并发化修改。
- `assets/**/*.meta` 默认改写：独立专项，不纳入本 strict gate。
- `.cconb` 二进制与 Editor 不完全一致：独立后续观察。

### 必须判失败

- 浏览器没有到达 `window.__RUNTIME_PREVIEW_READY`。
- ready 后出现 page error、unhandled rejection、同源 failed request、同源 bad response 或 `console.error`。
- route 通过硬编码 UUID、scene、bundle name 或报错 URL 才能成功。
- resolver 未使用 context root，而是自行扫描或推导外部路径。
- production 默认清理 programming cache。

## 当前结论

截至 2026-06-12：

- `feature-c` 核心流程 strict acceptance 已通过，记录见 [../issues.md](../issues.md) 的 `RP-ISSUE-001`。
- `engineRoot` 解析、启动日志重复、默认清理 programming cache、script compile report-only、internal library root、Express file validator 已分别收口到对应 issue。
- runtime preview 仍不能声明全量完成。未闭环项包括：source `.meta` 默认改写、编译性能指标、extension runtime trigger、pack / redirect / remote route trigger、小项目真实 CLI child process 集成验收。

新增或更新相关问题时，先写入 [../issues.md](../issues.md)，再补 facts / plans / acceptance。
