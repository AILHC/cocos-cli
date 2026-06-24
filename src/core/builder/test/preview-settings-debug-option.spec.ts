import { createPreviewBuildOptions } from '../preview-options';

describe('createPreviewBuildOptions', () => {
    it('forces debug true for runtime preview even when web-desktop defaults are release-like', () => {
        const result = createPreviewBuildOptions(
            {
                platform: 'web-desktop',
                debug: false,
                sourceMaps: true,
                taskId: 'release-task',
            } as any,
            {
                startScene: 'scene-uuid',
            } as any,
        );

        expect(result.platform).toBe('web-desktop');
        expect(result.preview).toBe(true);
        expect(result.debug).toBe(true);
        expect(result.sourceMaps).toBe(true);
        expect(result.taskId).toBe('release-task');
        expect(result.startScene).toBe('scene-uuid');
    });

    it('does not allow caller override debug false in preview settings generation', () => {
        const result = createPreviewBuildOptions(
            {
                platform: 'web-desktop',
                debug: true,
            } as any,
            {
                debug: false,
                startScene: 'scene-uuid',
            } as any,
        );

        expect(result.preview).toBe(true);
        expect(result.debug).toBe(true);
    });
});
