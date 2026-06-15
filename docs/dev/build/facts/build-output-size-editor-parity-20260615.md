# Build 产物体积 Editor parity 事实记录（2026-06-15）

本文记录主测试项目 `web-mobile` 构建产物中，CLI build 包体大于 Editor build 包体的复现事实和初步原因分析。

## Baseline

- 测试项目：`E:\own_space\engines\cocos-test-projects`
- Editor 产物：`E:\own_space\engines\cocos-test-projects\build\web-mobile`
- CLI 产物：`E:\own_space\engines\cocos-test-projects\build\codex-cconb-import-fix2-20260615`
- CLI 构建配置参数：`--build-config E:\own_space\engines\cocos-test-projects\profiles\v2\packages\web-mobile.json`
- 本轮只对已有产物做 byte-level 统计和配置反查，未重新执行 build。

## 总体大小

统计方式：递归统计文件数量和 `Length` 字节数，不做压缩包再压缩估算。

| 产物 | 文件数 | Bytes | MiB |
| --- | ---: | ---: | ---: |
| Editor `build\web-mobile` | 920 | 205947914 | 196.407 |
| CLI `build\codex-cconb-import-fix2-20260615` | 914 | 212472127 | 202.629 |
| CLI - Editor | -6 | 6524213 | 6.222 |

结论：当前 CLI 产物比 Editor 产物大约 `6.222 MiB`。

## Top-level 差异

| 目录 / 文件 | Editor MiB | CLI MiB | CLI - Editor MiB |
| --- | ---: | ---: | ---: |
| `cocos-js` | 17.385 | 23.817 | 6.433 |
| `remote` | 175.088 | 174.067 | -1.021 |
| `assets` | 3.711 | 4.454 | 0.743 |
| `src` | 0.216 | 0.284 | 0.067 |

结论：净增长主要来自 `cocos-js`。`remote` 目录反而略小，不是当前总体变大的主因。

## 文件类型差异

| 类型 | Editor MiB | CLI MiB | 观察 |
| --- | ---: | ---: | --- |
| `.map` | 15.576 | 19.400 | CLI sourcemap 多约 `3.824 MiB`。 |
| `.js` | 3.401 | 7.433 | CLI JS 多约 `4.032 MiB`。 |
| `.json` | 4.952 | 3.550 | CLI JSON 反而更小，说明总体变大不是 JSON 资源普遍膨胀导致。 |
| `.bin` | 92.621 | 92.621 | 二进制资源一致。 |
| `.jpeg` | 36.816 | 36.816 | 图片主体一致。 |

## 最大单文件差异

| 文件 | Editor bytes | CLI bytes | CLI - Editor |
| --- | ---: | ---: | ---: |
| `cocos-js/cc.js.map` | 86 | 16681112 | +16681026 |
| `cocos-js/_virtual_cc-eNNZ_Owf.js.map` | 13808618 | 0 | -13808618 |
| `cocos-js/cc.8a3ec.js` | 0 | 6105629 | +6105629 |
| `cocos-js/_virtual_cc-eNNZ_Owf.js` | 2612251 | 0 | -2612251 |
| `assets/main/index.dcd3d.js` | 0 | 1189049 | +1189049 |
| `assets/main/index.2d09f.js` | 500396 | 0 | -500396 |

Editor 的 `cocos-js/cc.84fd0.js` 是较小的 wrapper，真实压缩 engine 在 `_virtual_cc-eNNZ_Owf.js`；CLI 的 `cocos-js/cc.8a3ec.js` 本身是约 `6.106 MB` 的 engine 内容。

## 输出配置反查

从产物中的 `settings` 和 main bundle `config` 反查：

| 产物 | `settings.engine.debug` | main `config.debug` | settings bytes | main config bytes |
| --- | --- | --- | ---: | ---: |
| Editor | `false` | `false` | 3293 | 2004 |
| CLI | `true` | `true` | 5727 | 6127 |

结论：当前 CLI 产物是按 `debug=true` 输出，Editor baseline 是按 `debug=false` 输出。

## 配置来源分析

`profiles/v2/packages/web-mobile.json` 中有：

- `builder.common.sourceMaps: true`
- `builder.common.md5Cache: true`
- 未声明 `builder.common.debug`

Editor 的真实构建任务状态在 `profiles/v2/packages/builder.json` 中记录：

- `BuildTaskManager.taskMap["1781256410326"].options.platform: "web-mobile"`
- `BuildTaskManager.taskMap["1781256410326"].options.debug: false`
- 同一 task options 中还记录了 `sourceMaps: true`、`md5Cache: true` 等完整构建选项。

CLI 当前 `--build-config profiles/v2/packages/web-mobile.json` 的 adapter 只 flatten `builder.common`，并把 `builder.taskOptionsMap` 的 platform package options 写入 `packages[platform]`；不会读取 `profiles/v2/packages/builder.json` 里的 `BuildTaskManager.taskMap.<taskId>.options`。因此 `debug` 在传入配置中缺失后，会落到 CLI builder 通用默认值。

源码事实：

