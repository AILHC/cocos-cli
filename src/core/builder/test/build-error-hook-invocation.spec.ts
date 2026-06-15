const mockRun = jest.fn();
const mockRunErrorHook = jest.fn();

jest.mock('../../base/i18n', () => {
    const mock = {
        t(key: string) { return key; },
    };
    return { __esModule: true, default: mock };
});

jest.mock('../../base/console', () => ({
    newConsole: {
        buildStart: jest.fn(),
        buildComplete: jest.fn(),
        error: jest.fn(),
        progress: jest.fn(),
    },
}));

jest.mock('../manager/plugin', () => ({
    pluginManager: {
        checkPlatform: jest.fn(() => true),
        checkOptions: jest.fn(async (options: any) => options),
    },
}));

jest.mock('../share/common-options-validator', () => ({
    fillIncludeModulesFromProjectConfig: jest.fn(async () => undefined),
}));

jest.mock('../../assets/manager/asset', () => ({
    __esModule: true,
    default: {
        queryAsset: jest.fn(),
    },
}));

jest.mock('../../../server/middleware/core', () => ({
    middlewareService: {
        register: jest.fn(),
    },
}));

jest.mock('../build.middleware', () => ({
    __esModule: true,
    default: class MockBuildMiddleware {},
}));

jest.mock('../worker/builder', () => ({
    BuildTask: class MockBuildTask {
        public error?: Error;
        public buildExitRes = { code: 0, dest: 'project://build/test' };
        private listeners: Record<string, Function> = {};

        on(name: string, listener: Function) {
            this.listeners[name] = listener;
        }

        async run() {
            await mockRun(this);
        }

        async runErrorHook() {
            await mockRunErrorHook(this.error);
        }
    },
}));

describe('builder build error hook invocation', () => {
    beforeEach(() => {
        mockRun.mockReset();
        mockRunErrorHook.mockReset();
    });

    it('runs error hooks when the build task throws a fatal error', async () => {
        const fatalError = new Error('fatal hook failure');
        mockRun.mockImplementation(function runWithFatalError(this: any, task: any) {
            task.error = fatalError;
            throw fatalError;
        });

        const { build } = await import('../index');

        const result = await build('web-mobile' as any, {
            platform: 'web-mobile',
            skipCheck: false,
        } as any);

        expect(result.code).not.toBe(0);
        expect((result as any).reason).toContain('fatal hook failure');
        expect(mockRunErrorHook).toHaveBeenCalledWith(fatalError);
    });
});
