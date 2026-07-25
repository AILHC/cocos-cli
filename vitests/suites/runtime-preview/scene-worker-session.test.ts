import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';

class FakeChildProcess extends EventEmitter {
  connected = true;
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  send = vi.fn();
  kill = vi.fn(() => {
    this.connected = false;
    return true;
  });
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.resetModules();
  vi.doUnmock('../../../src/server');
  vi.doUnmock('../../../src/server/utils');
  vi.doUnmock('../../../src/core/scene/main-process/messages');
  vi.doUnmock('../../../src/core/scene/main-process/rpc');
  vi.doUnmock('../../../src/core/assets');
  vi.doUnmock('../../../src/core/scripting');
  vi.doUnmock('../../../src/core/scene/scene-configs');
  vi.doUnmock('../../../src/core/base/i18n');
});

describe('scene worker session ownership', () => {
  it('forks once, attaches main-process RPC to that child, and disposes both on stop', async () => {
    vi.resetModules();
    const child = new FakeChildProcess();
    const fork = vi.fn(() => child);
    const rpcStartup = vi.fn(async () => undefined);
    const rpcDispose = vi.fn();
    const listenModuleMessages = vi.fn(async () => undefined);
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    vi.doMock('../../../src/server', () => ({
      getServerUrl: () => 'http://127.0.0.1:19530',
    }));
    vi.doMock('../../../src/server/utils', () => ({
      getAvailablePort: vi.fn(async () => 9230),
    }));
    vi.doMock('../../../src/core/scene/main-process/messages', () => ({
      listenModuleMessages,
    }));
    vi.doMock('../../../src/core/scene/main-process/rpc', () => ({
      Rpc: {
        startup: rpcStartup,
        dispose: rpcDispose,
      },
    }));

    const { SceneWorker } = await import('../../../src/core/scene/main-process/scene-worker');
    const sceneWorker = new SceneWorker(fork as never);
    const starting = sceneWorker.start('D:/engine', 'E:/project');
    await vi.waitFor(() => expect(listenModuleMessages).toHaveBeenCalledTimes(1));
    expect(fork).toHaveBeenCalledTimes(1);
    expect(rpcStartup).toHaveBeenCalledWith(child);
    expect(sceneWorker.process).toBe(child);
    expect(child.listenerCount('message')).toBeGreaterThanOrEqual(2);
    child.emit('message', 'scene-worker:ready');

    await expect(starting).resolves.toBe(true);
    expect(fork).toHaveBeenCalledTimes(1);
    expect(fork).toHaveBeenCalledWith(
      expect.stringMatching(/dist[\\/]core[\\/]scene[\\/]scene-process[\\/]main\.js$/),
      [
        '--enginePath=D:/engine',
        '--projectPath=E:/project',
        '--serverURL=http://127.0.0.1:19530',
      ],
      expect.objectContaining({
        detached: false,
        stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
      }),
    );
    expect(rpcStartup).toHaveBeenCalledTimes(1);
    expect(rpcStartup).toHaveBeenCalledWith(child);

    await expect(sceneWorker.start('D:/engine', 'E:/project')).resolves.toBe(false);
    expect(fork).toHaveBeenCalledTimes(1);
    expect(child.kill).not.toHaveBeenCalled();

    const stopping = sceneWorker.stop();
    await vi.waitFor(() => expect(child.send).toHaveBeenCalledWith(SceneWorker.ExitWorkerEvent));
    child.connected = false;
    child.emit('exit', 0, null);
    await expect(stopping).resolves.toBe(true);

    expect(rpcDispose).toHaveBeenCalledTimes(1);
    expect(() => sceneWorker.process).toThrow('Scene worker 未初始化');
    consoleWarn.mockRestore();
  });

  it('keeps attached transport and local handlers on the same main-process RPC instance', async () => {
    vi.resetModules();
    const translate = vi.fn((key: string) => `translated:${key}`);
    const child = Object.assign(new EventEmitter(), {
      connected: true,
      send: vi.fn(),
    });

    vi.doMock('../../../src/core/assets', () => ({
      assetManager: {},
    }));
    vi.doMock('../../../src/core/scripting', () => ({
      default: {},
    }));
    vi.doMock('../../../src/core/scene/scene-configs', () => ({
      sceneConfigInstance: {},
    }));
    vi.doMock('../../../src/core/base/i18n', () => ({
      default: { translate },
    }));

    const { Rpc } = await import('../../../src/core/scene/main-process/rpc');
    await Rpc.startup(child as never);
    const attachedRpc = Rpc.getInstance();

    expect(Rpc.isConnect()).toBe(true);
    expect(Rpc.getInstance()).toBe(attachedRpc);
    await expect(
      attachedRpc.executeLocal('i18n', 'translate', ['scene.ready'] as never),
    ).resolves.toBe('translated:scene.ready');
    expect(translate).toHaveBeenCalledWith('scene.ready');

    Rpc.dispose();
    expect(Rpc.isConnect()).toBeUndefined();
  });

  it('disposes the attached RPC and releases a child that exits before ready', async () => {
    vi.resetModules();
    const child = new FakeChildProcess();
    const rpcStartup = vi.fn(async () => undefined);
    const rpcDispose = vi.fn();

    vi.doMock('../../../src/server', () => ({ getServerUrl: () => 'http://127.0.0.1:19530' }));
    vi.doMock('../../../src/server/utils', () => ({ getAvailablePort: vi.fn(async () => 9230) }));
    vi.doMock('../../../src/core/scene/main-process/messages', () => ({ listenModuleMessages: vi.fn(async () => undefined) }));
    vi.doMock('../../../src/core/scene/main-process/rpc', () => ({ Rpc: { startup: rpcStartup, dispose: rpcDispose } }));

    const { SceneWorker } = await import('../../../src/core/scene/main-process/scene-worker');
    const sceneWorker = new SceneWorker(vi.fn(() => child) as never);
    const starting = sceneWorker.start('D:/engine', 'E:/project');
    await vi.waitFor(() => expect(rpcStartup).toHaveBeenCalledWith(child));
    child.emit('exit', 1, null);

    await expect(starting).resolves.toBe(false);
    expect(rpcDispose).toHaveBeenCalledTimes(1);
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    expect(() => sceneWorker.process).toThrow('Scene worker 未初始化');
  });

  it('keeps waiting while a starting worker continues to produce output', async () => {
    vi.useFakeTimers();
    vi.resetModules();
    const child = new FakeChildProcess();
    const rpcDispose = vi.fn();
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    vi.doMock('../../../src/server', () => ({ getServerUrl: () => 'http://127.0.0.1:19530' }));
    vi.doMock('../../../src/server/utils', () => ({ getAvailablePort: vi.fn(async () => 9230) }));
    vi.doMock('../../../src/core/scene/main-process/messages', () => ({ listenModuleMessages: vi.fn(async () => undefined) }));
    vi.doMock('../../../src/core/scene/main-process/rpc', () => ({
      Rpc: { startup: vi.fn(async () => undefined), dispose: rpcDispose },
    }));

    const { SceneWorker } = await import('../../../src/core/scene/main-process/scene-worker');
    const sceneWorker = new SceneWorker(vi.fn(() => child) as never);
    const starting = sceneWorker.start('D:/engine', 'E:/project');
    await vi.waitFor(() => expect(child.stdout.listenerCount('data')).toBe(1));

    await vi.advanceTimersByTimeAsync(29_000);
    child.stdout.emit('data', Buffer.from('module progress 1'));
    await vi.advanceTimersByTimeAsync(29_000);
    child.stdout.emit('data', Buffer.from('module progress 2'));

    expect(child.kill).not.toHaveBeenCalled();
    child.emit('message', 'scene-worker:ready');
    await expect(starting).resolves.toBe(true);
    expect(rpcDispose).not.toHaveBeenCalled();
    consoleLog.mockRestore();
  });

  it('fails a starting worker after 30 seconds without child activity', async () => {
    vi.useFakeTimers();
    vi.resetModules();
    const child = new FakeChildProcess();
    const rpcDispose = vi.fn();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    vi.doMock('../../../src/server', () => ({ getServerUrl: () => 'http://127.0.0.1:19530' }));
    vi.doMock('../../../src/server/utils', () => ({ getAvailablePort: vi.fn(async () => 9230) }));
    vi.doMock('../../../src/core/scene/main-process/messages', () => ({ listenModuleMessages: vi.fn(async () => undefined) }));
    vi.doMock('../../../src/core/scene/main-process/rpc', () => ({
      Rpc: { startup: vi.fn(async () => undefined), dispose: rpcDispose },
    }));

    const { SceneWorker } = await import('../../../src/core/scene/main-process/scene-worker');
    const sceneWorker = new SceneWorker(vi.fn(() => child) as never);
    const starting = sceneWorker.start('D:/engine', 'E:/project');
    await vi.waitFor(() => expect(child.stdout.listenerCount('data')).toBe(1));

    await vi.advanceTimersByTimeAsync(30_000);

    await expect(starting).resolves.toBe(false);
    expect(consoleError).toHaveBeenCalledWith(expect.stringContaining('场景进程启动无活动超时'));
    expect(rpcDispose).toHaveBeenCalledTimes(1);
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    expect(() => sceneWorker.process).toThrow('Scene worker 未初始化');
    consoleError.mockRestore();
  });

  it('enforces a five minute startup cap even when the child stays active', async () => {
    vi.useFakeTimers();
    vi.resetModules();
    const child = new FakeChildProcess();
    const rpcDispose = vi.fn();
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    vi.doMock('../../../src/server', () => ({ getServerUrl: () => 'http://127.0.0.1:19530' }));
    vi.doMock('../../../src/server/utils', () => ({ getAvailablePort: vi.fn(async () => 9230) }));
    vi.doMock('../../../src/core/scene/main-process/messages', () => ({ listenModuleMessages: vi.fn(async () => undefined) }));
    vi.doMock('../../../src/core/scene/main-process/rpc', () => ({
      Rpc: { startup: vi.fn(async () => undefined), dispose: rpcDispose },
    }));

    const { SceneWorker } = await import('../../../src/core/scene/main-process/scene-worker');
    const sceneWorker = new SceneWorker(vi.fn(() => child) as never);
    const starting = sceneWorker.start('D:/engine', 'E:/project');
    await vi.waitFor(() => expect(child.stdout.listenerCount('data')).toBe(1));

    for (let index = 0; index < 10; index++) {
      await vi.advanceTimersByTimeAsync(29_000);
      child.stdout.emit('data', Buffer.from(`module progress ${index}`));
    }
    await vi.advanceTimersByTimeAsync(10_000);

    await expect(starting).resolves.toBe(false);
    expect(consoleError).toHaveBeenCalledWith(expect.stringContaining('场景进程启动总时限超时'));
    expect(rpcDispose).toHaveBeenCalledTimes(1);
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    consoleLog.mockRestore();
    consoleError.mockRestore();
  });

  it('cancels a start that is waiting for an inspect port before it forks', async () => {
    vi.resetModules();
    const child = new FakeChildProcess();
    let releasePort: ((port: number) => void) | undefined;
    const fork = vi.fn(() => child);
    const rpcDispose = vi.fn();

    vi.doMock('../../../src/server', () => ({ getServerUrl: () => 'http://127.0.0.1:19530' }));
    vi.doMock('../../../src/server/utils', () => ({
      getAvailablePort: vi.fn(() => new Promise<number>((resolve) => { releasePort = resolve; })),
    }));
    vi.doMock('../../../src/core/scene/main-process/messages', () => ({ listenModuleMessages: vi.fn(async () => undefined) }));
    vi.doMock('../../../src/core/scene/main-process/rpc', () => ({ Rpc: { startup: vi.fn(), dispose: rpcDispose } }));

    const { SceneWorker } = await import('../../../src/core/scene/main-process/scene-worker');
    const sceneWorker = new SceneWorker(fork as never);
    const starting = sceneWorker.start('D:/engine', 'E:/project');
    const stopping = sceneWorker.stop();
    releasePort?.(9230);

    await expect(Promise.all([starting, stopping])).resolves.toEqual([false, true]);
    expect(fork).not.toHaveBeenCalled();
    expect(rpcDispose).toHaveBeenCalledTimes(1);
    expect(() => sceneWorker.process).toThrow('Scene worker 未初始化');
  });

  it('can start again after a pre-fork start is cancelled', async () => {
    vi.resetModules();
    const secondChild = new FakeChildProcess();
    let releaseFirstPort: ((port: number) => void) | undefined;
    const getAvailablePort = vi.fn()
      .mockImplementationOnce(() => new Promise<number>((resolve) => { releaseFirstPort = resolve; }))
      .mockResolvedValueOnce(9231);
    const fork = vi.fn(() => secondChild);

    vi.doMock('../../../src/server', () => ({ getServerUrl: () => 'http://127.0.0.1:19530' }));
    vi.doMock('../../../src/server/utils', () => ({ getAvailablePort }));
    vi.doMock('../../../src/core/scene/main-process/messages', () => ({ listenModuleMessages: vi.fn(async () => undefined) }));
    vi.doMock('../../../src/core/scene/main-process/rpc', () => ({
      Rpc: { startup: vi.fn(async () => undefined), dispose: vi.fn() },
    }));

    const { SceneWorker } = await import('../../../src/core/scene/main-process/scene-worker');
    const sceneWorker = new SceneWorker(fork as never);
    const firstStart = sceneWorker.start('D:/engine', 'E:/project');
    const firstStop = sceneWorker.stop();
    releaseFirstPort?.(9230);
    await expect(Promise.all([firstStart, firstStop])).resolves.toEqual([false, true]);

    const secondStart = sceneWorker.start('D:/engine', 'E:/project');
    await vi.waitFor(() => expect(fork).toHaveBeenCalledTimes(1));
    secondChild.emit('message', 'scene-worker:ready');
    await expect(secondStart).resolves.toBe(true);

    const secondStop = sceneWorker.stop();
    secondChild.emit('exit', 0, null);
    await expect(secondStop).resolves.toBe(true);
  });

  it('releases a normally exited worker instead of reusing a dead child', async () => {
    vi.resetModules();
    const child = new FakeChildProcess();

    vi.doMock('../../../src/server', () => ({ getServerUrl: () => 'http://127.0.0.1:19530' }));
    vi.doMock('../../../src/server/utils', () => ({ getAvailablePort: vi.fn(async () => 9230) }));
    vi.doMock('../../../src/core/scene/main-process/messages', () => ({ listenModuleMessages: vi.fn(async () => undefined) }));
    vi.doMock('../../../src/core/scene/main-process/rpc', () => ({
      Rpc: { startup: vi.fn(async () => undefined), dispose: vi.fn() },
    }));

    const { SceneWorker } = await import('../../../src/core/scene/main-process/scene-worker');
    const sceneWorker = new SceneWorker(vi.fn(() => child) as never);
    const starting = sceneWorker.start('D:/engine', 'E:/project');
    await vi.waitFor(() => expect(sceneWorker.isRunning).toBe(true));
    child.emit('message', 'scene-worker:ready');
    await expect(starting).resolves.toBe(true);
    expect(sceneWorker.isRunning).toBe(true);

    child.emit('exit', 0, null);
    expect(sceneWorker.isRunning).toBe(false);
    expect(() => sceneWorker.process).toThrow('Scene worker 未初始化');
  });

  it('stops a forked worker before ready without leaving an attached RPC', async () => {
    vi.resetModules();
    const child = new FakeChildProcess();
    const rpcDispose = vi.fn();

    vi.doMock('../../../src/server', () => ({ getServerUrl: () => 'http://127.0.0.1:19530' }));
    vi.doMock('../../../src/server/utils', () => ({ getAvailablePort: vi.fn(async () => 9230) }));
    vi.doMock('../../../src/core/scene/main-process/messages', () => ({ listenModuleMessages: vi.fn(async () => undefined) }));
    vi.doMock('../../../src/core/scene/main-process/rpc', () => ({
      Rpc: { startup: vi.fn(async () => undefined), dispose: rpcDispose },
    }));

    const { SceneWorker } = await import('../../../src/core/scene/main-process/scene-worker');
    const sceneWorker = new SceneWorker(vi.fn(() => child) as never);
    const starting = sceneWorker.start('D:/engine', 'E:/project');
    await vi.waitFor(() => expect(sceneWorker.isRunning).toBe(true));
    const stopping = sceneWorker.stop();
    await vi.waitFor(() => expect(child.send).toHaveBeenCalledWith(SceneWorker.ExitWorkerEvent));
    child.emit('exit', 0, null);

    await expect(Promise.all([starting, stopping])).resolves.toEqual([false, true]);
    expect(rpcDispose).toHaveBeenCalledTimes(1);
    expect(() => sceneWorker.process).toThrow('Scene worker 未初始化');
  });

});
