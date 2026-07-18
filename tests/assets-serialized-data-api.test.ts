const mockQuerySerializedData = jest.fn();
const mockSaveSerializedData = jest.fn();

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
        querySerializedData: (...args: unknown[]) => mockQuerySerializedData(...args),
        saveSerializedData: (...args: unknown[]) => mockSaveSerializedData(...args),
    },
}));

import { AssetsApi } from '../src/api/assets/assets';
import { SchemaSerializedAssetPatch, SchemaUrlOrUUIDOrPath } from '../src/api/assets/schema';
import { COMMON_STATUS } from '../src/api/base/schema-base';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

function findArraySchemasWithoutItems(node: unknown, path = '$', result: string[] = []): string[] {
    if (!node || typeof node !== 'object') {
        return result;
    }

    if (!Array.isArray(node) && (node as { type?: unknown }).type === 'array' && !('items' in node)) {
        result.push(path);
    }

    if (Array.isArray(node)) {
        node.forEach((child, index) => findArraySchemasWithoutItems(child, `${path}[${index}]`, result));
        return result;
    }

    Object.entries(node as Record<string, unknown>).forEach(([key, value]) => {
        findArraySchemasWithoutItems(value, `${path}.${key}`, result);
    });

    return result;
}

describe('assets serialized data api', () => {
    beforeEach(() => {
        mockQuerySerializedData.mockReset();
        mockSaveSerializedData.mockReset();
    });

    it('delegates querySerializedData to assetManager', async () => {
        const result = {
            uuid: 'test-uuid',
            url: 'db://assets/test.pmtl',
            type: 'cc.PhysicsMaterial',
            importer: 'physics-material',
            dump: {},
        };
        mockQuerySerializedData.mockResolvedValue(result);

        await expect(new AssetsApi().querySerializedData('test-uuid')).resolves.toEqual({
            code: COMMON_STATUS.SUCCESS,
            data: result,
        });
        expect(mockQuerySerializedData).toHaveBeenCalledWith('test-uuid');
    });

    it('delegates saveSerializedData to assetManager', async () => {
        const result = {
            uuid: 'test-uuid',
            url: 'db://assets/test.pmtl',
            type: 'cc.PhysicsMaterial',
            importer: 'physics-material',
            dump: {},
        };
        const patch = { friction: { value: 0.25 } };
        mockSaveSerializedData.mockResolvedValue(result);

        await expect(new AssetsApi().saveSerializedData('test-uuid', patch)).resolves.toEqual({
            code: COMMON_STATUS.SUCCESS,
            data: result,
        });
        expect(mockSaveSerializedData).toHaveBeenCalledWith('test-uuid', patch);
    });

    it('emits Pink-compatible array items for saveSerializedData schema', () => {
        const inputSchema = zodToJsonSchema(z.object({
            uuidOrUrlOrPath: SchemaUrlOrUUIDOrPath,
            patch: SchemaSerializedAssetPatch,
        }), {
            target: 'jsonSchema7',
            $refStrategy: 'none',
        });

        expect(findArraySchemasWithoutItems(inputSchema)).toEqual([]);
    });
});
