# 项目 build extension hook Editor parity 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 验证 Cocos Editor 平台打包源码、现有 CLI hook 机制和 `feature-c/extensions/build-ex` 的真实耦合后，设计并实现项目内 build extension hook 支持，使 CLI 构建行为尽量对齐 Editor。

**Architecture:** 先做只读事实采集，优先使用已解包的 Editor 3.8.6 `app.asar` 目录确认平台扩展实现位置、`wechatgame` 打包逻辑来源、CLI 当前 hook 注册模型，以及 `build-ex` 实际依赖的 Editor API 和项目资源。实现阶段只接入 Editor 已支持的 extension builder 语义，不把 `build-ex` 的业务逻辑硬编码进 CLI；无法对齐的能力先拆成明确边界或移出测试 fixture。

**Tech Stack:** Node.js, TypeScript, Cocos Creator 3.8.6 Editor asar, Cocos CLI builder, Cocos extension `contributions.builder`, PowerShell, Vitest/Jest, in-app Browser。

---

## 文档归属

- Build 专题入口：`docs/dev/build/README.md`
- 既有 build hook 事实记录：`docs/dev/build-extension-hooks-20260612.md`
- Build 问题台账：`docs/dev/build/issues.md`
- Builder 稳定模块文档：`docs/dev/modules/builder.md`
- 本计划：`docs/superpowers/plans/2026-06-15-build-extension-hook-editor-parity.md`

## 执行边界

- 本计划先等待确认；确认前只记录计划，不执行解包、构建或代码修改。
- 文档使用中文；代码标识符、路径、命令、专业术语保留英文。
- 不能假设 CLI hook 与 Editor extension hook 完全一致，必须以源码和可重复验证结果为准。
- 不把 `feature-c` 的业务 build 逻辑硬编码到 CLI；CLI 只实现通用 extension builder 接入机制。
- 若 `build-ex` 依赖的 Editor API 在 CLI 中没有等价能力，必须明确列出替代方案或裁剪方案，不能静默 mock。
- 允许使用 `cce` / Electron debug 方式做运行时行为观测，例如确认 extension loader 是否加载 `contributions.builder`、模块路径、exports 形态、hook 调用顺序、调用栈和传参结构。
- 不使用破解、绕过保护、注入脚本导出内存代码、dump 闭源模块源码或反混淆闭源 Editor 实现作为实施依据。允许使用公开源码、官方文档、已安装文件的 manifest / 路径 / 配置元数据，以及不导出源码的运行时行为观测来建立事实。
- `wechatgame` / `web-mobile` / 其它平台的 baseline 必须由 Editor 构建产物和 CLI 构建产物对比得出。
- 每个实现阶段完成后单独提交；提交信息说明本阶段意图。

## 已确认事实

