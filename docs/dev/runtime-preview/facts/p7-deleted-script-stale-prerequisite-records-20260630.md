# P7 删除脚本后 prerequisite records 残留事实

日期：2026-06-30

关联问题：`RP-ISSUE-034`

## 用户反馈

P7 项目路径：

`D:\ps_copy\p7\trunk\GameClient\Client-fight-roguelike-migration`

用户从 `dev` 合并内容到功能分支后，运行中的 runtime preview 报错。用户怀疑可能与“去掉编译 `target=editor`”有关，要求查看日志并分析。

## 运行现场

本轮观察到的 preview 进程：

```text
PID: 54944
Command:
"C:\nvm4w\nodejs\node.exe" E:\own_space\engines\cocos-cli\dist\cli.js preview --runtime --project D:\ps_copy\p7\trunk\GameClient\Client-fight-roguelike-migration --host 127.0.0.1 --port 9527 --watch-assets --refresh-on-reload
```

进程仍监听：

```text
127.0.0.1:9527 LISTEN pid=54944
```

因此本轮不是 HTTP server 退出或端口未监听。

主要日志：

```text
D:\ps_copy\p7\trunk\GameClient\Client-fight-roguelike-migration\temp\logs\cocos-20260630085734.log
D:\ps_copy\p7\trunk\GameClient\Client-fight-roguelike-migration\temp\preview-logs\runtime-preview-20260630-165759.log
```

## 启动阶段事实

`runtime-preview-20260630-165759.log` 显示启动时 editor 和 preview target 都被编译：

```text
asset-db:script-sync:collect:done durationMs=522 count=3051
asset-db:script-compile:start count=3051
pack-target:build:start target=editor
pack-target:build:done target=editor durationMs=19389
pack-target:build:start target=preview
pack-target:build:done target=preview durationMs=23181
asset-db:script-compile:done durationMs=42647 count=3051
programming:prerequisite-scope required=3032 mapped=3032 missing=0
preview:ready durationMs=190231
```

结论：本轮证据不支持“`target=editor` 没有编译导致问题”。`target=editor` 与 `target=preview` 均存在，且启动阶段都成功过。

## 第一处缺失脚本

后续失败首先集中在：

```text
assets/scripts/fight_roguelike/ecs/story_mainline_ahead_mist_wall_controller.ts
```

典型错误：

```text
pack-target:build:failed target=editor file=cce:/internal/x/prerequisite-imports message=(i18n needed)resolve_error_module_not_found: {"specifier":"file:///D:/ps_copy/p7/trunk/GameClient/Client-fight-roguelike-migration/assets/scripts/fight_roguelike/ecs/story_mainline_ahead_mist_wall_controller.ts","parentURL":"cce:/internal/x/prerequisite-imports"}
pack-target:build:failed target=preview file=cce:/internal/x/prerequisite-imports message=(i18n needed)resolve_error_module_not_found: {"specifier":"file:///D:/ps_copy/p7/trunk/GameClient/Client-fight-roguelike-migration/assets/scripts/fight_roguelike/ecs/story_mainline_ahead_mist_wall_controller.ts","parentURL":"cce:/internal/x/prerequisite-imports"}
```

工作区检查：

```text
assets\scripts\fight_roguelike\ecs\story_mainline_ahead_mist_wall_controller.ts      不存在
assets\scripts\fight_roguelike\ecs\story_mainline_ahead_mist_wall_controller.ts.meta 不存在
git ls-files -- <file> / <file.meta>                                                     无输出
```

历史上该文件存在过：

```text
e3b8bfee test: migrate p6 unit test environment --- feat: migrate fly label batch renderer --- ...
b647fff6 baseline: import p7 sandbox client
```

残留记录：

