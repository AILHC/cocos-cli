export type RuntimeAssetDbIntegrityPhase = 'post-incremental-refresh' | 'post-root-refresh';

export interface RuntimeAssetDbIntegrityIssue {
    uuid: string;
    assetUrl?: string;
    parentUuid?: string;
    parentUrl?: string;
    database?: string;
    bundle?: string;
    missingFields: string[];
    queryError?: string;
}

export interface RuntimeAssetDbIntegrityCheck {
    ok: boolean;
    checkedUuidCount: number;
    invalidUuidCount: number;
    samples: RuntimeAssetDbIntegrityIssue[];
    sampleLimit: number;
    error?: string;
}

interface BuilderAssetLike {
    uuid?: unknown;
    url?: unknown;
    parent?: BuilderAssetLike | null;
    isDirectory?: () => boolean;
    _assetDB?: {
        options?: {
            name?: unknown;
        };
    };
}

interface BuilderAssetInfoLike {
    uuid?: unknown;
    url?: unknown;
    loadUrl?: unknown;
    type?: unknown;
}

export interface BuilderAssetLibraryIntegrityAdapter {
    assets: BuilderAssetLike[];
    getAssetInfo(uuid: string): BuilderAssetInfoLike | null | undefined;
    queryAllAssets(): BuilderAssetLike[];
}

const defaultSampleLimit = 20;

function stringValue(value: unknown): string | undefined {
    return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function databaseName(asset: BuilderAssetLike): string | undefined {
    const explicitName = stringValue(asset._assetDB?.options?.name);
    if (explicitName) {
        return explicitName;
    }
    const url = stringValue(asset.url);
    return url?.startsWith('db://') ? url.slice(5).split('/')[0] : undefined;
}

export function inspectBuilderAssetDbIntegrity(
    library: BuilderAssetLibraryIntegrityAdapter,
    options: { sampleLimit?: number } = {},
): RuntimeAssetDbIntegrityCheck {
    const sampleLimit = options.sampleLimit ?? defaultSampleLimit;
    const samples: RuntimeAssetDbIntegrityIssue[] = [];
    let checkedUuidCount = 0;
    let invalidUuidCount = 0;

    for (const cachedAsset of library.assets) {
        if (cachedAsset.isDirectory?.()) {
            continue;
        }
        const uuid = stringValue(cachedAsset.uuid);
        if (!uuid) {
            continue;
        }

        checkedUuidCount += 1;
        const missingFields: string[] = [];
        let assetInfo: BuilderAssetInfoLike | null | undefined;
        let queryError: string | undefined;
        try {
            assetInfo = library.getAssetInfo(uuid);
        } catch (error) {
            queryError = error instanceof Error ? error.message : String(error);
        }

        if (!assetInfo) {
            missingFields.push('assetInfo');
        } else {
            if (!stringValue(assetInfo.uuid)) {
                missingFields.push('uuid');
            }
            if (!stringValue(assetInfo.url)) {
                missingFields.push('url');
            }
            if (!stringValue(assetInfo.loadUrl)) {
                missingFields.push('loadUrl');
            }
            if (!stringValue(assetInfo.type)) {
                missingFields.push('type');
            }
        }

        if (missingFields.length === 0 && !queryError) {
            continue;
        }

        invalidUuidCount += 1;
        if (samples.length >= sampleLimit) {
            continue;
        }
        const parent = cachedAsset.parent ?? undefined;
        samples.push({
            uuid,
            assetUrl: stringValue(cachedAsset.url),
            parentUuid: stringValue(parent?.uuid),
            parentUrl: stringValue(parent?.url),
            database: databaseName(cachedAsset),
            missingFields,
            ...(queryError ? { queryError } : {}),
        });
    }

    return {
        ok: invalidUuidCount === 0,
        checkedUuidCount,
        invalidUuidCount,
        samples,
        sampleLimit,
    };
}

export async function verifyBuilderAssetDbIntegrity(
    phase: RuntimeAssetDbIntegrityPhase,
): Promise<RuntimeAssetDbIntegrityCheck> {
    const { buildAssetLibrary } = await import('../../core/builder/worker/builder/manager/asset-library');
    if (phase === 'post-root-refresh') {
        buildAssetLibrary.queryAllAssets();
    }
    return inspectBuilderAssetDbIntegrity(buildAssetLibrary);
}
