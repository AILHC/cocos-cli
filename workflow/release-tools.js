const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');
const RUNTIME_SCRIPT_ALLOWLIST = ['cli'];
const COPY_ENTRIES = [
    ['dist'],
    ['docs', 'usage.md'],
    ['static'],
    ['packages', 'cc-module'],
    ['packages', 'asset-db'],
];
const REQUIRED_TOOL_DIRS = [
    'static/tools/creator-3.8.6/PVRTexTool_win32',
    'static/tools/PVRTexTool_win32',
    'static/tools/libwebp_win32',
    'static/tools/mali_win32',
    'static/tools/astc-encoder',
    'static/tools/cmft',
    'static/tools/LightFX',
    'static/tools/lightmap-tools',
    'static/tools/cmake',
    'static/tools/keystore',
];

function cloneJsonValue(value) {
    if (value === undefined) {
        return undefined;
    }
    return JSON.parse(JSON.stringify(value));
}

function addRuntimePeerResolutionDependencies(runtimePackage, sourceLockfile) {
    const dependencies = runtimePackage.dependencies;
    if (!dependencies || !dependencies['@cocos/lib-programming'] || dependencies['@babel/preset-env']) {
        return;
    }

    const presetEnvPackage = sourceLockfile
        && sourceLockfile.packages
        && sourceLockfile.packages['node_modules/@babel/preset-env'];
    if (presetEnvPackage && presetEnvPackage.version) {
        dependencies['@babel/preset-env'] = presetEnvPackage.version;
    }
}

function createRuntimePackageJson(sourcePackage, sourceLockfile) {
    const runtimePackage = {};
    for (const key of ['name', 'version', 'main', 'bin', 'dependencies', 'overrides']) {
        if (Object.prototype.hasOwnProperty.call(sourcePackage, key)) {
            runtimePackage[key] = cloneJsonValue(sourcePackage[key]);
        }
    }

    const scripts = {};
    for (const key of RUNTIME_SCRIPT_ALLOWLIST) {
        if (sourcePackage.scripts && Object.prototype.hasOwnProperty.call(sourcePackage.scripts, key)) {
            scripts[key] = sourcePackage.scripts[key];
        }
    }
    if (Object.keys(scripts).length > 0) {
        runtimePackage.scripts = scripts;
    }

    addRuntimePeerResolutionDependencies(runtimePackage, sourceLockfile);
    return runtimePackage;
}

