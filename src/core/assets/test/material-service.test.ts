'use strict';

jest.mock('gl', () => {
    const createShader = (type: number) => ({ type });
    const noop = () => undefined;
    return () => ({
        VERTEX_SHADER: 35633,
        FRAGMENT_SHADER: 35632,
        COMPILE_STATUS: 35713,
        LINK_STATUS: 35714,
        getSupportedExtensions: () => [],
        getExtension: noop,
        createShader,
        shaderSource: noop,
        compileShader: noop,
        getShaderParameter: () => true,
        getShaderInfoLog: () => '',
        deleteShader: noop,
        createProgram: () => ({}),
        attachShader: noop,
        linkProgram: noop,
        getProgramParameter: () => true,
        getProgramInfoLog: () => '',
        deleteProgram: noop,
    });
});

import { readJSON, remove } from 'fs-extra';
import { globalSetup } from '../../test/global-setup';
import { TestGlobalEnv } from '../../../tests/global-env';
import { assetManager } from '..';
import type { IProperty, MaterialDump, MaterialPassDump } from '../@types/public';

describe('material asset service', function () {
    const name = `material-service-${Date.now()}`;

    beforeAll(async () => {
        await globalSetup();
    });

    afterAll(async () => {
        try {
            await assetManager.removeAsset(TestGlobalEnv.testRootUrl);
        } catch (error) {
            // Test root may already be absent if a previous test cleaned it.
        }
        await remove(TestGlobalEnv.testRoot);
        await remove(TestGlobalEnv.testRoot + '.meta');
    });

    it('queries all effects with stable UUID keys', async () => {
        const effects = await assetManager.queryMaterialAllEffects();
        const standard = Object.values(effects).find((effect) => effect.name.includes('builtin-standard'));

        expect(Object.keys(effects).length).toBeGreaterThan(0);
        expect(standard).toMatchObject({
            uuid: expect.any(String),
            name: expect.any(String),
            assetPath: expect.any(String),
        });
        expect(standard!.assetPath).toMatch(/^db:\/\//);
    });

    it('queries an effect as technique/pass dump data', async () => {
        const effects = await assetManager.queryMaterialAllEffects();
        const standard = Object.values(effects).find((effect) => effect.name.includes('builtin-standard'));

        expect(standard).toBeDefined();
        const data = await assetManager.queryMaterialEffect(standard!.uuid);

        expect(data.length).toBeGreaterThan(0);
        expect(data[0].passes.length).toBeGreaterThan(0);
        expect(data[0].passes[0]).toMatchObject({
            index: 0,
            propertyIndex: {
                value: expect.any(Number),
            },
            props: expect.any(Array),
            defines: expect.any(Array),
        });
    });

    it('queries a material by merging effect defaults and .mtl overrides', async () => {
        const assetInfo = await assetManager.createAssetByType(
            'material',
            TestGlobalEnv.testRoot,
            `${name}-query`,
            { overwrite: true },
        );

        const result = await assetManager.queryMaterial(assetInfo.uuid);

        expect(result.effect).toEqual(expect.any(String));
        expect(result.technique).toBe(0);
        expect(result.data.length).toBeGreaterThan(0);
        expect(result.data[result.technique].passes.length).toBeGreaterThan(0);
    });

    it('saves modified material dump values and reads them back', async () => {
        const assetInfo = await assetManager.createAssetByType(
            'material',
            TestGlobalEnv.testRoot,
            `${name}-save`,
            { overwrite: true },
        );

        const before = await assetManager.queryMaterial(assetInfo.uuid);
        const edit = findEditablePrimitive(before);

        expect(edit).toBeDefined();
        edit!.property.value = nextPrimitiveValue(edit!.property.value);

        await assetManager.saveMaterial(assetInfo.uuid, before);

        const after = await assetManager.queryMaterial(assetInfo.uuid);
        const afterPass = after.data[after.technique].passes[edit!.passIndex];
        const afterProperty = [...afterPass.props, ...afterPass.defines].find((prop) => prop.name === edit!.property.name);

        expect(afterProperty?.value).toEqual(edit!.property.value);
    });

    it('saves value type and asset reference material properties', async () => {
        const assetInfo = await assetManager.createAssetByType(
            'material',
            TestGlobalEnv.testRoot,
            `${name}-save-complex`,
            { overwrite: true },
        );
        const textureInfo = await assetManager.queryAssetInfo('db://assets/atlas/2.png@6c48a');

        expect(textureInfo).not.toBeNull();

        const before = await assetManager.queryMaterial(assetInfo.uuid);
        const colorProperty = findMaterialProperty(before, 'mainColor')?.property;
        const textureProperty = findMaterialProperty(before, 'mainTexture')?.property;

        expect(colorProperty).toBeDefined();
        expect(textureProperty).toBeDefined();

        colorProperty!.value = { r: 12, g: 34, b: 56, a: 78 };
        textureProperty!.value = { uuid: textureInfo!.uuid };

        await assetManager.saveMaterial(assetInfo.uuid, before);

        const after = await assetManager.queryMaterial(assetInfo.uuid);
        expect(findMaterialProperty(after, 'mainColor')?.property.value).toEqual(colorProperty!.value);
        expect(findMaterialProperty(after, 'mainTexture')?.property.value).toMatchObject({
            uuid: textureInfo!.uuid,
        });

        const savedInfo = await assetManager.queryAssetInfo(assetInfo.uuid);
        const savedSource = await readJSON(savedInfo!.file);
        expect(savedSource._props[0].mainColor).toMatchObject({
            __type__: 'cc.Color',
            r: 12,
            g: 34,
            b: 56,
            a: 78,
        });
        expect(savedSource._props[0].mainTexture).toMatchObject({
            __uuid__: textureInfo!.uuid,
        });
    });
});

function findEditablePrimitive(dump: MaterialDump): { passIndex: number; pass: MaterialPassDump; property: IProperty } | undefined {
    const technique = dump.data[dump.technique];
    for (let passIndex = 0; passIndex < technique.passes.length; passIndex++) {
        const pass = technique.passes[passIndex];
        for (const property of [...pass.props, ...pass.defines]) {
            if (!property.name || property.visible === false || property.readonly === true) {
                continue;
            }
            if (['number', 'boolean', 'string'].includes(typeof property.value)) {
                return { passIndex, pass, property };
            }
        }
    }
    return undefined;
}

function findMaterialProperty(dump: MaterialDump, name: string): { passIndex: number; pass: MaterialPassDump; property: IProperty } | undefined {
    const technique = dump.data[dump.technique];
    for (let passIndex = 0; passIndex < technique.passes.length; passIndex++) {
        const pass = technique.passes[passIndex];
        const property = [...pass.props, ...pass.defines].find((item) => item.name === name);
        if (property) {
            return { passIndex, pass, property };
        }
    }
    return undefined;
}

function nextPrimitiveValue(value: any) {
    switch (typeof value) {
        case 'number':
            return value + 1;
        case 'boolean':
            return !value;
        case 'string':
            return `${value}-changed`;
        default:
            return value;
    }
}
