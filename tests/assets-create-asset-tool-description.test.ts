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
import { SchemaCreateAssetOptions } from '../src/api/assets/schema';

describe('assets-create-asset tool guidance', () => {
    it('documents db URL requirements for create asset targets and templates', () => {
        const description = Reflect.getOwnMetadata('tool:description:createAsset', AssetsApi.prototype);
        const shape = SchemaCreateAssetOptions.shape;

        expect(description).toContain('db://assets');
        expect(description).toContain('asset-db URL');
        expect(description).toContain('absolute file path inside an asset database');

        expect(shape.target.description).toContain('db://assets');
        expect(shape.target.description).toContain('asset-db URL');
        expect(shape.target.description).toContain('absolute file path inside an asset database');
        expect(shape.target.description).not.toContain('supports absolute path and url');

        expect(shape.template.description).toContain('db://');
        expect(shape.template.description).toContain('asset-db URL');
        expect(shape.template.description).not.toContain('supports url and absolute path');
    });
});
