# 3.8.6 Engine NODEJS editor-path-replace 设计

## 背景

`BUILD-ISSUE-021` 的当前复现事实是：CLI normal build 使用 `D:\workspace\engines\cocos\3.8.6` 初始化 engine 后，自动图集阶段在加载 sprite frame 时进入 3.8.6 engine 的 `editor-path-replace.ts`。该文件只根据 `EDITOR` / `PREVIEW` 注册 import payload 扩展名替换逻辑；在 `EDITOR` 分支中直接调用全局 `Editor.Message.request('asset-db', 'query-asset-info', uuid)`。

当前 CLI build runtime 的 engine 模块由 `packages/engine-compiler` 以 `platform: 'NODEJS'`、`mode: 'EDITOR'` 编译，同时 `packages/cc-module/src/preload.ts` 又设置 `globalThis.CC_EDITOR = true`。因此 CLI 处于 `NODEJS + EDITOR` 语义叠加状态。3.8.6 的 `editor-path-replace.ts` 没有 `NODEJS` fallback，最终在 CLI build 作用域中访问不存在的全局 `Editor`，产生 `ReferenceError: Editor is not defined`，并导致自动图集 sprite frame 加载失败。

## 目标

让 CLI normal build 在 3.8.6 engine 下的自动图集扩展名替换路径不依赖完整 Editor runtime，并优先使用 CLI 已启动的 `AssetDB` 查询 import payload 扩展。

本设计至少覆盖：

- `web-mobile` normal build 自动图集路径。
- `wechatgame` normal build 自动图集路径。
- 当前 `NODEJS + EDITOR` CLI runtime 初始化策略。

## 非目标

- 不改变 CLI 当前 `CC_EDITOR=true` 初始化策略。
- 不为 CLI 安装完整 `Editor` 全局对象。
- 不实现通用 `Editor.Message` facade。
- 不修改 texture packer 算法。
- 不在 `editor-path-replace.ts` 处理本地 filesystem 读取 query/hash 的问题。
- 不处理 `BUILD-ISSUE-022` 的 texture compression tool resolver。

## 方案

修改 `D:\workspace\engines\cocos\3.8.6\cocos\asset\asset-manager\editor-path-replace.ts`，在原有 Editor / Preview 扩展名替换逻辑中补充最小 `NODEJS` 分支。

具体规则：

1. 从 `internal:constants` 增加导入 `NODEJS`。
2. 入口条件从 `(EDITOR || PREVIEW) && !TEST` 扩展为 `(EDITOR || PREVIEW || NODEJS) && !TEST`。
3. 在 `queryExtension(uuid)` 内优先判断 `NODEJS`。只要 `NODEJS` 为真，就不再回退到 `EDITOR` 分支。
4. `NODEJS` 分支内部检查 `globalThis.AssetDB?.queryAsset`，并通过 `globalThis.AssetDB.queryAsset(uuid)?.meta.files` 查询当前 asset 的 library payload 文件列表。
5. 当 `meta.files` 严格等于单文件 `[ ".cconb" ]` 时返回 `.cconb`。
6. 当 `meta.files` 严格等于单文件历史 `[ ".bin" ]` 时返回 `.cconb`，保持 CCON payload 加载语义。
7. 其他 `meta.files` 形态返回空字符串，除非后续有新的 engine 或 Editor 事实证明需要扩展。
8. 当 `NODEJS` 分支无法查询到有效 `meta.files` 时返回空字符串，让后续加载链路暴露真实失败。
9. Editor 分支保留原 `Editor.Message.request('asset-db', 'query-asset-info', uuid)` 行为。
10. Preview / Native preview 分支保留原 `/query-extname/<uuid>` 行为。

`NODEJS` 分支必须位于 `EDITOR` 分支之前。当前 CLI 同时满足 `NODEJS` 和 `EDITOR`，如果继续优先判断 `EDITOR`，新增分支不会生效。`NODEJS` 分支不能写成 `NODEJS && AssetDB` 才进入，否则 `AssetDB` 缺失时会落回 `EDITOR` 并再次访问 `Editor.Message`。

## 数据流

自动图集阶段的数据流如下：

1. `BundleManager.packImage()` 收集参与构建的 `.pac` 和 sprite frame。
2. `PacInfo.initSpriteFrames()` 调用 `assetManager.loadAny(spriteFrameUuid, ...)`。
3. engine asset manager pipeline 进入 `editor-path-replace.ts` 注册的 `replaceExtension`。
4. `replaceExtension` 调用 `queryExtension(uuid)`。
5. 在 CLI build runtime 中，`NODEJS` 分支通过全局 `AssetDB.queryAsset(uuid)` 读取 asset `meta.files`。
6. 如果 asset import payload 为 CCON，`queryExtension()` 返回 `.cconb`，将默认 `.json` URL 替换成 `.cconb`。
7. `assetManager.loadAny()` 继续读取正确的 import payload，sprite frame 可进入 texture packer。

## 错误处理

- `AssetDB` 不存在或没有 `queryAsset`：在 `NODEJS` 分支输出一次明确 warning / diagnostic，返回空字符串，不伪造成功，也不回退到 `Editor.Message`。
- `queryAsset(uuid)` 返回空：返回空字符串。
- `meta.files` 不存在或不是数组：返回空字符串。
- 查询过程抛错：沿用现有 `queryExtension()` 的 catch 行为，记录错误、缓存空字符串并继续。

该策略保持当前 engine 的容错模型：扩展名替换失败不会直接 hard fail build，但会让后续 asset load 暴露具体错误。

## 影响面

预期影响面只限于 3.8.6 engine 的 asset manager 扩展名替换逻辑。

不应改变：

- `NODEJS=false` 的 Creator Editor runtime 行为，仍走 `Editor.Message.request('asset-db', 'query-asset-info', uuid)`。
- Browser preview / native preview 通过 `/query-extname/<uuid>` 查询扩展名的行为。
- CLI builder 的 `CC_EDITOR=true` 初始化策略。
- CLI project extension hook 的 `Editor` facade 行为。

会有意改变：

- `NODEJS=true + EDITOR=true` 且无 `AssetDB.queryAsset` 的 runtime 不再回退到 `Editor.Message`，而是 warning 后返回空字符串。当前目标 runtime 是 CLI / dev-cli build；不能未经验证假设 Creator Editor 本体也以 `NODEJS=true` 编译并执行该模块。

需要注意：如果后续日志仍出现带 `?_t=` 的本地文件 `ENOENT`，应在 node adapter filesystem path 读取层继续定位，不能继续扩大 `editor-path-replace.ts` 的职责。

## 验证

实现后验证顺序：

1. 重新编译 CLI 和 engine dev-cli 产物，确保 `editor-path-replace.ts` 修改进入 `bin\.cache\dev-cli\editor`。
2. 复跑 clean `web-mobile` 自动图集构建。
3. 复跑 clean `wechatgame` 自动图集构建。
4. 检查 CLI 构建日志中 `ReferenceError: Editor is not defined` 计数为 0。
5. 检查 `sprite frame can't be load` 不再由 `Editor is not defined` 引发。
6. 复跑 `vitests/suites/build/wechatgame-editor-baseline-parity.test.ts`。
7. 如果仍存在新的 asset load 失败，根据新错误栈登记或更新问题，不把本次修复扩展为通用 filesystem 或 texture compression 修复。

可使用的最小自动化验证命令：

```powershell
rtk npm --prefix "E:\own_space\engines\cocos-cli\vitests" test -- suites/build/wechatgame-editor-baseline-parity.test.ts
```
