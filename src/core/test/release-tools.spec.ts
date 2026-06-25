import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';

const {
    createRuntimePackageJson,
    assertNoLocalAbsolutePaths,
    assertRuntimeLockfile,
    assertReleaseDirectory,
    renderReadme,
    _internals,
} = require('../../../workflow/release-tools.js');

function writeJson(file: string, data: Record<string, unknown>): void {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}

function writeText(file: string, content: string): void {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, content, 'utf8');
}

function createDir(path: string): string {
    mkdirSync(path, { recursive: true });
    return path;
}

function createReleaseSourceFixture(repoRoot: string): void {
    writeJson(join(repoRoot, 'package.json'), {
        name: 'cocos-cli',
        version: '1.2.3',
        main: 'dist/index.js',
        bin: {
            cocos: './dist/cli.js',
        },
        scripts: {
            cli: 'node ./dist/cli.js',
            postinstall: 'node workflow/postinstall.js',
        },
        dependencies: {
            cc: 'file:./packages/cc-module',
            '@cocos/asset-db': 'file:./packages/asset-db',
        },
        devDependencies: {
            jest: '^29.7.0',
        },
    });
    writeText(join(repoRoot, 'dist', 'cli.js'), 'console.log("cli");\n');
    writeText(join(repoRoot, 'static', 'keep.txt'), 'static\n');
    writeText(join(repoRoot, 'static', 'node_modules', 'stale.txt'), 'skip\n');
    writeText(join(repoRoot, 'packages', 'cc-module', 'index.js'), 'module.exports = {};\n');
    writeText(join(repoRoot, 'packages', 'cc-module', 'node_modules', 'skip.txt'), 'skip\n');
    writeText(join(repoRoot, 'packages', 'asset-db', 'index.js'), 'module.exports = {};\n');
    writeText(join(repoRoot, 'packages', 'engine', 'index.js'), 'engine\n');
    for (const toolDir of [
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
    ]) {
        writeText(join(repoRoot, toolDir, '.keep'), 'tool\n');
    }
}

function releaseToolsFixture(targetRoot: string, repoRoot: string): void {
    _internals.releaseToolsWithOptions(targetRoot, {
        repoRoot,
        getNpmVersion: () => '10.9.2',
        runNpmLockfileInstall: (runtimeRoot: string) => {
            writeJson(join(runtimeRoot, 'package-lock.json'), {
                packages: {
                    '': {},
                },
            });
        },
    });
}

