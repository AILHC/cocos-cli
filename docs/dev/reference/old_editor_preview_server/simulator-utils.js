{ copyDirSync: function copyDirSync(path, dest) {
    if (!(0, fs_extra_1.existsSync)(path)) {
        return 0;
    }
    const stat = (0, fs_extra_1.statSync)(path);
    if (!stat.isDirectory()) {
        (0, fs_extra_1.ensureDirSync)((0, path_1.dirname)(dest));
        return (0, fs_extra_1.copyFileSync)(path, dest);
    }
    // 文件夹
    const files = (0, fs_extra_1.readdirSync)(path);
    (0, fs_extra_1.ensureDirSync)(dest);
    files.forEach((fileName) => {
        const file = (0, path_1.join)(path, fileName);
        const fileDest = (0, path_1.join)(dest, fileName);
        copyDirSync(file, fileDest);
    });
}, formatPath: function formatPath(pathToFormat) {
    return pathToFormat.replace(/\\/g, '/');
}, getNativeEnginePath: async function getNativeEnginePath() {
    return (await Editor.Message.request('engine', 'query-engine-info')).native.path;
}, getJsEnginePath: async function getJsEnginePath() {
    return (await Editor.Message.request('engine', 'query-engine-info')).typescript.path;
}, getSimulatorPreference: async function getSimulatorPreference() {
    var _a;
    const showDebugPanel = await Editor.Profile.getConfig('preview', 'preview.simulator_debugger');
    let waitForConnect = false;
    if (showDebugPanel) {
        waitForConnect = await Editor.Profile.getConfig('preview', 'preview.wait_for_connect');
    }
    const orientation = await Editor.Profile.getConfig('preview', 'preview.simulator_orientation');
    const device = await Editor.Message.request('device', 'query');
    const resolutionIndex = await Editor.Profile.getConfig('preview', 'preview.simulator_resolution');
    const resolution = (_a = device[resolutionIndex]) !== null && _a !== void 0 ? _a : device[0];
    return {
        showDebugPanel,
        waitForConnect,
        orientation,
        resolution,
    };
}, generateSimulatorConfig: async function generateSimulatorConfig() {
    // 路径处理
    const isDarwin = process.platform === 'darwin';
    const nativeEnginePath = await getNativeEnginePath();
    const simulatorResourcesMac = (0, path_1.join)(nativeEnginePath, 'simulator/Release/SimulatorApp-Mac.app/Contents/Resources');
    const simulatorWritablePath = isDarwin ? simulatorResourcesMac : (0, path_1.join)(process.env.LOCALAPPDATA, 'SimulatorApp-Win32/debugruntime');
    // 偏好设置
    const preference = await getSimulatorPreference();
    // 写入 JSON
    (0, fs_extra_1.ensureDirSync)(simulatorWritablePath);
    const simulatorConfigPath = (0, path_1.join)(simulatorWritablePath, 'config.json');
    const simulatorConfigData = {
        name: 'Simulator',
        entry: 'main.js',
        isLandscape: preference.orientation === 'landscape',
        isWindowTop: false,
        waitForConnect: preference.waitForConnect,
        width: preference.resolution.width,
        height: preference.resolution.height,
        consolePort: 6050,
        uploadPort: 6060,
        debugPort: 5086,
    };
    await (0, fs_extra_1.writeFile)(simulatorConfigPath, JSON.stringify(simulatorConfigData, undefined, 2), 'utf8');
} }