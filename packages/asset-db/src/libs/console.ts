export const enum LogLevel {
    NONE = 0,
    Error = 1,
    WARN = 2,
    LOG = 3,
    DEBUG = 4,
}

export class CustomConsole {
    debug: (...args: any[]) => void;
    log: (...args: any[]) => void;
    warn: (...args: any[]) => void;
    error: (...args: any[]) => void;

    constructor(level?: LogLevel) {
        level = level || LogLevel.DEBUG;
        this.debug = console.debug.bind(console);
        this.log = console.log.bind(console);
        this.warn = console.warn.bind(console);
        this.error = console.error.bind(console);

        if (level < LogLevel.DEBUG) {
            this.debug = () => {};
        }
        if (level < LogLevel.LOG) {
            this.log = () => {};
        }
        if (level < LogLevel.WARN) {
            this.warn = () => {};
        }
        if (level < LogLevel.Error) {
            this.error = () => {};
        }
    }
}
