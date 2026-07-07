# P7 `watch-assets` 短路径导致 `.meta` uuid 被改写事实记录

记录时间：2026-07-07

## 背景

真实项目：

```text
D:\ps_copy\p7\trunk\GameClient\Client-fight-roguelike-migration
```

用户反馈：

- `cli preview runtime` 启动后，大量资源变更时包含 `.meta` 变更。
- 运行中的 preview 进程不应修改既有 `.meta` uuid，但现场出现大量 `.meta` uuid 被改写。
- 本轮要求只分析日志和源码调用链，不停止、不重启、不操作正在打开的 preview 进程。

## 现场证据

最新 runtime preview log：

```text
D:\ps_copy\p7\trunk\GameClient\Client-fight-roguelike-migration\temp\preview-logs\runtime-preview-20260706-164405.log
```

启动摘要：

```text
projectRoot=D:\ps_copy\p7\trunk\GameClient\Client-fight-roguelike-migration
engineRoot=D:\workspace\engines\cocos\3.8.6
engineRootSource=creator-profile
server:listening http://127.0.0.1:9527
asset-db:done durationMs=101262
runtime-asset-watch startup-baseline dirtyTargets=0 ignoredMetaOnly=0 skippedSymlinks=0
runtime-asset-watch start assetsRoot=D:\ps_copy\p7\trunk\GameClient\Client-fight-roguelike-migration\assets
preview:ready durationMs=133729
```

当前项目 git working tree 中 tracked `.meta` 修改数量：

```powershell
git -C D:\ps_copy\p7\trunk\GameClient\Client-fight-roguelike-migration diff --name-only -- "*.meta" | Measure-Object
```

结果：`10504` 个 `.meta` 文件处于 diff 中。

抽样 diff 显示仅 uuid 被替换：

```diff
diff --git a/assets/resources/cfg.meta b/assets/resources/cfg.meta
--- a/assets/resources/cfg.meta
+++ b/assets/resources/cfg.meta
@@
-  "uuid": "74b46a3e-fed6-4bfe-833f-1f7f3eb7c778",
+  "uuid": "e828029e-758d-4216-bbb9-cdf5f81e6c97",
```

```diff
diff --git a/assets/resources/cfg/activity/accum_recharge_act.json.meta b/assets/resources/cfg/activity/accum_recharge_act.json.meta
--- a/assets/resources/cfg/activity/accum_recharge_act.json.meta
+++ b/assets/resources/cfg/activity/accum_recharge_act.json.meta
@@
-  "uuid": "ac53ad01-29fd-4961-9a22-7d21c87096a7",
+  "uuid": "fb5f9651-2bcd-4ace-9350-726ffcb74d67",
```

runtime preview log 中出现 Windows 8.3 short path 形式的 dirty target：

```text
runtime-asset-watch events count=1 dirtyTargets=1 sample=db://assets/RESOUR~1/cfg/tank_game/tank_game_weapon.json
runtime-asset-watch events count=34 dirtyTargets=34 sample=db://assets/RESOUR~1/cfg/attr/attribute_define.json,...
runtime-asset-watch events count=163 dirtyTargets=164 sample=db://assets/product/ui_p7/font/JYFZMSDF.fnt,db://assets/RESOUR~1,db://assets/RESOUR~1/cfg,...
...
runtime-asset-watch events count=87 dirtyTargets=13715 sample=db://assets/product/ui_p7/font/JYFZMSDF.fnt,db://assets/RESOUR~1,db://assets/RESOUR~1/cfg,...
```

关键事实：项目真实目录是 `assets/resources/...`，但 watcher/dirty-set 中出现了 `assets/RESOUR~1/...`。这不是普通大小写差异，而是 Windows 8.3 short name alias。

## 源码调用链

### 1. watcher 把文件事件写入 dirty store

`src/runtime-preview/watch/runtime-asset-change-watcher.ts`