- `src/core/builder/share/builder-config.ts` 中通用 `debug.default` 当前为 `true`。
- `src/core/builder/worker/builder/asset-handler/script/engine.ts` 将 `buildEngineOptions.compress` 设置为 `!options.debug`。
- `src/core/builder/worker/builder/asset-handler/script/build-script.ts` 在 `!options.debug` 时才启用 `terser()`，`buildSystemJsCommand()` 也用 `minify: !options.debug`。
- `src/core/builder/worker/builder/tasks/setting-task/asset.ts` 等逻辑在 `!options.debug` 时会压缩 settings / bundle config 中的 UUID。

因此当前可解释链路是：

1. Editor task 实际 `debug=false`。
2. CLI 只读 `web-mobile.json`，没有合并 `builder.json` task options，导致 `debug` 缺失。
3. CLI 校验/默认补全后 `debug=true`。
4. `debug=true` 使 engine build `compress=false`、script build `minify=false`，并让 settings/config 以 debug 形态输出。
5. 最终 CLI 产物 JS 和 sourcemap 比 Editor baseline 大，净增约 `6.222 MiB`。

## 当前判断

这不是资源本体重复或 `.bin` / 图片资源变大的问题；当前主因是 CLI 对 Creator profile 的读取范围不完整，缺失 Editor task options 中的 `debug=false`。

后续修复方向应优先对齐 Editor 的 profile 语义：

- 当用户指定 `profiles/v2/packages/<platform>.json` 时，CLI 需要能按 `taskId` 从同目录 `builder.json` 的 `BuildTaskManager.taskMap.<taskId>.options` 读取完整 task options，至少不能丢失 `debug`。
- 显式命令行参数仍应覆盖 profile/task options。
- 修复后用同一项目、同一 task id、同一 `web-mobile` profile 重新构建，对比 `settings.engine.debug`、main `config.debug`、`cocos-js` 结构和总体大小。

不能只把 CLI 默认 `debug` 从 `true` 改成 `false` 作为最终方案；这会改变所有没有 Creator task baseline 的 build 默认行为，必须先确认 Editor profile 语义和 CLI 默认模式的边界。

## 追加验证：改用 `buildConfig_web-mobile.json`

用户提供测试项目根目录下的完整构建配置：

- 配置文件：`E:\own_space\engines\cocos-test-projects\buildConfig_web-mobile.json`
- 该文件是扁平后的完整 build config，包含 `debug: false`、`sourceMaps: true`、`md5Cache: true`、`packages["web-mobile"]` 等字段。

执行命令：

```powershell
rtk pwsh -NoProfile -Command "node .\dist\cli.js build --project 'E:\own_space\engines\cocos-test-projects' --platform web-mobile --build-config 'E:\own_space\engines\cocos-test-projects\buildConfig_web-mobile.json' --buildPath 'E:\own_space\engines\cocos-test-projects\build' --outputName 'codex-buildconfig-web-mobile-20260615'"
```

结果：

- build 退出码为 `0`。
- 输出目录：`E:\own_space\engines\cocos-test-projects\build\codex-buildconfig-web-mobile-20260615`。
- 日志中 `buildEngineCommand` 的 options 包含 `compress:true`、`flags.DEBUG:false`，说明 `debug:false` 已传入 engine build。
- 构建过程中仍出现既有 atlas/sprite frame library json 缺失 warning/error，但未阻塞 build，本轮不作为包体差异判断依据。

重新统计：

| 产物 | 文件数 | Bytes | MiB |
| --- | ---: | ---: | ---: |
| Editor `build\web-mobile` | 920 | 205947914 | 196.407 |
| CLI `build\codex-cconb-import-fix2-20260615`（旧 profile wrapper） | 914 | 212472127 | 202.629 |
| CLI `build\codex-buildconfig-web-mobile-20260615`（完整 buildConfig） | 917 | 203852907 | 194.409 |

差异：

- 完整 `buildConfig_web-mobile.json` 产物比旧 CLI profile wrapper 产物小约 `8.220 MiB`。
- 完整 `buildConfig_web-mobile.json` 产物比当前 Editor baseline 小约 `1.998 MiB`。

关键字段反查：

| 产物 | `settings.engine.debug` | main `config.debug` | settings bytes | main config bytes |
| --- | --- | --- | ---: | ---: |
| Editor | `false` | `false` | 3293 | 2004 |
| CLI 完整 buildConfig | `false` | `false` | 3436 | 1881 |

`cocos-js` 结构也恢复到与 Editor 同类的 release 形态：

- Editor：`cc.84fd0.js` 为 `11090` bytes，`_virtual_cc-eNNZ_Owf.js` 为 `2612251` bytes。
- CLI 完整 buildConfig：`cc.5b3d9.js` 为 `11070` bytes，`_virtual_cc-B-KDX1xD.js` 为 `2531023` bytes。

追加结论：

1. “CLI build 产物比 Editor 大”不是当前构建管线在 `debug:false` 下的必然结果。
2. 使用完整 `buildConfig_web-mobile.json` 时，CLI 可以生成 `debug:false`、engine compressed 的 release 形态产物，体积不再大于 Editor baseline。
3. 问题收敛为：直接把 `profiles/v2/packages/web-mobile.json` 作为 `--build-config` 时，CLI adapter 没有合并 Editor task 的完整 options，尤其是 `debug:false`，导致旧 CLI profile wrapper 产物变大。
