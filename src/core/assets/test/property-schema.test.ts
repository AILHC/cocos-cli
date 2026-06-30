import {
    convertUserDataConfigItemToPropertySchema,
    convertUserDataConfigToPropertySchema,
    mergeUserDataConfigForPropertySchema,
} from '../property-schema';
import i18n from '../../base/i18n';
import { readFileSync } from 'fs';
import { join } from 'path';

describe('asset property schema conversion', () => {
    afterEach(async () => {
        await i18n.setLanguage('en');
    });

    it('maps legacy userDataConfig controls to stable property schema fields', () => {
        const schema = convertUserDataConfigToPropertySchema({
            type: {
                label: 'Import Type',
                default: 'sprite-frame',
                render: {
                    ui: 'ui-select',
                    items: [
                        { label: 'Raw', value: 'raw' },
                        { label: 'Sprite Frame', value: 'sprite-frame' },
                    ],
                },
            },
            flipVertical: {
                label: 'Flip Vertical',
                render: {
                    ui: 'ui-checkbox',
                },
            },
            quality: {
                label: 'Quality',
                default: 80,
                render: {
                    ui: 'ui-number-input',
                    attributes: {
                        min: 0,
                        max: 100,
                        step: 1,
                    },
                },
            },
            image: {
                label: 'Image',
                default: '',
                render: {
                    ui: 'ui-asset',
                    attributes: {
                        assetType: 'cc.ImageAsset',
                    },
                },
            },
        });

        expect(schema.type).toMatchObject({
            label: 'Import Type',
            type: 'enum',
            default: 'sprite-frame',
            options: [
                { label: 'Raw', value: 'raw' },
                { label: 'Sprite Frame', value: 'sprite-frame' },
            ],
        });
        expect(schema.flipVertical.type).toBe('boolean');
        expect(schema.quality).toMatchObject({
            type: 'number',
            min: 0,
            max: 100,
            step: 1,
        });
        expect(schema.image).toMatchObject({
            type: 'asset',
            assetType: 'cc.ImageAsset',
        });
        expect(schema.type).not.toHaveProperty('raw');
        expect(schema.flipVertical).not.toHaveProperty('raw');
        expect(schema.quality).not.toHaveProperty('raw');
        expect(schema.image).not.toHaveProperty('raw');
    });

    it('normalizes numeric enum option values when the default is numeric', () => {
        const schema = convertUserDataConfigItemToPropertySchema('meshType', {
            label: 'Mesh Type',
            default: 0,
            render: {
                ui: 'ui-select',
                items: [
                    { label: 'Rect', value: '0' },
                    { label: 'Polygon', value: '1' },
                ],
            },
        });

        expect(schema.type).toBe('enum');
        expect(schema.options).toEqual([
            { label: 'Rect', value: 0 },
            { label: 'Polygon', value: 1 },
        ]);
    });

    it('localizes display fields before returning the property schema', async () => {
        i18n.registerLanguagePatch('en', 'assets.propertySchemaTest', {
            field: 'Localized Field',
            help: 'Localized Help',
            option: 'Localized Option',
        });
        i18n.registerLanguagePatch('zh', 'assets.propertySchemaTest', {
            field: 'ZH Field',
            help: 'ZH Help',
            option: 'ZH Option',
        });

        await i18n.setLanguage('en');
        const enSchema = convertUserDataConfigItemToPropertySchema('localized', {
            label: 'i18n:assets.propertySchemaTest.field',
            description: 'i18n:assets.propertySchemaTest.help',
            default: 'enabled',
            render: {
                ui: 'ui-select',
                items: [
                    { label: 'i18n:assets.propertySchemaTest.option', value: 'enabled' },
                ],
            },
        });

        expect(enSchema).toMatchObject({
            label: 'Localized Field',
            description: 'Localized Help',
            options: [
                {
                    label: 'Localized Option',
                    value: 'enabled',
                },
            ],
        });
        expect(enSchema).not.toHaveProperty('labelI18nKey');
        expect(enSchema).not.toHaveProperty('descriptionI18nKey');
        expect(enSchema.options?.[0]).not.toHaveProperty('labelI18nKey');

        await i18n.setLanguage('zh');
        const zhSchema = convertUserDataConfigItemToPropertySchema('localized', {
            label: 'i18n:assets.propertySchemaTest.field',
            description: 'i18n:assets.propertySchemaTest.help',
            default: 'enabled',
            render: {
                ui: 'ui-select',
                items: [
                    { label: 'i18n:assets.propertySchemaTest.option', value: 'enabled' },
                ],
            },
        });

        expect(zhSchema.label).toBe('ZH Field');
        expect(zhSchema.description).toBe('ZH Help');
        expect(zhSchema.options?.[0].label).toBe('ZH Option');
    });

    it('uses static importer i18n resources loaded by the shared i18n instance', async () => {
        await i18n.setLanguage('zh');

        const schema = convertUserDataConfigItemToPropertySchema('maxWidth', {
            label: 'i18n:importer.property_schema.auto_atlas.max_width',
            default: 1024,
            render: { ui: 'ui-number-input' },
        });

        expect(schema.label).toBe('最大宽度');
        expect(schema).not.toHaveProperty('labelI18nKey');
    });

    it('keeps built-in property schema i18n keys resolvable', () => {
        const engineAssetsI18n = require('../../../../packages/engine/editor/i18n/en/assets.js');
        const importerI18n = {
            en: JSON.parse(readFileSync(join(__dirname, '../../../../static/i18n/en/importer.json'), 'utf8')),
            zh: JSON.parse(readFileSync(join(__dirname, '../../../../static/i18n/zh/importer.json'), 'utf8')),
        };
        const files = [
            join(__dirname, '../asset-handler/assets/auto-atlas.ts'),
            join(__dirname, '../asset-handler/assets/gltf.ts'),
            join(__dirname, '../asset-handler/assets/fbx.ts'),
            join(__dirname, '../asset-handler/assets/image/index.ts'),
            join(__dirname, '../asset-handler/assets/sprite-frame.ts'),
            join(__dirname, '../asset-handler/assets/texture-base.ts'),
            join(__dirname, '../asset-handler/assets/texture.ts'),
        ];
        const missingKeys: string[] = [];

        for (const file of files) {
            const source = extractPropertySchemaSource(readFileSync(file, 'utf8'));
            for (const match of source.matchAll(/i18n:ENGINE\.([A-Za-z0-9_.]+)/g)) {
                if (readNestedValue(engineAssetsI18n, match[1]) === undefined) {
                    missingKeys.push(match[0]);
                }
            }
            for (const match of source.matchAll(/i18n:importer\.([A-Za-z0-9_.]+)/g)) {
                if (readNestedValue(importerI18n.en, match[1]) === undefined) {
                    missingKeys.push(`${match[0]}#en`);
                }
                if (readNestedValue(importerI18n.zh, match[1]) === undefined) {
                    missingKeys.push(`${match[0]}#zh`);
                }
            }
        }

        expect(missingKeys).toEqual([]);
    });

    it('keeps nested object itemConfigs as nested properties', () => {
        const schema = convertUserDataConfigItemToPropertySchema('textureSetting', {
            label: 'Texture Setting',
            type: 'object',
            default: {
                anisotropy: 0,
            },
            itemConfigs: {
                anisotropy: {
                    label: 'Anisotropy',
                    default: 0,
                    render: {
                        ui: 'ui-number-input',
                        attributes: {
                            min: 0,
                            step: 1,
                        },
                    },
                },
            },
        });

        expect(schema).toMatchObject({
            label: 'Texture Setting',
            type: 'object',
            properties: {
                anisotropy: {
                    label: 'Anisotropy',
                    type: 'number',
                    default: 0,
                    min: 0,
                    step: 1,
                },
            },
        });
        expect(schema).not.toHaveProperty('raw');
        expect(schema.properties?.anisotropy).not.toHaveProperty('raw');
    });

    it('treats array-form itemConfigs as object properties when the parent is not an array', () => {
        const schema = convertUserDataConfigItemToPropertySchema('rect', {
            label: 'Rect',
            itemConfigs: [
                {
                    key: 'x',
                    label: 'X',
                    default: 0,
                    render: { ui: 'ui-number-input' },
                },
            ],
        });

        expect(schema).toMatchObject({
            label: 'Rect',
            type: 'object',
            properties: {
                x: {
                    label: 'X',
                    type: 'number',
                    default: 0,
                },
            },
        });
        expect(schema).not.toHaveProperty('raw');
        expect(schema.properties?.x).not.toHaveProperty('raw');
    });

    it('does not expose raw legacy config through array item schemas', () => {
        const schema = convertUserDataConfigItemToPropertySchema('entries', {
            label: 'Entries',
            type: 'array',
            itemConfigs: [
                {
                    key: 'name',
                    label: 'Name',
                    default: '',
                    render: { ui: 'ui-input' },
                },
            ],
        });

        expect(schema).toMatchObject({
            label: 'Entries',
            type: 'array',
            items: {
                label: 'Name',
                type: 'string',
                default: '',
            },
        });
        expect(schema).not.toHaveProperty('raw');
        expect(schema.items).not.toHaveProperty('raw');
    });

    it('merges schema-only config for property schema without mutating runtime userDataConfig', () => {
        const runtimeConfig = {
            runtimeOnly: {
                label: 'Runtime Only',
                default: true,
                render: { ui: 'ui-checkbox' },
            },
        };
        const schemaOnlyConfig = {
            schemaOnly: {
                label: 'Schema Only',
                default: 1,
                render: { ui: 'ui-number-input' },
            },
        };

        const mergedConfig = mergeUserDataConfigForPropertySchema(runtimeConfig, schemaOnlyConfig);
        const schema = convertUserDataConfigToPropertySchema(mergedConfig);

        expect(schema).toMatchObject({
            runtimeOnly: {
                label: 'Runtime Only',
                type: 'boolean',
                default: true,
            },
            schemaOnly: {
                label: 'Schema Only',
                type: 'number',
                default: 1,
            },
        });
        expect(runtimeConfig).toHaveProperty('runtimeOnly');
        expect(runtimeConfig).not.toHaveProperty('schemaOnly');
    });
});

function readNestedValue(value: unknown, key: string): unknown {
    return key.split('.').reduce<unknown>((result, segment) => {
        if (!result || typeof result !== 'object') {
            return undefined;
        }
        return (result as Record<string, unknown>)[segment];
    }, value);
}

function extractPropertySchemaSource(source: string): string {
    const start = [
        source.indexOf('propertySchemaConfig'),
        source.indexOf('userDataConfig'),
        source.indexOf('createTextureBaseUserDataConfig'),
    ].filter((index) => index >= 0).sort((a, b) => a - b)[0];
    return start === undefined ? source : source.slice(start);
}
