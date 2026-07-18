import { existsSync } from 'fs';
import type {
    ICustomJointTextureLayout,
    IJointTextureLayoutDeviceTip,
    IJointTextureLayoutPreviewItem,
    IJointTextureLayoutPreviewResult,
    IResolvedCustomJointTextureLayout,
} from './@types/config';

type JointTextureLayoutAssetId = string | number | null | undefined;

interface IJointTextureLayoutContentInput {
    skeleton?: JointTextureLayoutAssetId;
    clips?: JointTextureLayoutAssetId[];
}

interface IJointTextureLayoutInput {
    textureLength?: number;
    contents?: IJointTextureLayoutContentInput[];
}

export interface IJointTextureLayoutAssetState {
    hash?: number;
    sample?: number;
    duration?: number;
    jointsLength?: number;
}

export interface IJointTextureLayoutResolver {
    readAssetState?: (uuid: string) => Promise<IJointTextureLayoutAssetState | null>;
    warn?: (message: string) => void;
    onMissingAsset?: (uuid: string) => void;
}

const JOINT_TEXTURE_LENGTH_ALIGN = 12;

export function getJointTextureLayoutDeviceTip(textureLength: number): IJointTextureLayoutDeviceTip {
    if (textureLength < 1024) {
        return {
            level: 'valid',
            message: 'Valid on all devices',
        };
    }
    if (textureLength < 2048) {
        return {
            level: 'warning',
            message: 'May exceeds max texture size limit on devices with no float texture support',
        };
    }
    return {
        level: 'error',
        message: 'May exceeds max texture size limit on many mobile devices',
    };
}

export async function resolveCustomJointTextureLayouts(
    layouts: readonly ICustomJointTextureLayout[] | null | undefined,
    resolver: IJointTextureLayoutResolver = {}
): Promise<IResolvedCustomJointTextureLayout[]> {
    return (await queryJointTextureLayoutPreview(layouts, resolver)).resolvedLayouts;
}

export async function queryJointTextureLayoutPreview(
    layouts: readonly ICustomJointTextureLayout[] | null | undefined,
    resolver: IJointTextureLayoutResolver = {}
): Promise<IJointTextureLayoutPreviewResult> {
    if (!Array.isArray(layouts) || layouts.length === 0) {
        return {
            layouts: [],
            resolvedLayouts: [],
            missingAssets: [],
        };
    }

    const readAssetState = createCachedAssetStateReader(resolver.readAssetState ?? readJointTextureLayoutAssetState);
    const previewLayouts: IJointTextureLayoutPreviewItem[] = [];
    const resolvedLayouts: IResolvedCustomJointTextureLayout[] = [];
    const allMissingAssets = new Set<string>();

    for (const [index, layout] of (layouts as readonly IJointTextureLayoutInput[]).entries()) {
        if (!layout || !Array.isArray(layout.contents) || layout.contents.length === 0) {
            previewLayouts.push(createEmptyPreviewItem(index));
            continue;
        }

        const layoutMissingAssets = new Set<string>();
        const previewResolver: IJointTextureLayoutResolver = {
            ...resolver,
            onMissingAsset: (uuid: string) => {
                const alreadyMissing = allMissingAssets.has(uuid);
                layoutMissingAssets.add(uuid);
                allMissingAssets.add(uuid);
                if (!alreadyMissing) {
                    resolver.onMissingAsset?.(uuid);
                }
            },
        };

        const contents = await Promise.all(
            layout.contents.map((content) => resolveChunkContent(content, readAssetState, previewResolver))
        );
        const resolvedContents = contents.filter((content): content is IResolvedCustomJointTextureLayout['contents'][number] => !!content);
        resolvedContents.sort((a, b) => a.skeleton - b.skeleton);

        const calculatedTextureLength = await calculateJointTextureLength(layout.contents, readAssetState, previewResolver);
        const fallbackTextureLength = normalizePositiveInteger(layout.textureLength);
        const textureLength = calculatedTextureLength || fallbackTextureLength || 0;
        const resolvedLayout = textureLength && resolvedContents.length > 0
            ? {
                textureLength,
                contents: resolvedContents,
            }
            : null;

        if (resolvedLayout) {
            resolvedLayouts.push(resolvedLayout);
        }

        previewLayouts.push({
            index,
            textureLength,
            calculatedTextureLength,
            fallbackTextureLength,
            resolvedLayout,
            tip: getJointTextureLayoutDeviceTip(textureLength),
            missingAssets: Array.from(layoutMissingAssets),
        });
    }

    return {
        layouts: previewLayouts,
        resolvedLayouts,
        missingAssets: Array.from(allMissingAssets),
    };
}

export async function calculateJointTextureLength(
    contents: readonly IJointTextureLayoutContentInput[],
    readAssetState: (uuid: string) => Promise<IJointTextureLayoutAssetState | null> = readJointTextureLayoutAssetState,
    resolver: IJointTextureLayoutResolver = {}
): Promise<number> {
    let pixels = 0;

    for (const content of contents) {
        const joints = await resolveJointsLength(content?.skeleton, readAssetState, resolver);
        if (!joints) {
            continue;
        }

        for (const clip of content.clips ?? []) {
            const clipState = await resolveUuidState(clip, readAssetState, resolver);
            const sample = normalizePositiveNumber(clipState?.sample);
            const duration = normalizeNonNegativeNumber(clipState?.duration);
            if (!sample || duration === undefined) {
                continue;
            }
            const frames = Math.ceil(sample * duration) + 1;
            pixels += joints * frames * 3;
        }
        pixels += joints * 3;
    }

    return pixels > 0
        ? Math.ceil(Math.sqrt(pixels) / JOINT_TEXTURE_LENGTH_ALIGN) * JOINT_TEXTURE_LENGTH_ALIGN
        : 0;
}

