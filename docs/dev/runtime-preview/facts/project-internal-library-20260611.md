# Project-level Internal Library 事实记录

记录时间：2026-06-11

## 记录边界

本文只记录 runtime preview 中 `internal` AssetDB library root 的事实、验证结果和最小决策边界。

本文不记录：

- `.anim.meta` importer parity 细节。该问题见 [source-meta-editor-baseline-20260611.md](source-meta-editor-baseline-20260611.md)。
- `.cconb` 二进制产物 byte-level parity。该问题仍是独立后续项。
- `engineRoot` production 解析和启动日志重复问题。该问题见 [../plans/engine-root-and-startup-log-fix-20260611.md](../plans/engine-root-and-startup-log-fix-20260611.md)。
- 正常 build output copy 规则或 pack/redirect URL 合约。

## 问题现象

测试项目：

```text
E:\own_space\engines\cocos-test-projects
```

当前 runtime preview scene：

```text
db://assets/cases/ui/06.scrollview/scroll-view-bounce-back.scene [cases]
```

浏览器错误集中在 internal UI texture 反序列化：

```text
TypeError: Cannot read properties of null (reading 'base')
at Texture2D._deserialize
```

关联 missing asset：

```text
afc47931-f066-46b0-90be-9fe61f213428@6c48a  default_scrollbar_vertical
ffb88a8f-af62-48f4-8f1d-3cb606443a43@6c48a  default_scrollbar_vertical_bg
b730527c-3233-41c2-aaf7-7cdab58f9749@6c48a  default_panel
```

## 原行为事实

修复前 `src/core/assets/asset-config.ts` 中 `internal` AssetDB 的配置为：

```ts
{
    name: 'internal',
    target: join(enginePath, 'editor/assets'),
    readonly: true,
    visible: true,
    library: join(enginePath, 'editor/library'),
}
```

`git blame` 显示该行为来自原 CLI 代码，不是本轮改动引入：

```text
dcb4626a [feat] update builder config (#66) 2025-10-10
```

修复前 runtime preview server 的 `internalLibraryRoot` 也会回落到：

```text
D:\workspace\engines\cocos\3.8.6\editor\library
```

因此 CLI import 与 runtime preview HTTP resolver 都可能消费 engine-level `editor/library`。

## Engine-level library 观察

在用户指定 engine root：

```text
D:\workspace\engines\cocos\3.8.6
```

对应 engine-level internal JSON 存在，但内容不完整：

```text
D:\workspace\engines\cocos\3.8.6\editor\library\af\afc47931-f066-46b0-90be-9fe61f213428@6c48a.json
```

其关键结构为：

```json
{
  "__type__": "cc.Texture2D",
  "content": null
}
```

这会导致 engine runtime 在 `Texture2D._deserialize()` 中读取 `content.base` 时抛错。

## Editor project-level library 观察

Editor 3.8.6 打开项目副本后，会在项目级 `library` 生成 internal metadata：

```text
<editor-project>\library\.internal-data.json
```

同一批 internal Texture2D 的 project-level JSON 包含完整 `content.base`：

```json
{
  "__type__": "cc.Texture2D",
  "content": {
    "base": "2,2,2,2,0,0",
    "mipmaps": [
      "<uuid>"
    ]
  }
}
```

结论：对同一 engine / 同一项目，Editor preview 需要的有效 internal library 是项目级 `library` 产物，不是 engine-level `editor/library` 中的 `content:null` 文件。

## CLI project-level library 验证

将 CLI `internal` AssetDB 的 `library` 改为项目级：

```ts
library: join(this._assetConfig.root, 'library')
```

后，CLI import 可以生成：

```text
E:\own_space\engines\cocos-test-projects\library\.internal-data.json
```

并生成完整 internal Texture2D JSON。例如：

```text
E:\own_space\engines\cocos-test-projects\library\af\afc47931-f066-46b0-90be-9fe61f213428@6c48a.json
```

HTTP 验证结果：

```text
/assets/internal/import/af/afc47931-f066-46b0-90be-9fe61f213428@6c48a.json status=200 hasContent=true hasBase=true base=2,2,2,2,0,0
/assets/internal/import/ff/ffb88a8f-af62-48f4-8f1d-3cb606443a43@6c48a.json status=200 hasContent=true hasBase=true base=2,2,2,2,0,0
/assets/internal/import/b7/b730527c-3233-41c2-aaf7-7cdab58f9749@6c48a.json status=200 hasContent=true hasBase=true base=2,2,2,2,0,0
```

## Preview server 第二处配置点