- 当前 CLI 已有 normal build 入口，并且 build 流程会执行平台 plugin hook。
- 当前 CLI 的 `PluginManager` 只扫描 CLI 内置 `src/core/builder/platforms` 和 CLI workspace 下的 `packages/platforms`。
- 当前 CLI 尚未发现扫描 `<projectRoot>/extensions/*` 的 builder hook 注册逻辑。
- 当前 CLI 已有项目 extension AssetDB mount 扫描逻辑，但该逻辑只处理 `contributions["asset-db"].mount`。
- Editor extension `build-ex` 的声明形式是 `package.json` 中 `contributions.builder: "./dist/builder.js"`，不同于 CLI platform package 的 `contributes.builder`。
- `feature-c/extensions/build-ex` 的 hook 依赖 `Editor.Project.path`、`Editor.Message.request/send('asset-db', ...)`、项目特定路径、平台输出目录写入、manifest / cfg / bundle 开关调整等能力。
- `D:\cocos_editors\Creator\Creator\3.8.6\resources\app.asar.unpacked\modules\platform-extensions\extensions` 存在，且包含 `wechatgame`、`taobao-mini-game`、`oppo-mini-game`、`vivo-mini-game`、`huawei-quick-game`、`native` 等目录。
- 上述 unpacked 路径下的 `wechatgame` 当前只看到 `static/cocos/plugin.json` 和 `static/cocos/signature.json`，没有看到完整 builder/config/hooks 源码。
- 已存在解包目录：`E:\own_space\engines\cocos-cli\.codex-tmp\creator-386-app-asar-extract`。
- 解包目录下 `modules/platform-extensions` 同时包含 `platforms/` 和 `extensions/`。
- 解包目录中 `wechatgame` 位于 `modules/platform-extensions/extensions/wechatgame`，不在 `modules/platform-extensions/platforms/wechatgame`。
- 解包目录中的 `modules/platform-extensions/extensions/wechatgame/package.json` 声明 `contributions.builder: "./dist/build.js"`，`main: "./dist/main.js"`，`version: "1.0.4"`。
- 解包目录中的 `modules/platform-extensions/extensions/wechatgame/dist` 实际可见文件包括 `build.ccc`、`hooks.ccc`、`main.ccc`、`share.ccc`、`separate-engine.ccc`、`view.ccc` 和 migrations；直接读取 `.ccc` 内容不是可读 JavaScript，需要确认 Editor `.ccc` 加载或映射机制。
- 已检查官方 GitHub：`cocos/cocos-creator-extensions` 当前 main 分支只检索到 `localization-editor`、`shader-graph` 等 extension 的 builder/hooks 源码，没有 `wechatgame`；`cocos/cocos-engine` 当前 main 分支有 `platforms/minigame/platforms/wechat/wrapper/*` 和 `templates/wechatgame/*`，但没有发现 `modules/platform-extensions/extensions/wechatgame` 的 Editor platform extension builder/hooks 源码。

## 待确认关键问题

- Editor 3.8.6 的 `wechatgame` 平台打包实现是否在 `resources/app.asar` 内，还是由其它 module/package 提供。
- Editor 3.8.6 的 `.ccc` 文件如何映射到 `package.json` 中声明的 `.js` 入口，例如 `./dist/build.js` 与实际 `dist/build.ccc` 的关系。
- 是否存在其它官方公开仓库或 tag / branch 包含 `modules/platform-extensions/extensions/wechatgame` 源码；当前已检查的 `cocos/cocos-creator-extensions` 和 `cocos/cocos-engine` main 分支未命中。
- 是否可以通过 `cce` / Electron debug 只观测 `.ccc` 模块加载行为和 hook exports，不导出模块源码。
- Editor 的 extension builder 加载顺序、配置合并、hook 调用签名、错误传播是否与当前 CLI 平台 plugin hook 一致。
- `build-ex` 哪些逻辑是 hook 机制验证所必需，哪些只是 `feature-c` 业务发布逻辑，应在迁移到主测试项目时删除。
- 主测试项目中是否需要保留 `build-ex` 的平台输出改写，例如 `game.js` 注入、`index.html` 注入、remote version 文件生成。
- `wechatgame` baseline 是否要求 CLI 已具备平台打包支持，还是本阶段只验证 extension hook 生命周期。

## 文件职责图

- Read: `E:\own_space\engines\cocos-cli\.codex-tmp\creator-386-app-asar-extract`
  - 优先使用已解包的 Editor `app.asar` 内容验证平台扩展实现位置。
- Read fallback: `D:\cocos_editors\Creator\Creator\3.8.6\resources\app.asar`
  - 只有已解包目录缺失或不完整时，才重新读取 packed `app.asar`。
- Read: `D:\cocos_editors\Creator\Creator\3.8.6\resources\app.asar.unpacked\modules\platform-extensions\extensions`
  - 对照 unpacked 平台静态资源，确认哪些资源来自 unpacked。
- Read: `D:\ps_copy\p6\trunk\Project\GameClient\feature-c\extensions\build-ex`
  - 分析 `build-ex` package、builder、hooks、asset handlers、依赖和项目耦合。
- Read/Modify after approval: `src/core/builder/plugin-manager.ts`
  - 如确认实现，增加项目 extension builder 扫描与注册入口。
- Read/Modify after approval: `src/core/builder/build-task.ts`
  - 如确认实现，核对 hook 调用顺序、调用签名和错误传播是否需要补齐。