describe('release tools workflow helpers', () => {
    let fixtureRoot: string;

    beforeEach(() => {
        fixtureRoot = mkdtempSync(join(tmpdir(), 'cocos-cli-release-tools-'));
    });

    afterEach(() => {
        rmSync(fixtureRoot, { recursive: true, force: true });
    });

    it('creates a runtime package without root install hooks or development dependencies', () => {
        const runtimePackage = createRuntimePackageJson({
            name: 'cocos-cli',
            version: '1.2.3',
            main: 'dist/index.js',
            bin: {
                cocos: './dist/cli.js',
            },
            scripts: {
                cli: 'node ./dist/cli.js',
                postinstall: 'node workflow/postinstall.js',
                test: 'jest',
            },
            dependencies: {
                cc: 'file:./packages/cc-module',
                '@cocos/asset-db': 'file:./packages/asset-db',
                commander: '^11.0.0',
            },
            devDependencies: {
                jest: '^29.7.0',
            },
            overrides: {
                fsevents: '2.3.3',
            },
        });

        expect(runtimePackage).toEqual({
            name: 'cocos-cli',
            version: '1.2.3',
            main: 'dist/index.js',
            bin: {
                cocos: './dist/cli.js',
            },
            scripts: {
                cli: 'node ./dist/cli.js',
            },
            dependencies: {
                cc: 'file:./packages/cc-module',
                '@cocos/asset-db': 'file:./packages/asset-db',
                commander: '^11.0.0',
            },
            overrides: {
                fsevents: '2.3.3',
            },
        });
    });

    it('rejects only root install script metadata in a runtime lockfile', () => {
        expect(() => assertRuntimeLockfile({
            packages: {
                '': {
                    hasInstallScript: true,
                },
            },
        })).toThrow('Runtime lockfile root package must not have install script metadata');

        expect(() => assertRuntimeLockfile({
            packages: {
                '': {},
                'node_modules/sharp': {
                    hasInstallScript: true,
                },
            },
        })).not.toThrow();
    });

    it('rejects local absolute paths while accepting placeholders', () => {
        expect(() => assertNoLocalAbsolutePaths('<p6Root>/tools/cocos-cli\n<projectRoot>\n<engineRoot>\n<port>')).not.toThrow();

        const drivePath = `${'D:'}/workspace/cocos-cli`;
        const windowsDrivePath = `${'D:'}\\workspace\\cocos-cli`;
        const uncPath = ['', '', 'server', 'share', 'cocos-cli'].join('\\\\'.slice(0, 1));

        expect(() => assertNoLocalAbsolutePaths(drivePath)).toThrow('Local absolute path is not allowed');
        expect(() => assertNoLocalAbsolutePaths(windowsDrivePath)).toThrow('Local absolute path is not allowed');
        expect(() => assertNoLocalAbsolutePaths(uncPath)).toThrow('UNC path is not allowed');
        expect(() => assertNoLocalAbsolutePaths(`path=${uncPath}`)).toThrow('UNC path is not allowed');
        expect(() => assertNoLocalAbsolutePaths(`\`${uncPath}\``)).toThrow('UNC path is not allowed');
        expect(() => assertNoLocalAbsolutePaths(`路径：${uncPath}`)).toThrow('UNC path is not allowed');
    });

    it('renders a Chinese README with runtime metadata and diagnostics', () => {
        const readme = renderReadme({
            nodeVersion: 'v22.17.0',
            npmVersion: '10.9.2',
        });

        expect(readme).toContain('Node.js: v22.17.0');
        expect(readme).toContain('npm: 10.9.2');
        expect(readme).toContain('npm install');
        expect(readme).toContain('node .\\dist\\cli.js --help');
        expect(readme).toContain('preview --runtime');
        expect(readme).toContain('cocos-cli.enginePath');
        expect(readme).toContain('cliInitializedEngineRoot');
        expect(readme).toContain('Creator profile custom engine');
        expect(readme).toContain('3.8.6');
        expect(readme).toContain('profile 缺失');
        expect(readme).toContain('builtin engine');
        expect(readme).toContain('engine path 不存在');
        expect(readme).toContain('依赖未安装');
        expect(readme).toContain('端口占用');
        expect(() => assertNoLocalAbsolutePaths(readme)).not.toThrow();
    });

    it('validates a complete release directory and rejects bundled engine source', () => {
        const targetRoot = createDir(join(fixtureRoot, 'tools', 'cocos-cli'));
        writeText(join(targetRoot, '.gitignore'), 'node_modules/\n');
        writeJson(join(targetRoot, 'package.json'), {
            name: 'cocos-cli',
            version: '1.2.3',
            scripts: {
                cli: 'node ./dist/cli.js',
            },
            dependencies: {
                cc: 'file:./packages/cc-module',
                '@cocos/asset-db': 'file:./packages/asset-db',
            },
        });
        writeJson(join(targetRoot, 'package-lock.json'), {
            packages: {
                '': {},
                'node_modules/sharp': {
                    hasInstallScript: true,
                },
            },
        });
        createDir(join(targetRoot, 'packages', 'asset-db'));
        createDir(join(targetRoot, 'packages', 'cc-module'));
        for (const toolDir of [
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
        ]) {
            createDir(join(targetRoot, toolDir));
        }

        expect(() => assertReleaseDirectory(targetRoot)).not.toThrow();

        const nestedNodeModules = createDir(join(targetRoot, 'packages', 'cc-module', 'node_modules'));
        expect(() => assertReleaseDirectory(targetRoot)).toThrow('Release directory must not include node_modules');
        rmSync(nestedNodeModules, { recursive: true, force: true });

        createDir(join(targetRoot, 'packages', 'engine'));
        expect(() => assertReleaseDirectory(targetRoot)).toThrow('Release directory must not include packages/engine');
    });

    it('clears stale target content before writing release output', () => {
        const repoRoot = createDir(join(fixtureRoot, 'repo'));
        const targetRoot = createDir(join(fixtureRoot, 'target'));
        createReleaseSourceFixture(repoRoot);
        writeText(join(targetRoot, 'old.txt'), 'old\n');
        writeText(join(targetRoot, 'node_modules', 'stale.txt'), 'stale\n');
        writeText(join(targetRoot, 'packages', 'engine', 'stale.txt'), 'stale\n');

        releaseToolsFixture(targetRoot, repoRoot);

        expect(() => assertReleaseDirectory(targetRoot)).not.toThrow();
        expect(existsSync(join(targetRoot, 'old.txt'))).toBe(false);
        expect(existsSync(join(targetRoot, 'node_modules'))).toBe(false);
        expect(existsSync(join(targetRoot, 'packages', 'engine'))).toBe(false);
        expect(existsSync(join(targetRoot, 'dist', 'cli.js'))).toBe(true);
    });

    it('rejects an unsafe target equal to the repo root before deletion', () => {
        const repoRoot = createDir(join(fixtureRoot, 'repo'));
        createReleaseSourceFixture(repoRoot);
        writeText(join(repoRoot, 'marker.txt'), 'keep\n');

        expect(() => releaseToolsFixture(repoRoot, repoRoot)).toThrow('Release target must not be the repository root');
        expect(existsSync(join(repoRoot, 'marker.txt'))).toBe(true);
    });

    it('rejects an unsafe target that is an ancestor of the repo root before deletion', () => {
        const parentRoot = createDir(join(fixtureRoot, 'parent'));
        const repoRoot = createDir(join(parentRoot, 'repo'));
        createReleaseSourceFixture(repoRoot);
        writeText(join(parentRoot, 'marker.txt'), 'keep\n');

        expect(() => releaseToolsFixture(parentRoot, repoRoot)).toThrow('Release target must not be an ancestor of the repository root');
        expect(existsSync(join(parentRoot, 'marker.txt'))).toBe(true);
    });

    it('rejects arbitrary repo child targets before deletion', () => {
        const repoRoot = createDir(join(fixtureRoot, 'repo'));
        createReleaseSourceFixture(repoRoot);

        for (const childDir of ['src', 'workflow']) {
            const targetRoot = createDir(join(repoRoot, childDir));
            writeText(join(targetRoot, 'marker.txt'), 'keep\n');

            expect(() => releaseToolsFixture(targetRoot, repoRoot)).toThrow('Release target must not be inside the repository root');
            expect(existsSync(join(targetRoot, 'marker.txt'))).toBe(true);
        }
    });

    it('rejects an unsafe target inside a copied source tree', () => {
        const repoRoot = createDir(join(fixtureRoot, 'repo'));
        createReleaseSourceFixture(repoRoot);
        const targetRoot = join(repoRoot, 'static', 'release-target');

        expect(() => releaseToolsFixture(targetRoot, repoRoot)).toThrow('Release target must not be inside a copied source entry');
    });

    it('excludes nested node_modules and packages/engine while copying release entries', () => {
        const repoRoot = createDir(join(fixtureRoot, 'repo'));
        const targetRoot = createDir(join(fixtureRoot, 'target'));
        createReleaseSourceFixture(repoRoot);

        releaseToolsFixture(targetRoot, repoRoot);

        expect(() => assertReleaseDirectory(targetRoot)).not.toThrow();
        expect(existsSync(join(targetRoot, 'static', 'node_modules'))).toBe(false);
        expect(existsSync(join(targetRoot, 'packages', 'cc-module', 'node_modules'))).toBe(false);
        expect(existsSync(join(targetRoot, 'packages', 'engine'))).toBe(false);
    });
});
