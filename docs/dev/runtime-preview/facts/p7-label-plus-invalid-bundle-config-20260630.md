# P7 `label-plus` bundle config ID 失效 warn 事实记录

## 背景

2026-06-30 用户反馈 P7 `Client-fight-roguelike-migration` 真实项目启动 runtime preview 时出现以下 warn：

```text
WARN Invalid Bundle config ID auto_c7FJ7y5XJIOpm9Bw75Alyl in bundle db://label-plus/resources, the bundle config will use the default config {"compressionType":"merge_dep","isRemote":false,"priority":19,"name":"label-plus","root":"db://label-plus/resources",...,"debug":true}
```

本记录只做静态排查和问题登记；本轮未执行 preview、未执行 build、未修改项目资源或源码。

## 复现项目

- 项目分类：issue 指定真实业务项目。
- 项目代号：`<P7_ROGUELIKE_PROJECT>`。
- 本地路径：`D:\ps_copy\p7\trunk\GameClient\Client-fight-roguelike-migration`。
- 涉及 bundle root：`db://label-plus/resources`。

## 静态证据

`<P7_ROGUELIKE_PROJECT>/extensions/label-plus/assets/resources.meta` 标记该目录是 asset bundle，并引用了 warn 中的 `bundleConfigID`：

```json
{
  "userData": {
    "isBundle": true,
    "bundleName": "label-plus",
    "priority": 19,
    "bundleConfigID": "auto_c7FJ7y5XJIOpm9Bw75Alyl"
  }
}
```

`<P7_ROGUELIKE_PROJECT>/settings/v2/packages/builder.json` 的 `bundleConfig.custom` 当前只包含以下 bundle config ID：

```text
auto_410KqPandAlr5ErqM/oVDe
auto_53R9YxfSBPMJCX71DWziFU
43sotjQFJKAZKcnZq+kh/1
f1QSIzaktEwJbtxVFCBsna
26ikdxdWRM0qFRu7XDeFt2
```

其中没有：

```text
auto_c7FJ7y5XJIOpm9Bw75Alyl
```

`<P7_ROGUELIKE_PROJECT>/profiles/v2/packages/builder.json` 只包含 `log.level`，没有提供 `bundleConfig.custom` 覆盖。

在排除 `node_modules`、`build`、`temp`、`library` 后，`auto_c7FJ7y5XJIOpm9Bw75Alyl` 只出现在：

```text
extensions/label-plus/assets/resources.meta
```

## 源码事实

`src/core/builder/worker/builder/asset-handler/bundle/index.ts` 中 `BundleManager.initStaticBundleConfig()` 从 builder project config 读取用户 bundle config 表：

```ts
const bundleConfig: Record<string, CustomBundleConfig> = (await builderConfig.getProject('bundleConfig.custom')) || {};
if (!bundleConfig.default) {
    bundleConfig.default = DefaultBundleConfig;
}
BundleManager.BundleConfigs = transformBundleConfigCustomByPlatformType(bundleConfig, pluginManager.bundleConfigs);
```

`patchProjectBundleConfig()` 从 bundle asset 的 `.meta` 读取 `bundleConfigID`，再查 `BundleManager.BundleConfigs`：

```ts
const { bundleFilterConfig, priority, bundleConfigID, bundleName } = assetInfo.meta.userData;
const userBundleConfig = this.getUserConfig(bundleConfigID);
...
if (!userBundleConfig) {
    console.warn(`Invalid Bundle config ID ${bundleConfigID} in bundle ${customConfig.root}, the bundle config will use the default config ${JSON.stringify(config)}`);
}
```

因此该 warn 的直接触发条件是：

1. bundle `.meta` 中存在 `bundleConfigID`；
2. builder project config 的 `bundleConfig.custom` 中不存在该 ID；
3. builder 对该 bundle 回退到默认 bundle config。

## 当前判断

根本原因是 P7 项目内 `extensions/label-plus/assets/resources.meta` 保留了一个已经不在 `settings/v2/packages/builder.json` 中登记的 `bundleConfigID`。CLI builder 按当前源码语义找不到该 ID 后，使用 default bundle config 并输出 warn。

这不是 runtime preview HTTP route、settings.js 或 scene resolver 的问题；warn 发生在 build / preview settings 生成所复用的 builder bundle 初始化阶段。当前静态证据也不支持把它判断为 CLI 新引入的 bundle config 解析 bug。

## 影响

- `label-plus` bundle 仍会生成 bundle 配置，但使用 default config。
- 从 warn 中的最终 config 看，当前回退值为 `compressionType: "merge_dep"`、`isRemote: false`、`priority: 19`、`name: "label-plus"`、`debug: true`。
- 如果缺失的原始 bundle config 对 `label-plus` 曾经有不同的 platform-specific 配置，例如 remote、subpackage 或其它 compression 策略，则当前 preview/build 行为会与原配置预期不一致。

## 未执行项

本轮用户明确要求不执行预览，因此没有运行：

```powershell
node <COCOS_CLI_ROOT>\dist\cli.js preview --runtime --project <P7_ROGUELIKE_PROJECT>
```

也没有运行 build、Vitest、browser smoke 或真实项目验收。

## 后续需要澄清 / 验证

1. 需要确认 `label-plus` extension 的 `resources.meta` 是否应改为使用项目现存的某个 bundle config ID，还是应在 `settings/v2/packages/builder.json` 恢复 `auto_c7FJ7y5XJIOpm9Bw75Alyl` 对应配置。
2. 如果要判断 Editor 是否同样 warn，需要在 Editor / 官方 builder 侧做同项目对照；本轮未执行。
3. 如果只要求消除 warn，修复点应优先落在项目配置一致性，而不是 CLI runtime preview 路由。
