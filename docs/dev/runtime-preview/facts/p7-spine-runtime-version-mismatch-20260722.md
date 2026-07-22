# P7 Runtime Preview Spine 版本错配事实

## 问题

2026-07-22，真实项目 `D:\ps_copy\p7\trunk\GameClient\feature-2` 使用 `preview --runtime` 进入自动战斗测试后，战车 Tank 和主角单位的 Spine 无法渲染。浏览器报告项目 Skeleton `3.8.99` 与 runtime `4.2` 不匹配。

本问题登记为 `RP-ISSUE-037`。

## 项目与引擎事实

- 项目类型：issue 指定真实业务项目。
- 项目配置：`settings/v2/packages/engine.json` 的 `globalConfigKey` 为 `migrationsConfig`，对应 `includeModules` 包含 `spine-3.8`；`spine._option` 同样为 `spine-3.8`，`spine-4.2._value` 为 `false`。
- engine root：`D:\workspace\engines\cocos\3.8.6`，当前 tag 为 `v3.8.6_ys`。
- 当前错误 cache：`D:\workspace\engines\cocos\3.8.6\bin\.cache\dev-cli\web`。

## 可重复证据

项目自动战斗入口由项目 `tests` 下的 battle runtime 脚本驱动：

```powershell
npm --prefix tests run runtime:tank-rogue -- --mode interactive --preview-url http://127.0.0.1:9528/
```

运行中的浏览器日志包含：

```text
[Spine] Skeleton version 3.8.99 does not match runtime version 4.2
```

请求落到 Spine 4.2 external：

```text
/scripting/engine/bin/.cache/dev-cli/web/external/external%253Aemscripten/spine/4.2/spine.wasm.js.js
```

生成的 `web/import-map.json` 明确包含：

```text
q-bundled:///fs/cocos/spine/lib/spine-version.js
  -> q-bundled:///fs/cocos/spine/lib/spine-version-4.2.js
q-bundled:///fs/cocos/spine/lib/spine-instantiate.js
  -> q-bundled:///fs/cocos/spine/lib/spine-instantiate-4.2.js
```

该 import map 与 cache `VERSION` 的最后写入时间均为 `2026-07-22 15:20:39`。

## 根因

`packages/engine-compiler/src/core/compiler.ts` 曾先移除所有 Spine feature，再同时加入 `spine-3.8` 和 `spine-4.2`。两者分别令 ccbuild 的 `SPINE_3_8`、`SPINE_4_2` build-time constant 成立。

engine `cc.config.json` 对 `cocos/spine/lib/spine-version.ts` 和 `spine-instantiate.ts` 依次定义 3.8、4.2 override。两个条件同时成立时，后面的 4.2 映射覆盖 3.8 映射。项目配置虽然正确，但项目模块接口和 `_CC_SPINE_VERSION` 都发生在 engine import map 生成之后，无法改变静态映射；browser `game-boot.js` 甚至在读取项目模块前已经执行 `System.import('cc')`。

双版本 feature 逻辑由 CLI 提交 `3795b11f3` 于 2026-07-07 引入。该提交没有同步提升 engine compiler cache version，因此旧的 3.8 cache 可以暂时掩盖问题；cache 重建后问题才暴露。当前 engine source 中不存在注释所依赖的 `spine-version-dynamic.ts` 或 `spine-instantiate-dynamic.ts`。

## 第一阶段处理

当前阶段先恢复可用性：

1. dev-cli preview engine 只启用 `spine-3.8`。
2. engine compiler cache version 从 `3` 提升到 `4`，使错误 cache 在下一次合法重编译时失效。
3. 删除无效的 `_CC_SPINE_VERSION` late-binding 逻辑。
4. 不在运行中的 preview 进程下清理或覆盖 engine cache；真实项目重启和 cache 重编译必须先取得用户确认。

第一阶段只恢复 Spine 3.8 项目，不代表 Spine 4.2 runtime preview 已支持。

2026-07-22 已完成候选实现和以下验证：

```powershell
npx jest packages/engine-compiler/src/core/preview-engine-policy.test.ts --runInBand
npm run compile
npx tsc -p packages/engine-compiler/tsconfig.json --pretty false
```

- Jest 单元测试：`2/2` 通过。
- 根仓库 `npm run compile`：通过，已更新 `dist` 和 static web 生成物。
- `packages/engine-compiler` 独立 TypeScript 构建：通过，workspace `dist/core/compiler.js` 已使用单一 Spine 3.8 policy 和 cache version `4`。
- 测试未设置 `COCOS_CLI_TEST_*` 环境变量。
- 当前 `9528` preview PID `38160` 未停止，root HTTP 仍返回 `200`；本轮没有清理或重建它正在使用的 engine cache。

## Editor `dev` 对照

`D:\workspace\engines\cocos\3.8.6\bin\.cache\dev\.incremental.json` 是当前 Editor dev engine 的直接产物事实：

- cache 根目录只有 `editor`、`preview` 两个 target，没有按 Spine 版本拆分的 variant。
- `editor` target 的 `includeIndex.features` 共 53 项，其中 Spine 只有 `spine-3.8`，没有 `spine-4.2`。
- `dev/editor/import-map.json` 和 `dev/preview/import-map.json` 都把 `spine-version.js`、`spine-instantiate.js` 映射到 3.8 实现。
- import map 同时列出 3.8、4.2 external URL，只表示这些 external 被产物图记录或复制；实际 Spine 入口仍由上述 3.8 module override 决定。

因此当前 CLI 修复应直接对齐 Editor `dev`：完整 dev engine 仍可包含其它通用 feature，但互斥的 Spine feature 只选择 `spine-3.8`。本 issue 不引入 compilation profile、Spine variant 或两份 engine 编译产物。

如果未来有明确需求让 runtime preview 支持 Spine 4.2，或出现另一个必须在 preview 中切换的多版本模块，应先取得 Editor 对应行为和真实项目需求，再单独设计；不能从本次 3.8 回归推导出通用 variant 架构。

## 验收边界

- Jest 单元测试：证明 preview feature policy 只保留 Spine 3.8，并且 cache policy version 已提升；不能证明真实 browser 渲染。
- TypeScript / CLI build 已通过：证明源码和 `dist` 可构建；不能证明 P7 自动战斗场景已恢复。
- 最终验收：必须在用户确认可停止当前 preview 后，使用新 `dist/cli.js` 合法重建 engine cache，重新启动 `feature-2` runtime preview，并运行上述自动战斗测试；Tank、主角 Spine 可见，且无 Spine version mismatch、page error、同源失败请求或 `console.error`，才能把 issue 标为 `fixed`。
