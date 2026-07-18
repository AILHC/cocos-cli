jest.mock('cc', () => ({}));

const canonicalUuidValues = new Set([
    'fcmR3XADNLgJ1ByKhqcC5Z',
    'fc9913XADNLgJ1ByKhqcC5Z',
    'fc991dd700334b809d41c8a86a702e59',
    'fc991dd7-0033-4b80-9d41-c8a86a702e59',
]);
const canonicalIsUUID = jest.fn((value: string) => canonicalUuidValues.has(value));
const previousEditorExtends = (globalThis as any).EditorExtends;

(globalThis as any).EditorExtends = {
    UuidUtils: {
        isUUID: canonicalIsUUID,
    },
};

const componentUtils = require('../../scene-process/service/component/utils').default;

describe('component utils isUUID', () => {
    beforeEach(() => {
        canonicalIsUUID.mockClear();
    });

    afterAll(() => {
        if (previousEditorExtends === undefined) {
            delete (globalThis as any).EditorExtends;
        } else {
            (globalThis as any).EditorExtends = previousEditorExtends;
        }
    });

    it.each([
        ['compressed 22-character UUID', 'fcmR3XADNLgJ1ByKhqcC5Z'],
        ['compressed 23-character UUID', 'fc9913XADNLgJ1ByKhqcC5Z'],
        ['normalized UUID', 'fc991dd700334b809d41c8a86a702e59'],
        ['dashed UUID', 'fc991dd7-0033-4b80-9d41-c8a86a702e59'],
    ])('accepts %s through the canonical UUID utility', (_name, value) => {
        expect(componentUtils.isUUID(value)).toBe(true);
        expect(canonicalIsUUID).toHaveBeenCalledWith(value);
    });

    it('keeps legacy Comp.N component IDs without canonical conversion', () => {
        expect(componentUtils.isUUID('Comp.42')).toBe(true);
        expect(canonicalIsUUID).not.toHaveBeenCalled();
    });

    it.each([
        ['component path', 'Canvas/cc.Label'],
        ['asset URL', 'db://assets/scripts/example.ts'],
        ['random text', 'not-a-uuid'],
    ])('rejects %s', (_name, value) => {
        expect(componentUtils.isUUID(value)).toBe(false);
        expect(canonicalIsUUID).toHaveBeenCalledWith(value);
    });
});