- Read/Modify after approval: `src/core/assets/extension-mounts.ts` 或相邻模块
  - 如确认实现，抽出项目 extension package discovery，避免 AssetDB mount 和 builder hook 各自重复扫描。
- Test after approval: `tests/commands/*` 或 `src/core/builder/test/*`
  - 覆盖 extension builder config normalize、hook 注册、hook 执行顺序和错误传播。
- Fixture after approval: `E:\own_space\engines\cocos-test-projects\extensions\build-ex`
  - 放置从 `feature-c` 裁剪后的主测试项目 build extension。
- Baseline after approval: `E:\own_space\engines\cocos-test-projects\build\*`
  - 保存或对比 Editor / CLI 构建输出，不把构建产物提交进 CLI 仓库。

## Task 1: 验证 Editor 平台打包源码位置

- [ ] **Step 1: 检查官方 GitHub 是否公开相关源码**

Run:

```powershell
rtk pwsh -NoLogo -NoProfile -Command '$dst=".codex-tmp\github-cocos-creator-extensions"; if (!(Test-Path -LiteralPath $dst)) { git clone --depth 1 --filter=blob:none https://github.com/cocos/cocos-creator-extensions.git $dst | Out-Host }; git -C $dst ls-files | rg "wechat|platform|builder|hooks|build\."'
rtk pwsh -NoLogo -NoProfile -Command '$dst=".codex-tmp\github-cocos-engine-tree"; if (!(Test-Path -LiteralPath $dst)) { git clone --depth 1 --filter=blob:none --no-checkout https://github.com/cocos/cocos-engine.git $dst | Out-Host }; git -C $dst ls-tree -r --name-only HEAD | rg "platform-extensions|wechatgame|wechat-game|wechat|builder|hooks"'
```

Expected:

- `cocos/cocos-creator-extensions` 若仍只命中 `localization-editor`、`shader-graph` 等源码，则记录为“未公开 `wechatgame` platform extension 源码”。
- `cocos/cocos-engine` 若只命中 `platforms/minigame/platforms/wechat/wrapper/*` 和 `templates/wechatgame/*`，则记录为“engine repo 提供 runtime wrapper/template，不提供 Editor builder/hooks 源码”。
- 如果后续发现其它官方仓库或 tag，需要先补充来源和 license，再决定是否可作为实现依据。

- [ ] **Step 2: 只读检查已解包 `app.asar` 目录**

Run:

```powershell
rtk pwsh -NoLogo -NoProfile -Command '$p="E:\own_space\engines\cocos-cli\.codex-tmp\creator-386-app-asar-extract\modules\platform-extensions"; [Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Test-Path -LiteralPath $p; Get-ChildItem -LiteralPath $p -Directory | Select-Object -ExpandProperty Name; Write-Output "EXTENSIONS"; Get-ChildItem -LiteralPath (Join-Path $p "extensions") -Directory | Select-Object -ExpandProperty Name'
```

Expected:

- `Test-Path` 返回 `True`。
- 能列出 `platforms` 和 `extensions`。
- `extensions` 中包含 `wechatgame`。

- [ ] **Step 3: 检查解包目录中的 `wechatgame` 文件**

Run:

```powershell
rtk pwsh -NoLogo -NoProfile -Command '$p="E:\own_space\engines\cocos-cli\.codex-tmp\creator-386-app-asar-extract\modules\platform-extensions\extensions\wechatgame"; Get-Content -LiteralPath (Join-Path $p "package.json") -Raw; rg --files $p | rg "dist\\(build|hooks|main|share|separate-engine|view)\\.ccc|package\\.json|@types|static"'
```

Expected:

- `package.json` 声明 `contributions.builder: "./dist/build.js"`。
- 文件列表中存在 `dist/build.ccc` 和 `dist/hooks.ccc`。
- 记录 `.js` 声明入口与 `.ccc` 实际文件之间的差异。

- [ ] **Step 4: 只读检查 `app.asar.unpacked` 平台目录**

Run:

