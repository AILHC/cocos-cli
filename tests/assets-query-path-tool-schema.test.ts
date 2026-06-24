jest.mock('../src/core/assets', () => ({
    assetDBManager: {},
    assetManager: {},
}));

jest.mock('../src/api/decorator/decorator.js', () => jest.requireActual('../src/api/decorator/decorator'), { virtual: true });

import { toolRegistry } from '../src/api/decorator/decorator.js';
import '../src/api/assets/assets';

describe('assets-query-path tool schema', () => {
    it('accepts asset-db relative paths before MCP handler execution', () => {
        const tool = toolRegistry.get('assets-query-path');
        const schema = tool?.meta.paramSchemas.find((param) => param.name === 'urlOrUuid')?.schema;

        expect(schema).toBeDefined();
        expect(schema!.parse('assets/resources/Image/gem_red.png')).toBe('assets/resources/Image/gem_red.png');
    });
});
