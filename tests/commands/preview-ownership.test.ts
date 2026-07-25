/**
 * cocos preview command 层 ownership 接线单测(T3)。
 * 层级:Jest 单元测试;fixture:os.tmpdir 下的最小 Cocos 项目目录(仅 package.json)。
 * 全部 T1 API / Launcher / session-signals / openUrl 均为 mock,不启动真实进程。
 * 覆盖:acquire 接缝位置、acquired/existing-ready/starting/incompatible/conflict 分支、
 * 参数差异 warn、starting 窗口 signal 保护、启动失败回滚 release、
 * live loser 不触达 stdin.resume()、legacy --build 同一流程。
 * 不能证明:真实双进程竞争、真实 claim 文件行为(属 T1/Vitest 集成层)。
 */
import { Command } from 'commander';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';

jest.mock('../../src/core/preview-session', () => ({
    acquirePreviewSessionOwnership: jest.fn(),
}));
jest.mock('../../src/runtime-preview/session/session-signals', () => ({
    installRuntimePreviewSessionSignalHandlers: jest.fn(() => jest.fn()),
}));
jest.mock('../../src/core/builder/platforms/web-common/utils', () => ({
    openUrlAsync: jest.fn(async () => {}),
}));
jest.mock('../../src/core/launcher', () => ({
    __esModule: true,
    default: jest.fn(),
}));

import { PreviewCommand } from '../../src/commands/preview';
import { acquirePreviewSessionOwnership } from '../../src/core/preview-session';
import { installRuntimePreviewSessionSignalHandlers } from '../../src/runtime-preview/session/session-signals';
import { openUrlAsync } from '../../src/core/builder/platforms/web-common/utils';
import Launcher from '../../src/core/launcher';
import {
    collectIgnoredPreviewParams,
    reportExistingPreviewSession,
} from '../../src/commands/preview-existing-session';

const mockAcquire = acquirePreviewSessionOwnership as jest.Mock;
const mockInstallSignalHandlers = installRuntimePreviewSessionSignalHandlers as jest.Mock;
const mockOpenUrlAsync = openUrlAsync as jest.Mock;
const MockLauncher = Launcher as unknown as jest.Mock;

function makeFakeOwnership(projectRoot: string) {
    return {
        sessionId: 'session-new',
        pid: 4321,
        projectRoot,
        claimDir: join(projectRoot, 'temp', 'cli', 'preview-session-session-new-4321'),
        publishReady: jest.fn(async () => {}),
        markDraining: jest.fn(async () => {}),
        release: jest.fn(async () => {}),
    };
}

const readyDescriptor = {
    sessionId: 'session-old',
    projectRoot: 'E:/proj',
    pid: 1234,
    state: 'ready' as const,
    protocolVersion: 1,
    serverUrl: 'http://127.0.0.1:9527',
    startedAt: '2026-07-24T00:00:00.000Z',
};

function existingResult(overrides: Record<string, any>) {
    return {
        acquired: false,
        reason: 'existing-session',
        liveness: 'live-compatible',
        claimDir: 'E:/proj/temp/cli/preview-session-session-old-1234',
        descriptor: readyDescriptor,
        identity: null,
        message: 'A live preview session (PID 1234) already owns this project.',
        ...overrides,
    };
}