- `createRuntimeAssetChangeWatcher()` 通过 `@parcel/watcher.subscribe()` 监听 `<project>/assets`。
- callback 中对每个事件调用 `dirtyStore.recordFileEvent(event)`。
- 当前记录日志只输出 dirty target sample，不记录原始 OS event path，因此现场只能从 target 反推出 short path 已进入归一化结果。

### 2. `.meta` 事件被映射回源资源 target

`src/runtime-preview/watch/runtime-asset-dirty-store.ts`

```typescript
function sourcePathForAssetEvent(path: string): string {
    return path.endsWith('.meta') ? path.slice(0, -'.meta'.length) : path;
}
```

```typescript
const normalizeTarget = (filePath: string): string | null => {
    const sourcePath = resolve(sourcePathForAssetEvent(filePath));
    ...
    const relativeAssetPath = toDbPath(relative(assetsRoot, sourcePath));
    return relativeAssetPath ? `db://assets/${relativeAssetPath}` : 'db://assets';
};
```

当前问题点：

- `.meta` event 不会被忽略，而是去掉 `.meta` 后当作源资源变更。
- `resolve()` / `relative()` 只做字符串和绝对路径处理，不会把 `RESOUR~1` 还原为 `resources`。
- 因此 `D:\...\assets\RESOUR~1\cfg.meta` 会进入 `db://assets/RESOUR~1/cfg`。

### 3. dirty-set refresh 把 short-path target 交给 AssetDB

`src/runtime-preview/refresh/runtime-refresh-coordinator.ts`

- `refreshDirtySet()` drain dirty targets。
- `optimizeDirtyBatchTargets()` 只按 target 字符串做父子关系优化，不处理 filesystem alias。
- 每个 target 进入 `refreshDirtyTarget(target)`。

`src/runtime-preview/server/runtime-preview-server.ts`

```typescript
refreshTarget: options.refreshTarget ?? (async (target) => {
    const { assetOperation } = await import('../../core/assets/manager/operation');
    return assetOperation.refreshAsset(target);
}),
```

`src/core/assets/manager/operation.ts`

```typescript
async refreshAsset(pathOrUrlOrUUID: string): Promise<number> {
    return await assetDBManager.addTask(this._refreshAsset.bind(this), [pathOrUrlOrUUID]);
}

private async _refreshAsset(pathOrUrlOrUUID: string, autoRefreshDir = true): Promise<number> {
    const refreshTarget = this._pathToDbUrlIfInsideAssetDB(pathOrUrlOrUUID);
    const refreshDir = this._dirnameForRefresh(refreshTarget);
    const result = await refresh(refreshTarget);
    ...
    await assetDBManager.addTask(assetDBManager.autoRefreshAssetLazy.bind(assetDBManager), [refreshDir]);
}
```

### 4. `@cocos/asset-db` 用字符串 path 判断 asset identity

`packages/asset-db/libs/asset-db.js`

`AssetDB.refresh()` 会把 refresh target 转为扫描路径，并用 `path2asset` / `uuid2asset` 维护 identity。`path2asset` 的 key 是路径字符串。

启动时 AssetDB 已有长路径 asset：

```text
D:\...\assets\resources\cfg
```

运行期 dirty refresh 进入 short path：

```text
D:\...\assets\RESOUR~1\cfg
```

这两个路径指向同一个 filesystem object，但字符串不同。AssetDB 当前没有 canonical realpath 去重，因此会把 short path 当作另一个新 asset。

### 5. uuid 冲突保护误判并写回 `.meta`

`@cocos/asset-db` 的 `_checkAssetsStatSync()` 中，新 asset 读取 `.meta` 后会检查同 uuid 是否已存在：

```javascript
const i = new asset_1.Asset(e, a.json, this);
const s = getAsset(a.json.uuid);
if (s) {
    this._replaceUUID(i, s);
    await i.save();
}
```

`_replaceUUID()` 行为：

