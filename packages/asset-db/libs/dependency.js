"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DependencyManager = void 0;
exports.getAssociatedFiles = getAssociatedFiles;
const fs_extra_1 = require("fs-extra");
const path_1 = require("path");
const migrator_1 = require("./migrator");
const migrations = [{
        version: '1.0.0',
        migrate: async (data, manager) => {
            const result = {
                data: {
                    path: {},
                    uuid: {},
                },
                version: DependencyManager.version,
            };
            Object.keys(data.path).forEach((path) => {
                result.data.path[(0, path_1.relative)(manager.pathRoot, path)] = data.path[path].map((dependency) => {
                    return (0, path_1.relative)(manager.pathRoot, dependency);
                });
            });
            Object.keys(data.uuid).forEach((path) => {
                result.data.uuid[(0, path_1.relative)(manager.pathRoot, path)] = data.uuid[path];
            });
            return result;
        },
    }];
function getDefaultRecordInfo() {
    return {
        data: {
            path: {},
            uuid: {},
        },
        version: DependencyManager.version,
    };
}
const associatedMap = {};
class DependencyManager {
    constructor(customConsole, pathRoot) {
        this.dependMap = getDefaultRecordInfo().data;
        this._saveTimer = null;
        this.editorCompatibility = false;
        this.console = customConsole || console;
        this.pathRoot = pathRoot;
    }
    async setRecordJSON(path) {
        this.editorCompatibility = (0, path_1.basename)(path) === '.internal-dependency.json';
        this.file = path;
        try {
            await this._restoreCache(path);
        }
        catch (error) {
            this.console.warn(error);
        }
    }
    async _restoreCache(path) {
        const cache = await this.readRecordJSON(path);
        if (!cache) {
            return;
        }
        if (this.editorCompatibility) {
            if (cache.data) {
                Object.keys(cache.data.path).forEach((path) => {
                    this.dependMap.path[(0, path_1.join)(this.pathRoot, path)] = cache.data.path[path].map((dependency) => {
                        return (0, path_1.join)(this.pathRoot, dependency);
                    });
                });
                Object.keys(cache.data.uuid).forEach((path) => {
                    this.dependMap.uuid[(0, path_1.join)(this.pathRoot, path)] = cache.data.uuid[path];
                });
            }
            else {
                this.dependMap = {
                    path: cache.path || {},
                    uuid: cache.uuid || {},
                };
            }
            this.restoreAssociatedMap();
            return;
        }
        const { path: pathMap, uuid: uuidMap } = this.dependMap;
        Object.keys(cache.data.path).forEach((path) => {
            pathMap[(0, path_1.join)(this.pathRoot, path)] = cache.data.path[path].map((dependency) => {
                return (0, path_1.join)(this.pathRoot, dependency);
            });
        });
        Object.keys(cache.data.uuid).forEach((path) => {
            uuidMap[(0, path_1.join)(this.pathRoot, path)] = cache.data.uuid[path];
        });
        this.restoreAssociatedMap();
    }
    async readRecordJSON(path) {
        if ((0, fs_extra_1.existsSync)(path)) {
            try {
                const data = (0, fs_extra_1.readJSONSync)(path);
                const version = data.version ? data.version : '0.0.0';
                const migrator = new migrator_1.Migrator(migrations, version, {
                    onError: (error) => {
                        this.console.warn('Migrate error in dependencyManager');
                        this.console.warn(error);
                    },
                });
                return await migrator.run(data, DependencyManager.version, [this]);
            }
            catch (error) {
                this.console.error(error);
            }
        }
    }
    save() {
        clearTimeout(this._saveTimer);
        this._saveTimer = setTimeout(() => {
            this.saveImmediate();
        }, 400);
    }
    saveImmediate() {
        clearTimeout(this._saveTimer);
        if (this.file) {
            if (this.editorCompatibility) {
                (0, fs_extra_1.outputJSONSync)(this.file, {
                    path: this.dependMap.path,
                    uuid: this.dependMap.uuid,
                }, { spaces: 2 });
                return;
            }
            const output = getDefaultRecordInfo();
            const { path: pathMap, uuid: uuidMap } = this.dependMap;
            Object.keys(pathMap).forEach((path) => {
                output.data.path[(0, path_1.relative)(this.pathRoot, path)] = pathMap[path].map((dependency) => {
                    return (0, path_1.relative)(this.pathRoot, dependency);
                });
            });
            Object.keys(uuidMap).forEach((path) => {
                output.data.uuid[(0, path_1.relative)(this.pathRoot, path)] = uuidMap[path];
            });
            (0, fs_extra_1.outputJSONSync)(this.file, output, { spaces: 2 });
        }
    }
    add(type, key, depends) {
        const typeMap = this.dependMap[type] = this.dependMap[type] || {};
        const list = typeMap[key] = typeMap[key] || [];
        if (!Array.isArray(depends)) {
            depends = [depends];
        }
        depends.forEach((dependency) => {
            if (dependency && list.indexOf(dependency) !== -1) {
                return;
            }
            list.push(dependency);
            const associatedList = associatedMap[dependency] = associatedMap[dependency] || [];
            if (associatedList.indexOf(key) === -1) {
                associatedList.push(key);
            }
        });
        this.save();
    }
    remove(type, key) {
        if (!this.dependMap[type] || !this.dependMap[type][key]) {
            return;
        }
        this.dependMap[type][key].forEach((dependency) => {
            const list = associatedMap[dependency];
            const index = list.indexOf(key);
            if (index !== -1) {
                list.splice(index, 1);
            }
            if (list.length === 0) {
                delete associatedMap[dependency];
            }
        });
        delete this.dependMap[type][key];
        this.save();
    }
    destroy() {
        for (const type in this.dependMap) {
            const map = this.dependMap[type];
            for (const path in map) {
                map[path].forEach((dependency) => {
                    if (!associatedMap[dependency]) {
                        return;
                    }
                    const index = associatedMap[dependency].indexOf(path);
                    if (index !== -1) {
                        associatedMap[dependency].splice(index, 1);
                    }
                    if (associatedMap[dependency].length === 0) {
                        delete associatedMap[dependency];
                    }
                });
            }
        }
    }
    restoreAssociatedMap() {
        for (const type in this.dependMap) {
            const map = this.dependMap[type];
            for (const path in map) {
                map[path].forEach((dependency) => {
                    associatedMap[dependency] = associatedMap[dependency] || [];
                    if (associatedMap[dependency].indexOf(path) === -1) {
                        associatedMap[dependency].push(path);
                    }
                });
            }
        }
    }
}
exports.DependencyManager = DependencyManager;
DependencyManager.version = '1.0.0';
function getAssociatedFiles(urlOrPathOrUUID) {
    return associatedMap[urlOrPathOrUUID] || [];
}
