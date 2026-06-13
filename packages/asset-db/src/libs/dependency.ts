import { existsSync, outputJSONSync, readJSONSync } from 'fs-extra';
import { basename, join, relative } from 'path';
import { CustomConsole } from './console';
import { Migrator, Migrate } from './migrator';

interface DependMap {
    path: {
        [path: string]: string[];
    };
    uuid: {
        [uuid: string]: string[];
    };
}

interface DependencyRecord {
    data: DependMap;
    version: string;
}

interface LegacyDependencyRecord extends DependMap {
    version?: string;
}

const migrations: Migrate<any>[] = [{
    version: '1.0.0',
    migrate: async (data: LegacyDependencyRecord, manager: DependencyManager) => {
        const result: DependencyRecord = {
            data: {
                path: {},
                uuid: {},
            },
            version: DependencyManager.version,
        };

        Object.keys(data.path).forEach((path) => {
            result.data.path[relative(manager.pathRoot, path)] = data.path[path].map((dependency) => {
                return relative(manager.pathRoot, dependency);
            });
        });
        Object.keys(data.uuid).forEach((path) => {
            result.data.uuid[relative(manager.pathRoot, path)] = data.uuid[path];
        });

        return result;
    },
}];

function getDefaultRecordInfo(): DependencyRecord {
    return {
        data: {
            path: {},
            uuid: {},
        },
        version: DependencyManager.version,
    };
}

const associatedMap: Record<string, string[]> = {};

export class DependencyManager {
    static version = '1.0.0';

    file?: string;
    pathRoot: string;
    dependMap: DependMap = getDefaultRecordInfo().data;
    _saveTimer: any = null;
    private console: CustomConsole | Console;
    private editorCompatibility = false;

    constructor(customConsole: CustomConsole, pathRoot: string) {
        this.console = customConsole || console;
        this.pathRoot = pathRoot;
    }

    async setRecordJSON(path: string): Promise<void> {
        this.editorCompatibility = basename(path) === '.internal-dependency.json';
        this.file = path;
        try {
            await this._restoreCache(path);
        } catch (error) {
            this.console.warn(error);
        }
    }

    private async _restoreCache(path: string): Promise<void> {
        const cache = await this.readRecordJSON(path);
        if (!cache) {
            return;
        }

        if (this.editorCompatibility) {
            if ((cache as any).data) {
                Object.keys((cache as any).data.path).forEach((path) => {
                    this.dependMap.path[join(this.pathRoot, path)] = (cache as any).data.path[path].map((dependency: string) => {
                        return join(this.pathRoot, dependency);
                    });
                });
                Object.keys((cache as any).data.uuid).forEach((path) => {
                    this.dependMap.uuid[join(this.pathRoot, path)] = (cache as any).data.uuid[path];
                });
            } else {
                this.dependMap = {
                    path: (cache as any).path || {},
                    uuid: (cache as any).uuid || {},
                };
            }
            this.restoreAssociatedMap();
            return;
        }

        const { path: pathMap, uuid: uuidMap } = this.dependMap;
        Object.keys(cache.data.path).forEach((path) => {
            pathMap[join(this.pathRoot, path)] = cache.data.path[path].map((dependency) => {
                return join(this.pathRoot, dependency);
            });
        });
        Object.keys(cache.data.uuid).forEach((path) => {
            uuidMap[join(this.pathRoot, path)] = cache.data.uuid[path];
        });

        this.restoreAssociatedMap();
    }

    private async readRecordJSON(path: string): Promise<DependencyRecord | undefined> {
        if (existsSync(path)) {
            try {
                const data = readJSONSync(path);
                const version = data.version ? data.version : '0.0.0';
                const migrator = new Migrator<any>(migrations, version, {
                    onError: (error) => {
                        this.console.warn('Migrate error in dependencyManager');
                        this.console.warn(error);
                    },
                });
                return await migrator.run(data, DependencyManager.version, [this]);
            } catch (error) {
                this.console.error(error);
            }
        }
    }

    save(): void {
        clearTimeout(this._saveTimer);
        this._saveTimer = setTimeout(() => {
            this.saveImmediate();
        }, 400);
    }

    saveImmediate(): void {
        clearTimeout(this._saveTimer);
        if (this.file) {
            if (this.editorCompatibility) {
                outputJSONSync(this.file, {
                    path: this.dependMap.path,
                    uuid: this.dependMap.uuid,
                }, { spaces: 2 });
                return;
            }
            const output = getDefaultRecordInfo();
            const { path: pathMap, uuid: uuidMap } = this.dependMap;
            Object.keys(pathMap).forEach((path) => {
                output.data.path[relative(this.pathRoot, path)] = pathMap[path].map((dependency) => {
                    return relative(this.pathRoot, dependency);
                });
            });
            Object.keys(uuidMap).forEach((path) => {
                output.data.uuid[relative(this.pathRoot, path)] = uuidMap[path];
            });
            outputJSONSync(this.file, output, { spaces: 2 });
        }
    }

    add(type: string, key: string, depends: string | string[]): void {
        const typeMap = (this.dependMap as any)[type] = (this.dependMap as any)[type] || {};
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

    remove(type: string, key: string): void {
        if (!(this.dependMap as any)[type] || !(this.dependMap as any)[type][key]) {
            return;
        }
        (this.dependMap as any)[type][key].forEach((dependency: string) => {
            const list = associatedMap[dependency];
            const index = list.indexOf(key);
            if (index !== -1) {
                list.splice(index, 1);
            }
            if (list.length === 0) {
                delete associatedMap[dependency];
            }
        });
        delete (this.dependMap as any)[type][key];
        this.save();
    }

    destroy(): void {
        for (const type in this.dependMap) {
            const map = (this.dependMap as any)[type] as Record<string, string[]>;
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

    private restoreAssociatedMap(): void {
        for (const type in this.dependMap) {
            const map = (this.dependMap as any)[type] as Record<string, string[]>;
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

export function getAssociatedFiles(urlOrPathOrUUID: string): string[] {
    return associatedMap[urlOrPathOrUUID] || [];
}
