interface BundleAssetInfo {
    uuid?: unknown;
    url?: unknown;
    loadUrl?: unknown;
    type?: unknown;
}

interface CachedBundleAsset {
    uuid?: unknown;
    url?: unknown;
    parent?: CachedBundleAsset | null;
    _assetDB?: {
        options?: {
            name?: unknown;
        };
    };
}

function nonEmptyString(value: unknown): value is string {
    return typeof value === 'string' && value.length > 0;
}

export function assertBundleAssetInfo(
    assetInfo: BundleAssetInfo | null | undefined,
    context: {
        bundleName: string;
        uuid: string;
        cachedAsset?: CachedBundleAsset | null;
    },
): asserts assetInfo is BundleAssetInfo & {
    uuid: string;
    url: string;
    loadUrl: string;
    type: string;
} {
    const missingFields = !assetInfo
        ? ['assetInfo']
        : ([
            !nonEmptyString(assetInfo.uuid) ? 'uuid' : '',
            !nonEmptyString(assetInfo.url) ? 'url' : '',
            !nonEmptyString(assetInfo.loadUrl) ? 'loadUrl' : '',
            !nonEmptyString(assetInfo.type) ? 'type' : '',
        ]).filter(Boolean);
    if (missingFields.length === 0) {
        return;
    }

    const cachedAsset = context.cachedAsset;
    const parent = cachedAsset?.parent;
    const details = [
        `bundle=${context.bundleName}`,
        `uuid=${context.uuid}`,
        `cachedUrl=${nonEmptyString(cachedAsset?.url) ? cachedAsset.url : '<unknown>'}`,
        `parentUuid=${nonEmptyString(parent?.uuid) ? parent.uuid : '<none>'}`,
        `parentUrl=${nonEmptyString(parent?.url) ? parent.url : '<none>'}`,
        `database=${nonEmptyString(cachedAsset?._assetDB?.options?.name) ? cachedAsset._assetDB.options.name : '<unknown>'}`,
        `missingFields=${missingFields.join(',')}`,
        'queryPhase=Bundle.initAssetPaths',
    ];
    throw new Error(`Invalid Bundle asset info: ${details.join(' ')}`);
}