function assertNoLocalAbsolutePaths(content) {
    const text = String(content);
    if (/(^|[^\w])([A-Za-z]:[\\/])/.test(text)) {
        throw new Error('Local absolute path is not allowed');
    }
    if (/\\\\[^\\/\s`"'<>]+[\\/][^\\/\s`"'<>]+/.test(text)) {
        throw new Error('UNC path is not allowed');
    }
}

function assertRuntimeLockfile(lockfile) {
    const rootPackage = lockfile && lockfile.packages && lockfile.packages[''];
    if (rootPackage && rootPackage.hasInstallScript === true) {
        throw new Error('Runtime lockfile root package must not have install script metadata');
    }
}

function assertRuntimePackage(runtimePackage) {
    if (runtimePackage.scripts && runtimePackage.scripts.postinstall !== undefined) {
        throw new Error('Runtime package must not include scripts.postinstall');
    }
    if (runtimePackage.devDependencies !== undefined) {
        throw new Error('Runtime package must not include devDependencies');
    }
}

function readJson(file) {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function readJsonIfExists(file) {
    if (!fs.existsSync(file)) {
        return undefined;
    }
    return readJson(file);
}

function writeJson(file, data) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify(data, null, 4)}\n`, 'utf8');
}

function assertPathExists(targetRoot, relativePath, type) {
    const fullPath = path.join(targetRoot, relativePath);
    if (!fs.existsSync(fullPath)) {
        throw new Error(`Release directory is missing ${relativePath}`);
    }
    const stat = fs.statSync(fullPath);
    if (type === 'directory' && !stat.isDirectory()) {
        throw new Error(`Release path must be a directory: ${relativePath}`);
    }
    if (type === 'file' && !stat.isFile()) {
        throw new Error(`Release path must be a file: ${relativePath}`);
    }
}

function findDirectoryNamed(root, directoryName) {
    if (!fs.existsSync(root)) {
        return undefined;
    }
    const entries = fs.readdirSync(root, { withFileTypes: true });
    for (const entry of entries) {
        if (!entry.isDirectory()) {
            continue;
        }
        const entryPath = path.join(root, entry.name);
        if (entry.name === directoryName) {
            return entryPath;
        }
        const nestedMatch = findDirectoryNamed(entryPath, directoryName);
        if (nestedMatch) {
            return nestedMatch;
        }
    }
    return undefined;
}

function isPathInside(parent, child) {
    const relative = path.relative(path.resolve(parent), path.resolve(child));
    return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function isSamePath(left, right) {
    const resolvedLeft = path.resolve(left);
    const resolvedRight = path.resolve(right);
    if (process.platform === 'win32') {
        return resolvedLeft.toLowerCase() === resolvedRight.toLowerCase();
    }
    return resolvedLeft === resolvedRight;
}

function assertSafeReleaseTarget(targetRoot, repoRoot, copyEntries = COPY_ENTRIES) {
    const resolvedTargetRoot = path.resolve(targetRoot);
    const resolvedRepoRoot = path.resolve(repoRoot);
    if (isSamePath(resolvedTargetRoot, resolvedRepoRoot)) {
        throw new Error('Release target must not be the repository root');
    }
    if (isPathInside(resolvedTargetRoot, resolvedRepoRoot)) {
        throw new Error('Release target must not be an ancestor of the repository root');
    }
    for (const entry of copyEntries) {
        const sourceRoot = path.join(resolvedRepoRoot, ...entry);
        if (isSamePath(resolvedTargetRoot, sourceRoot) || isPathInside(sourceRoot, resolvedTargetRoot)) {
            throw new Error('Release target must not be inside a copied source entry');
        }
    }
    if (isPathInside(resolvedRepoRoot, resolvedTargetRoot)) {
        throw new Error('Release target must not be inside the repository root');
    }
}

function assertReleaseDirectory(targetRoot) {
    const resolvedTargetRoot = path.resolve(targetRoot);
    if (findDirectoryNamed(resolvedTargetRoot, 'node_modules')) {
        throw new Error('Release directory must not include node_modules');
    }
    if (fs.existsSync(path.join(resolvedTargetRoot, 'packages', 'engine'))) {
        throw new Error('Release directory must not include packages/engine');
    }

    assertPathExists(resolvedTargetRoot, '.gitignore', 'file');
    assertPathExists(resolvedTargetRoot, 'docs/usage.md', 'file');
    assertPathExists(resolvedTargetRoot, 'package.json', 'file');
    assertPathExists(resolvedTargetRoot, 'package-lock.json', 'file');
    assertPathExists(resolvedTargetRoot, 'packages/asset-db', 'directory');
    assertPathExists(resolvedTargetRoot, 'packages/cc-module', 'directory');

    for (const toolDir of REQUIRED_TOOL_DIRS) {
        assertPathExists(resolvedTargetRoot, toolDir, 'directory');
    }

    const gitignore = fs.readFileSync(path.join(resolvedTargetRoot, '.gitignore'), 'utf8');
    if (!/(^|\r?\n)node_modules\/(\r?\n|$)/.test(gitignore)) {
        throw new Error('Release .gitignore must contain node_modules/');
    }
    assertNoLocalAbsolutePaths(fs.readFileSync(path.join(resolvedTargetRoot, 'docs', 'usage.md'), 'utf8'));

    const runtimePackage = readJson(path.join(resolvedTargetRoot, 'package.json'));
    assertRuntimePackage(runtimePackage);
    const lockfile = readJson(path.join(resolvedTargetRoot, 'package-lock.json'));
    assertRuntimeLockfile(lockfile);
}

function renderReadme(metadata) {
    const readme = `# Cocos CLI tools runtime

本文档说明 \`<p6Root>/tools/cocos-cli\` 中的 Cocos CLI runtime 使用方式。当前支持的 Creator 版本为 \`3.8.6\`。

给 agent 使用的注意事项见 \`docs/usage.md\`；CLI help 已覆盖的参数说明不在该文档重复。

## 环境版本

- Node.js: ${metadata.nodeVersion}
- npm: ${metadata.npmVersion}

## 首次安装

在 \`<p6Root>/tools/cocos-cli\` 目录执行：

\`\`\`powershell
npm install
\`\`\`

查看 CLI 帮助：

\`\`\`powershell
node .\\dist\\cli.js --help
\`\`\`

runtime preview 示例：

\`\`\`powershell
node .\\dist\\cli.js preview --runtime --project <projectRoot> --port <port>
\`\`\`

## Engine 解析优先级

CLI 运行时按以下顺序解析 engine source：

1. project \`package.json\` 中的 \`cocos-cli.enginePath\`。
2. CLI 初始化链路传入的 \`cliInitializedEngineRoot\`。
3. Creator profile 中的 \`Creator profile custom engine\`。

示例路径请使用 \`<projectRoot>\`、\`<engineRoot>\`、\`<p6Root>\` 这类占位符替换为本机真实路径。

## 常见错误

- profile 缺失：确认 Creator profile 已生成并包含 \`3.8.6\` 对应配置。
- builtin engine：当前 workflow 需要 custom engine，不使用 Creator builtin engine。
- engine path 不存在：确认 \`cocos-cli.enginePath\`、\`cliInitializedEngineRoot\` 或 Creator profile custom engine 指向有效的 \`<engineRoot>\`。
- 依赖未安装：在 \`<p6Root>/tools/cocos-cli\` 执行 \`npm install\`。
- 端口占用：将 preview 端口改为未占用的 \`<port>\`。
`;
    assertNoLocalAbsolutePaths(readme);
    return readme;
}

