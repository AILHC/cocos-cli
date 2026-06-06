import type { RuntimePreviewArtifactManifest, RuntimePreviewArtifactManifestOptions } from './types';
import { buildRuntimePreviewLibraryManifest } from './library-index';
import { buildRuntimePreviewProgrammingManifest } from './programming-index';

export async function buildRuntimePreviewArtifactManifest(
    options: RuntimePreviewArtifactManifestOptions,
): Promise<RuntimePreviewArtifactManifest> {
    const [library, programming] = await Promise.all([
        buildRuntimePreviewLibraryManifest(options.libraryRoot),
        buildRuntimePreviewProgrammingManifest(options.programmingRoot),
    ]);

    return {
        projectRoot: options.projectRoot,
        library,
        programming,
    };
}
