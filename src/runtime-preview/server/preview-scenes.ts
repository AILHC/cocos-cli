import { readFile, stat } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import type { RuntimePreviewContext } from '../context/runtime-preview-context';

const currentSceneKeyword = 'current_scene';

interface AssetDataRecord {
    url?: string;
}

interface PreviewProfile {
    general?: {
        start_scene?: unknown;
    };
}

export interface PreviewSceneRecord {
    uuid: string;
    url: string;
    name?: string;
    bundle?: string;
}

async function resolveExistingFile(absolutePath: string): Promise<string | null> {
    try {
        const fileStat = await stat(absolutePath);
        if (fileStat.isFile()) {
            return absolutePath;
        }
    } catch {
        // Try the next fact-backed file candidate.
    }

    return null;
}

function isPathInsideRoot(filePath: string, root: string): boolean {
    const resolvedRoot = resolve(root);
    const resolvedFile = resolve(filePath);
    const rootRelativePath = relative(resolvedRoot, resolvedFile);
    return Boolean(rootRelativePath) && !rootRelativePath.startsWith('..') && !isAbsolute(rootRelativePath);
}

async function resolveExistingFileInside(root: string, relativePath: string): Promise<string | null> {
    const normalized = relativePath.replace(/\\/g, '/').replace(/^\/+/, '');
    if (!normalized || normalized.split('/').includes('..')) {
        return null;
    }

    const absolutePath = resolve(root, ...normalized.split('/'));
    if (!isPathInsideRoot(absolutePath, root)) {
        return null;
    }

    return resolveExistingFile(absolutePath);
}

export function getProjectLibraryRoots(context: RuntimePreviewContext): string[] {
    const projectLibraryRoot = resolve(context.projectRoot, 'library');
    const cliLibraryRoot = join(projectLibraryRoot, 'cli');
    const configuredLibraryRoot = resolve(context.projectLibraryRoot);
    const roots = configuredLibraryRoot === projectLibraryRoot
        ? [cliLibraryRoot, context.projectLibraryRoot]
        : [context.projectLibraryRoot, cliLibraryRoot, projectLibraryRoot];

    return Array.from(new Set(roots.filter((value): value is string => Boolean(value))));
}

async function readJsonFile<T>(absolutePath: string): Promise<T | null> {
    try {
        return JSON.parse(await readFile(absolutePath, 'utf8')) as T;
    } catch {
        return null;
    }
}

async function loadAssetData(root: string): Promise<Record<string, AssetDataRecord> | null> {
    return readJsonFile<Record<string, AssetDataRecord>>(join(root, '.assets-data.json'));
}

function sceneNameFromUrl(url: string): string | undefined {
    const name = url.split('/').pop()?.replace(/\.scene$/, '');
    return name || undefined;
}

function sceneBundleFromUrl(url: string): string | undefined {
    if (!url.startsWith('db://assets/')) {
        return undefined;
    }

    const relativeAssetPath = url.slice('db://assets/'.length);
    return relativeAssetPath.split('/')[0] || undefined;
}

export async function listPreviewScenes(context: RuntimePreviewContext): Promise<PreviewSceneRecord[]> {
    for (const root of getProjectLibraryRoots(context)) {
        const assetData = await loadAssetData(root);
        if (!assetData) {
            continue;
        }

        return Object.entries(assetData)
            .filter((entry): entry is [string, AssetDataRecord & { url: string }] => typeof entry[1]?.url === 'string' && entry[1].url.endsWith('.scene'))
            .map(([uuid, record]) => ({
                uuid,
                url: record.url,
                name: sceneNameFromUrl(record.url),
                bundle: sceneBundleFromUrl(record.url),
            }))
            .sort((left, right) => left.url.localeCompare(right.url));
    }

    return [];
}

export async function resolveSceneJsonFile(context: RuntimePreviewContext, uuid: string): Promise<string | null> {
    if (!/^[0-9a-fA-F-]+$/.test(uuid)) {
        return null;
    }

    for (const root of getProjectLibraryRoots(context)) {
        const assetData = await loadAssetData(root);
        if (!assetData?.[uuid]?.url?.endsWith('.scene')) {
            continue;
        }

        const file = await resolveExistingFileInside(root, `${uuid.slice(0, 2)}/${uuid}.json`);
        if (file) {
            return file;
        }
    }

    return null;
}

function getRequestedSceneFromUrl(requestPath: string): string {
    const requestUrl = new URL(requestPath, 'http://runtime-preview.local');
    return requestUrl.searchParams.get('scene')?.trim() ?? '';
}

export function getRequestedScene(requestPath?: string): string {
    if (!requestPath) {
        return '';
    }

    try {
        return getRequestedSceneFromUrl(requestPath);
    } catch {
        return '';
    }
}

async function readProfileStartScene(context: RuntimePreviewContext): Promise<string> {
    const profile = await readJsonFile<PreviewProfile>(join(context.projectRoot, 'profiles', 'v2', 'packages', 'preview.json'));
    const startScene = profile?.general?.start_scene;
    return typeof startScene === 'string' ? startScene.trim() : '';
}

function resolveSceneRecord(scenes: PreviewSceneRecord[], scene: string): PreviewSceneRecord | null {
    return scenes.find((record) => record.uuid === scene || record.url === scene) ?? null;
}

async function findFirstLoadableScene(context: RuntimePreviewContext, scenes: PreviewSceneRecord[]): Promise<string> {
    for (const scene of scenes) {
        if (await resolveSceneJsonFile(context, scene.uuid)) {
            return scene.uuid;
        }
    }

    return '';
}

export async function resolveRuntimePreviewStartScene(
    context: RuntimePreviewContext,
    requestedScene?: string,
    cliScene?: string,
): Promise<string> {
    const scenes = await listPreviewScenes(context);
    const fallbackScene = await findFirstLoadableScene(context, scenes);
    const explicitScene = requestedScene?.trim() || cliScene?.trim();

    if (explicitScene) {
        if (explicitScene === currentSceneKeyword) {
            return fallbackScene;
        }

        return resolveSceneRecord(scenes, explicitScene)?.uuid ?? explicitScene;
    }

    const profileScene = await readProfileStartScene(context);
    if (!profileScene || profileScene === currentSceneKeyword) {
        return fallbackScene;
    }

    return resolveSceneRecord(scenes, profileScene)?.uuid ?? fallbackScene;
}