```javascript
_replaceUUID(t, e) {
    if (e !== t) {
        if (t.source === e.source) return void console.trace(...);
        const s = node_uuid_1.v4();
        ...
        t.meta.uuid = s;
    }
}
```

因为 `t.source` 是 short path，`e.source` 是 long path，字符串不相等，`t.source === e.source` 的保护没有生效。于是 AssetDB 认为这是“两个不同 asset 共用一个 uuid”，生成新 uuid，并通过 `await i.save()` 写回同一个 `.meta` 文件。

## 根因结论

根因不是 `.meta` uuid 缺失、uuid 格式非法，也不是 importer 正常迁移。

根因是：

```text
Windows 8.3 short path alias 进入 runtime preview watch dirty-set，
CLI 未在 watcher / dirty-store / refresh 边界 canonicalize 路径，
导致 AssetDB 把同一真实文件的 long path 和 short path 当作两个 asset，
触发 uuid 冲突保护 `_replaceUUID()`，
最终把新的 uuid 写回 source `.meta`。
```

`.meta` 大量变更会放大问题，因为 dirty store 当前把 `.meta` event 映射成源资源 refresh；大量 `.meta` event 通过 short path 进入 dirty-set 后，会批量触发同类误判。

## 2026-07-07 补充：watcher 为什么会出现 short path

本问题不能只依赖 P7 现场判断。Windows / NTFS 本身允许同一个目录或文件同时具有 long name 和 8.3 short name。只要卷启用了 8.3 name 生成，目录如 `resources` 可同时被 `RESOUR~1` 访问。

P7 现场用 `cmd /c dir /x` 只读确认：

```text
2026/06/30  17:54    <DIR>          RESOUR~1     resources
2026/06/25  12:02               296 RESOUR~1.MET resources.meta
```

同时发现一个重要副产物：

```text
?? assets/RESOUR~1.meta
```

该文件内容是 directory importer `.meta`：

```json
{
  "ver": "1.2.0",
  "importer": "directory",
  "imported": true,
  "uuid": "9fcb7ac3-31c5-4537-b99f-b1704beecbb5",
  "files": [],
  "subMetas": {},
  "userData": {}
}
```

这说明 short path 一旦进入 AssetDB refresh，AssetDB 可能把 `assets\RESOUR~1` 当成独立目录 asset 并创建字面文件 `assets\RESOUR~1.meta`，之后该副产物又会继续参与 watcher / AssetDB 链路，形成放大效应。

`@parcel/watcher@2.5.6` 的 Windows backend 使用 `ReadDirectoryChangesW`。源码 `node_modules/@parcel/watcher/src/windows/WindowsBackend.cc` 中，事件路径直接由 watch root 和 `FILE_NOTIFY_INFORMATION.FileName` 拼接：

```cpp
std::string path = mWatcher->mDir + "\\" + utf16ToUtf8(info->FileName, info->FileNameLength / sizeof(WCHAR));
```

当前 backend 没有在事件出口调用 `GetLongPathNameW`、`GetFinalPathNameByHandleW`、`realpath` 或等价 canonicalization。因此如果 Windows 通知层给出 `RESOUR~1\probe.txt`，JS callback 就会收到 `RESOUR~1\probe.txt`。这不是 Cocos 语义层的路径，而是 OS 事件路径字符串。

## 2026-07-07 补充：脱离 P7 的最小复现

为了证明问题不依赖 P7 项目内容，已在 D 盘临时目录构造最小复现：

```powershell
$root = 'D:\tmp\codex-short-path-watch-root'
Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path (Join-Path $root 'resources') | Out-Null
cmd /c dir /x "D:\tmp\codex-short-path-watch-root"
```

`dir /x` 输出确认：

```text
<DIR>          RESOUR~1     resources
```

随后使用 `@parcel/watcher` Windows backend 监听 root，并通过 short path 写入文件：

