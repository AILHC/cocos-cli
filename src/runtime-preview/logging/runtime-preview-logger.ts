import { appendFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

function pad2(value: number): string {
    return String(value).padStart(2, '0');
}

function timestampForFile(date = new Date()): string {
    return [
        date.getFullYear(),
        pad2(date.getMonth() + 1),
        pad2(date.getDate()),
        '-',
        pad2(date.getHours()),
        pad2(date.getMinutes()),
        pad2(date.getSeconds()),
    ].join('');
}

export class RuntimePreviewLogger {
    private writeQueue = Promise.resolve();

    constructor(public readonly logFilePath: string) {}

    write(line: string): Promise<void> {
        this.writeQueue = this.writeQueue.then(() => appendFile(this.logFilePath, `${line}\n`, 'utf8'));
        return this.writeQueue;
    }
}

export async function createRuntimePreviewLogger(projectRoot: string): Promise<RuntimePreviewLogger> {
    const logDir = join(projectRoot, 'temp', 'preview-logs');
    await mkdir(logDir, { recursive: true });
    const logger = new RuntimePreviewLogger(join(logDir, `runtime-preview-${timestampForFile()}.log`));
    await logger.write('runtime-preview:log:start');
    return logger;
}
