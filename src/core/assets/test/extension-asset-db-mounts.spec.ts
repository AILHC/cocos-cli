import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { resolveProjectExtensionAssetDbMounts } from '../extension-asset-db-mounts';

function writeJson(file: string, data: Record<string, any>): void {
    writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}

function createExtension(projectRoot: string, dirName: string, packageJson: Record<string, any>): string {
    const extensionRoot = join(projectRoot, 'extensions', dirName);
    mkdirSync(extensionRoot, { recursive: true });
    writeJson(join(extensionRoot, 'package.json'), packageJson);
    return extensionRoot;
}

describe('resolveProjectExtensionAssetDbMounts', () => {
    let projectRoot: string;

    beforeEach(() => {
        projectRoot = mkdtempSync(join(tmpdir(), 'cocos-cli-extension-mounts-'));
    });

    afterEach(() => {
        rmSync(projectRoot, { recursive: true, force: true });
    });

    it('keeps asset-db mount behavior while ignoring builder-only extensions', () => {
        const assetExtensionRoot = createExtension(projectRoot, 'asset-extension', {
            name: 'asset-extension',
            contributions: {
                'asset-db': {
                    mount: {
                        path: 'static/assets',
                        readonly: false,
                        visible: true,
                    },
                },
            },
        });
        mkdirSync(join(assetExtensionRoot, 'static', 'assets'), { recursive: true });

        createExtension(projectRoot, 'builder-only', {
            name: 'builder-only',
            contributions: {
                builder: './dist/builder.js',
            },
        });

        const missingTargetRoot = createExtension(projectRoot, 'missing-target', {
            name: 'missing-target',
            contributions: {
                'asset-db': {
                    mount: {
                        path: 'static/missing',
                    },
                },
            },
        });

        const mounts = resolveProjectExtensionAssetDbMounts(projectRoot);

        expect(mounts).toEqual([
            {
                name: 'asset-extension',
                target: join(assetExtensionRoot, 'static', 'assets'),
                readonly: false,
                visible: true,
                library: join(projectRoot, 'library', 'cli-extensions', 'asset-extension'),
            },
        ]);
        expect(mounts.find((mount) => mount.target.startsWith(missingTargetRoot))).toBeUndefined();
    });
});
