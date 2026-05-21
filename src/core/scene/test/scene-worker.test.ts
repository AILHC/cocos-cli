import { EventEmitter } from 'events';
import type { ChildProcess } from 'child_process';

import { SceneWorker } from '../main-process/scene-worker';

class MockChildProcess extends EventEmitter {
    send = jest.fn();
    kill = jest.fn();
}

function createEpipeError(): NodeJS.ErrnoException {
    const error = new Error('write EPIPE') as NodeJS.ErrnoException;
    error.code = 'EPIPE';
    return error;
}

describe('SceneWorker', () => {
    it('returns true when stop gets EPIPE before exit during manual shutdown', async () => {
        const worker = new SceneWorker();
        const process = new MockChildProcess();
        (worker as any)._process = process as unknown as ChildProcess;

        const stopPromise = worker.stop();

        process.emit('error', createEpipeError());
        process.emit('exit', 0, null);

        await expect(stopPromise).resolves.toBe(true);
        expect(process.send).toHaveBeenCalledWith(SceneWorker.ExitWorkerEvent);
    });
});
