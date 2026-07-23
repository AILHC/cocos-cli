import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { installRuntimePreviewSessionSignalHandlers } from '../../../src/runtime-preview/session/session-signals';

class FakeSignalProcess extends EventEmitter {
  exitCode: number | null | undefined;
  exit = vi.fn();
}

describe('Runtime Preview session signal handlers', () => {
  it('closes once for repeated SIGINT and removes its handlers after cleanup', async () => {
    const target = new FakeSignalProcess();
    let releaseClose: (() => void) | undefined;
    const close = vi.fn(() => new Promise<void>((resolve) => {
      releaseClose = resolve;
    }));
    const remove = installRuntimePreviewSessionSignalHandlers({ close }, target);

    expect(target.listenerCount('SIGINT')).toBe(1);
    expect(target.listenerCount('SIGTERM')).toBe(1);
    target.emit('SIGINT');
    target.emit('SIGINT');
    expect(close).toHaveBeenCalledTimes(1);

    releaseClose?.();
    await vi.waitFor(() => expect(target.exit).toHaveBeenCalledWith(130));
    expect(target.exitCode).toBe(130);
    expect(target.listenerCount('SIGINT')).toBe(0);
    expect(target.listenerCount('SIGTERM')).toBe(0);
    remove();
  });

  it('replaces an earlier CLI handler rather than accumulating process listeners', () => {
    const target = new FakeSignalProcess();
    const firstClose = vi.fn(async () => undefined);
    const secondClose = vi.fn(async () => undefined);
    installRuntimePreviewSessionSignalHandlers({ close: firstClose }, target);
    const remove = installRuntimePreviewSessionSignalHandlers({ close: secondClose }, target);

    expect(target.listenerCount('SIGINT')).toBe(1);
    expect(target.listenerCount('SIGTERM')).toBe(1);
    remove();
    expect(target.listenerCount('SIGINT')).toBe(0);
    expect(target.listenerCount('SIGTERM')).toBe(0);
  });

  it('uses SIGTERM exit semantics and removes handlers before exit', async () => {
    const target = new FakeSignalProcess();
    target.exit = vi.fn(() => {
      expect(target.listenerCount('SIGINT')).toBe(0);
      expect(target.listenerCount('SIGTERM')).toBe(0);
    });
    installRuntimePreviewSessionSignalHandlers({ close: vi.fn(async () => undefined) }, target);

    target.emit('SIGTERM');
    await vi.waitFor(() => expect(target.exit).toHaveBeenCalledWith(143));
    expect(target.exitCode).toBe(143);
  });

  it('exits with failure status when cleanup rejects and ignores repeated signals', async () => {
    const target = new FakeSignalProcess();
    const close = vi.fn(async () => {
      throw new Error('cleanup failed');
    });
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    installRuntimePreviewSessionSignalHandlers({ close }, target);

    target.emit('SIGINT');
    target.emit('SIGTERM');
    await vi.waitFor(() => expect(target.exit).toHaveBeenCalledWith(1));
    expect(close).toHaveBeenCalledTimes(1);
    expect(target.exitCode).toBe(1);
    error.mockRestore();
  });
});