function copyReleaseEntry(targetRoot, relativeParts, repoRoot = REPO_ROOT) {
    const source = path.join(repoRoot, ...relativeParts);
    const destination = path.join(targetRoot, ...relativeParts);
    if (!fs.existsSync(source)) {
        throw new Error(`Release source is missing: ${relativeParts.join('/')}`);
    }
    fs.rmSync(destination, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.cpSync(source, destination, {
        recursive: true,
        dereference: true,
        filter(sourcePath) {
            const relative = path.relative(repoRoot, sourcePath).replace(/\\/g, '/');
            if (/(^|\/)node_modules($|\/)/.test(relative)) {
                return false;
            }
            return relative !== 'packages/engine' && !relative.startsWith('packages/engine/');
        },
    });
}

function quoteWindowsCmdArg(arg) {
    const text = String(arg);
    if (text.length === 0) {
        return '""';
    }
    if (!/[\s"&()^|<>]/.test(text)) {
        return text;
    }
    return `"${text.replace(/"/g, '\\"')}"`;
}

function createNpmInvocation(npmArgs, platform = process.platform) {
    if (platform === 'win32') {
        return {
            command: 'cmd.exe',
            args: ['/d', '/s', '/c', ['npm', ...npmArgs].map(quoteWindowsCmdArg).join(' ')],
        };
    }
    return {
        command: 'npm',
        args: npmArgs,
    };
}

function runNpmCommand(npmArgs, options = {}) {
    const {
        platform = process.platform,
        spawnSync: spawnSyncImpl = spawnSync,
        ...spawnOptions
    } = options;
    const invocation = createNpmInvocation(npmArgs, platform);
    return spawnSyncImpl(invocation.command, invocation.args, {
        shell: false,
        ...spawnOptions,
    });
}

function getNpmVersionWithOptions(options = {}) {
    const result = runNpmCommand(['--version'], {
        platform: options.platform,
        spawnSync: options.spawnSync,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (result.error) {
        throw result.error;
    }
    if (result.status !== 0) {
        const stderr = result.stderr ? String(result.stderr).trim() : '';
        throw new Error(`npm --version failed with exit code ${result.status}${stderr ? `: ${stderr}` : ''}`);
    }
    return String(result.stdout || '').trim();
}

function getNpmVersion() {
    return getNpmVersionWithOptions();
}

function runNpmLockfileInstall(targetRoot) {
    const result = runNpmCommand(['install', '--package-lock-only', '--ignore-scripts'], {
        cwd: targetRoot,
        stdio: 'inherit',
    });
    if (result.error) {
        throw result.error;
    }
    if (result.status !== 0) {
        throw new Error(`npm install --package-lock-only --ignore-scripts failed with exit code ${result.status}`);
    }
}

function releaseToolsWithOptions(targetRoot, options = {}) {
    if (!targetRoot) {
        throw new Error('Missing required --target <path>');
    }

    const {
        repoRoot = REPO_ROOT,
        copyEntries = COPY_ENTRIES,
        getNpmVersion: getNpmVersionImpl = getNpmVersion,
        runNpmLockfileInstall: runNpmLockfileInstallImpl = runNpmLockfileInstall,
    } = options;
    const resolvedTargetRoot = path.resolve(targetRoot);
    const resolvedRepoRoot = path.resolve(repoRoot);
    assertSafeReleaseTarget(resolvedTargetRoot, resolvedRepoRoot, copyEntries);
    fs.rmSync(resolvedTargetRoot, { recursive: true, force: true });
    fs.mkdirSync(resolvedTargetRoot, { recursive: true });

    for (const entry of copyEntries) {
        copyReleaseEntry(resolvedTargetRoot, entry, resolvedRepoRoot);
    }

    const sourcePackage = readJson(path.join(resolvedRepoRoot, 'package.json'));
    const sourceLockfile = readJsonIfExists(path.join(resolvedRepoRoot, 'package-lock.json'));
    const runtimePackage = createRuntimePackageJson(sourcePackage, sourceLockfile);
    assertRuntimePackage(runtimePackage);
    writeJson(path.join(resolvedTargetRoot, 'package.json'), runtimePackage);
    fs.writeFileSync(path.join(resolvedTargetRoot, '.gitignore'), 'node_modules/\n', 'utf8');
    fs.writeFileSync(path.join(resolvedTargetRoot, 'README.md'), renderReadme({
        nodeVersion: process.version,
        npmVersion: getNpmVersionImpl(),
    }), 'utf8');

    runNpmLockfileInstallImpl(resolvedTargetRoot);
    assertReleaseDirectory(resolvedTargetRoot);
}

function releaseTools(targetRoot) {
    releaseToolsWithOptions(targetRoot);
}

function parseTargetArg(argv) {
    const index = argv.indexOf('--target');
    if (index === -1 || !argv[index + 1]) {
        return undefined;
    }
    return argv[index + 1];
}

if (require.main === module) {
    try {
        const targetRoot = parseTargetArg(process.argv.slice(2));
        if (!targetRoot) {
            console.error('Missing required --target <path>');
            process.exit(1);
        }
        releaseTools(targetRoot);
    } catch (error) {
        console.error(error && error.message ? error.message : error);
        process.exit(1);
    }
}

module.exports = {
    createRuntimePackageJson,
    assertNoLocalAbsolutePaths,
    assertRuntimeLockfile,
    assertReleaseDirectory,
    renderReadme,
    releaseTools,
    _internals: {
        assertSafeReleaseTarget,
        addRuntimePeerResolutionDependencies,
        copyReleaseEntry,
        createNpmInvocation,
        getNpmVersionWithOptions,
        isPathInside,
        runNpmCommand,
        releaseToolsWithOptions,
    },
};
