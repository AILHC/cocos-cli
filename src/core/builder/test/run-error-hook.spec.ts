import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { BuildTask } from '../worker/builder';

jest.mock('cc', () => ({
    ResolutionPolicy: {
        SHOW_ALL: 0,
        FIXED_HEIGHT: 1,
        FIXED_WIDTH: 2,
        NO_BORDER: 3,
    },
}));

jest.mock('../../assets', () => ({
    assetDBManager: {
        pause: jest.fn(),
        resume: jest.fn(),
    },
}));

jest.mock('../worker/builder/manager/asset', () => ({
    BuilderAssetCache: class MockBuilderAssetCache {},
}));

jest.mock('../worker/builder/manager/build-result', () => ({
    InternalBuildResult: class MockInternalBuildResult {},
    BuildResult: class MockBuildResult {},
}));

jest.mock('../worker/builder/task-config', () => ({
    TaskManager: class MockTaskManager {},
}));

jest.mock('../worker/builder/stage-task-manager', () => ({
    BuildStageTask: class MockBuildStageTask {},
}));

jest.mock('../worker/worker-pools/sub-process-manager', () => ({
    workerManager: {
        killRunningChilds: jest.fn(),
    },
}));

jest.mock('../worker/builder/asset-handler/bundle', () => ({
    BundleManager: class MockBundleManager {},
}));

jest.mock('../worker/builder/manager/build-template', () => ({
    BuildTemplate: class MockBuildTemplate {},
}));

jest.mock('../worker/builder/utils', () => ({
    isInstallNodeJs: jest.fn(),
    relativeUrl: jest.fn(),
    transformCode: jest.fn(),
}));

jest.mock('../manager/plugin', () => ({
    pluginManager: {
        getHooksInfo: jest.fn(() => ({ pkgNameOrder: [], infos: {} })),
        getBuildTemplateConfig: jest.fn(() => ({})),
        platformConfig: {
            'web-mobile': { platformType: 'WEB' },
        },
    },
}));

jest.mock('../../base/console', () => ({
    newConsole: {
        trackMemoryStart: jest.fn(),
        trackMemoryEnd: jest.fn(),
        trackTimeEnd: jest.fn(async () => 0),
    },
}));

jest.mock('../../base/i18n', () => {
    const mock = {
        t(key: string) { return key; },
    };
    return { __esModule: true, default: mock };
});

jest.mock('../share/common-options-validator', () => ({
    checkProjectSetting: jest.fn(),
}));

describe('BuildTask.runErrorHook', () => {
    let tempRoot: string;
    let debugSpy: jest.SpyInstance;

    beforeEach(() => {
        tempRoot = mkdtempSync(join(tmpdir(), 'cocos-cli-run-error-hook-'));
        debugSpy = jest.spyOn(console, 'debug').mockImplementation(() => {});
    });

    afterEach(() => {
        debugSpy.mockRestore();
        rmSync(tempRoot, { recursive: true, force: true });
        delete (global as any).__runErrorHookArgs;
    });

    it('passes the build error as the third argument to public onError hooks', async () => {
        const hookPath = join(tempRoot, 'hooks.js');
        writeFileSync(hookPath, `
            exports.onError = function onError(options, result, error) {
                global.__runErrorHookArgs = {
                    platform: options.platform,
                    hasResult: !!result,
                    errorMessage: error && error.message,
                };
            };
        `, 'utf8');
        const buildError = new Error('fatal build failure');
        const fakeTask = {
            hooksInfo: {
                pkgNameOrder: ['build-ex'],
                infos: {
                    'build-ex': {
                        path: hookPath,
                        internal: false,
                    },
                },
            },
            result: {
                rawOptions: { platform: 'web-mobile' },
            },
            buildResult: { dest: 'build-output' },
            error: buildError,
            updateProcess: jest.fn(),
            postBuild: jest.fn(),
        };

        await BuildTask.prototype.runErrorHook.call(fakeTask as any);

        expect((global as any).__runErrorHookArgs).toEqual({
            platform: 'web-mobile',
            hasResult: true,
            errorMessage: 'fatal build failure',
        });
    });
});
