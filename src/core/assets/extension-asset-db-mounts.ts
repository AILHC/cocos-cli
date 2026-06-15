import { join } from 'path';
import { discoverProjectExtensions } from '../extensions/project-extensions';

export interface ProjectExtensionAssetDbMount {
    name: string;
    target: string;
    library: string;
    readonly: boolean;
    visible: boolean;
}

export function resolveProjectExtensionAssetDbMounts(projectRoot: string): ProjectExtensionAssetDbMount[] {
    return discoverProjectExtensions(projectRoot).extensions
        .filter((extension) => extension.assetDbMount)
        .map((extension) => ({
            name: extension.name,
            target: extension.assetDbMount!.target,
            readonly: extension.assetDbMount!.readonly,
            visible: extension.assetDbMount!.visible,
            library: join(projectRoot, 'library', 'cli-extensions', extension.name),
        }));
}