```powershell
rtk pwsh -NoLogo -NoProfile -Command '$p="D:\cocos_editors\Creator\Creator\3.8.6\resources\app.asar.unpacked\modules\platform-extensions\extensions"; [Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Get-ChildItem -LiteralPath $p -Directory | Select-Object -ExpandProperty Name; Get-ChildItem -LiteralPath (Join-Path $p "wechatgame") -Recurse -File | ForEach-Object { $_.FullName.Substring($p.Length + 1) }'
```

Expected:

- 能列出 `wechatgame` 等平台目录。
- 如果 `wechatgame` unpacked 目录仍只有 `static/cocos/plugin.json` 和 `static/cocos/signature.json`，记录为“unpacked 只有运行时静态资源，不含完整打包逻辑”。

- [ ] **Step 5: 必要时检查 `resources/app.asar` 是否存在**

Run:

```powershell
rtk pwsh -NoLogo -NoProfile -Command '$asar="D:\cocos_editors\Creator\Creator\3.8.6\resources\app.asar"; Test-Path -LiteralPath $asar; Get-Item -LiteralPath $asar | Select-Object FullName,Length,LastWriteTime'
```

Expected:

- 已解包目录完整时，此步骤只作为来源文件存在性记录。
- 若已解包目录缺失或不完整，再考虑使用 asar reader 重新解包。

- [ ] **Step 6: 确认 `.ccc` 加载或映射机制**

Run:

```powershell
rtk pwsh -NoLogo -NoProfile -Command 'rg -n "\\.ccc|require\\(.*\\.ccc|dist/build\\.js|contributions\\.builder|package_version" ".codex-tmp\creator-386-app-asar-extract\builtin" ".codex-tmp\creator-386-app-asar-extract\modules" ".codex-tmp\creator-386-app-asar-extract\extension"'
```

Expected:

- 找到 Editor extension loader 对 `.ccc` 的处理，或记录“当前尚未定位到 `.ccc` loader”。
- 如果 `.ccc` 是加密/压缩后的 JS，后续不能直接按普通 JS 源码复用，必须先确认可执行加载方式。

- [ ] **Step 7: 必要时用 debug 方式观测加载行为**

Run only after explicit confirmation:

```text
用 `cce` / Electron debug 方式启动 Editor，观察 `wechatgame` extension 的 builder 入口是否被加载、解析后的模块路径、exports key、hook 调用顺序、调用栈和传参结构。
```

Expected:

- 只记录行为事实：模块 id / resolved path、exports key、hook 名称、调用顺序、参数结构、错误传播。
- 不导出 `.ccc` 模块源码。
- 不保存闭源模块反混淆结果。
- 若 debug 只能通过导出或反混淆源码才能继续，则停止并回到公开文档与产物 diff 路线。

- [ ] **Step 8: 记录 Editor source 事实**

Modify:

- `docs/dev/build-extension-hooks-20260612.md`

Expected content:

- Editor unpacked 路径有哪些平台。
- 官方 GitHub 是否提供 `wechatgame` platform extension builder/hooks 源码。
- `wechatgame` unpacked 目录具体文件。
- 已解包 `app.asar` 目录中的 `modules/platform-extensions/extensions/wechatgame` 文件。
- `package.json` 的 `contributions.builder` 声明。
- `.js` 入口声明与 `.ccc` 实际文件的映射问题。
- debug 方式观测到的加载行为事实，不包含源码内容。
- 若找到 loader，记录 `.ccc` 加载机制；若未找到，记录为待验证风险。

## Task 2: 梳理 CLI 当前 hook 机制事实

- [ ] **Step 1: 定位 CLI hook 注册与执行源码**

Run:

```powershell
rtk pwsh -NoLogo -NoProfile -Command 'rg -n "class PluginManager|pluginRoots|getHooksInfo|runPluginTask|onBeforeBuild|onAfterBuild|contributes\\.builder|contributions\\.builder" src'
```

Expected:

- 明确当前扫描范围。
- 明确 platform package schema。
- 明确 hook 执行顺序、调用参数、preview skip、error handling。

- [ ] **Step 2: 使用 CodeGraph 复核调用链**

Use CodeGraph:

```text
PluginManager getHooksInfo runPluginTask BuildTask build
```

Expected:

- 复核 `PluginManager` 到 `BuildTask` 的调用路径。
- 不用 grep 手工重建完整调用链。

