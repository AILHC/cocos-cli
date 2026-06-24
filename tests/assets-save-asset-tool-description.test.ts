import 'reflect-metadata';

jest.mock('../src/core/assets', () => ({
    assetDBManager: {},
    assetManager: {},
}));

jest.mock('../src/api/decorator/decorator.js', () => ({
    description: (desc: string) => (target: object, propertyKey: string | symbol) => {
        Reflect.defineMetadata(`tool:description:${propertyKey.toString()}`, desc, target);
    },
    param: () => jest.fn(),
    result: () => jest.fn(),
    title: () => jest.fn(),
    tool: () => jest.fn(),
}), { virtual: true });

import { AssetsApi } from '../src/api/assets/assets';
import { SchemaAssetData, SchemaSaveAssetPath } from '../src/api/assets/schema';

describe('assets-save-asset tool guidance', () => {
    it('documents required save target and complete asset data', () => {
        const description = Reflect.getOwnMetadata('tool:description:saveAsset', AssetsApi.prototype);

        expect(description).toContain('Do not call this tool with empty arguments');
        expect(description).toContain('pathOrUrlOrUUID');
        expect(description).toContain('data');
        expect(description).toContain('complete file content');
        expect(description).toContain('temporary files');
        expect(description).toContain('scene and prefab');
    });

    it('describes save parameters as required existing asset content', () => {
        expect(SchemaSaveAssetPath.description).toContain('existing asset');
        expect(SchemaAssetData.description).toContain('complete file content');
        expect(SchemaAssetData.description).toMatch(/required/i);
    });
});
