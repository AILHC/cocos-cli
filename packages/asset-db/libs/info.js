"use strict";
/// <reference types="node" preserve="true" />
Object.defineProperty(exports, "__esModule", { value: true });
exports.InfoManager = void 0;
const fs_extra_1 = require("fs-extra");
const path_1 = require("path");
const migrator_1 = require("./migrator");
const migrations = [{
        version: '1.0.0',
        migrate: async (data) => {
            const result = {
                version: InfoManager.version,
                map: {},
                missing: {},
            };
            Object.keys(data).forEach((path) => {
                const info = data[path];
                if (info.missing) {
                    delete info.missing;
                    if (info.uuid) {
                        result.missing[info.uuid] = {
                            path,
                            time: info.time,
                            removeTime: Date.now(),
                        };
                    }
                }
                else {
                    delete info.missing;
                    result.map[path] = info;
                }
            });
            return result;
        },
    }, {
        version: '1.0.1',
        migrate: async (data, manager) => {
            const result = {
                version: InfoManager.version,
                map: {},
                missing: {},
            };
            Object.keys(data).forEach((path) => {
                const info = data[path];
                const relativePath = (0, path_1.relative)(manager.pathRoot, path);
                if (relativePath.startsWith('..')) {
                    result.missing[path] = info;
                }
                else {
                    result[relativePath] = info;
                }
            });
            return result;
        },
    }];
function getDefaultRecordInfo() {
    return {
        version: InfoManager.version,
        map: {},
        missing: {},
    };
}
function getDefaultEditorRecordInfo() {
    return {
        version: '1.0.0',
        map: {},
        missing: {},
    };
}
function getLegacyInfoPath(path) {
    return path.replace(/\.json$/, '1.0.0.json');
}
class InfoManager {
    constructor(customConsole, pathRoot) {
        this.editorCompatibility = false;
        this._saveTimer = null;
        this.console = customConsole || console;
        this.pathRoot = pathRoot;
        this.recordInfo = getDefaultRecordInfo();
    }
    async setRecordJSON(path) {
        this.editorCompatibility = (0, path_1.basename)(path) === '.internal-info1.0.0.json';
        this.file = path;
        try {
            await this._restoreCache(this.file);
        }
        catch (error) {
            this.console.warn(error);
        }
    }
    async _restoreCache(path) {
        const recordInfo = this.editorCompatibility ? getDefaultEditorRecordInfo() : getDefaultRecordInfo();
        const cache = await this._readRecordInfo(path);
        if (cache) {
            if (this.editorCompatibility) {
                this.recordInfo = cache;
                return;
            }
            Object.keys(cache.map).forEach((path) => {
                recordInfo.map[(0, path_1.join)(this.pathRoot, path)] = cache.map[path];
            });
            recordInfo.missing = cache.missing;
            this.recordInfo = recordInfo;
        }
    }
    async _readRecordInfo(path) {
        if (this.editorCompatibility) {
            if ((0, fs_extra_1.existsSync)(path)) {
                try {
                    const data = (0, fs_extra_1.readJSONSync)(path);
                    return {
                        version: '1.0.0',
                        map: data.map || {},
                        missing: data.missing || {},
                    };
                }
                catch (error) {
                    this.console.warn(error);
                }
            }
            return getDefaultEditorRecordInfo();
        }
        const oldPath = getLegacyInfoPath(path);
        const migrator = new migrator_1.Migrator(migrations, InfoManager.version, {
            onError: (error) => {
                this.console.warn(`migrate error in infoManager: ${error}`);
                this.console.warn(error);
            },
        });
        if ((0, fs_extra_1.existsSync)(oldPath)) {
            try {
                const data = (0, fs_extra_1.readJSONSync)(oldPath);
                await (0, fs_extra_1.remove)(oldPath);
                return await migrator.run(data, '1.0.0', [this]);
            }
            catch (error) {
                this.console.warn(error);
            }
        }
        else if ((0, fs_extra_1.existsSync)(path)) {
            try {
                const data = (0, fs_extra_1.readJSONSync)(path);
                return await migrator.run(data, InfoManager.version, [this]);
            }
            catch (error) {
                this.console.warn(error);
            }
        }
    }
    destroy() {
        this.recordInfo = getDefaultRecordInfo();
    }
    save() {
        if (this._saveTimer) {
            clearTimeout(this._saveTimer);
        }
        this._saveTimer = setTimeout(() => {
            this.saveImmediate();
        }, 400);
    }
    saveImmediate() {
        if (this._saveTimer) {
            clearTimeout(this._saveTimer);
        }
        if (this.file) {
            if (this.editorCompatibility) {
                (0, fs_extra_1.outputJSONSync)(this.file, {
                    version: '1.0.0',
                    map: this.recordInfo.map,
                    missing: this.recordInfo.missing,
                }, { spaces: 2 });
                return;
            }
            const output = getDefaultRecordInfo();
            Object.keys(this.recordInfo.map).forEach((path) => {
                output.map[(0, path_1.relative)(this.pathRoot, path)] = this.recordInfo.map[path];
            });
            (0, fs_extra_1.outputJSONSync)(this.file, output, { spaces: 2 });
        }
    }
    add(path, mtimeMs, uuid) {
        if (this.recordInfo.map[path]
            && this.recordInfo.map[path].uuid === uuid
            && this.recordInfo.map[path].time === mtimeMs) {
            return;
        }
        this.recordInfo.map[path] = uuid ? { time: mtimeMs, uuid } : { time: mtimeMs };
        this.save();
    }
    remove(path) {
        if (!this.recordInfo.map[path]) {
            return;
        }
        const info = this.recordInfo.map[path];
        this.addMissing(path, info);
        delete this.recordInfo.map[path];
        this.save();
    }
    get(path) {
        return (this.recordInfo.map[path] || null);
    }
    addMissing(path, info) {
        if (info.uuid) {
            this.recordInfo.missing[info.uuid] = {
                path,
                time: info.time,
                removeTime: Date.now(),
            };
        }
    }
    getMissingInfo(uuid) {
        return (this.recordInfo.missing[uuid] || null);
    }
    compare(path, mtimeMs) {
        const info = this.recordInfo.map[path];
        return !!info && info.time === mtimeMs;
    }
    async forEach(handler) {
        for (const path in this.recordInfo.map) {
            await handler(path, this.recordInfo.map[path]);
        }
    }
}
exports.InfoManager = InfoManager;
InfoManager.version = '1.0.1';