describe('cocos preview command ownership wiring', () => {
    let projectDir: string;
    let exitSpy: jest.SpyInstance;
    let stdinResumeSpy: jest.SpyInstance;
    let logSpy: jest.SpyInstance;
    let warnSpy: jest.SpyInstance;
    let errorSpy: jest.SpyInstance;
    let startRuntimePreview: jest.Mock;
    let startPreview: jest.Mock;

    beforeEach(() => {
        projectDir = mkdtempSync(join(tmpdir(), 'cocos-preview-cmd-'));
        writeFileSync(join(projectDir, 'package.json'), '{}');
        exitSpy = jest.spyOn(process, 'exit').mockImplementation((() => undefined) as any);
        stdinResumeSpy = jest.spyOn(process.stdin, 'resume').mockImplementation(() => process.stdin);
        logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
        warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
        errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
        startRuntimePreview = jest.fn(async () => ({ close: async () => {} }));
        startPreview = jest.fn(async () => {});
        MockLauncher.mockReset();
        MockLauncher.mockImplementation(() => ({ startRuntimePreview, startPreview }));
        mockAcquire.mockReset();
        mockInstallSignalHandlers.mockClear();
        mockOpenUrlAsync.mockClear();
    });

    afterEach(() => {
        rmSync(projectDir, { recursive: true, force: true });
        jest.restoreAllMocks();
    });

    async function runPreview(args: string[]) {
        const program = new Command();
        new PreviewCommand(program).register();
        await program.parseAsync(['node', 'cocos', 'preview', '--project', projectDir, ...args]);
    }

    it('acquired: ownership 传给 startRuntimePreview,安装 starting 窗口保护,进入保活', async () => {
        const ownership = makeFakeOwnership(projectDir);
        mockAcquire.mockResolvedValue({ acquired: true, ownership });

        await runPreview([]);

        // acquire 在 new Launcher 之前、用 resolve 后的项目路径。
        expect(mockAcquire).toHaveBeenCalledWith({ projectRoot: resolve(projectDir) });
        expect(startRuntimePreview).toHaveBeenCalledTimes(1);
        expect(startRuntimePreview.mock.calls[0][0].ownership).toBe(ownership);
        // 第一次安装 = starting 窗口保护;第二次 = session handler(内部去重替换)。
        expect(mockInstallSignalHandlers).toHaveBeenCalledTimes(2);
        const earlyCloser = mockInstallSignalHandlers.mock.calls[0][0];
        expect(earlyCloser).not.toBe(startRuntimePreview.mock.results[0].value);
        await earlyCloser.close();
        expect(ownership.release).toHaveBeenCalledTimes(1);
        expect(stdinResumeSpy).toHaveBeenCalledTimes(1);
    });

    it('existing-session + live-compatible + ready: 报 URL、warn 参数差异、开页、exit 0,不触达 stdin.resume', async () => {
        mockAcquire.mockResolvedValue(existingResult({}));

        await runPreview(['--watch-assets', '--scene', 'db://assets/main.scene']);

        expect(MockLauncher).not.toHaveBeenCalled();
        expect(startRuntimePreview).not.toHaveBeenCalled();
        expect(logSpy).toHaveBeenCalledWith(expect.stringContaining(readyDescriptor.serverUrl));
        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('--watch-assets'));
        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('--scene'));
        expect(mockOpenUrlAsync).toHaveBeenCalledWith(readyDescriptor.serverUrl);
        expect(exitSpy).toHaveBeenCalledWith(0);
        expect(stdinResumeSpy).not.toHaveBeenCalled();
    });

    it('existing-session + ready + --no-open: 不开页仍 exit 0', async () => {
        mockAcquire.mockResolvedValue(existingResult({}));

        await runPreview(['--no-open']);

        expect(mockOpenUrlAsync).not.toHaveBeenCalled();
        expect(exitSpy).toHaveBeenCalledWith(0);
        expect(stdinResumeSpy).not.toHaveBeenCalled();
    });

    it('existing-session + starting: 报错非零退出,不开页、不起 Launcher', async () => {
        mockAcquire.mockResolvedValue(existingResult({
            liveness: 'starting',
            descriptor: { ...readyDescriptor, state: 'starting', serverUrl: undefined },
            message: 'A preview session (PID 1234) is still starting; retry later.',
        }));

        await runPreview([]);

        expect(MockLauncher).not.toHaveBeenCalled();
        expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('still starting'));
        expect(mockOpenUrlAsync).not.toHaveBeenCalled();
        expect(exitSpy).toHaveBeenCalledWith(1);
        expect(stdinResumeSpy).not.toHaveBeenCalled();
    });

    it('existing-session + live-incompatible: 报错非零退出', async () => {
        mockAcquire.mockResolvedValue(existingResult({
            liveness: 'live-incompatible',
            message: 'A live preview session (PID 1234) uses an incompatible protocol version; restart the Preview.',
        }));

        await runPreview([]);

        expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('incompatible protocol version'));
        expect(mockOpenUrlAsync).not.toHaveBeenCalled();
        expect(exitSpy).toHaveBeenCalledWith(1);
        expect(stdinResumeSpy).not.toHaveBeenCalled();
    });

    it('conflict: 报并发竞争非零退出', async () => {
        mockAcquire.mockResolvedValue({
            acquired: false,
            reason: 'conflict',
            liveness: null,
            claimDir: null,
            descriptor: null,
            identity: null,
            message: 'Concurrent preview startup race resolved with no surviving claim; retry the command.',
        });

        await runPreview([]);

        expect(MockLauncher).not.toHaveBeenCalled();
        expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Concurrent preview startup race'));
        expect(exitSpy).toHaveBeenCalledWith(1);
        expect(stdinResumeSpy).not.toHaveBeenCalled();
    });

    it('启动失败回滚: startRuntimePreview 抛错时先 release ownership 再 exit 1', async () => {
        const ownership = makeFakeOwnership(projectDir);
        mockAcquire.mockResolvedValue({ acquired: true, ownership });
        startRuntimePreview.mockRejectedValue(new Error('boom'));

        await runPreview([]);

        expect(ownership.release).toHaveBeenCalledTimes(1);
        expect(exitSpy).toHaveBeenCalledWith(1);
        expect(stdinResumeSpy).not.toHaveBeenCalled();
    });

    it('legacy --build + live session ready: 同一发现流程,不起第二套 backend,exit 0', async () => {
        mockAcquire.mockResolvedValue(existingResult({}));

        await runPreview(['--build']);

        expect(MockLauncher).not.toHaveBeenCalled();
        expect(startPreview).not.toHaveBeenCalled();
        // mode 差异(issues/F12):显式 --build 复用 session 时必须 warn 不会 build。
        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('--build'));
        expect(mockOpenUrlAsync).toHaveBeenCalledWith(readyDescriptor.serverUrl);
        expect(exitSpy).toHaveBeenCalledWith(0);
        expect(stdinResumeSpy).not.toHaveBeenCalled();
    });

    it('legacy --build acquired: ownership 传给 startPreview,starting 窗口 handler 保留且不被替换', async () => {
        const ownership = makeFakeOwnership(projectDir);
        mockAcquire.mockResolvedValue({ acquired: true, ownership });

        await runPreview(['--build']);

        expect(startPreview).toHaveBeenCalledTimes(1);
        // blocking owner(issues/19):ownership 透传,由 startPreview 挂 identity endpoint
        // 并在 server ready 后 publishReady。
        expect(startPreview.mock.calls[0][0].ownership).toBe(ownership);
        // --build 无 session handler:仅 starting 窗口保护安装一次,进程生命周期内有效。
        expect(mockInstallSignalHandlers).toHaveBeenCalledTimes(1);
        const earlyCloser = mockInstallSignalHandlers.mock.calls[0][0];
        await earlyCloser.close();
        expect(ownership.release).toHaveBeenCalledTimes(1);
        expect(stdinResumeSpy).toHaveBeenCalledTimes(1);
    });

    it('invalid-owner-alive:claim 损坏但 PID 活,报人工处理消息并非零退出', async () => {
        mockAcquire.mockResolvedValue(existingResult({
            liveness: 'invalid-owner-alive',
            descriptor: null,
            message: 'The existing preview session claim is corrupted or its identity does not match, ' +
                'but its process (PID 1234) is still alive; the claim was left untouched. ' +
                'Stop the process and remove the claim manually, then retry.',
        }));

        await runPreview([]);

        expect(MockLauncher).not.toHaveBeenCalled();
        expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('corrupted'));
        expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('manually'));
        expect(mockOpenUrlAsync).not.toHaveBeenCalled();
        expect(exitSpy).toHaveBeenCalledWith(1);
        expect(stdinResumeSpy).not.toHaveBeenCalled();
    });

    it('--build-config 不存在:acquire 之前报错 exit 1,不 acquire、不起 Launcher(issues/F13)', async () => {
        await runPreview(['--build', '--build-config', join(projectDir, 'missing-build-config.json')]);

        expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('does not exist'));
        expect(exitSpy).toHaveBeenCalledWith(1);
        expect(mockAcquire).not.toHaveBeenCalled();
        expect(MockLauncher).not.toHaveBeenCalled();
        expect(stdinResumeSpy).not.toHaveBeenCalled();
    });

    it('--build-config 非法 JSON:acquire 之前报错 exit 1,不 acquire(issues/F13)', async () => {
        const configPath = join(projectDir, 'bad-build-config.json');
        writeFileSync(configPath, '{ not json');

        await runPreview(['--build', '--build-config', configPath]);

        expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('not valid JSON'));
        expect(exitSpy).toHaveBeenCalledWith(1);
        expect(mockAcquire).not.toHaveBeenCalled();
        expect(MockLauncher).not.toHaveBeenCalled();
    });

    it('--build-config 合法:acquire 前解析,startPreview 收到解析后的 buildOptions', async () => {
        const ownership = makeFakeOwnership(projectDir);
        mockAcquire.mockResolvedValue({ acquired: true, ownership });
        const configPath = join(projectDir, 'build-config.json');
        writeFileSync(configPath, JSON.stringify({ platform: 'web-mobile', debug: false }));

        await runPreview(['--build', '--build-config', configPath]);

        expect(mockAcquire).toHaveBeenCalledTimes(1);
        expect(startPreview).toHaveBeenCalledTimes(1);
        expect(startPreview.mock.calls[0][0].buildOptions).toMatchObject({ platform: 'web-mobile', debug: false });
        expect(startPreview.mock.calls[0][0].platform).toBe('web-mobile');
    });

    it('scene-editor mode 复用 session: 打开 scene-editor 页面', async () => {
        mockAcquire.mockResolvedValue(existingResult({}));

        await runPreview(['--scene-editor']);

        expect(mockOpenUrlAsync).toHaveBeenCalledWith(`${readyDescriptor.serverUrl}/scene-editor/`);
        expect(exitSpy).toHaveBeenCalledWith(0);
    });
});

