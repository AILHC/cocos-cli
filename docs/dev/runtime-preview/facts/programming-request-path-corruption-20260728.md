# Runtime preview programming 请求路径畸变事实

## 反馈

2026-07-28，`feature-c` 的 `cocos.log` 出现一次 filesystem `stat` 失败：

```text
ENOENT: no such file or directory, stat '<project>\temp\cli\programming\packer-driver\targets\preview\packer-driver\targets\preview\=1785228545736'
```

该错误发生后原进程仍继续输出日志，因此当前证据不支持把它判定为 scene worker 启动失败的直接原因。

## 已确认事实

- 真实 programming preview target 位于 `<project>\temp\cli\programming\packer-driver\targets\preview`。
- 错误路径包含重复的 `packer-driver\targets\preview`，磁盘产物不存在这种递归目录结构。
- `1785228545736` 对应错误发生前约 393ms 的当前时间戳，属于运行时动态生成，不是历史文件名。
- 当前 import map、main record 和 assembly record 中没有重复 target 前缀或该时间戳记录。
- 错误时段 programming/library 没有对应文件写入或删除证据，不支持文件删除竞争假设。
- 使用真实 QuickPack workspace，把 `packer-driver/targets/preview/=1785228545736` 作为相对资源 ID，可以精确复现同一重复目录路径。

## 反馈时解析行为

runtime preview 对 `/scripting/x/` 请求执行以下处理：

1. 统一路径分隔符。
2. 截取 `/scripting/x/` 后的内容作为 `relativePath`。
3. 只拒绝空路径和包含 `..` 的路径。
4. 将 `relativePath` 直接解析到 project programming root，并执行 `stat`。

当前没有验证请求是否符合 programming 产物结构，也没有在解析后验证绝对路径仍位于选定 root 内。非法请求与普通文件不存在最终都会退化为未解析。

## 第一阶段防御

2026-07-28 已实现 programming request boundary 防御：

- 重复的 `packer-driver/targets/preview` 前缀抛出 `duplicate-preview-target`。
- preview target 下独立的 `=纯数字` 路径段抛出 `timestamp-path-segment`。
- 绝对路径或 Windows drive path 抛出 `absolute-path`。
- filesystem `stat` 前验证解析结果仍位于选定 programming root 内。
- runtime preview HTTP boundary 将上述错误转换为 `400`，日志只记录规范化 pathname 和拒绝原因，不记录 query。
- 合法 records、chunks、SystemJS 和 user macro 请求保持 `200`；合法但不存在的 programming 文件仍保持 `404`。

该防御不会自动删除重复前缀，也不会创建占位文件，因此不会掩盖错误请求的生成端。

## 第一阶段验证

- 测试层级：短链路 Vitest resolver / HTTP route contract。
- fixture：测试进程创建的临时 programming root，不属于真实项目。
- 环境变量：仅设置 `COCOS_CLI_TEST_ENGINE_ROOT=D:\workspace\engines\cocos\3.8.6`，用于 Vitest TypeScript transform；未设置 project、Editor reference 或 feature-c 专项环境变量。
- 命令：

```powershell
npm --prefix vitests run test -- suites/runtime-preview/on-demand-resolver.test.ts suites/runtime-preview/http-contract.test.ts -t "rejects malformed programming paths|returns 400 and logs malformed programming requests"
npx tsc -b --pretty false
```

- 结果：focused Vitest `2/2` 通过；TypeScript project references 编译通过。
- 未执行 `npm run compile`，因此没有更新 `dist`。
- 该结果只能证明 resolver 和 HTTP route contract；不能证明 browser runtime、主测试项目或 `feature-c` 已闭环。

## 与历史问题的关系

本问题与 `BUILD-ISSUE-021` 同属 Web URL/cache-bust 信息进入 filesystem 路径的故障类别，但触发形态不同：

- 历史问题是 `library/*.json?_t=<timestamp>` 被 Node.js adapter 当成本地文件路径。
- 当前问题是 programming 请求出现重复 preview target 前缀，并把 `=<timestamp>` 作为路径段。

因此不能把历史修复直接视为当前问题的根因修复。

## 剩余事实缺口

现有日志没有保存原始 HTTP URL，也没有请求发起端调用栈。当前只能确定非法路径进入了解析边界，尚不能确定是哪段 CLI、engine 或 browser 代码生成了 `/=时间戳`。

## 处理顺序

1. 已在 programming HTTP 边界拒绝已确认不可能合法的路径结构，记录规范化 pathname 和拒绝原因，避免非法请求进入 filesystem。
2. 下一步利用该诊断证据定位实际 URL 生成端，并在源头修复 cache-bust 语义。
3. 不以清理 programming cache、创建占位文件或自动删除重复前缀作为修复。
