import { assertBundleAssetInfo } from '../worker/builder/asset-handler/bundle/asset-info-integrity';

describe('Bundle asset info integrity assertion', () => {
    it('reports Bundle, UUID, cached URL, parent and database context instead of reading null.loadUrl', () => {
        expect(() => assertBundleAssetInfo(null, {
            bundleName: 'resources',
            uuid: 'stale-sub-uuid',
            cachedAsset: {
                uuid: 'stale-sub-uuid',
                url: 'db://assets/resources/model.fbx@mesh',
                parent: {
                    uuid: 'parent-uuid',
                    url: 'db://assets/resources/model.fbx',
                },
                _assetDB: { options: { name: 'assets' } },
            },
        })).toThrow(
            'Invalid Bundle asset info: bundle=resources uuid=stale-sub-uuid '
            + 'cachedUrl=db://assets/resources/model.fbx@mesh parentUuid=parent-uuid '
            + 'parentUrl=db://assets/resources/model.fbx database=assets '
            + 'missingFields=assetInfo queryPhase=Bundle.initAssetPaths',
        );
    });

    it('accepts the fields consumed by Bundle.initAssetPaths', () => {
        expect(() => assertBundleAssetInfo({
            uuid: 'valid-uuid',
            url: 'db://assets/resources/config.json',
            loadUrl: 'resources/config',
            type: 'cc.JsonAsset',
        }, {
            bundleName: 'resources',
            uuid: 'valid-uuid',
        })).not.toThrow();
    });
});
