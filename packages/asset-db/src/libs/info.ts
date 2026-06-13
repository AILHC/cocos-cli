/// <reference types="node" preserve="true" />

import { existsSync, outputJSONSync, readJSONSync, remove } from 'fs-extra';
import { basename, join, relative } from 'path';
import { CustomConsole } from './console';
import { Migrator, Migrate } from './migrator';

export interface SimpleInfo {
    time: number;
    uuid?: string;
}

export interface MissingAssetInfo {
    path: string;
    time: number;
    removeTime: number;
}

export interface RecordInfoMap {
    version: string;
    map: {
        [path: string]: SimpleInfo;
    };
    missing: {
        [path: string]: MissingAssetInfo;
    };
}

type LegacyInfoRecord = Record<string, SimpleInfo & { missing?: boolean }>;

const migrations: Migrate<any>[] = [{
    version: '1.0.0',
    migrate: async (data: LegacyInfoRecord) => {
        const result: RecordInfoMap = {
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
            } else {
                delete info.missing;
                result.map[path] = info;
            }
        });
        return result;
    },
}, {
    version: '1.0.1',
    migrate: async (data: any, manager: InfoManager) => {
        const result: RecordInfoMap = {
            version: InfoManager.version,
            map: {},
            missing: {},
        };
        Object.keys(data).forEach((path) => {
            const info = data[path];
            const relativePath = relative(manager.pathRoot, path);
            if (relativePath.startsWith('..')) {
                (result.missing as any)[path] = info;
            } else {
                (result as any)[relativePath] = info;
            }
        });
        return result;
    },
}];

function getDefaultRecordInfo(): RecordInfoMap {
    return {
        version: InfoManager.version,
        map: {},
        missing: {},
    };
}

function getDefaultEditorRecordInfo(): RecordInfoMap {
    return {
        version: '1.0.0',
        map: {},
        missing: {},
    };
}

function getLegacyInfoPath(path: string): string {
    return path.replace(/\.json$/, '1.0.0.json');
}

export class InfoManager {
    static version = '1.0.1';

    private file?: string;
    pathRoot: string;
    private recordInfo: RecordInfoMap;
    private console: CustomConsole | Console;
    private editorCompatibility = false;
    _saveTimer: null | NodeJS.Timeout = null;

    constructor(customConsole: CustomConsole, pathRoot: string) {
        this.console = customConsole || console;
        this.pathRoot = pathRoot;
        this.recordInfo = getDefaultRecordInfo();
    }

    async setRecordJSON(path: string): Promise<void> {
        this.editorCompatibility = basename(path) === '.internal-info1.0.0.json';
        this.file = path;
        try {
            await this._restoreCache(this.file);
        } catch (error) {
            this.console.warn(error);
        }
    }

    private async _restoreCache(path: string): Promise<void> {
        const recordInfo = this.editorCompatibility ? getDefaultEditorRecordInfo() : getDefaultRecordInfo();
        const cache = await this._readRecordInfo(path);
        if (cache) {
            if (this.editorCompatibility) {
                this.recordInfo = cache;
                return;
            }
            Object.keys(cache.map).forEach((path) => {
                recordInfo.map[join(this.pathRoot, path)] = cache.map[path];
            });
            recordInfo.missing = cache.missing;
            this.recordInfo = recordInfo;
        }
    }

    private async _readRecordInfo(path: string): Promise<RecordInfoMap | undefined> {
        if (this.editorCompatibility) {
            if (existsSync(path)) {
                try {
                    const data = readJSONSync(path);
                    return {
                        version: '1.0.0',
                        map: data.map || {},
                        missing: data.missing || {},
                    };
                } catch (error) {
                    this.console.warn(error);
                }
            }
            return getDefaultEditorRecordInfo();
        }

        const oldPath = getLegacyInfoPath(path);
        const migrator = new Migrator<any>(migrations, InfoManager.version, {
            onError: (error) => {
                this.console.warn(`migrate error in infoManager: ${error}`);
                this.console.warn(error);
            },
        });

        if (existsSync(oldPath)) {
            try {
                const data = readJSONSync(oldPath);
                await remove(oldPath);
                return await migrator.run(data, '1.0.0', [this]);
            } catch (error) {
                this.console.warn(error);
            }
        } else if (existsSync(path)) {
            try {
                const data = readJSONSync(path);
                return await migrator.run(data, InfoManager.version, [this]);
            } catch (error) {
                this.console.warn(error);
            }
        }
    }

    destroy(): void {
        this.recordInfo = getDefaultRecordInfo();
    }

    save(): void {
        if (this._saveTimer) {
            clearTimeout(this._saveTimer);
        }
        this._saveTimer = setTimeout(() => {
            this.saveImmediate();
        }, 400);
    }

    saveImmediate(): void {
        if (this._saveTimer) {
            clearTimeout(this._saveTimer);
        }
        if (this.file) {
            if (this.editorCompatibility) {
                outputJSONSync(this.file, {
                    version: '1.0.0',
                    map: this.recordInfo.map,
                    missing: this.recordInfo.missing,
                }, { spaces: 2 });
                return;
            }
            const output = getDefaultRecordInfo();
            Object.keys(this.recordInfo.map).forEach((path) => {
                output.map[relative(this.pathRoot, path)] = this.recordInfo.map[path];
            });
            outputJSONSync(this.file, output, { spaces: 2 });
        }
    }

    add(path: string, mtimeMs: number, uuid?: string): void {
        if (this.recordInfo.map[path]
            && this.recordInfo.map[path].uuid === uuid
            && this.recordInfo.map[path].time === mtimeMs) {
            return;
        }
        this.recordInfo.map[path] = uuid ? { time: mtimeMs, uuid } : { time: mtimeMs };
        this.save();
    }

    remove(path: string): void {
        if (!this.recordInfo.map[path]) {
            return;
        }
        const info = this.recordInfo.map[path];
        this.addMissing(path, info);
        delete this.recordInfo.map[path];
        this.save();
    }

    get(path: string): SimpleInfo {
        return (this.recordInfo.map[path] || null) as any;
    }

    private addMissing(path: string, info: SimpleInfo): void {
        if (info.uuid) {
            this.recordInfo.missing[info.uuid] = {
                path,
                time: info.time,
                removeTime: Date.now(),
            };
        }
    }

    getMissingInfo(uuid: string): MissingAssetInfo {
        return (this.recordInfo.missing[uuid] || null) as any;
    }

    compare(path: string, mtimeMs: number): boolean {
        const info = this.recordInfo.map[path];
        return !!info && info.time === mtimeMs;
    }

    async forEach(handler: Function): Promise<void> {
        for (const path in this.recordInfo.map) {
            await handler(path, this.recordInfo.map[path]);
        }
    }
}