```text
library\.cli-assets-info.json:
  "scripts\\fight_roguelike\\ecs\\story_mainline_ahead_mist_wall_controller.ts"
  uuid: "d47061ba-9231-4f58-a3e9-6b321a5f2b9b"

library\.cli-assets-data.json:
  "d47061ba-9231-4f58-a3e9-6b321a5f2b9b": {
    "url": "db://assets/scripts/fight_roguelike/ecs/story_mainline_ahead_mist_wall_controller.ts"
  }

temp\cli\programming\packer-driver\targets\editor\import-map.json:
  file:///D:/.../story_mainline_ahead_mist_wall_controller.ts

temp\cli\programming\packer-driver\targets\preview\import-map.json:
  file:///D:/.../story_mainline_ahead_mist_wall_controller.ts

temp\cli\programming\packer-driver\targets\editor\main-record.json:
  多处引用该 file URL 和相对 import

temp\cli\programming\packer-driver\targets\preview\main-record.json:
  多处引用该 file URL 和相对 import
```

## 第二处缺失脚本

主日志后续显示第一处脚本最终触发 destroy / asset-delete 后，错误推进到：

```text
assets/scripts/uimodule_p6/uiunion/uiunion_config.ts
```

典型错误：

```text
QuickPack(editor) instantiate:error ... resolve_error_module_not_found:
{"specifier":"file:///D:/ps_copy/p7/trunk/GameClient/Client-fight-roguelike-migration/assets/scripts/uimodule_p6/uiunion/uiunion_config.ts","parentURL":"cce:/internal/x/prerequisite-imports"}
```

工作区检查：

```text
assets\scripts\uimodule_p6\uiunion\uiunion_config.ts      不存在
assets\scripts\uimodule_p6\uiunion\uiunion_config.ts.meta 不存在
git ls-files -- <file> / <file.meta>                         无输出
```

历史上该文件存在过：

```text
4fe340ea test: migrate p6 unit test environment --- feat: migrate fly label batch renderer --- ...
b647fff6 baseline: import p7 sandbox client
```

残留记录：

```text
library\.cli-assets-info.json:
  "scripts\\uimodule_p6\\uiunion\\uiunion_config.ts"

library\.cli-assets-data.json:
  "url": "db://assets/scripts/uimodule_p6/uiunion/uiunion_config.ts"

temp\cli\programming\packer-driver\targets\editor\import-map.json:
  file:///D:/.../uiunion_config.ts

temp\cli\programming\packer-driver\targets\preview\import-map.json:
  file:///D:/.../uiunion_config.ts
```

## 时间线观察

主日志中存在大量 `asset-delete` / `asset-add` / `asset-change`，符合 merge 后资源批量变更的现场。

关键片段：

```text
[18:05:54.585] INFO  asset-change db://assets/scripts/fight_roguelike/drop_batch/ExpDropBatchMgr.ts
[18:05:55.651] DEBUG Destroy: D:\ps_copy\p7\trunk\GameClient\Client-fight-roguelike-migration\assets\scripts\fight_roguelike\ecs\story_mainline_ahead_mist_wall_controller.ts
[18:06:32.625] ERROR QuickPack(editor) instantiate:error ... uiunion_config.ts
[18:06:33.270] INFO  asset-change db://assets/scripts/fight_roguelike/ecs
[18:07:16.635] INFO  asset-delete db://assets/scripts/fight_roguelike/ecs/story_mainline_ahead_mist_wall_controller.ts
```

说明：

- `story_mainline_ahead_mist_wall_controller.ts` 的 delete / destroy 最终发生，但显著晚于第一次 prerequisite failure。
- 清掉第一个 stale script 后，QuickPack 又遇到下一个 stale deleted script。
- preview 进程不是立即失败退出，而是在 stale prerequisite 和 delayed delete/destroy 之间反复推进。

`runtime-preview` 日志还显示 dirty targets 继续累积：

```text
runtime-asset-watch events count=1 dirtyTargets=11 sample=...
...
runtime-asset-watch events count=1 dirtyTargets=23 sample=...
```

## 源码事实

`src/runtime-preview/watch/runtime-asset-change-watcher.ts`：

