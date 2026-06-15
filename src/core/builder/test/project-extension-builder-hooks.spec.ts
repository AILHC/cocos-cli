import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { PluginManager } from '../manager/plugin';
import builderConfig from '../share/builder-config';

jest.mock('../../base/i18n', () => {
    const mock = {
        transI18nName(name: string) { return name; },
        t(key: string, args?: Record<string, any>) {
            if (!args) {
                return key;
            }
            return `${key}:${JSON.stringify(args)}`;
        },
        setLanguage() {},
        registerLanguagePatch() {},
        _lang: 'en',
    };
    return { __esModule: true, default: mock };
});

jest.mock('../share/builder-config', () => ({
    __esModule: true,
    default: {
        commonOptionConfigs: {},
        getProject: jest.fn(async (key?: string) => {
            if (key === 'common') {
                return {};
            }
            return { packages: {} };
        }),
        setProject: jest.fn(),
    },
}));

jest.mock('../share/common-options-validator', () => ({
    checkBuildCommonOptionsByKey: jest.fn(),
    checkBundleCompressionSetting: jest.fn(async (value: any) => ({ newValue: value, error: '' })),
}));

jest.mock('../share/texture-compress', () => ({
    configGroups: {},
    textureFormatConfigs: {},
    formatsInfo: {},
    defaultSupport: {},
}));

jest.mock('../share/validator-manager', () => ({
    validator: { checkWithInternalRule: jest.fn(() => true) },
    validatorManager: {
        addRule: jest.fn(),
        check: jest.fn(async () => ''),
    },
}));

jest.mock('../../configuration', () => ({
    configurationRegistry: { register: jest.fn() },
}));

jest.mock('../../../global', () => ({
    GlobalPaths: { workspace: '/tmp/test-workspace' },
}));

const PLATFORM = 'web-mobile';

function createPluginManager(): PluginManager {
    const pm = new PluginManager();
    (pm as any).platformConfig = {
        [PLATFORM]: { name: 'Web Mobile', platformType: 'WEB' },
    };
    (pm as any).bundleConfigs = {
        [PLATFORM]: {
            platformType: 'web',
            supportOptions: { compressionType: ['none', 'merge_dep', 'merge_all_json'] },
        },
    };
    (pm as any).builderPathsMap = {
        [PLATFORM]: {
            [PLATFORM]: join('builtin', 'web-mobile-hooks.js'),
        },
    };
    (pm as any).pkgPriorities[PLATFORM] = 0;
    return pm;
}

function createProjectRoot(): string {
    return mkdtempSync(join(tmpdir(), 'cocos-cli-project-extension-hooks-'));
}

function writeJson(file: string, data: Record<string, any>): void {
    writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}

function createExtension(
    projectRoot: string,
    dirName: string,
    packageJson: Record<string, any> | string,
    files: Record<string, string> = {},
): string {
    const extensionRoot = join(projectRoot, 'extensions', dirName);
    mkdirSync(extensionRoot, { recursive: true });
    if (typeof packageJson === 'string') {
        writeFileSync(join(extensionRoot, 'package.json'), packageJson, 'utf8');
    } else {
        writeJson(join(extensionRoot, 'package.json'), packageJson);
    }
    for (const [relativePath, content] of Object.entries(files)) {
        const filePath = join(extensionRoot, relativePath);
        mkdirSync(join(filePath, '..'), { recursive: true });
        writeFileSync(filePath, content, 'utf8');
    }
    return extensionRoot;
}

function createBuilderExtension(
    projectRoot: string,
    dirName: string,
    packageName: string,
    configSource = `module.exports = {
        configs: {
            '*': {
                hooks: './hooks',
                options: {
                    buildVersion: { default: 'base-version' },
                    gameDebug: { default: false }
                }
            }
        }
    };`,
): string {
    return createExtension(projectRoot, dirName, {
        name: packageName,
        contributions: {
            builder: './dist/builder.js',
        },
    }, {
        'dist/builder.js': configSource,
        'dist/hooks.js': 'exports.onBeforeBuild = function onBeforeBuild() {};',
    });
}

