const mockUpdateUserData = jest.fn();
const mockUpdateUserDataByPath = jest.fn();

jest.mock('../src/core/assets', () => ({
    assetDBManager: {},
    assetManager: {
        updateUserData: (...args: unknown[]) => mockUpdateUserData(...args),
        updateUserDataByPath: (...args: unknown[]) => mockUpdateUserDataByPath(...args),
    },
}));

jest.mock('../src/api/decorator/decorator.js', () => jest.requireActual('../src/api/decorator/decorator'), { virtual: true });

import { toolRegistry } from '../src/api/decorator/decorator.js';
import { COMMON_STATUS } from '../src/api/base/schema-base';
import { AssetsApi } from '../src/api/assets/assets';

describe('assets-update-asset-user-data api', () => {
    beforeEach(() => {
        mockUpdateUserData.mockReset();
        mockUpdateUserDataByPath.mockReset();
    });

    it('does not register a separate meta userData update tool', () => {
        expect(toolRegistry.get('assets-update-asset-meta-user-data')).toBeUndefined();
    });

    it('accepts sub asset UUID as the target asset identifier', () => {
        const tool = toolRegistry.get('assets-update-asset-user-data');
        const schema = tool?.meta.paramSchemas.find((param) => param.name === 'urlOrUuidOrPath')?.schema;

        expect(schema).toBeDefined();
        expect(schema!.parse('6FA5FBAD0D324B6395D824507665775C@6C48A')).toBe('6fa5fbad-0d32-4b63-95d8-24507665775c@6c48a');
    });

    it('delegates complete userData replacement to assetManager.updateUserData', async () => {
        const userData = { minfilter: 'nearest', wrapMode: 'clamp' };
        const updatedUserData = { ...userData };
        mockUpdateUserData.mockResolvedValue(updatedUserData);

        const result = await new AssetsApi().updateAssetUserData(
            '6fa5fbad-0d32-4b63-95d8-24507665775c@6c48a',
            userData,
        );

        expect(result).toEqual({
            code: COMMON_STATUS.SUCCESS,
            data: updatedUserData,
        });
        expect(mockUpdateUserData).toHaveBeenCalledWith(
            '6fa5fbad-0d32-4b63-95d8-24507665775c@6c48a',
            userData,
        );
    });

    it('delegates path updates to assetManager.updateUserDataByPath', async () => {
        const updatedUserData = { minfilter: 'nearest' };
        mockUpdateUserDataByPath.mockResolvedValue(updatedUserData);

        const result = await new AssetsApi().updateAssetUserDataByPath(
            '6fa5fbad-0d32-4b63-95d8-24507665775c@6c48a',
            'minfilter',
            'nearest',
        );

        expect(result).toEqual({
            code: COMMON_STATUS.SUCCESS,
            data: updatedUserData,
        });
        expect(mockUpdateUserDataByPath).toHaveBeenCalledWith(
            '6fa5fbad-0d32-4b63-95d8-24507665775c@6c48a',
            'minfilter',
            'nearest',
        );
    });
});