- watcher 在 `subscribe()` 成功后调用 startup baseline diff。
- baseline diff 会把启动前后 source delete 记录为 `eventType: 'delete'` dirty target。
- 因此“watcher 在 `settingsProvider.getPreviewSettings()` 后才启动”不必然等于启动窗口变更丢失，前提是 baseline snapshot 覆盖到了对应文件。

`src/runtime-preview/watch/runtime-asset-dirty-store.ts`：

- dirtyStore 会保存 target 和 eventTypes。
- source delete 会进入 `entries[].eventTypes`。

`src/runtime-preview/refresh/runtime-refresh-coordinator.ts`：

- dirty refresh 对 missing delete 有 settle 逻辑：

```ts
function shouldSettleMissingDirtyTarget(
    entries: RuntimeRefreshDirtyEntry[] | undefined,
    target: string,
    errorMessage: string,
): boolean {
    if (!isMissingDirtyTargetError(errorMessage)) {
        return false;
    }

    const eventTypes = entries?.find((entry) => entry.target === target)?.eventTypes ?? [];
    return eventTypes.includes('delete') || (eventTypes.includes('create') && eventTypes.includes('delete'));
}
```

- 只有存在 successfulTargets 时才会执行 `runPostRefreshWork()`，也就是 `waitForIdle()`、`verifyProgrammingOutput()`、`invalidateSettings()` 和 `clearImportReplacement()`。
- 如果 delete target 因 missing 被 settle，且本轮没有 successful target，当前 coordinator 不会主动等待 scripting idle 或验证 programming output。

`src/core/assets/manager/operation.ts`：

- `assetOperation.refreshAsset(target)` 最终调用 `@cocos/asset-db.refresh(refreshTarget)`。
- 返回 `undefined` 时抛出 `can not find asset ...`。

`src/core/assets/manager/asset.ts`：

- AssetDB 触发 `asset-delete` 时会调用 `assetHandlerManager.destroyAsset(asset)`。

`src/core/assets/asset-handler/assets/javascript.ts`：

- script destroy 会执行：

```ts
scripting.dispatchAssetChange({
    type: AssetActionEnum.delete,
    uuid: asset.uuid,
    filePath: asset.source,
    importer: asset.meta.importer,
    userData: asset.meta.userData,
});
await scripting.compileScripts();
```

因此 deleted script 能否从 QuickPack records 中清掉，依赖 AssetDB 产生 `asset-delete` 并进入 `JavascriptHandler.destroy()`。

## 当前判断

当前直接故障不是 `target=editor` 被去掉，而是已删除脚本仍留在 AssetDB sidecar 和 QuickPack prerequisite records 中。

更具体地说：

1. dev merge 删除了一批历史脚本。
2. 运行中的 preview 的 dirty refresh / AssetDB delete / scripting delete compile 链路没有一次性 purge 这些脚本。
3. QuickPack prerequisite build 继续按 stale records 引用已删除脚本。
4. 每遇到一个 stale script，editor 和 preview target 都会各失败一轮。
5. 部分 delete/destroy 最终会发生，但发生得晚，而且会继续暴露下一个 stale deleted script。

待验证假设：

- 对纯 delete dirty target，`refreshAsset(deletedFile)` 返回 missing 后被 settle，但没有补充刷新父目录，导致 AssetDB 未及时发出对应 `asset-delete`。
- delete-only settle 后若没有 successful target，coordinator 不执行 post-refresh work，不能及时等待后续 script delete compile 或发现 programming output 仍不可用。
- 批量删除脚本时，当前 per-file refresh / build 串行路径会把每个 stale prerequisite 都放大成几十秒失败，形成“preview 卡住”的体感。

## 非结论

- 不能把本轮归因于浏览器 cache。错误发生在 QuickPack build 阶段，不只是 browser load 阶段。
- 不能把本轮归因于 server 未监听。进程仍监听 `127.0.0.1:9527`。
- 不能把本轮归因于 `target=editor` 未编译。日志显示 editor 和 preview target 都在编译并失败。
- 不能通过随意硬超时解决。问题是 stale records 清理链路和批量删除策略，不是单纯等待时长不足。
