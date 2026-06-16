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
        saveAssetMeta: jest.fn(async () => undefined),
        queryAssetMeta: jest.fn(async () => null),
        queryUUID: jest.fn(async () => ''),
        refreshAsset: jest.fn(async () => undefined),
        reimportAsset: jest.fn(async () => ({ uuid: 'reimport-uuid' })),
        saveAsset: jest.fn(async () => undefined),
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

    it('delegates move-asset to assetManager.moveAsset and accepts Editor override option', async () => {
        const editor = createEditorFacade({ projectRoot });
        await editor.Message.request('asset-db', 'move-asset', 'db://assets/resources/cfg', 'db://assets/tmp_cfg', {
            override: true,
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

    it('delegates save-asset-meta request to assetManager.saveAssetMeta and parses string meta', async () => {
        const editor = createEditorFacade({ projectRoot });
        const meta = {
            width: 32,
            packed: true,
        };

        await editor.Message.request('asset-db', 'save-asset-meta', 'db://assets/atlas', JSON.stringify(meta));

        expect(assetManager.saveAssetMeta).toHaveBeenCalledWith(
            'db://assets/atlas',
            meta,
        );
    });

    it('delegates save-asset-meta request to assetManager.saveAssetMeta with raw object', async () => {
        const editor = createEditorFacade({ projectRoot });
        const meta = {
            width: 32,
            packed: true,
        };

        await editor.Message.request('asset-db', 'save-asset-meta', 'db://assets/atlas', meta);

        expect(assetManager.saveAssetMeta).toHaveBeenCalledWith(
            'db://assets/atlas',
            meta,
        );
        expect((assetManager.saveAssetMeta as jest.Mock).mock.calls[0][1]).toBe(meta);
    });

    it('delegates query-asset-meta request to assetManager.queryAssetMeta and returns modifiable object', async () => {
        const editor = createEditorFacade({ projectRoot });
        const meta = {
            width: 32,
            packed: true,
        };
        (assetManager.queryAssetMeta as jest.Mock).mockResolvedValueOnce(meta);

        const queriedMeta = await editor.Message.request('asset-db', 'query-asset-meta', 'db://assets/atlas') as { width?: number };
        queriedMeta.width = 48;

        await editor.Message.request('asset-db', 'save-asset-meta', 'db://assets/atlas', queriedMeta);

        expect(assetManager.queryAssetMeta).toHaveBeenCalledWith('db://assets/atlas');
        expect(assetManager.saveAssetMeta).toHaveBeenCalledWith(
            'db://assets/atlas',
            queriedMeta,
        );
    });

    it('delegates query-uuid request to assetManager.queryUUID', async () => {
        const editor = createEditorFacade({ projectRoot });
        (assetManager.queryUUID as jest.Mock).mockReturnValueOnce('uuid-for-atlas');

        const uuid = await editor.Message.request('asset-db', 'query-uuid', 'db://assets/atlas');

        expect(uuid).toBe('uuid-for-atlas');
        expect(assetManager.queryUUID).toHaveBeenCalledWith('db://assets/atlas');
    });

    it('returns an empty string when query-uuid cannot resolve an asset', async () => {
        const editor = createEditorFacade({ projectRoot });
        (assetManager.queryUUID as jest.Mock).mockReturnValueOnce(null);

        const uuid = await editor.Message.request('asset-db', 'query-uuid', 'db://assets/missing');

        expect(uuid).toBe('');
        expect(assetManager.queryUUID).toHaveBeenCalledWith('db://assets/missing');
    });

    it('delegates refresh-asset request to assetManager.refreshAsset', async () => {
        const editor = createEditorFacade({ projectRoot });

        await editor.Message.request('asset-db', 'refresh-asset', 'db://assets/atlas');

        expect(assetManager.refreshAsset).toHaveBeenCalledWith('db://assets/atlas');
    });

    it('delegates reimport-asset request to assetManager.reimportAsset', async () => {
        const editor = createEditorFacade({ projectRoot });

        await editor.Message.request('asset-db', 'reimport-asset', 'db://assets/atlas');

        expect(assetManager.reimportAsset).toHaveBeenCalledWith('db://assets/atlas');
    });

    it('delegates save-asset request to assetManager.saveAsset', async () => {
        const editor = createEditorFacade({ projectRoot });

        await editor.Message.request('asset-db', 'save-asset', 'db://assets/atlas', 'saved-content');

        expect(assetManager.saveAsset).toHaveBeenCalledWith('db://assets/atlas', 'saved-content');
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

    it('delegated API internal delayed setTimeout should not trigger send-scope timer failure', async () => {
        (assetManager.saveAssetMeta as jest.Mock).mockImplementationOnce(() => new Promise<void>((resolve) => {
            setTimeout(() => {
                resolve(undefined);
            }, 10);
        }));

        await expect(withEditorFacade({ projectRoot }, async () => {
            await (globalThis as any).Editor.Message.request('asset-db', 'save-asset-meta', 'db://assets/atlas', JSON.stringify({
                width: 32,
                packed: true,
            }));
        })).resolves.toBeUndefined();
    });

    it('delegated API with internal delayed setTimeout in send request path should not trigger timer failure', async () => {
        (assetManager.refreshAsset as jest.Mock).mockImplementationOnce(() => new Promise<void>((resolve) => {
            setTimeout(() => {
                resolve(undefined);
            }, 10);
        }));

        await expect(withEditorFacade({ projectRoot }, async () => {
            await (globalThis as any).Editor.Message.request('asset-db', 'refresh-asset', 'db://assets/atlas');
        })).resolves.toBeUndefined();
    });

    it('delegates send reimport-asset to assetManager.reimportAsset', async () => {
        await withEditorFacade({ projectRoot }, async () => {
            (globalThis as any).Editor.Message.send('asset-db', 'reimport-asset', 'db://assets/atlas');
        });

        expect(assetManager.reimportAsset).toHaveBeenCalledWith('db://assets/atlas');
    });

    it('queue send operations and drain before teardown', async () => {
        await withEditorFacade({ projectRoot }, async () => {
            (globalThis as any).Editor.Message.send('asset-db', 'move-asset', 'db://assets/tmp_cfg', 'db://assets/resources/cfg', {
                override: true,
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
                override: true,
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
                    override: true,
                    rename: true,
                });
            }, 10);
        })).rejects.toThrow('Editor.Message send scheduled after hook scope');
    });

    it('setTimeout scheduled with positive delay for reimport send also throws', async () => {
        await expect(withEditorFacade({ projectRoot }, async () => {
            setTimeout(() => {
                (globalThis as any).Editor.Message.send('asset-db', 'reimport-asset', 'db://assets/atlas');
            }, 10);
        })).rejects.toThrow('Editor.Message send scheduled after hook scope');
    });
});