```javascript
const watcher = require('@parcel/watcher');
const fs = require('fs');
const path = require('path');

(async () => {
  const root = 'D:/tmp/codex-short-path-watch-root';
  const shortDir = path.join(root, 'RESOUR~1');
  const events = [];
  const sub = await watcher.subscribe(root, (err, evs) => {
    if (err) throw err;
    events.push(...evs);
  }, { backend: 'windows' });
  await new Promise((resolve) => setTimeout(resolve, 200));
  fs.writeFileSync(path.join(shortDir, 'probe.txt'), '1');
  await new Promise((resolve) => setTimeout(resolve, 1000));
  await sub.unsubscribe();
  console.log(JSON.stringify(events, null, 2));
})();
```

实际输出：

```json
[
  {
    "path": "D:\\tmp\\codex-short-path-watch-root\\RESOUR~1\\probe.txt",
    "type": "create"
  },
  {
    "path": "D:\\tmp\\codex-short-path-watch-root\\RESOUR~1\\probe.txt",
    "type": "update"
  }
]
```

该复现证明：

1. Windows 8.3 short path 可以稳定进入 `@parcel/watcher` callback。
2. 触发不依赖 P7，不依赖 Cocos AssetDB，也不依赖 runtime preview。
3. P7 只是具备同类 filesystem 条件的大型真实项目；真实根因是 runtime preview 将 watcher path 字符串直接当作 asset identity，缺少 canonical identity 边界。

当前仍不能仅凭现有日志断言“第一批 P7 short path 是哪个外部工具触发的”。但修复不应依赖找到该外部工具，因为 OS / watcher 层允许 short path 作为合法事件路径；CLI 必须把它归一到稳定 asset identity 后再进入 AssetDB。

## 修复方向分析

### 必须修复的主边界：dirty target canonicalization

应在 runtime preview 自己的文件事件入口修复，而不是修改 `@cocos/asset-db` 默认策略作为第一步。

理由：

- `runtime preview --watch-assets` 是 short path 进入系统的当前入口。
- `@parcel/watcher` / Windows 可能返回 short path，CLI 不能把 OS alias 直接传播为 `db://assets/...`。
- `@cocos/asset-db` 使用字符串 path 作为 identity 是既有包行为；贸然改它影响面大，可能改变 normal build / Editor parity。

候选实现：

1. 在 `runtime-asset-dirty-store.ts` 的 `normalizeTarget()` 中，把 event path 和 `assetsRoot` 都 canonicalize 后再求 relative。
2. Windows 下优先使用 `fs.realpathSync.native()` 或等价 async `realpath`。
3. 对 deleted event 或文件不存在场景，不能简单依赖 `realpath(filePath)`，需要从存在的最近父目录 realpath + 剩余 segment 组合。
4. canonicalize 后必须再次校验仍在 canonical `assetsRoot` 内，避免 alias / junction / symlink 把路径绕到项目外。
5. 输出 target 统一使用 canonical relative path，因此 `RESOUR~1` 必须变为 `resources`。

性能约束：

- 不能对每个事件做全树扫描。
- canonicalization 只应作用于 watcher event path 和 refresh target path 这类边界输入。
- 对同一目录的 canonical result 应做进程内小缓存，避免大量同目录文件变更时重复 realpath。
- deleted / missing path 只向上查找最近存在父目录，不枚举子树。
- flush 或 refresh 完成后可以清理本轮缓存，避免长期缓存路径迁移。

### 必须补充的保护：refresh target canonicalization

dirty store 修复只能覆盖 watcher event。还需要在 runtime refresh 输入边界做防御：

- `normalizeRefreshTarget(projectRoot, target)` 处理 absolute path 时应 canonicalize。
- 对 `db://assets/RESOUR~1/...` 这类已经是 db URL 的 target，不能直接通过字符串接受；可在 runtime preview dirty-set 入口避免产生，也可在 refresh 前对 db URL 反解到 assetsRoot 下 canonicalize 后再重建 db URL。
- 明确禁止或修正 Windows 8.3 short segment 进入 `assetOperation.refreshAsset()`。

