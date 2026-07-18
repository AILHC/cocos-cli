import { resolveDecodeCCONBinary } from '../asset-handler/assets/gltf/serialization-namespace';

describe('gltf serialization namespace resolver', () => {
    it('returns a named decodeCCONBinary export', () => {
        const decodeCCONBinary = jest.fn();

        expect(resolveDecodeCCONBinary({ decodeCCONBinary })).toBe(decodeCCONBinary);
    });

    it('returns decodeCCONBinary from a default-only namespace', () => {
        const decodeCCONBinary = jest.fn();

        expect(resolveDecodeCCONBinary({ default: { decodeCCONBinary } })).toBe(decodeCCONBinary);
    });

    it('fails clearly when neither namespace shape provides decodeCCONBinary', () => {
        expect(() => resolveDecodeCCONBinary({ default: {} })).toThrow(
            'cc/editor/serialization does not provide decodeCCONBinary as a named export or on its default export.',
        );
    });
});
