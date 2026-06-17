import { EventEmitter } from 'events';
import { PassThrough } from 'stream';
import { mkdtemp, pathExists, remove } from 'fs-extra';
import { join } from 'path';
import { tmpdir } from 'os';

const spawnMock = jest.fn();

jest.mock('child_process', () => ({
    spawn: (...args: unknown[]) => spawnMock(...args),
}));

jest.mock('../../../core/builder', () => ({
    build: jest.fn(),
    executeBuildStageTask: jest.fn(),
    queryDefaultBuildConfigByPlatform: jest.fn(),
}));

jest.mock('../../../core/assets', () => ({
    assetManager: {
        queryAssetInfos: jest.fn(() => []),
    },
}));

describe('BuilderApi build runtime isolation', () => {
    let projectPath = '';

    beforeEach(async () => {
        projectPath = await mkdtemp(join(tmpdir(), 'cocos-builder-api-'));
        spawnMock.mockReset();
    });

    afterEach(async () => {
        await remove(projectPath);
    });

    it('runs builder-build in an isolated process when startup projectPath is available', async () => {
        const child = new EventEmitter() as EventEmitter & {
            stdout: PassThrough;
            stderr: PassThrough;
        };
        child.stdout = new PassThrough();
        child.stderr = new PassThrough();
        spawnMock.mockImplementation(() => {
            setImmediate(() => {
                child.stdout.write('__COCOS_CLI_BUILD_RESULT__{"code":0,"dest":"project://build/api-isolated"}\n');
                child.emit('close', 0);
            });
            return child;
        });

        const { BuilderApi } = await import('../../../api/builder/builder');
        const api = new BuilderApi(() => projectPath);
        const result = await api.build('wechatgame', {
            platform: 'wechatgame',
            outputName: 'api-isolated',
        });

        expect(result.code).toBe(200);
        expect(result.data?.code).toBe(0);
        expect(result.data?.dest).toBe('project://build/api-isolated');
        expect(spawnMock).toHaveBeenCalledTimes(1);
        const [, args, options] = spawnMock.mock.calls[0];
        expect(args).toContain(projectPath);
        expect(args).toContain('wechatgame');
        expect(options.windowsHide).toBe(true);
        const optionsPath = args[4];
        expect(await pathExists(optionsPath)).toBe(false);
    });

    it('passes startup projectPath through MCP builder-build tool execution', async () => {
        const child = new EventEmitter() as EventEmitter & {
            stdout: PassThrough;
            stderr: PassThrough;
        };
        child.stdout = new PassThrough();
        child.stderr = new PassThrough();
        spawnMock.mockImplementation(() => {
            setImmediate(() => {
                child.stdout.write('__COCOS_CLI_BUILD_RESULT__{"code":0,"dest":"project://build/mcp-isolated"}\n');
                child.emit('close', 0);
            });
            return child;
        });

        await import('../../../api/builder/builder');
        const { toolRegistry } = await import('../../../api/decorator/decorator');
        const { McpMiddleware } = await import('../../../mcp/mcp.middleware');
        const tool = toolRegistry.get('builder-build');
        expect(tool).toBeDefined();
        const middleware = new McpMiddleware(() => projectPath);
        const result = await (middleware as any).callToolMethod(tool?.target, tool?.meta, [
            'wechatgame',
            {
                platform: 'wechatgame',
                outputName: 'mcp-isolated',
            },
        ]);

        expect(result.code).toBe(200);
        expect(result.data?.code).toBe(0);
        expect(result.data?.dest).toBe('project://build/mcp-isolated');
        expect(spawnMock).toHaveBeenCalledTimes(1);
        const [, args] = spawnMock.mock.calls[0];
        expect(args).toContain(projectPath);
        expect(args).toContain('wechatgame');
    });
});
