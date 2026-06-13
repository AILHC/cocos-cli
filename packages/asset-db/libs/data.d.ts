import type { VirtualAsset } from './asset';
import { CustomConsole } from './console';
export interface IData {
    url: string;
    value: {
        [key: string]: any;
    };
    versionCode: number;
}
export declare class DataManager {
    file: string | undefined;
    dataMap: {
        [uuid: string]: IData;
    };
    _saveTimer: any;
    private console;
    private editorCompatibility;
    constructor(customConsole: CustomConsole);
    setRecordJSON(json: string): Promise<void>;
    save(): void;
    saveImmediate(): void;
    has(asset: VirtualAsset): boolean;
    empty(asset: VirtualAsset): void;
    update(asset: VirtualAsset): void;
    setValue(asset: VirtualAsset, key: string, value: any): void;
    getValue(asset: VirtualAsset, key: string): any;
    get(asset: VirtualAsset, key?: keyof IData): null | any;
    private shouldPreserve;
}