只修改 AssetDB import 还不够。runtime preview server 的 `RuntimePreviewContext.internalLibraryRoot` 也必须指向项目级 `library`，否则 HTTP resolver 仍可能从 engine-level `editor/library` 返回 `content:null` 文件。

本次验证中，重启 preview 后启动日志为：

```text
[runtime-preview] internalLibraryRoot=E:\own_space\engines\cocos-test-projects\library
```

该日志是判断 server 当前使用项目级 internal library 的直接证据。

## Engine source `.meta` 污染根因

旧 internal DB 配置同时带来另一个副作用：CLI 启动 runtime preview 时会把 engine editor assets 当作 internal AssetDB source 扫描和导入。

修复前 internal DB 的关键配置为：

```ts
{
    name: 'internal',
    target: join(enginePath, 'editor/assets'),
    readonly: true,
    library: join(enginePath, 'editor/library'),
}
```

根因链路：

1. `target=enginePath/editor/assets` 使 CLI AssetDB 直接扫描 engine source assets。
2. `@cocos/asset-db` 在启动或 dirty import 时会执行 importer，并在 import 后调用 `asset.save()` 写回 source `.meta`。
3. `readonly: true` 只限制 asset operation 层的移动、删除、导入等用户操作，不阻止 AssetDB 启动 import 写 source `.meta`。
4. image / sprite-frame importer 的默认 `SpriteFrameBaseAssetUserData` 中 `borderTop`、`borderBottom`、`borderLeft`、`borderRight` 都是 `0`。
5. 当 internal image 被 dirty import 且旧 subMeta userData 没有完整保留时，engine editor asset 的九宫格信息会被默认值覆盖，例如 `default_ui/default_btn_normal.png.meta` 的四个 `border*` 从 `12` 变为 `0`。

该问题的本质不是“不允许写 `.meta`”，而是 CLI 对 engine internal assets 的 source `.meta` 写回规则不应偏离 Editor 对同一 engine / 同一项目的生成规则；旧配置还把写回目标放在 engine source 目录，放大了污染范围。

2026-06-11 已做复现验证：

- 先还原 `D:\workspace\engines\cocos\3.8.6\editor\assets\default_ui`。
- `default_btn_normal.png.meta` 的 `borderTop`、`borderBottom`、`borderLeft`、`borderRight` 回到 `12`。
- 使用当前 CLI 重新启动 `preview --runtime` 到 `preview:ready`。
- 启动日志显示 `internalLibraryRoot=E:\own_space\engines\cocos-test-projects\library`。
- 再次检查 `editor/assets/default_ui`，没有新的 git diff；`default_btn_normal.png.meta` 的四个 `border*` 仍为 `12`。
- 项目级 generated library 中 `20835ba4-6145-4fbc-a58a-051ce700aa3e@f9941.json` 的 `capInsets` 为 `[12, 12, 12, 12]`。

结论：旧污染来自 engine-level internal DB import 写回；切到项目级 internal library 后，reset 再启动当前 preview 没有复现 `default_ui` 九宫格丢失。

## 缓存干扰事实

在 server 已经返回完整 JSON 后，浏览器普通 reload 仍可能复用同 origin 下旧的 `content:null` JSON，继续出现旧的 `Texture2D._deserialize` 错误。

同一页面执行 `Ctrl+Shift+R` 强制刷新后，当前 scene 的 fresh `warn/error` 日志为 `0`，画面正常。

该事实的用途：

- 验证修复时不能只看普通 reload 后的旧 console log。
- 如果 HTTP 直连已经返回 `content.base`，但浏览器普通 reload 仍报旧错，应先排除 browser cache。
- 不能把 cache 现象反向解释为 server 仍在使用 engine-level `editor/library`。

## 当前最小决策

针对 3.8.6，当前最小策略是：

1. `internal` AssetDB import 写入项目级 `library`。
2. runtime preview `internalLibraryRoot` 优先使用项目级 `library`。
3. 仅当项目级 `library` 不存在时，保留 engine-level `editor/library` fallback。

不进入的范围：

- 不引入 importer version 配置表。
- 不修改其他 resource importer。
- 不把 `assets/`、`settings/`、`profiles/` 的测试项目配置检查扩大为 gate。
- 不在 server 中递归扫描 `library` 或建立全量 URL/file index。

## 回归验证项

代码级验证：

```text
npm run build
npm test -- src/core/assets/test/config-sync.test.ts --runInBand
```

runtime preview 验证：

```text
preview --runtime 启动日志包含 internalLibraryRoot=<project>/library
三个 internal Texture2D HTTP 响应包含 content.base
当前 scroll-view-bounce-back.scene 强刷后不再出现 Texture2D._deserialize content.base 错误
```
