import ejs from 'ejs';
import { readFile, stat } from 'node:fs/promises';
import { basename, isAbsolute, join, relative, resolve } from 'node:path';
import type { RuntimePreviewContext } from '../context/runtime-preview-context';
import type { ResolvedRuntimePreviewFile } from '../library/resolve-library-request';
import type { PreviewSettingsProvider } from '../settings/preview-settings-provider';
import {
    getRequestedScene,
    resolveRuntimePreviewStartScene,
} from './preview-scenes';

interface RuntimePreviewDevice {
    name: string;
    width: number;
    height: number;
    ratio?: number;
}

interface RuntimePreviewDesignResolution {
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

export class RuntimePreviewTemplateRenderError extends Error {
    readonly templatePath: string;

    constructor(templatePath: string, errorMessage: string) {
        const message = `runtime-preview-template-error ${templatePath}: ${errorMessage}`;
        super(message);
        this.name = 'RuntimePreviewTemplateRenderError';
        this.templatePath = templatePath;
    }
}

function readNumber(value: unknown): number | null {
    if (typeof value === 'number') {
        return Number.isFinite(value) && value > 0 ? value : null;
    }

    if (typeof value === 'string') {
        const numeric = Number(value);
        return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
    }

    return null;
}

function parseResolutionFromText(value: string): RuntimePreviewDesignResolution | null {
    const match = /^\s*(\d+)\s*[xX]\s*(\d+)\s*$/.exec(value);
    if (!match) {
        return null;
    }
    const width = Number(match[1]);
    const height = Number(match[2]);
    if (width <= 0 || height <= 0 || !Number.isFinite(width) || !Number.isFinite(height)) {
        return null;
    }

    return {
        width,
        height,
    };
}

function readDesignResolution(settings: unknown): RuntimePreviewDesignResolution | null {
    if (!settings || typeof settings !== 'object') {
        return null;
    }

    const screen = (settings as { screen?: unknown }).screen;
    const candidates: unknown[] = [];
    if (screen && typeof screen === 'object') {
        const screenLike = screen as { designResolution?: unknown; resolution?: unknown };
        candidates.push(screenLike.designResolution, screenLike.resolution);
    }
    candidates.push((settings as { designResolution?: unknown }).designResolution);

    for (const candidate of candidates) {
        if (typeof candidate === 'string') {
            const parsed = parseResolutionFromText(candidate);
            if (parsed) {
                return parsed;
            }
        }

        if (candidate && typeof candidate === 'object') {
            const width = readNumber((candidate as { width?: unknown }).width);
            const height = readNumber((candidate as { height?: unknown }).height);
            if (width !== null && height !== null) {
                return { width, height };
            }
        }
    }

    return null;
}

export function createRuntimePreviewDeviceMap(
    source: unknown,
    settings?: unknown,
): Record<string, RuntimePreviewDevice> {
    const devices = getFallbackRuntimePreviewDevices();
    const entries = Array.isArray(source) ? source as CreatorDeviceEntry[] : [];
    let defaultDevice: RuntimePreviewDevice | null = null;
    for (const entry of entries) {
        if (typeof entry.name !== 'string' || !entry.name.trim()) {
            continue;
        }
        if (typeof entry.width !== 'number' || typeof entry.height !== 'number') {
            continue;
        }

        if (entry.default === true) {
            defaultDevice = {
                name: entry.name,
                width: entry.width,
                height: entry.height,
                ...(typeof entry.ratio === 'number' ? { ratio: entry.ratio } : {}),
            };
        }
        devices[entry.name] = {
            name: entry.name,
            width: entry.width,
            height: entry.height,
            ...(typeof entry.ratio === 'number' ? { ratio: entry.ratio } : {}),
        };
    }

    const designResolution = readDesignResolution(settings);
    if (designResolution) {
        devices.Default = {
            name: 'Default',
            width: designResolution.width,
            height: designResolution.height,
            ...(typeof designResolution.ratio === 'number' ? { ratio: designResolution.ratio } : {}),
        };
    } else if (defaultDevice) {
        devices.Default = {
            ...defaultDevice,
            name: 'Default',
        };
    }

    return devices;
}

export async function loadRuntimePreviewDevices(settings?: unknown): Promise<Record<string, RuntimePreviewDevice>> {
    try {
        const devicesJson = await readFile(join(runtimePreviewStaticRoot, 'devices', 'devices.json'), 'utf8');
        return createRuntimePreviewDeviceMap(JSON.parse(devicesJson), settings);
    } catch {
        return createRuntimePreviewDeviceMap([], settings);
    }
}

async function isProjectTemplateAvailable(pathname: string): Promise<boolean> {
    try {
        const fileStat = await stat(pathname);
        return fileStat.isFile();
    } catch {
        return false;
    }
}

async function getSceneQuery(context: RuntimePreviewContext, requestPath: string): Promise<string> {
    const scene = await resolveRuntimePreviewStartScene(context, getRequestedScene(requestPath), context.scene);
    return scene ? `?scene=${encodeURIComponent(scene)}` : '';
}

function shouldShowFps(requestPath: string): boolean {
    const requestUrl = new URL(requestPath, 'http://runtime-preview.local');
    return requestUrl.searchParams.get('debug') !== 'false';
}

export async function renderRuntimePreviewEntry(
    context: RuntimePreviewContext,
    settingsProvider: PreviewSettingsProvider,
    requestPath: string,
): Promise<string> {
    const previewSettings = await settingsProvider.getPreviewSettings();
    const devices = await loadRuntimePreviewDevices(previewSettings.settings);
    const sceneQuery = await getSceneQuery(context, requestPath);
    const projectTemplatePath = join(context.projectRoot, 'preview-template', 'index.ejs');
    const usesProjectTemplate = await isProjectTemplateAvailable(projectTemplatePath);
    const templatePath = usesProjectTemplate
        ? projectTemplatePath
        : join(runtimePreviewStaticRoot, 'index.ejs');

    try {
        const html = await ejs.renderFile(templatePath, {
            title: `Cocos Creator Preview - ${basename(context.projectRoot)}`,
            tip_sceneIsEmpty: 'No user scene found to load.',
            enableDebugger: false,
            settingsJs: `/settings.js${sceneQuery}`,
            packImportMapURL: '/scripting/x/packer-driver/targets/preview/import-map.json',
            packResolutionDetailMapURL: '/scripting/x/packer-driver/targets/preview/main-record.json',
            cocosTemplate: join(runtimePreviewStaticRoot, 'script.ejs'),
            cocosToolBar: join(runtimePreviewStaticRoot, 'toolbar.ejs'),
            devices,
            config: {
                device: 'Default',
                showFps: shouldShowFps(requestPath),
                rotate: false,
                debugMode: 'INFO',
                fps: 60,
            },
        });
        return String(html);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (usesProjectTemplate) {
            throw new RuntimePreviewTemplateRenderError(templatePath, message);
        }
        throw error;
    }
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
