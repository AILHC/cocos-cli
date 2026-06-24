# SpriteFrame NODEJS 序列化运行时问题记录（2026-06-24）

## 背景

主测试项目使用 `buildConfig_web-mobile.json` 构建并通过 `cli run` 打开后，浏览器启动时报错：

```text
Cannot read properties of null (reading 'rect')
at SpriteFrame._deserialize(...)
```

source map 映射到 3.8.6 engine `cocos/2d/assets/sprite-frame.ts` 的 `_deserialize()`：

```ts
const data = serializeData as ISpriteFramesSerializeData;
const rect = data.rect;
```

因此直接原因不是 `rect` 字段缺失，而是传入的 `serializeData` 本身为 `null`。

## 根因

构建产物 `assets/main/import/02/02dc3cfb0.45d4b.json` 中，`cc.SpriteFrame` custom instance 被打包为：

```json
[[null],[2],0,[],[],[]]
```

对应 uuid 是 `b730527c-3233-41c2-aaf7-7cdab58f9749@f9941`，项目原始 `library/b7/...@f9941.json` 中 `rect`、`texture`、`vertices` 等数据完整。

单资源验证显示：

- `build-nodejs` runtime 为 `CC_EDITOR=false`、`CC_NODEJS=true`。
- 清理错误缓存后，`SpriteFrame` 实例直接调用 `instance._serialize(null)` 可以返回完整数据。
- 但在清理 `temp/builder/asset-db` 前，`buildAssetLibrary.getSerializedJSON()` 会优先读取旧 bad `release.json`，继续输出 `[null]`。

真正的 engine 漏项是 3.8.6 `cocos/2d/assets/sprite-frame.ts`：

```ts
import { EDITOR, TEST, BUILD } from 'internal:constants';

public _serialize (ctxForExporting: any): any {
    if (EDITOR || TEST) {
        // return SpriteFrame data
    }
    return null;
}
```

Cocos4 同文件已经把该分支扩展为 `EDITOR || TEST || NODEJS`，并导入 `NODEJS`。BUILD-ISSUE-021 当时已回迁 texture/image `_serialize()` 的 `NODEJS` 分支，但漏掉 `SpriteFrame`，导致 normal build 切到 `build-nodejs` 后，SpriteFrame 在重新序列化时会产生 `null`。

## 修改

Engine source：

- `D:\workspace\engines\cocos\3.8.6\cocos\2d\assets\sprite-frame.ts`
- 从 `internal:constants` 增加导入 `NODEJS`。
- `_serialize()` 条件从 `EDITOR || TEST` 改为 `EDITOR || TEST || NODEJS`。

CLI source 本轮未修改；CLI 与 engine 的对应关系是：

- CLI normal build 仍由 `Launcher.build()` 显式进入 `build-nodejs` runtime。
- 3.8.6 engine 必须补齐构建期会重新序列化的 asset class 的 `NODEJS` adapter 分支。

## 验证

已执行：

```text
rtk npm run compiler:engine
```

通过。

清理正确缓存路径：

```text
E:\own_space\engines\cocos-test-projects\temp\builder\asset-db
E:\own_space\engines\cocos-test-projects\temp\builder\assets-mtime.json
```

单资源验证：

- `buildAssetLibrary.getSerializedJSON("b730527c-3233-41c2-aaf7-7cdab58f9749@f9941", { debug: false })` 不再输出 `[null]`。
- 输出包含 `rect`、`offset`、`originalSize`、`vertices`、`_textureSource` dependency。

主测试项目构建：

```text
node .\dist\cli.js build --project E:\own_space\engines\cocos-test-projects --platform web-mobile --build-config E:\own_space\engines\cocos-test-projects\buildConfig_web-mobile.json --buildPath E:\own_space\engines\cocos-test-projects\temp\cli-build-smoke --outputName web-mobile-config-20260624-spriteframe-nodejs-3
```

通过，输出：

```text
Build completed successfully for web-mobile
project://temp/cli-build-smoke/web-mobile-config-20260624-spriteframe-nodejs-3
```

产物检查：

```text
rg "\[\[null\],\[[0-9]+\]" assets/main/import
```

结果：`NO_NULL_CUSTOM_INSTANCES`。

运行验证：

```text
node .\dist\cli.js run --platform web-mobile --dest E:\own_space\engines\cocos-test-projects\temp\cli-build-smoke\web-mobile-config-20260624-spriteframe-nodejs-3
```

URL：

```text
http://localhost:9527/build/web-mobile/web-mobile-config-20260624-spriteframe-nodejs-3/index.html
```

HTTP 200，run log 未再出现 `Cannot read properties of null (reading 'rect')` 或 `Browser ERROR`。

## 注意

旧失败构建会把 bad `SpriteFrame` compiled JSON 写入 `temp/builder/asset-db/**/release.json`。修复 engine 后如果不清理该缓存，构建可能继续复用旧 `[null]` 数据，导致误判 engine patch 未生效。
