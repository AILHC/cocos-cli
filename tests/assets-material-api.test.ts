const mockQueryMaterialAllEffects = jest.fn();
const mockQueryMaterialEffect = jest.fn();
const mockQueryMaterial = jest.fn();
const mockSaveMaterial = jest.fn();

jest.mock('../src/api/decorator/decorator.js', () => ({
    description: () => jest.fn(),
    param: () => jest.fn(),
    result: () => jest.fn(),
    title: () => jest.fn(),
    tool: () => jest.fn(),
}), { virtual: true });

jest.mock('../src/core/assets', () => ({
    assetDBManager: {},
    assetManager: {
        queryMaterialAllEffects: (...args: unknown[]) => mockQueryMaterialAllEffects(...args),
        queryMaterialEffect: (...args: unknown[]) => mockQueryMaterialEffect(...args),
        queryMaterial: (...args: unknown[]) => mockQueryMaterial(...args),
        saveMaterial: (...args: unknown[]) => mockSaveMaterial(...args),
    },
}));

import { AssetsApi } from '../src/api/assets/assets';
import { COMMON_STATUS } from '../src/api/base/schema-base';

describe('assets material api', () => {
    beforeEach(() => {
        mockQueryMaterialAllEffects.mockReset();
        mockQueryMaterialEffect.mockReset();
        mockQueryMaterial.mockReset();
        mockSaveMaterial.mockReset();
    });

    it('delegates material API methods to assetManager', async () => {
        const effects = {
            'effect-uuid': {
                uuid: 'effect-uuid',
                name: 'builtin-standard',
                hideInEditor: false,
                assetPath: 'db://internal/effects/builtin-standard.effect',
            },
        };
        const effectDump = [{ name: 'default', passes: [] }];
        const materialDump = {
            effect: 'effect-uuid',
            technique: 0,
            data: effectDump,
        };

        mockQueryMaterialAllEffects.mockResolvedValue(effects);
        mockQueryMaterialEffect.mockResolvedValue(effectDump);
        mockQueryMaterial.mockResolvedValue(materialDump);
        mockSaveMaterial.mockResolvedValue(undefined);

        const api = new AssetsApi();

        await expect(api.queryMaterialAllEffects()).resolves.toEqual({
            code: COMMON_STATUS.SUCCESS,
            data: effects,
        });
        await expect(api.queryMaterialEffect('effect-uuid')).resolves.toEqual({
            code: COMMON_STATUS.SUCCESS,
            data: effectDump,
        });
        await expect(api.queryMaterial('material-uuid')).resolves.toEqual({
            code: COMMON_STATUS.SUCCESS,
            data: materialDump,
        });
        await expect(api.saveMaterial('material-uuid', materialDump)).resolves.toEqual({
            code: COMMON_STATUS.SUCCESS,
            data: null,
        });

        expect(mockQueryMaterialAllEffects).toHaveBeenCalledWith();
        expect(mockQueryMaterialEffect).toHaveBeenCalledWith('effect-uuid');
        expect(mockQueryMaterial).toHaveBeenCalledWith('material-uuid');
        expect(mockSaveMaterial).toHaveBeenCalledWith('material-uuid', materialDump);
    });
});