export async function readJointTextureLayoutAssetState(uuid: string): Promise<IJointTextureLayoutAssetState | null> {
    const { assetManager } = await import('../assets');
    const meta = assetManager.queryAssetMeta(uuid);
    const jointsLength = normalizePositiveInteger(meta?.userData && (meta.userData as { jointsLength?: unknown }).jointsLength);
    const info = assetManager.queryAssetInfo(uuid);
    if (!info) {
        return jointsLength ? { jointsLength } : null;
    }

    const libraryPath = findImportLibraryPath(info.library);
    if (!libraryPath) {
        return jointsLength ? { jointsLength } : null;
    }

    try {
        const { getRawInstanceFromImportFile } = await import('../assets/utils');
        const rawInstanceResult = await getRawInstanceFromImportFile(libraryPath, {
            uuid: info.uuid,
            url: info.url,
        });
        const asset = rawInstanceResult?.asset;
        if (!asset) {
            return jointsLength ? { jointsLength } : null;
        }

        const instance = asset as {
            hash?: unknown;
            sample?: unknown;
            duration?: unknown;
            joints?: unknown;
        };

        return {
            hash: normalizePositiveInteger(instance.hash),
            sample: normalizePositiveNumber(instance.sample),
            duration: normalizeNonNegativeNumber(instance.duration),
            jointsLength: jointsLength || (Array.isArray(instance.joints) ? instance.joints.length : undefined),
        };
    } catch (error) {
        console.error(error);
        return jointsLength ? { jointsLength } : null;
    }
}

async function resolveChunkContent(
    content: IJointTextureLayoutContentInput,
    readAssetState: (uuid: string) => Promise<IJointTextureLayoutAssetState | null>,
    resolver: IJointTextureLayoutResolver
): Promise<IResolvedCustomJointTextureLayout['contents'][number] | null> {
    const skeleton = await resolveAssetHash(content?.skeleton, readAssetState, resolver);
    if (!skeleton) {
        return null;
    }

    const clips: number[] = [];
    for (const clip of content.clips ?? []) {
        const hash = await resolveAssetHash(clip, readAssetState, resolver);
        if (hash) {
            clips.push(hash);
        }
    }
    clips.sort();

    return {
        skeleton,
        clips,
    };
}

async function resolveAssetHash(
    value: JointTextureLayoutAssetId,
    readAssetState: (uuid: string) => Promise<IJointTextureLayoutAssetState | null>,
    resolver: IJointTextureLayoutResolver
): Promise<number | null> {
    if (typeof value === 'number') {
        return normalizePositiveInteger(value) ?? null;
    }

    const state = await resolveUuidState(value, readAssetState, resolver);
    return normalizePositiveInteger(state?.hash) ?? null;
}

async function resolveJointsLength(
    value: JointTextureLayoutAssetId,
    readAssetState: (uuid: string) => Promise<IJointTextureLayoutAssetState | null>,
    resolver: IJointTextureLayoutResolver
): Promise<number> {
    const state = await resolveUuidState(value, readAssetState, resolver);
    return normalizePositiveInteger(state?.jointsLength) ?? 0;
}

async function resolveUuidState(
    value: JointTextureLayoutAssetId,
    readAssetState: (uuid: string) => Promise<IJointTextureLayoutAssetState | null>,
    resolver: IJointTextureLayoutResolver
): Promise<IJointTextureLayoutAssetState | null> {
    if (typeof value !== 'string' || !value.trim()) {
        return null;
    }

    const state = await readAssetState(value);
    if (!state) {
        resolver.onMissingAsset?.(value);
        resolver.warn?.(`Failed to resolve Joint Texture Layout asset: ${value}`);
    }
    return state;
}

function createEmptyPreviewItem(index: number): IJointTextureLayoutPreviewItem {
    return {
        index,
        textureLength: 0,
        calculatedTextureLength: 0,
        resolvedLayout: null,
        tip: getJointTextureLayoutDeviceTip(0),
        missingAssets: [],
    };
}

function findImportLibraryPath(library: Record<string, string> | undefined): string {
    if (!library) {
        return '';
    }

    for (const ext of ['.json', '.bin', '.cconb']) {
        const file = library[ext];
        if (file && existsSync(file)) {
            return file;
        }
    }
    return '';
}

function createCachedAssetStateReader(
    readAssetState: (uuid: string) => Promise<IJointTextureLayoutAssetState | null>
): (uuid: string) => Promise<IJointTextureLayoutAssetState | null> {
    const cache = new Map<string, Promise<IJointTextureLayoutAssetState | null>>();
    return (uuid: string) => {
        if (!cache.has(uuid)) {
            cache.set(uuid, readAssetState(uuid));
        }
        return cache.get(uuid)!;
    };
}

function normalizePositiveInteger(value: unknown): number | undefined {
    const numberValue = normalizePositiveNumber(value);
    return numberValue === undefined ? undefined : Math.trunc(numberValue);
}

function normalizePositiveNumber(value: unknown): number | undefined {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
        return undefined;
    }
    return value;
}

function normalizeNonNegativeNumber(value: unknown): number | undefined {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
        return undefined;
    }
    return value;
}