### `.meta` event 策略需要收紧，但不能作为唯一修复

只忽略 `.meta` event 可以减少触发概率，但不是完整修复：

- 资源文件本身也可能通过 short path 进入 watcher。
- 删除 / rename / 大批量外部工具写入仍可能产生 alias path。
- `.meta` 变更本身对 AssetDB 可能是有意义的，比如 importer/userData/uuid 外部编辑后需要 refresh。

更稳妥策略：

- meta-only event 仍可映射回源资源，但必须先 canonicalize。
- 对“同一 target 已成功刷新后追加出现的 meta-only follow-up”继续沿用当前 `optimizeDirtyBatchTargets()` 的去重思路。
- 如果需要进一步防止 uuid 写回，可以对 meta-only batch 增加只读检查或延迟合并，但这属于第二层优化，不是根因修复。

### AssetDB 层防线：可作为二期修复

可以考虑在 CLI adapter 层或 AssetDB fork 包中加保护，但必须谨慎：

- `_replaceUUID()` 在 `t.source` 和 `e.source` 字符串不等时改 uuid，是 AssetDB 的冲突修复机制。
- 对 Windows alias，应在调用 `_replaceUUID()` 前比较 canonical realpath；若 canonical 相同，则不应改 uuid。
- 但这会改 `@cocos/asset-db` 包行为，影响范围包括 build、import、delete、move、Editor parity 相关测试。

因此建议优先加 runtime preview 边界修复和回归测试；AssetDB 层作为 defense-in-depth 单独评估。

## 回归测试建议

### 单元测试

新增或扩展：

- `runtime-asset-dirty-store.test.ts`
  - 输入 `assets\RESOUR~1\cfg\foo.json.meta`，期望输出 `db://assets/resources/cfg/foo.json`。
  - 输入 short path asset file，期望输出 long relative db URL。
  - 输入 deleted file：文件不存在但父目录存在时，仍能 canonicalize parent 并保留 leaf。
  - 输入 canonical 后跑出 `assetsRoot` 的路径，期望忽略。

- `runtime-refresh-coordinator.test.ts` 或 server route 层测试
  - dirty-set 中不允许 short segment 传播到 `refreshTarget` mock。
  - db URL target 若包含 short alias，按设计 either reject 或 normalize。

### 最小集成测试

在 Windows fixture 中创建可复现 short alias 的目录。若 CI 无法稳定生成 8.3 short name，可通过注入 `subscribe` mock 直接传入 short-path event，同时在临时目录建立真实 `resources` 目录，测试 `fs.realpath` canonicalization。

### 真实项目验收

P7 真实项目验收前必须先保护现有 working tree：

1. 记录并清理或备份当前 `.meta` diff，不能把已有污染当成修复前后对比。
2. 使用已构建 `dist/cli.js`，清理无关 `COCOS_CLI_TEST_*` env。
3. 启动：

```powershell
node E:\own_space\engines\cocos-cli\dist\cli.js preview --runtime `
  --project D:\ps_copy\p7\trunk\GameClient\Client-fight-roguelike-migration `
  --host 127.0.0.1 --port <port> --watch-assets --refresh-on-reload
```

4. 触发同类大量资源 / `.meta` 变更。
5. 检查：
   - runtime preview log 不再出现 `db://assets/RESOUR~1`。
   - `git diff -- "*.meta"` 没有新增 uuid-only rewrite。
   - dirty refresh 能完成或明确失败，不能静默 fallback root 大刷。

## 当前边界

- 本轮未停止或操作正在打开的 preview 进程。
- 当前只登记根因和修复方向，尚未修改 production code。
- 现场已有 `10504` 个 `.meta` diff，后续验证必须先建立干净 baseline，否则不能判断修复是否生效。