- [ ] **Step 3: 记录 CLI hook 事实**

Modify:

- `docs/dev/build-extension-hooks-20260612.md`

Expected content:

- 当前 CLI 支持哪些 hook。
- public hook 与 internal hook 调用签名差异。
- 当前不支持 `<projectRoot>/extensions/*` builder hook 的源码依据。
- `contributes.builder` 与 Editor `contributions.builder` 的 schema 差异。

## Task 3: 分析 `feature-c/extensions/build-ex` 的项目耦合

- [ ] **Step 1: 读取 extension package 与源码入口**

Run:

```powershell
rtk pwsh -NoLogo -NoProfile -Command '$p="D:\ps_copy\p6\trunk\Project\GameClient\feature-c\extensions\build-ex"; Get-Content -LiteralPath (Join-Path $p "package.json") -Raw; rg -n "exports|configs|hooks|assetHandlers|Editor\\.|Editor\\.Message|Editor\\.Project|db://|build-templates|__GAME_BUILD_CFG__|project\\.manifest|merged_cfg|version\\.ts|onBefore|onAfter|throwError" $p'
```

Expected:

- 列出 `package.json` 的 `contributions.builder`。
- 列出 `builder.ts`、`hooks.ts`、`asset-handlers` 是否存在。
- 列出所有 `Editor.*`、`db://`、项目路径、平台输出目录改写点。

- [ ] **Step 2: 分类 build-ex 逻辑**

Expected classification:

- Hook 机制验证必需：最小 `onBeforeBuild` / `onAfterBuild` / `onError` 生命周期验证。
- 可迁移但需 CLI 能力：AssetDB query、bundle 配置调整、platform package options 读取。
- 业务强耦合应删除：`assets/resources/cfg` 合并、`version.ts` 写入、`__GAME_BUILD_CFG__` 业务注入、SDK 平台分支、hotupdate manifest 生成、`feature-c` 特定路径。
- 高风险异步逻辑：未 await 的 `fs.readFile/fs.writeFile` callback 中抛错。

- [ ] **Step 3: 输出裁剪建议**

Modify:

- `docs/dev/build-extension-hooks-20260612.md`

Expected content:

- `build-ex` 迁移到主测试项目时建议保留的最小 hook。
- 建议删除或替换的 `feature-c` 耦合点。
- 每类逻辑是否依赖 CLI 新机制。

## Task 4: 审视用户三阶段思路并固化最终方案

- [ ] **Step 1: 对用户思路做风险审视**

Input idea:

- 先把 `feature-c` 的 `build-ex` 挪到主测试项目。
- 用户用 Editor 构建微信小游戏、`web-mobile` 等主要平台作为 baseline。
- 再看 CLI 如何实现自定义 hook。
- 最后验证。

Expected findings:

- 不能先整体搬 `feature-c/build-ex`，否则业务耦合会污染 hook 机制验证。
- Editor baseline 要先定义“比较什么”：hook 日志、产物文件、平台配置、运行时结果、git diff。
- `wechatgame` baseline 依赖 CLI 是否已有该平台完整打包能力；若 CLI 暂不支持某平台，不应把平台完整 parity 和 extension hook parity 混成一个验收目标。
- `web-mobile` 更适合作为第一阶段 hook 机制验证平台。
- 微信小游戏适合作为第二阶段平台输出结构验证，前提是 CLI 已能构建对应平台或已导入 Editor 平台 package 逻辑。

- [ ] **Step 2: 拟定最终三阶段方案**

Expected plan:

1. 事实阶段：Editor source、CLI hook、`build-ex` 耦合、baseline 比较维度。
2. 最小机制阶段：主测试项目加入裁剪版 `build-ex`，CLI 支持项目 extension builder 扫描和 hook 执行，用 `web-mobile` 验证。
3. 平台 parity 阶段：在 `wechatgame` 等平台上对齐 Editor 平台 package 逻辑、extension hook 顺序、产物结构和运行结果。

- [ ] **Step 3: 等用户确认**

Expected:

- 输出最终方案摘要。
- 明确哪些内容要先删除、哪些要替代、哪些要等平台能力齐备。
- 用户确认后才进入实现。

