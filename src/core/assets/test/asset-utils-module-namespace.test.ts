import {
    resolveDecodeCCONBinary,
    resolveEngineModuleFunction,
} from '../asset-handler/assets/gltf/serialization-namespace';

describe('asset utils engine module namespace compatibility', () => {
    it('prefers the named function over default and initialized-realm exports', () => {
        const named = jest.fn();
        const defaultExport = jest.fn();
        const initializedRealm = jest.fn();

        expect(resolveEngineModuleFunction(
            { deserialize: named, default: { deserialize: defaultExport } },
            'deserialize',
            'cc',
            initializedRealm,
        )).toBe(named);
    });

    it('uses the default function before the initialized engine realm', () => {
        const defaultExport = jest.fn();
        const initializedRealm = jest.fn();

        expect(resolveEngineModuleFunction(
            { default: { deserialize: defaultExport } },
            'deserialize',
            'cc',
            initializedRealm,
        )).toBe(defaultExport);
    });

    it('uses the initialized engine realm when the module namespace omits deserialize', () => {
        const initializedRealm = jest.fn();

        expect(resolveEngineModuleFunction(
            { default: {} },
            'deserialize',
            'cc',
            initializedRealm,
        )).toBe(initializedRealm);
    });

    it('resolves decodeCCONBinary from a default-only serialization namespace', () => {
        const decodeCCONBinary = jest.fn();

        expect(resolveDecodeCCONBinary({ default: { decodeCCONBinary } })).toBe(decodeCCONBinary);
    });

    it('fails clearly when no compatible engine realm export exists', () => {
        expect(() => resolveEngineModuleFunction({ default: {} }, 'deserialize', 'cc')).toThrow(
            'cc does not provide deserialize as a named export, on its default export, or on the initialized engine realm.',
        );
    });
});
