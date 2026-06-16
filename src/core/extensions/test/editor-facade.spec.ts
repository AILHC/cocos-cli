import { join } from 'path';
import { tmpdir } from 'os';
import { mkdtempSync, removeSync } from 'fs-extra';

import { createEditorFacade, drainEditorFacade, withEditorFacade } from '../editor-facade';
import { assetManager } from '../../assets';

jest.mock('../../assets', () => ({
    __esModule: true,
    assetManager: {
        moveAsset: jest.fn(async () => ({ uuid: 'moved-uuid' })),
        removeAsset: jest.fn(async () => ({ uuid: 'removed-uuid' })),
    },
}));

describe('project extension Editor facade', () => {
    let projectRoot: string;

    beforeEach(() => {
        projectRoot = mkdtempSync(join(tmpdir(), 'cocos-cli-editor-facade-'));
        jest.clearAllMocks();
    });

    afterEach(() => {
        delete (globalThis as any).Editor;
        removeSync(projectRoot);
    });

    it('exposes Editor.Project.path while installed', async () => {
        await withEditorFacade({ projectRoot }, async () => {
            expect((globalThis as any).Editor.Project.path).toBe(projectRoot);
        });
        expect((globalThis as any).Editor).toBeUndefined();
    });

    it('delegates move-asset to assetManager.moveAsset', async () => {
        const editor = createEditorFacade({ projectRoot });
        await editor.Message.request('asset-db', 'move-asset', 'db://assets/resources/cfg', 'db://assets/tmp_cfg', {
            overwrite: true,
            rename: true,
        });

        expect(assetManager.moveAsset).toHaveBeenCalledWith(
            'db://assets/resources/cfg',
            'db://assets/tmp_cfg',
            {
                overwrite: true,
                rename: true,
            },
        );
    });

    it('delegates delete-asset to assetManager.removeAsset with { useTrash: false }', async () => {
        const editor = createEditorFacade({ projectRoot });
        await editor.Message.request('asset-db', 'delete-asset', 'db://assets/tmp_cfg');

        expect(assetManager.removeAsset).toHaveBeenCalledWith('db://assets/tmp_cfg', {
            useTrash: false,
        });
    });

    it('unsupported request throws Unsupported Editor.Message request: asset-db.query-assets', async () => {
        const editor = createEditorFacade({ projectRoot });
        await expect(editor.Message.request('asset-db', 'query-assets'))
            .rejects
            .toThrow('Unsupported Editor.Message request: asset-db.query-assets');
    });

    it('unsupported send is thrown when draining editor facade', async () => {
        await expect(withEditorFacade({ projectRoot }, async () => {
            (globalThis as any).Editor.Message.send('asset-db', 'query-assets');
        })).rejects.toThrow('Unsupported Editor.Message send: asset-db.query-assets');
    });

    it('queue send operations and drain before teardown', async () => {
        await withEditorFacade({ projectRoot }, async () => {
            (globalThis as any).Editor.Message.send('asset-db', 'move-asset', 'db://assets/tmp_cfg', 'db://assets/resources/cfg', {
                overwrite: true,
                rename: true,
            });
            await drainEditorFacade();
        });

        expect(assetManager.moveAsset).toHaveBeenCalledWith(
            'db://assets/tmp_cfg',
            'db://assets/resources/cfg',
            {
                overwrite: true,
                rename: true,
            },
        );
    });

    it('drains setTimeout(…, 0) send operations before teardown', async () => {
        await withEditorFacade({ projectRoot }, async () => {
            setTimeout(() => {
                (globalThis as any).Editor.Message.send('asset-db', 'move-asset', 'db://assets/project.json', 'db://assets/project.manifest', {
                    overwrite: true,
                    rename: true,
                });
            }, 0);
        });

        expect(assetManager.moveAsset).toHaveBeenCalledWith(
            'db://assets/project.json',
            'db://assets/project.manifest',
            {
                overwrite: true,
                rename: true,
            },
        );
    });

    it('setTimeout scheduled with positive delay after hook scope throws', async () => {
        await expect(withEditorFacade({ projectRoot }, async () => {
            setTimeout(() => {
                (globalThis as any).Editor.Message.send('asset-db', 'move-asset', 'db://assets/project.json', 'db://assets/project.manifest', {
                    overwrite: true,
                    rename: true,
                });
            }, 10);
        })).rejects.toThrow('Editor.Message send scheduled after hook scope');
    });
});
