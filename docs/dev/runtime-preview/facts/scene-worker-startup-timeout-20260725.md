# Scene Worker 启动超时反馈（2026-07-25）

## 观察到的现象

真实项目复杂场景 `D:\ps_copy\p6\trunk\Project\GameClient\feature-c` 的日志确认，2026-07-25 至少三次 `preview --runtime` 启动在 scene worker 阶段失败：

- `runtime-preview-20260725-203919.log` 和 `runtime-preview-20260725-210507.log` 都完成 engine、AssetDB、builder、settings、watcher 和 prerequisite-scope 准备后，记录 `preview:error Scene worker failed to start.`，随后停止 runtime asset watcher。
- `runtime-preview-20260725-212316.log` 显式清理 programming cache 后，editor / preview target 编译合计耗时 `594240ms`，仍在 scene worker 阶段失败；清理 programming cache 没有解决该问题。
- `temp/logs/cocos.log` 在 `2026-07-25 21:09:54.336/337` 记录“场景进程启动超时”，紧随其后才记录 `[Node] Disposing RPC instance`；约两秒后记录 `Failed to start preview` 与 `startupScene()` -> `Launcher.startRuntimePreview()` -> `preview` command 调用栈。
- 21:35 的第三次失败在超时前持续输出 `targets/editor/chunks/** is not in module cache!` 和 `[[Executor]] Module "pack:///chunks/**" loaded.`；最后一个 module loaded 与“场景进程启动超时”只相差数毫秒。worker 并非无活动或已经退出，而是在固定 30 秒总时限到达时仍持续加载项目 editor modules。

已核对日志：

- [runtime-preview-20260725-203919.log](D:\ps_copy\p6\trunk\Project\GameClient\feature-c\temp\preview-logs\runtime-preview-20260725-203919.log)
- [runtime-preview-20260725-210507.log](D:\ps_copy\p6\trunk\Project\GameClient\feature-c\temp\preview-logs\runtime-preview-20260725-210507.log)
- [runtime-preview-20260725-212316.log](D:\ps_copy\p6\trunk\Project\GameClient\feature-c\temp\preview-logs\runtime-preview-20260725-212316.log)
- [cocos.log](D:\ps_copy\p6\trunk\Project\GameClient\feature-c\temp\logs\cocos.log)

## 已核对源码

- `src/core/scene/main-process/scene-worker.ts` 的 `sceneWorker.start()` 等待 child process 通过 `SceneReadyChannel` 发送 ready 消息；30 秒内未收到该消息时记录“场景进程启动超时”，释放 RPC 与 child process，并返回 `false`。
- `src/core/scene/index.ts` 的 `startupScene()` 收到 `false` 后调用 `sceneWorker.stop()`，再抛出 `Scene worker failed to start.`。
- `src/core/launcher.ts` 的 `Launcher.startRuntimePreview()` 在 runtime readiness 达到 ready 后调用 `startupScene()`；因此该异常会使 runtime preview 启动失败并进入 session 清理。

## 当前边界

固定 30 秒总时限不能正确判定 scene worker 的 liveness：`feature-c` 的 worker 在时限到达时仍持续加载 `3158` 个 editor modules，却被当作启动失败清理。`is not in module cache!` 描述的是新 worker 进程内存 module cache 的首次加载状态，现有证据不支持把它判定为 programming disk cache 损坏。

## 候选修复与验证

2026-07-25 已将 scene worker 启动限制改为双门禁：

- 连续 30 秒没有 child IPC、stdout 或 stderr 活动才判定 idle timeout；
- 即使持续有活动，启动总时长达到 5 分钟仍判定 max timeout；
- timeout 日志记录 `elapsedMs`、`lastActivity` 和 `lastActivityAgoMs`；
- ready、early exit、RPC dispose、child kill 和 session 清理语义保持不变。

验证结果：

- `vitests/suites/runtime-preview/scene-worker-session.test.ts`：10/10 通过，覆盖总时长超过 30 秒但持续输出后 ready、30 秒无活动失败、持续活动仍受 5 分钟总时限约束。
- `src/core/scene/test/scene-worker.test.ts`：1/1 通过；Jest 报告既有 `CustomGC` open handle，不影响测试通过结论。
- `npx tsc -b --pretty false`：通过。
- `npm run compile`：通过，`dist/core/scene/main-process/scene-worker.js` 已包含 idle / max timeout 实现。
- 主测试项目 `E:\own_space\engines\cocos-test-projects` 的真实 `dist/cli.js preview --runtime` 集成已执行：runtime log 记录 `preview:ready durationMs=44838`，browser evidence 记录 `elapsedStartupMs=62509`，证明 scene worker 与统一 session 已成功 ready，未出现 scene worker timeout；测试结束后端口由 helper 释放。
- 同一集成测试随后在第一个 browser scene 被既有 `cc.TiledLayer` / `cc.TiledMap` 缺类错误阻断，Vitest 结果为 1 failed。该错误发生在 preview ready 之后，与本 issue 的 scene worker startup timeout 不同；对应 evidence 为 `E:\own_space\engines\cocos-test-projects\temp\runtime-preview-cli-generated-output-scene-d3fc11bc-05dc-4e60-bc4f-f682fa74e8b6.json`。

本轮没有启动或停止 `feature-c`，也没有修改其项目文件。真实项目 production 验收仍需在用户下一次自行启动更新后的 `dist` 后确认 scene worker 可以越过原 30 秒点并最终 ready，因此 issue 暂不标 `fixed`。
