import {
    getJointTextureLayoutDeviceTip,
    queryJointTextureLayoutPreview,
    resolveCustomJointTextureLayouts,
} from '../joint-texture-layout';

describe('joint texture layout', () => {
    it('resolves UUID layouts to runtime hashes and calculates textureLength', async () => {
        const layouts = await resolveCustomJointTextureLayouts([{
            textureLength: 12,
            contents: [
                { skeleton: 'skeleton-b', clips: ['clip-b', 'clip-a'] },
                { skeleton: 'skeleton-a', clips: ['clip-a'] },
            ],
        }], {
            readAssetState: async (uuid) => ({
                'skeleton-a': { hash: 100, jointsLength: 10 },
                'skeleton-b': { hash: 50, jointsLength: 20 },
                'clip-a': { hash: 7, sample: 30, duration: 1 },
                'clip-b': { hash: 3, sample: 10, duration: 2.5 },
            })[uuid] ?? null,
        });

        expect(layouts).toEqual([{
            textureLength: 72,
            contents: [
                { skeleton: 50, clips: [3, 7] },
                { skeleton: 100, clips: [7] },
            ],
        }]);
    });

    it('keeps already-resolved numeric hashes with manual textureLength fallback', async () => {
        const layouts = await resolveCustomJointTextureLayouts([{
            textureLength: 96,
            contents: [
                { skeleton: 123 as unknown as string, clips: [456 as unknown as string] },
            ],
        }]);

        expect(layouts).toEqual([{
            textureLength: 96,
            contents: [
                { skeleton: 123, clips: [456] },
            ],
        }]);
    });

    it('counts zero-duration clips as one frame when calculating textureLength', async () => {
        const layouts = await resolveCustomJointTextureLayouts([{
            textureLength: 0,
            contents: [
                { skeleton: 'skeleton', clips: ['idle-pose'] },
            ],
        }], {
            readAssetState: async (uuid) => ({
                skeleton: { hash: 1, jointsLength: 10 },
                'idle-pose': { hash: 2, sample: 30, duration: 0 },
            })[uuid] ?? null,
        });

        expect(layouts).toEqual([{
            textureLength: 12,
            contents: [
                { skeleton: 1, clips: [2] },
            ],
        }]);
    });

    it('sorts clip hashes with Creator default array sort', async () => {
        const layouts = await resolveCustomJointTextureLayouts([{
            textureLength: 12,
            contents: [
                { skeleton: 'skeleton', clips: ['clip-small', 'clip-large'] },
            ],
        }], {
            readAssetState: async (uuid) => ({
                skeleton: { hash: 1, jointsLength: 1 },
                'clip-small': { hash: 7, sample: 1, duration: 1 },
                'clip-large': { hash: 100, sample: 1, duration: 1 },
            })[uuid] ?? null,
        });

        expect(layouts[0].contents[0].clips).toEqual([100, 7]);
    });

    it('queries preview data for UI consumption', async () => {
        const onMissingAsset = jest.fn();

        const preview = await queryJointTextureLayoutPreview([
            {
                textureLength: 0,
                contents: [
                    { skeleton: 'skeleton', clips: ['idle-pose', 'missing-clip'] },
                ],
            },
            {
                textureLength: 2048,
                contents: [
                    { skeleton: 10 as unknown as string, clips: [20 as unknown as string] },
                ],
            },
        ], {
            readAssetState: async (uuid) => ({
                skeleton: { hash: 1, jointsLength: 10 },
                'idle-pose': { hash: 2, sample: 30, duration: 0 },
            })[uuid] ?? null,
            onMissingAsset,
        });

        expect(preview.resolvedLayouts).toEqual([
            {
                textureLength: 12,
                contents: [
                    { skeleton: 1, clips: [2] },
                ],
            },
            {
                textureLength: 2048,
                contents: [
                    { skeleton: 10, clips: [20] },
                ],
            },
        ]);
        expect(preview.missingAssets).toEqual(['missing-clip']);
        expect(preview.layouts[0]).toMatchObject({
            index: 0,
            textureLength: 12,
            calculatedTextureLength: 12,
            missingAssets: ['missing-clip'],
            tip: { level: 'valid' },
        });
        expect(preview.layouts[1]).toMatchObject({
            index: 1,
            textureLength: 2048,
            calculatedTextureLength: 0,
            fallbackTextureLength: 2048,
            tip: { level: 'error' },
            missingAssets: [],
        });
        expect(onMissingAsset).toHaveBeenCalledTimes(1);
        expect(onMissingAsset).toHaveBeenCalledWith('missing-clip');
    });

    it('matches Creator device-size tips', () => {
        expect(getJointTextureLayoutDeviceTip(1023)).toEqual({
            level: 'valid',
            message: 'Valid on all devices',
        });
        expect(getJointTextureLayoutDeviceTip(1024).level).toBe('warning');
        expect(getJointTextureLayoutDeviceTip(2048).level).toBe('error');
    });
});