## Task 5: 实现项目 extension builder discovery

This task runs only after user confirmation.

- [ ] **Step 1: 写失败测试，证明当前 CLI 不扫描项目 extension builder**

Test target:

- `src/core/builder/test` 或 `tests/commands`

Expected:

- 构造临时 project root，包含 `extensions/test-build-hook/package.json`：

```json
{
  "name": "test-build-hook",
  "version": "1.0.0",
  "contributions": {
    "builder": "./dist/builder.js"
  }
}
```

- `dist/builder.js` 暴露：

```js
exports.configs = {
  "*": {
    hooks: "./hooks"
  }
};
```

- 当前测试应失败，证明未注册该 hook。

- [ ] **Step 2: 抽出 project extension package discovery**

Modify after approval:

- `src/core/assets/extension-mounts.ts`
- 或新增 `src/core/extensions/project-extensions.ts`

Expected:

- 统一读取 `<projectRoot>/extensions/*/package.json`。
- 只返回 package metadata 和绝对路径，不在 discovery 层执行业务副作用。
- AssetDB mount 继续使用 `contributions["asset-db"].mount`。
- Builder hook 新增读取 `contributions.builder`。

- [ ] **Step 3: 在 `PluginManager` 注册 project extension builder**

Modify after approval:

- `src/core/builder/plugin-manager.ts`

Expected:

- 支持 Editor extension schema：`contributions.builder` 指向 builder entry。
- 支持 builder entry 的 `configs["*"].hooks` 和 `configs[platform].hooks`。
- 生成的 hook info 使用 public hook 调用签名。
- 不把项目 extension 标记为 internal platform hook。

- [ ] **Step 4: 跑单测**

Run:

```powershell
rtk pwsh -NoLogo -NoProfile -Command 'npx jest <新增测试文件> --runInBand'
```

Expected:

- 新增测试通过。
- 旧 builder plugin tests 不回归。

## Task 6: 主测试项目裁剪版 `build-ex` 验证

This task runs only after user confirmation.

- [ ] **Step 1: 新增裁剪版 extension fixture**

Modify after approval:

- `E:\own_space\engines\cocos-test-projects\extensions\build-ex\package.json`
- `E:\own_space\engines\cocos-test-projects\extensions\build-ex\dist\builder.js`
- `E:\own_space\engines\cocos-test-projects\extensions\build-ex\dist\hooks.js`

Expected:

- `onBeforeBuild` 写一条可验证 hook marker 到 build temp 或 build result 允许的位置。
- `onAfterBuild` 写一条可验证 hook marker 到输出目录。
- 不写 `.meta`。
- 不写 `library` 顶层 internal JSON。
- 不引入 `feature-c` 的 cfg、hotupdate、SDK、obfuscation、manifest 逻辑。

- [ ] **Step 2: Editor baseline**

Run in Editor manually by user or via documented Editor command if available:

```text
profiles/v2/packages/web-mobile.json
wechatgame profile when available
```

Expected:

- 记录 Editor 是否执行 `build-ex` hook。
- 记录 hook marker 位置。
- 记录 build output path。
- 记录构建前后 git diff，尤其 `.meta`、`library`、`profiles`。

- [ ] **Step 3: CLI build 验证**

Run:

```powershell
rtk pwsh -NoLogo -NoProfile -Command 'node .\dist\cli.js build --project "E:\own_space\engines\cocos-test-projects" --platform web-mobile --build-config "E:\own_space\engines\cocos-test-projects\profiles\v2\packages\web-mobile.json" --buildPath "E:\own_space\engines\cocos-test-projects\build" --outputName "codex-build-ex-hook-check-20260615"'
```

Expected:

- build 退出码为 `0`。
- hook marker 与 Editor baseline 的生命周期一致。
- 构建后运行页面无新增 console error。

- [ ] **Step 4: 浏览器运行验证**

Run:

```powershell
rtk pwsh -NoLogo -NoProfile -Command 'python -m http.server 13340 --directory "E:\own_space\engines\cocos-test-projects\build\codex-build-ex-hook-check-20260615"'
```