describe('reportExistingPreviewSession', () => {
    let logSpy: jest.SpyInstance;
    let warnSpy: jest.SpyInstance;
    let errorSpy: jest.SpyInstance;

    beforeEach(() => {
        logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
        warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
        errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    const baseOptions = {
        open: true,
        openPage: 'runtime' as const,
        ignoredParams: [] as string[],
        openUrl: jest.fn(async () => {}),
    };

    it('live-compatible + ready → reused: stdout 报 URL 与项目信息并开页', async () => {
        const outcome = await reportExistingPreviewSession(existingResult({}) as any, baseOptions);

        expect(outcome).toBe('reused');
        expect(logSpy).toHaveBeenCalledWith(expect.stringContaining(readyDescriptor.serverUrl));
        expect(logSpy).toHaveBeenCalledWith(expect.stringContaining(readyDescriptor.projectRoot));
        expect(baseOptions.openUrl).toHaveBeenCalledWith(readyDescriptor.serverUrl);
        expect(errorSpy).not.toHaveBeenCalled();
    });

    it('参数差异: stderr warn 列出未生效参数,仍 reused', async () => {
        const options = { ...baseOptions, openUrl: jest.fn(async () => {}), ignoredParams: ['--watch-assets', '--scene db://assets/a.scene'] };

        const outcome = await reportExistingPreviewSession(existingResult({}) as any, options);

        expect(outcome).toBe('reused');
        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('--watch-assets'));
        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('--scene db://assets/a.scene'));
    });

    it('starting → failed: stderr 报错,不开页', async () => {
        const options = { ...baseOptions, openUrl: jest.fn(async () => {}) };
        const result = existingResult({
            liveness: 'starting',
            descriptor: { ...readyDescriptor, state: 'starting', serverUrl: undefined },
            message: 'A preview session (PID 1234) is still starting; retry later.',
        });

        const outcome = await reportExistingPreviewSession(result as any, options);

        expect(outcome).toBe('failed');
        expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('still starting'));
        expect(options.openUrl).not.toHaveBeenCalled();
    });

    it('live-incompatible → failed;conflict → failed', async () => {
        const options = { ...baseOptions, openUrl: jest.fn(async () => {}) };
        const incompatible = existingResult({ liveness: 'live-incompatible', message: 'incompatible; restart the Preview.' });
        const conflict = {
            acquired: false,
            reason: 'conflict',
            liveness: null,
            claimDir: null,
            descriptor: null,
            identity: null,
            message: 'retry the command.',
        };

        expect(await reportExistingPreviewSession(incompatible as any, options)).toBe('failed');
        expect(await reportExistingPreviewSession(conflict as any, options)).toBe('failed');
        expect(options.openUrl).not.toHaveBeenCalled();
        expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('incompatible'));
        expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('retry the command.'));
    });
});

describe('collectIgnoredPreviewParams', () => {
    it('列出显式携带的关键参数;默认值不列出', () => {
        expect(collectIgnoredPreviewParams({ port: '9527' }, 'runtime')).toEqual([]);
        expect(collectIgnoredPreviewParams({
            watchAssets: true,
            scene: 'db://assets/main.scene',
            host: '0.0.0.0',
            port: '9528',
            settingsTimeoutMs: '5000',
        }, 'runtime')).toEqual([
            '--watch-assets',
            '--scene db://assets/main.scene',
            '--host 0.0.0.0',
            '--settings-timeout-ms',
            '--port 9528',
        ]);
    });

    it('--build 模式列出 mode 差异与 platform/build-config(issues/F12)', () => {
        expect(collectIgnoredPreviewParams({ platform: 'web-mobile', buildConfig: 'c.json' }, 'build'))
            .toEqual(['--build', '--platform web-mobile', '--build-config c.json']);
        // runtime 模式不误报 mode 差异。
        expect(collectIgnoredPreviewParams({}, 'runtime')).toEqual([]);
    });
});
