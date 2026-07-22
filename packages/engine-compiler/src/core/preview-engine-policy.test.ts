import {
    PREVIEW_ENGINE_CACHE_VERSION,
    resolvePreviewEngineFeatures,
} from './preview-engine-policy';

describe('preview engine feature policy', () => {
    it('keeps exactly one compile-time Spine version', () => {
        const input = ['base', 'spine-3.8', 'spine-4.2', 'ui'];

        expect(resolvePreviewEngineFeatures(input)).toEqual(['base', 'ui', 'spine-3.8']);
        expect(input).toEqual(['base', 'spine-3.8', 'spine-4.2', 'ui']);
    });

    it('invalidates caches produced by the previous dual-Spine policy', () => {
        expect(PREVIEW_ENGINE_CACHE_VERSION).toBe('4');
    });
});