describe('PluginManager project extension builder hooks', () => {
    let projectRoot: string;

    beforeEach(() => {
        projectRoot = createProjectRoot();
        (builderConfig.getProject as jest.Mock).mockImplementation(async (key?: string) => {
            if (key === 'common') {
                return {};
            }
            return { packages: {} };
        });
    });

    afterEach(() => {
        rmSync(projectRoot, { recursive: true, force: true });
        jest.resetModules();
    });

    it('registers project extension contributions.builder as a public hook with package options', async () => {
        const extensionRoot = createBuilderExtension(projectRoot, 'test-build-hook', 'test-build-hook');
        const pm = createPluginManager();

        const result = await pm.registerProjectExtensionBuilders(projectRoot, PLATFORM);
        const hooksInfo = pm.getHooksInfo(PLATFORM);

        expect(result.registered).toEqual(['test-build-hook']);
        expect(hooksInfo.infos['test-build-hook']).toEqual({
            path: join(extensionRoot, 'dist', 'hooks.js'),
            internal: false,
        });
        expect(hooksInfo.pkgNameOrder).toEqual([PLATFORM, 'test-build-hook']);
        expect((pm as any).pkgOptionConfigs[PLATFORM]['test-build-hook'].buildVersion.default).toBe('base-version');
    });

    it('keeps platform hook registration unchanged when project has no extensions directory', async () => {
        const pm = createPluginManager();
        const before = pm.getHooksInfo(PLATFORM);

        const result = await pm.registerProjectExtensionBuilders(projectRoot, PLATFORM);
        const after = pm.getHooksInfo(PLATFORM);

        expect(result.registered).toEqual([]);
        expect(result.diagnostics).toEqual([]);
        expect(after).toEqual(before);
    });

    it('warns and skips malformed packages, packages without names, and packages without contributions.builder', async () => {
        createExtension(projectRoot, 'bad-json', '{');
        createExtension(projectRoot, 'missing-name', {
            contributions: { builder: './dist/builder.js' },
        }, {
            'dist/builder.js': 'module.exports = { configs: {} };',
        });
        createExtension(projectRoot, 'asset-only', {
            name: 'asset-only',
            contributions: {
                'asset-db': {
                    mount: { path: 'static/assets' },
                },
            },
        });
        const pm = createPluginManager();

        const result = await pm.registerProjectExtensionBuilders(projectRoot, PLATFORM);
        const hooksInfo = pm.getHooksInfo(PLATFORM);

        expect(result.registered).toEqual([]);
        expect(result.diagnostics).toEqual(expect.arrayContaining([
            expect.objectContaining({ code: 'invalid-package-json', level: 'warning', extensionDirName: 'bad-json' }),
            expect.objectContaining({ code: 'missing-package-name', level: 'warning', extensionDirName: 'missing-name' }),
            expect.objectContaining({ code: 'missing-builder-contribution', level: 'warning', extensionDirName: 'asset-only' }),
        ]));
        expect(hooksInfo.pkgNameOrder).toEqual([PLATFORM]);
    });

    it('fails deterministically when contributions.builder points to a missing file', async () => {
        createExtension(projectRoot, 'missing-builder-entry', {
            name: 'missing-builder-entry',
            contributions: { builder: './dist/missing-builder.js' },
        });
        const pm = createPluginManager();

        await expect(pm.registerProjectExtensionBuilders(projectRoot, PLATFORM))
            .rejects
            .toThrow(/missing-builder-entry.*builder entry.*dist[\\/]missing-builder\.js/);
    });

    it('fails deterministically when builder config points to a missing hooks file', async () => {
        createExtension(projectRoot, 'missing-hooks', {
            name: 'missing-hooks',
            contributions: { builder: './dist/builder.js' },
        }, {
            'dist/builder.js': `module.exports = {
                configs: { '*': { hooks: './missing-hooks' } }
            };`,
        });
        const pm = createPluginManager();

        await expect(pm.registerProjectExtensionBuilders(projectRoot, PLATFORM))
            .rejects
            .toThrow(/missing-hooks.*hooks.*missing-hooks/);
    });

    it('does not treat contributes.builder as project extension schema', async () => {
        createExtension(projectRoot, 'legacy-schema', {
            name: 'legacy-schema',
            contributes: {
                builder: {
                    hooks: './dist/hooks.js',
                    config: './dist/builder.js',
                },
            },
        }, {
            'dist/builder.js': 'module.exports = { configs: { "*": { hooks: "./hooks" } } };',
            'dist/hooks.js': 'exports.onBeforeBuild = function onBeforeBuild() {};',
        });
        const pm = createPluginManager();

        const result = await pm.registerProjectExtensionBuilders(projectRoot, PLATFORM);
        const hooksInfo = pm.getHooksInfo(PLATFORM);

        expect(result.registered).toEqual([]);
        expect(result.diagnostics).toEqual(expect.arrayContaining([
            expect.objectContaining({ code: 'missing-builder-contribution', extensionDirName: 'legacy-schema' }),
        ]));
        expect(hooksInfo.infos['legacy-schema']).toBeUndefined();
    });

    it('registers multiple project extensions in stable package-name order after built-in platform hooks', async () => {
        createBuilderExtension(projectRoot, 'z-dir', 'zeta-hook');
        createBuilderExtension(projectRoot, 'a-dir', 'alpha-hook');
        const pm = createPluginManager();

        const result = await pm.registerProjectExtensionBuilders(projectRoot, PLATFORM);
        const hooksInfo = pm.getHooksInfo(PLATFORM);

        expect(result.registered).toEqual(['alpha-hook', 'zeta-hook']);
        expect(hooksInfo.pkgNameOrder).toEqual([PLATFORM, 'alpha-hook', 'zeta-hook']);
        expect(hooksInfo.infos['alpha-hook'].internal).toBe(false);
        expect(hooksInfo.infos['zeta-hook'].internal).toBe(false);
    });

    it('fails deterministically when two project extensions use the same package name', async () => {
        createBuilderExtension(projectRoot, 'first-copy', 'duplicate-hook');
        createBuilderExtension(projectRoot, 'second-copy', 'duplicate-hook');
        const pm = createPluginManager();

        await expect(pm.registerProjectExtensionBuilders(projectRoot, PLATFORM))
            .rejects
            .toThrow(/Duplicate project extension package name.*duplicate-hook/);
    });

    it('fails when a project extension package name collides with the platform package name', async () => {
        createBuilderExtension(projectRoot, 'platform-name-collision', PLATFORM);
        const pm = createPluginManager();

        await expect(pm.registerProjectExtensionBuilders(projectRoot, PLATFORM))
            .rejects
            .toThrow(/Project extension package name conflicts with registered builder package.*web-mobile/);

        expect(pm.getHooksInfo(PLATFORM).infos[PLATFORM]).toEqual({
            path: join('builtin', 'web-mobile-hooks.js'),
            internal: true,
        });
    });

    it('does not leave partial project extension registration when registration fails', async () => {
        createExtension(projectRoot, 'missing-hooks', {
            name: 'missing-hooks',
            contributions: { builder: './dist/builder.js' },
        }, {
            'dist/builder.js': `module.exports = {
                configs: { '*': { hooks: './missing-hooks', options: { buildVersion: { default: 'bad' } } } }
            };`,
        });
        const pm = createPluginManager();

        await expect(pm.registerProjectExtensionBuilders(projectRoot, PLATFORM)).rejects.toThrow(/missing-hooks/);

        expect((pm as any).configMap[PLATFORM]?.['missing-hooks']).toBeUndefined();
        expect((pm as any).pkgOptionConfigs[PLATFORM]?.['missing-hooks']).toBeUndefined();
        expect((pm as any).builderPathsMap[PLATFORM]?.['missing-hooks']).toBeUndefined();
        expect((pm as any).pkgPriorities['missing-hooks']).toBeUndefined();
    });

    it('merges configs["*"] and configs[platform] with platform-specific options and hooks taking precedence', async () => {
        const extensionRoot = createBuilderExtension(projectRoot, 'merge-hook', 'merge-hook', `module.exports = {
            configs: {
                '*': {
                    hooks: './base-hooks',
                    options: {
                        buildVersion: { default: 'base-version' },
                        hotupdateUrl: { default: 'https://base.example.com' }
                    }
                },
                '${PLATFORM}': {
                    hooks: './web-hooks.js',
                    options: {
                        buildVersion: { default: 'web-version' },
                        gameDebug: { default: true }
                    }
                }
            }
        };`);
        writeFileSync(join(extensionRoot, 'dist', 'base-hooks.js'), 'exports.onBeforeBuild = function baseHook() {};', 'utf8');
        writeFileSync(join(extensionRoot, 'dist', 'web-hooks.js'), 'exports.onBeforeBuild = function webHook() {};', 'utf8');
        const pm = createPluginManager();

        await pm.registerProjectExtensionBuilders(projectRoot, PLATFORM);
        const hooksInfo = pm.getHooksInfo(PLATFORM);
        const options = (pm as any).pkgOptionConfigs[PLATFORM]['merge-hook'];

        expect(hooksInfo.infos['merge-hook']).toEqual({
            path: join(extensionRoot, 'dist', 'web-hooks.js'),
            internal: false,
        });
        expect(options.buildVersion.default).toBe('web-version');
        expect(options.gameDebug.default).toBe(true);
        expect(options.hotupdateUrl.default).toBe('https://base.example.com');
    });

    it('replaces arrays when merging configs["*"] and configs[platform]', async () => {
        createBuilderExtension(projectRoot, 'array-merge', 'array-merge', `module.exports = {
            configs: {
                '*': {
                    hooks: './hooks',
                    options: {
                        mode: {
                            default: 'base-a',
                            items: [
                                { label: 'Base A', value: 'base-a' },
                                { label: 'Base B', value: 'base-b' }
                            ]
                        }
                    }
                },
                '${PLATFORM}': {
                    options: {
                        mode: {
                            default: 'web-only',
                            items: [
                                { label: 'Web Only', value: 'web-only' }
                            ]
                        }
                    }
                }
            }
        };`);
        const pm = createPluginManager();

        await pm.registerProjectExtensionBuilders(projectRoot, PLATFORM);
        const modeConfig = (pm as any).pkgOptionConfigs[PLATFORM]['array-merge'].mode;

        expect(modeConfig.items).toEqual([
            { label: 'Web Only', value: 'web-only' },
        ]);
    });

    it('fills project extension package option defaults without overriding build config packages', async () => {
        createBuilderExtension(projectRoot, 'option-defaults', 'option-defaults');
        const pm = createPluginManager();
        await pm.registerProjectExtensionBuilders(projectRoot, PLATFORM);

        const options = await pm.checkOptions({
            platform: PLATFORM,
            mainBundleCompressionType: 'none',
            packages: {
                'option-defaults': {
                    buildVersion: 'from-build-config',
                },
            },
        } as any);

        expect(options?.packages['option-defaults']).toEqual({
            buildVersion: 'from-build-config',
            gameDebug: false,
        });
    });

    it('does not let project extension defaults override saved project package options', async () => {
        createBuilderExtension(projectRoot, 'saved-options', 'saved-options');
        const pm = createPluginManager();
        await pm.registerProjectExtensionBuilders(projectRoot, PLATFORM);
        (builderConfig.getProject as jest.Mock).mockImplementation(async (key?: string) => {
            if (key === 'common') {
                return {};
            }
            if (key === `platforms.${PLATFORM}`) {
                return {
                    packages: {
                        'saved-options': {
                            buildVersion: 'from-saved-project-config',
                        },
                    },
                };
            }
            return { packages: {} };
        });

        const options = await pm.checkOptions({
            platform: PLATFORM,
            mainBundleCompressionType: 'none',
        } as any);

        expect(options?.packages['saved-options']).toEqual({
            buildVersion: 'from-saved-project-config',
            gameDebug: false,
        });
    });
});
