import path from 'path';

const TJS = require('typescript-json-schema') as typeof import('typescript-json-schema');

describe('cocos config schema', () => {
    function resolveDefinition(schema: any, ref: string): any {
        return schema.definitions[ref.replace('#/definitions/', '')];
    }

    function generateSchema(): any {
        const input = path.resolve(__dirname, '../@types/cocos.config.d.ts');
        const program = TJS.getProgramFromFiles([input], {
            skipLibCheck: true,
        }, path.resolve(__dirname, '../../../..'));
        return TJS.generateSchema(program, 'COCOS_CONFIG', {
            noExtraProps: true,
            skipLibCheck: true,
        });
    }

    it('allows only CLI-owned overlay fields at the top level', () => {
        const schema = generateSchema();

        expect(schema?.properties?.$schema).toBeDefined();
        expect(schema?.properties?.version).toBeDefined();
        expect(schema?.properties?.import).toBeDefined();
        expect(schema?.properties?.builder).toBeUndefined();
        expect(schema?.properties?.engine).toBeUndefined();
        expect(schema?.properties?.scene).toBeUndefined();
        expect(schema?.properties?.script).toBeUndefined();
    });

    it('allows only CLI-owned import overlay fields', () => {
        const schema = generateSchema();
        const importRef = schema.properties.import.$ref;
        const importOverlay = resolveDefinition(schema, importRef);

        expect(importOverlay.properties.restoreAssetDBFromCache).toBeDefined();
        expect(importOverlay.properties.globList).toBeDefined();
        expect(importOverlay.properties.createTemplateRoot).toBeDefined();
        expect(importOverlay.properties.fbx).toBeUndefined();
        expect(importOverlay.properties.default).toBeUndefined();
    });
});
