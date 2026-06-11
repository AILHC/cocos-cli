import { existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';

export interface ProjectExtensionAssetDbMount {
    name: string;
    target: string;
    library: string;
    readonly: boolean;
    visible: boolean;
}

interface ExtensionPackageJson {
    name?: string;
    contributions?: {
        'asset-db'?: {
            mount?: {
                path?: string;
                readonly?: boolean;
                visible?: boolean;
            };
        };
    };
}

export function resolveProjectExtensionAssetDbMounts(projectRoot: string): ProjectExtensionAssetDbMount[] {
    const extensionsDir = join(projectRoot, 'extensions');
    if (!existsSync(extensionsDir)) {
        return [];
    }

    const mounts: ProjectExtensionAssetDbMount[] = [];
    try {
        const entries = readdirSync(extensionsDir, { withFileTypes: true });
        for (const entry of entries) {
            if (!entry.isDirectory()) {
                continue;
            }

            const extensionDir = join(extensionsDir, entry.name);
            const packageJsonPath = join(extensionDir, 'package.json');
            if (!existsSync(packageJsonPath)) {
                continue;
            }

            try {
                const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as ExtensionPackageJson;
                const mount = packageJson.contributions?.['asset-db']?.mount;
                if (!mount?.path) {
                    continue;
                }

                const target = join(extensionDir, mount.path);
                if (!existsSync(target)) {
                    continue;
                }

                const name = packageJson.name || entry.name;
                mounts.push({
                    name,
                    target,
                    readonly: mount.readonly ?? true,
                    visible: mount.visible ?? false,
                    library: join(projectRoot, 'library', 'cli-extensions', name),
                });
            } catch {
                // Skip extensions with invalid package.json.
            }
        }
    } catch {
        // Ignore errors scanning extensions directory.
    }

    return mounts;
}
