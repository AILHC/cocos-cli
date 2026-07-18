import { resolveFsExtraSync } from '../asset-handler/fs-extra-namespace';

describe('fs-extra namespace resolver', () => {
    it('returns named sync APIs', () => {
        const existsSync = jest.fn();
        const statSync = jest.fn();

        expect(resolveFsExtraSync({ existsSync, statSync })).toEqual({ existsSync, statSync });
    });

    it('returns sync APIs from a default-only CommonJS namespace', () => {
        const existsSync = jest.fn();
        const statSync = jest.fn();

        expect(resolveFsExtraSync({ default: { existsSync, statSync } })).toEqual({ existsSync, statSync });
    });

    it('fails clearly when required sync APIs are missing', () => {
        expect(() => resolveFsExtraSync({ default: { existsSync: jest.fn() } })).toThrow(
            'fs-extra namespace does not provide required sync API(s): statSync '
            + 'as named exports or on its default export.',
        );
    });
});
