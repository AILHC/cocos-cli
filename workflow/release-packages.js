const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const sevenBin = require('7zip-bin');
const { zipArchive } = require('./utils');
const { _internals: releaseToolsInternals } = require('./release-tools');

const REPO_ROOT = path.resolve(__dirname, '..');

function readJson(file) {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function assertVersion(value) {
    if (typeof value !== 'string' || !/^[0-9A-Za-z][0-9A-Za-z._-]*$/.test(value)) {
        throw new Error('CLI package version must be a non-empty filename-safe string');
    }
}

function assertArchive(archivePath) {
    const result = spawnSync(sevenBin.path7za, ['t', archivePath], {
        encoding: 'utf8',
        windowsHide: true,
    });
    if (result.error) {
        throw result.error;
    }
    if (result.status !== 0) {
        const output = `${result.stdout || ''}${result.stderr || ''}`.trim();
        throw new Error(`Archive validation failed: ${path.basename(archivePath)}${output ? `\n${output}` : ''}`);
    }
}

function readUserReleaseConfig(repoRoot) {
    // .user.json 是仓库本地、被 .gitignore 忽略的个人配置入口；
    // releaseDirectPath 配置后发布直出目录、不再生成 zip。
    const configPath = path.join(repoRoot, '.user.json');
    if (!fs.existsSync(configPath)) {
        return {};
    }
    return JSON.parse(fs.readFileSync(configPath, 'utf8'));
}

function resolveReleaseDirectPath(repoRoot, value) {
    if (value === undefined || value === null) {
        return null;
    }
    if (typeof value !== 'string' || value.trim() === '') {
        throw new Error('.user.json releaseDirectPath must be a non-empty path string');
    }
    const resolved = path.resolve(repoRoot, value);
    if (resolved === repoRoot) {
        throw new Error('.user.json releaseDirectPath must not be the repository root');
    }
    return resolved;
}

async function publishReleaseWithOptions(options = {}) {
    const repoRoot = path.resolve(options.repoRoot || REPO_ROOT);
    const publishRoot = path.resolve(options.publishRoot || path.join(repoRoot, 'publish'));
    const archive = options.zipArchive || zipArchive;
    const sourcePackage = readJson(path.join(repoRoot, 'package.json'));
    assertVersion(sourcePackage.version);

    const cliArchive = path.join(publishRoot, `cocos-cli-v${sourcePackage.version}.zip`);
    const directPath = resolveReleaseDirectPath(repoRoot, readUserReleaseConfig(repoRoot).releaseDirectPath);
    if (!directPath && fs.existsSync(cliArchive)) {
        throw new Error(`CLI release archive already exists: ${cliArchive}`);
    }

    fs.mkdirSync(publishRoot, { recursive: true });
    const stagingRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cocos-cli-release-'));
    const partialArchive = path.join(
        publishRoot,
        `.cocos-cli-v${sourcePackage.version}.${process.pid}-${Date.now()}.partial.zip`,
    );

    try {
        const runtimeRoot = path.join(stagingRoot, 'cocos-cli');
        releaseToolsInternals.releaseToolsWithOptions(runtimeRoot, {
            repoRoot,
            getNpmVersion: options.getNpmVersion,
            runNpmLockfileInstall: options.runNpmLockfileInstall,
        });
        if (directPath) {
            fs.rmSync(directPath, { recursive: true, force: true });
            fs.cpSync(runtimeRoot, directPath, { recursive: true });
            return { cliDirectory: directPath, cliVersion: sourcePackage.version };
        }
        await archive(stagingRoot, partialArchive, { compressionLevel: 9, preserveSymlinks: false });
        assertArchive(partialArchive);
        fs.renameSync(partialArchive, cliArchive);
        return { cliArchive, cliVersion: sourcePackage.version };
    } finally {
        fs.rmSync(partialArchive, { force: true });
        fs.rmSync(stagingRoot, { recursive: true, force: true });
    }
}

async function main() {
    const result = await publishReleaseWithOptions();
    if (result.cliDirectory) {
        console.log(`CLI directory: ${result.cliDirectory}`);
    } else {
        console.log(`CLI archive: ${result.cliArchive}`);
    }
}

if (require.main === module) {
    main().catch((error) => {
        console.error(error && error.message ? error.message : error);
        process.exit(1);
    });
}

module.exports = {
    publishReleaseWithOptions,
    _internals: {
        assertArchive,
    },
};
