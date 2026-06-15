import { existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';

export type ProjectExtensionDiagnosticLevel = 'warning' | 'error';

export type ProjectExtensionDiagnosticCode =
    | 'invalid-package-json'
    | 'missing-package-name'
    | 'missing-builder-contribution';

export interface ProjectExtensionDiagnostic {
    code: ProjectExtensionDiagnosticCode;
    level: ProjectExtensionDiagnosticLevel;
    extensionDirName: string;
    extensionRoot: string;
    message: string;
}

export interface ProjectExtensionAssetDbMount {
    path: string;
    target: string;
    readonly: boolean;
    visible: boolean;
}

export interface ProjectExtensionPackage {
    name: string;
    extensionDirName: string;
    root: string;
    packageJsonPath: string;
    builderEntry?: string;
    assetDbMount?: ProjectExtensionAssetDbMount;
}

export interface ProjectExtensionDiscoveryResult {
    extensions: ProjectExtensionPackage[];
    diagnostics: ProjectExtensionDiagnostic[];
}

interface ExtensionPackageJson {
    name?: string;
    contributions?: {
        builder?: string;
        'asset-db'?: {
            mount?: {
                path?: string;
                readonly?: boolean;
                visible?: boolean;
            };
        };
    };
}

function createDiagnostic(
    code: ProjectExtensionDiagnosticCode,
    extensionDirName: string,
    extensionRoot: string,
    message: string,
): ProjectExtensionDiagnostic {
    return {
        code,
        level: 'warning',
        extensionDirName,
        extensionRoot,
        message,
    };
}

export function discoverProjectExtensions(projectRoot: string): ProjectExtensionDiscoveryResult {
    const extensionsDir = join(projectRoot, 'extensions');
    const result: ProjectExtensionDiscoveryResult = {
        extensions: [],
        diagnostics: [],
    };

    if (!existsSync(extensionsDir)) {
        return result;
    }

    let entries;
    try {
        entries = readdirSync(extensionsDir, { withFileTypes: true });
    } catch {
        return result;
    }

    for (const entry of entries.filter((item) => item.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
        const extensionRoot = join(extensionsDir, entry.name);
        const packageJsonPath = join(extensionRoot, 'package.json');
        if (!existsSync(packageJsonPath)) {
            continue;
        }

        let packageJson: ExtensionPackageJson;
        try {
            packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as ExtensionPackageJson;
        } catch {
            result.diagnostics.push(createDiagnostic(
                'invalid-package-json',
                entry.name,
                extensionRoot,
                `Invalid package.json in project extension ${entry.name}`,
            ));
            continue;
        }

        const assetDbMountConfig = packageJson.contributions?.['asset-db']?.mount;
        let assetDbMount: ProjectExtensionAssetDbMount | undefined;
        if (assetDbMountConfig?.path) {
            const target = join(extensionRoot, assetDbMountConfig.path);
            if (existsSync(target)) {
                assetDbMount = {
                    path: assetDbMountConfig.path,
                    target,
                    readonly: assetDbMountConfig.readonly ?? true,
                    visible: assetDbMountConfig.visible ?? false,
                };
            }
        }

        const descriptor: ProjectExtensionPackage = {
            name: packageJson.name || entry.name,
            extensionDirName: entry.name,
            root: extensionRoot,
            packageJsonPath,
            assetDbMount,
        };

        if (!packageJson.name && packageJson.contributions?.builder) {
            result.diagnostics.push(createDiagnostic(
                'missing-package-name',
                entry.name,
                extensionRoot,
                `Project extension ${entry.name} declares contributions.builder but has no package name`,
            ));
        } else if (packageJson.contributions?.builder) {
            descriptor.builderEntry = join(extensionRoot, packageJson.contributions.builder);
        } else {
            result.diagnostics.push(createDiagnostic(
                'missing-builder-contribution',
                entry.name,
                extensionRoot,
                `Project extension ${entry.name} does not declare contributions.builder`,
            ));
        }

        result.extensions.push(descriptor);
    }

    result.extensions.sort((a, b) => {
        const nameOrder = a.name.localeCompare(b.name);
        if (nameOrder) {
            return nameOrder;
        }
        return a.root.localeCompare(b.root);
    });

    return result;
}
