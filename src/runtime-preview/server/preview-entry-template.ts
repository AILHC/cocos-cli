import ejs from 'ejs';
import { readFile, stat } from 'node:fs/promises';
import { basename, isAbsolute, join, relative, resolve } from 'node:path';
import type { RuntimePreviewContext } from '../context/runtime-preview-context';
import type { ResolvedRuntimePreviewFile } from '../library/resolve-library-request';

interface RuntimePreviewDevice {
    name: string;
    width: number;
    height: number;
    ratio?: number;
}

interface CreatorDeviceEntry {
    name?: unknown;
    width?: unknown;
    height?: unknown;
    ratio?: unknown;
    default?: unknown;
}

const runtimePreviewStaticRoot = resolve(__dirname, '../../..', 'static', 'runtime-preview');

function isPathInsideRoot(filePath: string, root: string): boolean {
    const rootRelativePath = relative(resolve(root), resolve(filePath));
    return Boolean(rootRelativePath) && !rootRelativePath.startsWith('..') && !isAbsolute(rootRelativePath);
}

function getFallbackRuntimePreviewDevices(): Record<string, RuntimePreviewDevice> {
    return {
        Default: { name: 'Default', width: 960, height: 640 },
        FullScreen: { name: 'FullScreen', width: 0, height: 0 },
        WebpageFullScreen: { name: 'WebpageFullScreen', width: 0, height: 0 },
    };
}

function createRuntimePreviewDeviceMap(source: unknown): Record<string, RuntimePreviewDevice> {
    const devices = getFallbackRuntimePreviewDevices();
    const entries = Array.isArray(source) ? source as CreatorDeviceEntry[] : [];
    for (const entry of entries) {
        if (typeof entry.name !== 'string' || !entry.name.trim()) {
            continue;
        }
        if (typeof entry.width !== 'number' || typeof entry.height !== 'number') {
            continue;
        }
        if (entry.default !== true) {
            continue;
        }
        devices[entry.name] = {
            name: entry.name,
            width: entry.width,
            height: entry.height,
            ...(typeof entry.ratio === 'number' ? { ratio: entry.ratio } : {}),
        };
    }
    return devices;
}

async function loadRuntimePreviewDevices(): Promise<Record<string, RuntimePreviewDevice>> {
    try {
        const devicesJson = await readFile(join(runtimePreviewStaticRoot, 'devices', 'devices.json'), 'utf8');
        return createRuntimePreviewDeviceMap(JSON.parse(devicesJson));
    } catch {
        return getFallbackRuntimePreviewDevices();
    }
}

function getSceneQuery(requestPath: string): string {
    const requestUrl = new URL(requestPath, 'http://runtime-preview.local');
    const scene = requestUrl.searchParams.get('scene');
    return scene ? `?scene=${encodeURIComponent(scene)}` : '';
}

export async function renderRuntimePreviewEntry(context: RuntimePreviewContext, requestPath: string): Promise<string> {
    const devices = await loadRuntimePreviewDevices();
    const html = await ejs.renderFile(join(runtimePreviewStaticRoot, 'index.ejs'), {
        title: `Cocos Creator Preview - ${basename(context.projectRoot)}`,
        tip_sceneIsEmpty: 'No user scene found to load.',
        enableDebugger: false,
        settingsJs: `/settings.js${getSceneQuery(requestPath)}`,
        packImportMapURL: '/scripting/x/packer-driver/targets/preview/import-map.json',
        packResolutionDetailMapURL: '/scripting/x/packer-driver/targets/preview/main-record.json',
        cocosTemplate: join(runtimePreviewStaticRoot, 'script.ejs'),
        cocosToolBar: join(runtimePreviewStaticRoot, 'toolbar.ejs'),
        devices,
        config: {
            device: 'Default',
            showFps: true,
            rotate: false,
            debugMode: 'INFO',
            fps: 60,
        },
    });
    return String(html);
}

export async function resolveRuntimePreviewStaticFile(pathname: string): Promise<ResolvedRuntimePreviewFile | null> {
    const staticPrefix = '/static/runtime-preview/resources/';
    const previewAppPrefix = '/preview-app/';
    let absolutePath: string | null = null;
    let allowedRoot: string | null = null;
    if (pathname.startsWith(previewAppPrefix)) {
        const relativePath = pathname.slice(previewAppPrefix.length).replace(/\\/g, '/');
        if (!relativePath || relativePath.split('/').includes('..')) {
            return null;
        }
        allowedRoot = join(runtimePreviewStaticRoot, 'preview-app');
        absolutePath = join(allowedRoot, ...relativePath.split('/'));
    } else if (pathname.startsWith(staticPrefix)) {
        const relativePath = pathname.slice(staticPrefix.length).replace(/\\/g, '/');
        if (!relativePath || relativePath.split('/').includes('..')) {
            return null;
        }
        allowedRoot = join(runtimePreviewStaticRoot, 'resources');
        absolutePath = join(allowedRoot, ...relativePath.split('/'));
    } else if (pathname === '/index.css') {
        allowedRoot = join(runtimePreviewStaticRoot, 'resources');
        absolutePath = join(allowedRoot, 'index.css');
    } else if (pathname === '/favicon.ico') {
        allowedRoot = join(runtimePreviewStaticRoot, 'resources');
        absolutePath = join(allowedRoot, 'favicon.ico');
    }

    if (!absolutePath || !allowedRoot || !isPathInsideRoot(absolutePath, allowedRoot)) {
        return null;
    }

    try {
        const fileStat = await stat(absolutePath);
        if (fileStat.isFile()) {
            return { absolutePath };
        }
    } catch {
        // The caller will continue with other fact-backed resolvers.
    }

    return null;
}
