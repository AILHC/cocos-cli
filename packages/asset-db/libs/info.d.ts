/// <reference types="node" preserve="true" />
import { CustomConsole } from './console';
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
export declare class InfoManager {
    static version: string;
    private file?;
    pathRoot: string;
    private recordInfo;
    private console;
    private editorCompatibility;
    _saveTimer: null | NodeJS.Timeout;
    constructor(customConsole: CustomConsole, pathRoot: string);
    setRecordJSON(path: string): Promise<void>;
    private _restoreCache;
    private _readRecordInfo;
    destroy(): void;
    save(): void;
    saveImmediate(): void;
    add(path: string, mtimeMs: number, uuid?: string): void;
    remove(path: string): void;
    get(path: string): SimpleInfo;
    private addMissing;
    getMissingInfo(uuid: string): MissingAssetInfo;
    compare(path: string, mtimeMs: number): boolean;
    forEach(handler: Function): Promise<void>;
}
