import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { BuildTaskBase } from '../worker/builder/manager/task-base';
import type { IBuildHooksInfo } from '../@types/protected';

jest.mock('../../base/i18n', () => {
    const mock = {
        t(key: string, args?: Record<string, any>) {
            if (!args) {
                return key;
            }
            return `${key}:${JSON.stringify(args)}`;
        },
    };
    return { __esModule: true, default: mock };
});

jest.mock('../../base/console', () => ({
    newConsole: {
        trackTimeStart: jest.fn(),
        trackTimeEnd: jest.fn(() => 0),
        pluginTask: jest.fn(),
        error: jest.fn(),
        warn: jest.fn(),
        log: jest.fn(),
        success: jest.fn(),
        debug: jest.fn(),
    },
}));

class TestHookTask extends BuildTaskBase {
    public hooksInfo: IBuildHooksInfo;
    public options: any = {};
    public hookMap: Record<string, string> = {
        onBeforeBuild: 'onBeforeBuild',
    };

    constructor(hooksInfo: IBuildHooksInfo) {
        super('test-hook-task', 'test');
        this.hooksInfo = hooksInfo;
    }

    async handleHook(func: Function): Promise<void> {
        await func();
    }

    async run(): Promise<boolean> {
        return true;
    }
}

describe('BuildTaskBase.runPluginTask error context', () => {
    let tempRoot: string;
    let debugSpy: jest.SpyInstance;

    beforeEach(() => {
        tempRoot = mkdtempSync(join(tmpdir(), 'cocos-cli-run-plugin-task-'));
        debugSpy = jest.spyOn(console, 'debug').mockImplementation(() => {});
    });

    afterEach(() => {
        debugSpy.mockRestore();
        rmSync(tempRoot, { recursive: true, force: true });
    });

    it('throws fatal hook errors with package name, hook name, and original message', async () => {
        const hookPath = join(tempRoot, 'hooks.js');
        writeFileSync(hookPath, `
            exports.throwError = true;
            exports.onBeforeBuild = function onBeforeBuild() {
                throw new Error('original boom');
            };
        `, 'utf8');
        const task = new TestHookTask({
            pkgNameOrder: ['project-build-ex'],
            infos: {
                'project-build-ex': {
                    path: hookPath,
                    internal: false,
                },
            },
        });

        await expect(task.runPluginTask('onBeforeBuild'))
            .rejects
            .toThrow(/project-build-ex.*onBeforeBuild.*original boom/);
    });
});
