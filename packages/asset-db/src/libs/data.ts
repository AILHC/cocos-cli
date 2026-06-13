import { basename } from 'path';
import { existsSync, outputJSONSync, readJSONSync } from 'fs-extra';
import type { VirtualAsset } from './asset';
import { CustomConsole } from './console';

export interface IData {
    url: string;
    value: {
        [key: string]: any;
    };
    versionCode: number;
}

export class DataManager {
    file: string | undefined;
    dataMap: {
        [uuid: string]: IData;
    } = {};
    _saveTimer: any = null;
    private console: CustomConsole | Console;
    private editorCompatibility = false;

    constructor(customConsole: CustomConsole) {
        this.console = customConsole || console;
    }

    async setRecordJSON(json: string): Promise<void> {
        this.file = json;
        this.editorCompatibility = basename(json) === '.internal-data.json';
        if (existsSync(json)) {
            try {
                this.dataMap = readJSONSync(this.file);
            } catch (error) {
                this.console.error(error);
                this.dataMap = {};
            }
        } else {
            this.dataMap = {};
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
            outputJSONSync(this.file, this.dataMap, { spaces: 2 });
        }
    }

    has(asset: VirtualAsset): boolean {
        return !!this.dataMap[asset.uuid];
    }

    empty(asset: VirtualAsset): void {
        if (this.shouldPreserve(asset)) {
            return;
        }
        this.dataMap[asset.uuid] = {
            url: asset.url,
            value: {},
            versionCode: asset.versionCode,
        };
        this.save();
    }

    update(asset: VirtualAsset): void {
        if (this.shouldPreserve(asset)) {
            return;
        }
        if (!this.dataMap[asset.uuid]) {
            this.dataMap[asset.uuid] = {
                url: asset.url,
                value: {},
                versionCode: asset.versionCode,
            };
        }
        this.dataMap[asset.uuid].url = asset.url;
        this.dataMap[asset.uuid].versionCode = asset.versionCode;
    }

    setValue(asset: VirtualAsset, key: string, value: any): void {
        if (this.shouldPreserve(asset)) {
            return;
        }
        this.update(asset);
        this.dataMap[asset.uuid].value[key] = value;
        this.save();
    }

    getValue(asset: VirtualAsset, key: string): any {
        return this.dataMap[asset.uuid].value[key];
    }

    get(asset: VirtualAsset, key: keyof IData = 'value'): null | any {
        return this.dataMap[asset.uuid] ? this.dataMap[asset.uuid][key] : null;
    }

    private shouldPreserve(asset: VirtualAsset): boolean {
        return this.editorCompatibility && !!this.dataMap[asset.uuid];
    }
}
