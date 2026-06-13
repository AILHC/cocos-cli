import { CustomConsole } from './console';
interface DependMap {
    path: {
        [path: string]: string[];
    };
    uuid: {
        [uuid: string]: string[];
    };
}
export declare class DependencyManager {
    static version: string;
    file?: string;
    pathRoot: string;
    dependMap: DependMap;
    _saveTimer: any;
    private console;
    constructor(customConsole: CustomConsole, pathRoot: string);
    setRecordJSON(path: string): Promise<void>;
    private _restoreCache;
    private readRecordJSON;
    save(): void;
    saveImmediate(): void;
    add(type: string, key: string, depends: string | string[]): void;
    remove(type: string, key: string): void;
    destroy(): void;
}
export declare function getAssociatedFiles(urlOrPathOrUUID: string): string[];
export {};
