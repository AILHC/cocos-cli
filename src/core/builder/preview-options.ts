import type { IBuildTaskOption, Platform } from './@types/private';

export function createPreviewBuildOptions<P extends Platform>(
    defaultBuildOptions: IBuildTaskOption<P>,
    options?: IBuildTaskOption<P>,
): IBuildTaskOption<P> {
    return {
        ...defaultBuildOptions,
        ...(options ?? {}),
        preview: true,
        debug: true,
    };
}
