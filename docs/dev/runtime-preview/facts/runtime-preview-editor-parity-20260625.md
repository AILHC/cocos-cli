# Runtime preview Editor parity 事实记录

## 范围

本文记录 `RP-ISSUE-007` 与 `RP-ISSUE-019` 的 Editor / CLI 对齐事实。结论只覆盖本轮验证到的 root template、Default device、preview prerequisite imports、browser debug evidence 和主测试项目 `TestBundleZip` scene。

## Editor baseline

- Editor：Cocos Creator 3.8.6。
- Project：`E:\own_space\engines\cocos-test-projects`。
- Preview URL：`http://localhost:7457/`。
- Capture timestamp：`20260625122226`。
- root `/`：使用项目 `preview-template/index.ejs`。
- root title：`Cocos Creator - cocos-test-projects`。
- `/settings.js`：`engine.debug === true`，`engine.platform === "web-desktop"`。
- prerequisite import：`cce:/internal/x/prerequisite-imports` 映射到 preview target chunk。
- prerequisite chunk URL：`http://localhost:7457/scripting/x/chunks/6d/6d8fd2b0177941b032ddc0733af48a561fb60657.js`。
- prerequisite chunk status：`200`。
- prerequisite chunk shape：`System.register([...deps], ...)` static dependency array。
- sequential dynamic import：未发现 `await import(`、`() => import(`、`const requests`、`for (const request`。
- prerequisite dependency token count：`233`。

## CLI validation

- CLI command：`C:\nvm4w\nodejs\node.exe E:\own_space\engines\cocos-cli\dist\cli.js preview --project E:\own_space\engines\cocos-test-projects --runtime --host 127.0.0.1 --port 19531 --scene ea53723b-fbb6-46f9-bf18-eaf73a330fae`。
- Server URL：`http://127.0.0.1:19531`。
- Log file：`E:\own_space\engines\cocos-test-projects\temp\preview-logs\runtime-preview-20260625-122952.log`。
- Scene：`ea53723b-fbb6-46f9-bf18-eaf73a330fae`，`db://assets/cases/asset/asset-bundle-zip.scene`。
- root `/`：使用项目 `preview-template/index.ejs`，boot script 来自 CLI `static/runtime-preview/script.ejs`。
- project template sidecar：`/test.js` 从 `<project>/preview-template/test.js` 安全提供；`.ejs` 不作为静态文件暴露。
- `/settings.js`：`engine.debug === true`，`engine.platform === "web-desktop"`。
- prerequisite import-map：`E:\own_space\engines\cocos-test-projects\temp\cli\programming\packer-driver\targets\preview\import-map.json`。
- prerequisite chunk：`E:\own_space\engines\cocos-test-projects\temp\cli\programming\packer-driver\targets\preview\chunks\6d\6d8fd2b0177941b032ddc0733af48a561fb60657.js`。
- prerequisite dependency count：`233`。
- prerequisite unresolved mapping count：`233`。
- Browser smoke：ready timeout `120000ms`，stable window `10000ms`。
- Browser smoke result：`status=pass`，`elapsedReadyMs=3896`，`networkRequestCount=397`。
- Browser errors：`consoleErrorCount=0`、`unhandledRejectionCount=0`、`pageErrorCount=0`、`failedRequestCount=0`、`badResponseCount=0`。

## 分辨率与截图证据

- Editor browser debug：`E:\own_space\engines\cocos-cli\.codex-tmp\editor-preview-capture-final\editor-browser-debug-http-3A-2F-2Flocalhost-3A7457-2F-1280x720-20260625122226.json`。
- Editor screenshot：`E:\own_space\engines\cocos-cli\.codex-tmp\editor-preview-capture-final\editor-root-http-3A-2F-2Flocalhost-3A7457-2F-1280x720-20260625122226.png`。
- Editor canvas backing store：`300x150`，DPR `1`。
- CLI browser debug：`E:\own_space\engines\cocos-test-projects\temp\runtime-preview-main-test-project-cli-test-bundle-zip-scene.json#canvasDebugEvidence`。
- CLI screenshot：`E:\own_space\engines\cocos-test-projects\temp\cli-main-test-project-ea53723b-fbb6-46f9-bf18-eaf73a330fae-1280x720-20260625043002128.png`。
- CLI viewport：`764x485`，DPR `1`。
- CLI `#GameCanvas` rect：`960x640`。
- CLI canvas backing store：`960x640`。

## Evidence summary

```json
{
  "summary": "E:\\own_space\\engines\\cocos-test-projects\\temp\\runtime-preview-main-test-project-cli-evidence.json",
  "scene": "E:\\own_space\\engines\\cocos-test-projects\\temp\\runtime-preview-main-test-project-cli-test-bundle-zip-scene.json",
  "editor": "E:\\own_space\\engines\\cocos-cli\\.codex-tmp\\editor-preview-capture-final\\editor-browser-debug-http-3A-2F-2Flocalhost-3A7457-2F-1280x720-20260625122226.json",
  "serverUrl": "http://127.0.0.1:19531",
  "elapsedStartupMs": 17504,
  "elapsedReadyMs": 3896,
  "networkRequestCount": 397,
  "cliScreenshot": "E:\\own_space\\engines\\cocos-test-projects\\temp\\cli-main-test-project-ea53723b-fbb6-46f9-bf18-eaf73a330fae-1280x720-20260625043002128.png",
  "editorScreenshot": "E:\\own_space\\engines\\cocos-cli\\.codex-tmp\\editor-preview-capture-final\\editor-root-http-3A-2F-2Flocalhost-3A7457-2F-1280x720-20260625122226.png",
  "cliCanvasWidth": 960,
  "cliCanvasHeight": 640,
  "editorCanvasWidth": 300,
  "editorCanvasHeight": 150,
  "cliDpr": 1,
  "editorDpr": 1,
  "editorPrereqStatus": 200,
  "prereqDeps": 233,
  "prereqUnresolved": 233
}
```

## 结论

- `RP-ISSUE-007` 本轮解决的是 CLI preview target sequential dynamic import 与 Editor preview static deps 不一致；不是引入全并发加载策略。
- `RP-ISSUE-019` 本轮覆盖 project `preview-template/index.ejs`、project template sidecar `/test.js`、CLI boot script、settings debug/platform、Default device 实际浏览器尺寸证据和截图证据。
- 本文不能代表 runtime preview 全量完成；pack / redirect / extension runtime trigger、编译性能指标、source `.meta` 写回 parity 等仍由各自 issue 和 acceptance row 跟踪。
