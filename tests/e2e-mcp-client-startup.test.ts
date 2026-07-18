import { EventEmitter } from 'events';
import { PassThrough } from 'stream';
import { ChildProcess, spawn } from 'child_process';

import { MCPTestClient } from '../e2e/helpers/mcp-client';

jest.mock('child_process', () => ({
    ...jest.requireActual('child_process'),
    spawn: jest.fn(),
}));

class FakeChildProcess extends EventEmitter {
    stdout = new PassThrough();
    stderr = new PassThrough();
    exitCode: number | null = null;
    kill = jest.fn((_signal?: NodeJS.Signals | number) => {
        this.exitCode = 0;
        this.emit('exit', 0);
        return true;
    });
}

describe('MCPTestClient startup diagnostics', () => {
    const originalCliPath = process.env.__E2E_CLI_PATH__;
    const originalTestEngineRoot = process.env.COCOS_CLI_TEST_ENGINE_ROOT;
    const originalTestProjectRoot = process.env.COCOS_CLI_TEST_PROJECT_ROOT;
    const spawnMock = spawn as jest.MockedFunction<typeof spawn>;

    beforeEach(() => {
        jest.useFakeTimers();
        process.env.__E2E_CLI_PATH__ = __filename;
        delete process.env.COCOS_CLI_TEST_ENGINE_ROOT;
        delete process.env.COCOS_CLI_TEST_PROJECT_ROOT;
        spawnMock.mockReset();
    });

    afterEach(() => {
        jest.useRealTimers();
        if (originalCliPath === undefined) {
            delete process.env.__E2E_CLI_PATH__;
        } else {
            process.env.__E2E_CLI_PATH__ = originalCliPath;
        }
        restoreEnv('COCOS_CLI_TEST_ENGINE_ROOT', originalTestEngineRoot);
        restoreEnv('COCOS_CLI_TEST_PROJECT_ROOT', originalTestProjectRoot);
    });

    test('includes bounded child output and terminates the child on startup timeout', async () => {
        const child = new FakeChildProcess();
        spawnMock.mockReturnValue(child as unknown as ChildProcess);
        const client = new MCPTestClient({
            projectPath: 'C:\\fixtures\\cold-project',
            startTimeout: 25,
        });

        const startPromise = client.start();
        child.stdout.write(`${'discarded-'.repeat(3000)}stdout-tail-marker`);
        child.stderr.write('stderr-tail-marker');

        const errorPromise = startPromise.then(
            () => { throw new Error('Expected MCP startup to reject'); },
            (error: Error) => error,
        );
        await jest.advanceTimersByTimeAsync(25);

        const error = await errorPromise;
        expect(error.message).toMatch(/MCP server start timeout after 25ms/);
        expect(error.message).toMatch(/stdout-tail-marker/);
        expect(error.message).toMatch(/stderr-tail-marker/);
        expect(child.kill).toHaveBeenCalledWith('SIGTERM');
        expect(child.listenerCount('exit')).toBe(0);
        expect(spawnMock.mock.calls[0][2]).not.toHaveProperty('env');
    });

    test('scopes explicit test engine and project roots to the spawned MCP process', async () => {
        const child = new FakeChildProcess();
        spawnMock.mockReturnValue(child as unknown as ChildProcess);
        process.env.COCOS_CLI_TEST_ENGINE_ROOT = ' C:\\fixtures\\engine-3.8.6 ';
        process.env.COCOS_CLI_TEST_PROJECT_ROOT = 'C:\\fixtures\\stale-parent-project';
        const client = new MCPTestClient({
            projectPath: 'C:\\fixtures\\current-project',
            startTimeout: 100,
        });

        const startPromise = client.start().then(
            () => { throw new Error('Expected MCP startup to reject'); },
            (error: Error) => error,
        );
        const spawnOptions = spawnMock.mock.calls[0][2];

        expect(spawnOptions?.env).toMatchObject({
            COCOS_CLI_TEST_ENGINE_ROOT: 'C:\\fixtures\\engine-3.8.6',
            COCOS_CLI_TEST_PROJECT_ROOT: 'C:\\fixtures\\current-project',
        });

        child.exitCode = 1;
        child.emit('exit', 1);
        await expect(startPromise).resolves.toBeInstanceOf(Error);
    });
});

function restoreEnv(name: string, value: string | undefined): void {
    if (value === undefined) {
        delete process.env[name];
    } else {
        process.env[name] = value;
    }
}
