import {
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    readdirSync,
    rmSync,
    writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';

const JSZip = require('jszip');
const { publishReleaseWithOptions } = require('../../../workflow/release-packages.js');

const REQUIRED_TOOL_DIRS = [
    'creator-3.8.6/PVRTexTool_win32',
    'PVRTexTool_win32',
    'libwebp_win32',
    'mali_win32',
    'astc-encoder',
    'cmft',
    'LightFX',
    'lightmap-tools',
    'cmake',
    'keystore',
];

function writeJson(file: string, data: Record<string, unknown>): void {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function writeText(file: string, content: string): void {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, content, 'utf8');
}

function createFixture(repoRoot: string): void {
    writeJson(join(repoRoot, 'package.json'), {
        name: 'cocos-cli',
        version: '1.2.3',
        main: 'dist/index.js',
        bin: { cocos: './dist/cli.js' },
        scripts: { cli: 'node ./dist/cli.js', postinstall: 'node workflow/postinstall.js' },
        dependencies: {
            cc: 'file:./packages/cc-module',
            '@cocos/asset-db': 'file:./packages/asset-db',
        },
        devDependencies: { jest: '^29.7.0' },
    });
    writeJson(join(repoRoot, 'package-lock.json'), { packages: {} });
    writeText(join(repoRoot, 'docs', 'usage.md'), '# usage\n');
    writeText(join(repoRoot, 'dist', 'cli.js'), 'console.log("cli");\n');
    writeText(join(repoRoot, 'static', 'keep.txt'), 'keep\n');
    for (const toolDir of REQUIRED_TOOL_DIRS) {
        writeText(join(repoRoot, 'static', 'tools', toolDir, 'fixture.txt'), 'tool\n');
    }
    writeText(join(repoRoot, 'static', 'node_modules', 'skip.txt'), 'skip\n');
    writeText(join(repoRoot, 'packages', 'cc-module', 'index.js'), 'module.exports = {};\n');
    writeText(join(repoRoot, 'packages', 'asset-db', 'index.js'), 'module.exports = {};\n');
    writeText(join(repoRoot, 'packages', 'engine-compiler', 'dist', 'index.js'), 'module.exports = {};\n');
    writeText(join(repoRoot, 'packages', 'engine', 'skip.txt'), 'skip\n');
    writeText(join(repoRoot, 'workflow', 'tools-runtime-scripts', 'install-cocos-cli.cmd'), '@echo off\r\n');
    writeText(join(repoRoot, 'workflow', 'tools-runtime-scripts', 'preview-runtime.cmd'), '@echo off\r\n');
    writeText(join(repoRoot, 'workflow', 'tools-runtime-scripts', 'compile-engine.cmd'), '@echo off\r\n');
}

async function readZipEntries(file: string): Promise<Map<string, Buffer>> {
    const zip = await JSZip.loadAsync(readFileSync(file));
    const entries = new Map<string, Buffer>();
    await Promise.all(Object.entries(zip.files).map(async ([name, entry]: [string, any]) => {
        if (!entry.dir) {
            entries.set(name.replace(/\\/g, '/'), await entry.async('nodebuffer'));
        }
    }));
    return entries;
}

function releaseOptions(repoRoot: string, publishRoot: string): Record<string, unknown> {
    return {
        repoRoot,
        publishRoot,
        getNpmVersion: () => '10.9.2',
        runNpmLockfileInstall: (runtimeRoot: string) => {
            writeJson(join(runtimeRoot, 'package-lock.json'), { packages: { '': {} } });
        },
    };
}

describe('release package', () => {
    let fixtureRoot: string;
    let repoRoot: string;
    let publishRoot: string;

    beforeEach(() => {
        fixtureRoot = mkdtempSync(join(tmpdir(), 'cocos-cli-release-'));
        repoRoot = join(fixtureRoot, 'repo');
        publishRoot = join(repoRoot, 'publish');
        createFixture(repoRoot);
    });

    afterEach(() => {
        rmSync(fixtureRoot, { recursive: true, force: true });
    });

    it('publishes one versioned archive containing the runtime and static tools', async () => {
        const result = await publishReleaseWithOptions(releaseOptions(repoRoot, publishRoot));
        expect(result).toEqual({
            cliArchive: join(publishRoot, 'cocos-cli-v1.2.3.zip'),
            cliVersion: '1.2.3',
        });

        const entries = await readZipEntries(result.cliArchive);
        expect(entries.has('cocos-cli/dist/cli.js')).toBe(true);
        expect(entries.has('cocos-cli/static/keep.txt')).toBe(true);
        expect(entries.has('cocos-cli/static/tools/PVRTexTool_win32/fixture.txt')).toBe(true);
        expect(entries.has('cocos-cli/install-cocos-cli.cmd')).toBe(true);
        expect(entries.has('cocos-cli/preview-runtime.cmd')).toBe(true);
        expect([...entries.keys()].some((name) => name.includes('/node_modules/'))).toBe(false);
        expect([...entries.keys()].some((name) => name.startsWith('cocos-cli/packages/engine/'))).toBe(false);

        const runtimePackage = JSON.parse(entries.get('cocos-cli/package.json')!.toString('utf8'));
        expect(runtimePackage.devDependencies).toBeUndefined();
        expect(runtimePackage.scripts.postinstall).toBeUndefined();
        expect(runtimePackage.staticToolsVersion).toBeUndefined();
    });

    it('rejects an existing version and allows a new CLI version', async () => {
        const options = releaseOptions(repoRoot, publishRoot);
        await publishReleaseWithOptions(options);
        await expect(publishReleaseWithOptions(options)).rejects.toThrow('CLI release archive already exists');

        const sourcePackage = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));
        sourcePackage.version = '1.2.4';
        writeJson(join(repoRoot, 'package.json'), sourcePackage);
        const result = await publishReleaseWithOptions(options);
        expect(result.cliArchive).toBe(join(publishRoot, 'cocos-cli-v1.2.4.zip'));
    });

    it('does not leave a partial archive when packaging fails', async () => {
        const options = {
            ...releaseOptions(repoRoot, publishRoot),
            zipArchive: async () => {
                throw new Error('zip failed');
            },
        };
        await expect(publishReleaseWithOptions(options)).rejects.toThrow('zip failed');
        expect(existsSync(join(publishRoot, 'cocos-cli-v1.2.3.zip'))).toBe(false);
        expect(readdirSync(publishRoot).filter((name) => name.includes('.partial.zip'))).toEqual([]);
    });

    it('publishes directly to .user.json releaseDirectPath without creating a zip', async () => {
        const directPath = join(fixtureRoot, 'direct-out');
        writeJson(join(repoRoot, '.user.json'), { releaseDirectPath: directPath });

        const result = await publishReleaseWithOptions(releaseOptions(repoRoot, publishRoot));
        expect(result).toEqual({ cliDirectory: directPath, cliVersion: '1.2.3' });
        expect(existsSync(join(directPath, 'dist', 'cli.js'))).toBe(true);
        expect(existsSync(join(directPath, 'static', 'keep.txt'))).toBe(true);
        expect(existsSync(join(directPath, 'install-cocos-cli.cmd'))).toBe(true);
        expect(existsSync(join(directPath, 'docs', 'usage.md'))).toBe(true);
        expect(existsSync(join(publishRoot, 'cocos-cli-v1.2.3.zip'))).toBe(false);

        // 直出模式允许同版本重复发布：目标目录被整体替换
        writeText(join(directPath, 'stale.txt'), 'stale\n');
        await publishReleaseWithOptions(releaseOptions(repoRoot, publishRoot));
        expect(existsSync(join(directPath, 'stale.txt'))).toBe(false);
        expect(existsSync(join(directPath, 'dist', 'cli.js'))).toBe(true);
    });

    it('rejects .user.json releaseDirectPath pointing at the repository root', async () => {
        writeJson(join(repoRoot, '.user.json'), { releaseDirectPath: '.' });
        await expect(publishReleaseWithOptions(releaseOptions(repoRoot, publishRoot)))
            .rejects.toThrow('must not be the repository root');
    });
});
