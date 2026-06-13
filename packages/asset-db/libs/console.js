"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CustomConsole = void 0;
class CustomConsole {
    constructor(level) {
        level = level || 4 /* LogLevel.DEBUG */;
        this.debug = console.debug.bind(console);
        this.log = console.log.bind(console);
        this.warn = console.warn.bind(console);
        this.error = console.error.bind(console);
        if (level < 4 /* LogLevel.DEBUG */) {
            this.debug = () => { };
        }
        if (level < 3 /* LogLevel.LOG */) {
            this.log = () => { };
        }
        if (level < 2 /* LogLevel.WARN */) {
            this.warn = () => { };
        }
        if (level < 1 /* LogLevel.Error */) {
            this.error = () => { };
        }
    }
}
exports.CustomConsole = CustomConsole;