Expected:

- 用 in-app Browser 打开 `http://127.0.0.1:13340/`。
- 页面 title 为 `Cocos Creator | test-cases`。
- `canvas` 存在。
- warning/error 中没有新增 hook 相关错误。

## Task 7: 微信小游戏平台 parity 评估

This task runs only after Task 1 confirms Editor platform source location and user confirms scope.

- [ ] **Step 1: 确认 CLI 是否已有 `wechatgame` 平台 package**

Run:

```powershell
rtk pwsh -NoLogo -NoProfile -Command 'Get-ChildItem -LiteralPath "src\core\builder\platforms" -Directory | Select-Object -ExpandProperty Name; rg -n "wechatgame" src\core\builder\platforms packages src'
```

Expected:

- 若 CLI 已有 `wechatgame` 平台，继续构建验证。
- 若 CLI 没有完整平台 package，先登记平台 package 缺口，不把 extension hook 机制验收绑定到微信小游戏完整构建。

- [ ] **Step 2: 对比 Editor wechatgame baseline 与 CLI 输出**

Expected comparison:

- `game.js` / platform config 文件。
- `project.config.json` 或对应小游戏工程配置。
- `src/settings` 或 bundle config。
- `remote` / `assets` / `subpackages` 结构。
- extension hook marker。
- 运行时或开发者工具打开结果。

- [ ] **Step 3: 输出平台后续工作拆分**

Expected:

- 如果差异来自平台 package 本身，拆成 `wechatgame platform package parity`。
- 如果差异来自 extension hook 机制，回到 Task 5/6 修。
- 如果差异来自 `build-ex` 业务逻辑，继续裁剪 fixture 或记录业务不迁移。

## Task 8: 文档收敛与状态更新

- [ ] **Step 1: 更新事实记录**

Modify:

- `docs/dev/build-extension-hooks-20260612.md`

Expected:

- 记录 Editor source 检查结果。
- 记录 CLI hook 实现边界。
- 记录 `build-ex` 裁剪结论。
- 记录 Editor/CLI baseline 对比结果。

- [ ] **Step 2: 更新 issues 状态**

Modify only after validation:

- `docs/dev/build/issues.md`

Expected:

- 若新增问题，按现有 `BUILD-ISSUE-*` 格式登记。
- 若只是本计划过程事实，不动 issues。

- [ ] **Step 3: 回填稳定模块文档**

Modify when behavior stabilizes:

- `docs/dev/modules/builder.md`

Expected:

- 描述 CLI 支持的 project extension builder hook schema。
- 描述与 platform internal hook 的差异。
- 描述不支持或不承诺兼容的 Editor API。

## 验收标准

- 已确认 Editor 3.8.6 平台打包代码是否在已解包 `app.asar` 目录或其它可定位位置。
- 已确认 `wechatgame` unpacked 静态资源和 packed builder source 的边界。
- 已确认 `wechatgame` 的 `.ccc` 文件与 `package.json` 中 `.js` 入口声明之间的加载关系。
- 已确认 CLI 当前 hook 机制与 Editor extension builder schema 的差异。
- 已确认 `feature-c/build-ex` 中哪些逻辑可迁移、哪些必须删除、哪些需要 CLI 新能力。
- 主测试项目中裁剪版 `build-ex` 可由 Editor 和 CLI 执行同一生命周期 hook。
- CLI `web-mobile` 构建通过，输出目录可运行，无新增 console error。
- 若执行微信小游戏验证，差异能归类到平台 package、extension hook 机制或业务 `build-ex` 逻辑中的一种。
- 所有事实写入对应文档，长期结论回填到 `docs/dev/modules/builder.md`。

## 确认后建议执行顺序

1. Task 1：先查已解包 Editor source，确认平台代码位置和 `.ccc` 加载关系。
2. Task 2：复核 CLI hook 机制。
3. Task 3：完成 `build-ex` 耦合分类。
4. Task 4：输出最终实现方案，等待二次确认。
5. Task 5-6：实现并验证最小项目 extension builder hook。
6. Task 7：再进入微信小游戏等平台 parity。
7. Task 8：收敛文档和 issue 状态。
