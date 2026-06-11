import { Ui } from './ui.js';
import { bootstrap } from './index.js';

type RuntimePreviewReadyResource = {
    path: string;
    type: string;
    uuid?: string;
};

type RuntimePreviewReadyState = {
    scene: string;
    resources: RuntimePreviewReadyResource[];
    timestamp: number;
    limitation?: string;
};

type RuntimePreviewImportMap = {
    imports?: Record<string, string>;
    scopes?: Record<string, Record<string, string>>;
};

declare global {
    interface Window {
        __RUNTIME_PREVIEW_READY?: RuntimePreviewReadyState;
    }
}

export async function main(ui: Ui, options: bootstrap.Options) {
    const cc = await System.import('cc');

    const debugMode = cc.DebugMode[ui.debugMode] ?? cc.DebugMode.INFO;

    // 引擎启动选项
    const option: { debugMode: boolean; overrideSettings: Record<string, any>;} = {
        debugMode,
        overrideSettings: {},
    };
    let launchScene = options.settings.launch.launchScene;

    Object.assign(option.overrideSettings, options.settings);
    applyRuntimePreviewBrowserOverrides(option.overrideSettings);

    option.overrideSettings.profiling = option.overrideSettings.profiling || {};
    option.overrideSettings.profiling.showFPS = ui.showFps;
    option.overrideSettings.screen = option.overrideSettings.screen || {};
    option.overrideSettings.screen.frameRate = ui.frameRate;
    option.overrideSettings.screen.exactFitScreen = ui.isFullscreen() ? true : false;
    option.overrideSettings.assets = option.overrideSettings.assets || {};
    option.overrideSettings.assets.importBase = 'assets/general/import';
    option.overrideSettings.assets.nativeBase = 'assets/general/native';
    option.overrideSettings.assets.remoteBundles = [];
    option.overrideSettings.assets.subpackages = [];
    option.overrideSettings.launch = option.overrideSettings.launch || {};
    option.overrideSettings.launch.launchScene = '';
    // 等待引擎启动
    await cc.game.init(option);
    await loadRuntimePreviewPrerequisiteImports();
    const readyResources = await loadRuntimePreviewReadyResources(cc);
    cc.assetManager.onAssetMissing(async (parentAsset: any, owner: any, propName: string, uuid: string) => {
        let assetPathOrUuid = uuid;
        let errorInfo = `The asset ${uuid} used by ${parentAsset.name}{${cc.js.getClassName(parentAsset)}(${parentAsset.uuid})} is missing! \n`;
        try {
            const info = await getData(`/missing-asset/${uuid}`);
            if (info) {
                errorInfo = `The asset ${info.path} used by ${parentAsset.name}{${cc.js.getClassName(parentAsset)}(${parentAsset.uuid})} is missing! \n`;
            }
            assetPathOrUuid = info.path;
            info && (errorInfo += `asset ${info.path}(${uuid}) has been deleted at ${new Date(info.removeTime).toLocaleString()}. \n`);
        } catch (error) {
            console.debug(`query missing asset ${uuid} failed`);
        }
        if (owner && owner.node instanceof cc.Node) {
            errorInfo += `Node path: ${owner.node.getPathInHierarchy()}\n`;
        }
        propName && (errorInfo += `PropName: ${propName}`);
        console.error(errorInfo);
    });

    await cc.game.run(async () => {
        cc.director.once(cc.Director.EVENT_AFTER_SCENE_LAUNCH, () => {
            ui.hideSplash();
            if (isCurrentSceneEmpty(cc)) {
                ui.hintEmptyScene();
            }
        });
        ui.showLoading();
        cc.game.pause();
        if (!launchScene) {
            ui.hideSplash();
            ui.hintEmptyScene();
            setRuntimePreviewReady({
                scene: '',
                resources: readyResources,
                timestamp: Date.now(),
                limitation: readyResources.length > 0 ? undefined : 'resource-marker-not-requested',
            });
            return;
        }
        const json = await getCurrentScene(launchScene);
        try {
            launchScene = json[1]._id;
        } catch (error) {
            console.debug(error);
        }
        // load scene
        // Load scene progress reports the first 60% of the splash progress.
        cc.assetManager.loadWithJson(
            json,
            { assetId: launchScene },
            (completedCount: number, totalCount: number) => {
                const progress = ((100 * completedCount) / totalCount) * 0.6; // 划分加载进度，场景加载 60%
                ui.reportLoadProgress(progress);
            },
            (error: null | Error, sceneAsset: any) => {
                if (error) {
                    ui.showError(error);
                    cc.error(error);
                    return;
                }
                const scene = sceneAsset.scene;
                scene._name = sceneAsset._name;
                cc.director.runSceneImmediate(scene, () => {
                    cc.game.resume();
                    setRuntimePreviewReady({
                        scene: launchScene || '',
                        resources: readyResources,
                        timestamp: Date.now(),
                    });
                });
            },
        );
    });

    await new Promise((resolve) => {
        setTimeout(resolve, 100);
    });
}

async function loadRuntimePreviewPrerequisiteImports(): Promise<void> {
    try {
        await System.import('cce:/internal/x/prerequisite-imports');
        await validateRuntimePreviewPrerequisiteImportMap();
    } catch (error) {
        console.error('[runtime-preview] prerequisite imports failed', error);
        throw error;
    }
}

async function validateRuntimePreviewPrerequisiteImportMap(): Promise<void> {
    const importMapUrl = '/scripting/x/packer-driver/targets/preview/import-map.json';
    const response = await fetch(importMapUrl);
    if (!response.ok) {
        throw new Error(`Failed to load runtime preview import map: ${response.status}`);
    }

    const importMap = await response.json() as RuntimePreviewImportMap;
    const prerequisiteChunk = importMap.imports?.['cce:/internal/x/prerequisite-imports'];
    const prerequisiteScope = prerequisiteChunk ? importMap.scopes?.[prerequisiteChunk] : undefined;
    if (!prerequisiteChunk || !prerequisiteScope) {
        throw new Error('Runtime preview prerequisite import scope is missing.');
    }

    const importMapBase = new URL(importMapUrl, window.location.href);
    const prerequisiteChunkUrl = new URL(prerequisiteChunk, importMapBase);
    const chunkResponse = await fetch(prerequisiteChunkUrl.href);
    if (!chunkResponse.ok) {
        throw new Error(`Failed to load runtime preview prerequisite chunk: ${chunkResponse.status}`);
    }

    const prerequisiteChunkSource = await chunkResponse.text();
    const requiredSpecifiers = collectRuntimePreviewUnresolvedSpecifiers(prerequisiteChunkSource);
    for (const specifier of requiredSpecifiers) {
        const chunkImport = prerequisiteScope[specifier];
        if (!isRuntimePreviewChunkImport(chunkImport)) {
            throw new Error(`Runtime preview prerequisite scope is missing ${specifier}.`);
        }
    }
}

function collectRuntimePreviewUnresolvedSpecifiers(source: string): string[] {
    const specifiers = new Set<string>();
    const pattern = /__unresolved_\d+/g;
    let match: RegExpExecArray | null = null;
    while ((match = pattern.exec(source))) {
        specifiers.add(match[0]);
    }

    return Array.from(specifiers)
        .sort((left, right) => Number(left.slice('__unresolved_'.length)) - Number(right.slice('__unresolved_'.length)));
}

function isRuntimePreviewChunkImport(value: unknown): value is string {
    return typeof value === 'string' && /^\.\/chunks\/[^/]+\/[^/]+\.js$/.test(value);
}

async function loadRuntimePreviewReadyResources(cc: any): Promise<RuntimePreviewReadyResource[]> {
    const request = getRuntimePreviewReadyResourceRequest(cc);
    if (!request) {
        return [];
    }

    return [await new Promise<RuntimePreviewReadyResource>((resolve, reject) => {
        cc.resources.load(request.path, request.ctor, (error: Error | null, asset: any) => {
            if (error) {
                reject(error);
                return;
            }

            resolve({
                path: request.path,
                type: request.type,
                uuid: asset?.uuid,
            });
        });
    })];
}

function getRuntimePreviewReadyResourceRequest(cc: any): { path: string; type: string; ctor: any } | null {
    const params = new URLSearchParams(window.location.search);
    const path = params.get('runtimePreviewReadyResource');
    const type = params.get('runtimePreviewReadyType') || 'JsonAsset';
    if (!path) {
        return null;
    }

    const ctor = cc[type];
    if (typeof ctor !== 'function') {
        throw new Error(`Unsupported runtime preview ready resource type: ${type}`);
    }

    return { path, type, ctor };
}

const LEGACY_RENDER_MODE_WEBGL = 2;
const LEGACY_RENDER_MODE_WEBGPU = 4;

function applyRuntimePreviewBrowserOverrides(overrideSettings: Record<string, any>): void {
    const params = new URLSearchParams(window.location.search);
    const renderType = params.get('runtimePreviewRenderType') || 'webgl';
    overrideSettings.rendering = overrideSettings.rendering || {};
    // Runtime preview defaults to WebGL for deterministic browser validation.
    // WebGPU stays opt-in because 3.8.6 WebGPU validation can fail for existing project assets.
    overrideSettings.rendering.renderMode = renderType === 'webgpu'
        ? LEGACY_RENDER_MODE_WEBGPU
        : LEGACY_RENDER_MODE_WEBGL;
}

function setRuntimePreviewReady(state: RuntimePreviewReadyState): void {
    window.__RUNTIME_PREVIEW_READY = state;
    window.dispatchEvent(new CustomEvent('runtime-preview-ready', { detail: state }));
}

/**
 * Check if current scene is empty.
 */
function isCurrentSceneEmpty(cc: any) {
    const scene = cc.director.getScene();
    if (!scene || scene.children.length === 0) {
        return true;
    } else if (scene.children.length > 1) {
        return false;
    } else {
        const child0 = scene.children[0];
        if (
            child0.children.length > 0 ||
            child0._components.length > 1 ||
            (child0._components.length > 0 && !(child0._components[0] instanceof cc.Canvas))
        ) {
            return false;
        } else {
            return true;
        }
    }
}

/**
 * 读取当前场景 json 数据
 */
function getCurrentScene(launchScene?: string) {
    return getData(`scene/${launchScene}.json`);
}

/**
 * 根据 url 获取数据
 * @param url
 * @returns
 */
function getData(url: string) {
    return new Promise<any>((resolve, reject) => {
        const request = new XMLHttpRequest();
        request.responseType = 'text';
        request.addEventListener('load', () => {
            if (request.status === 200) {
                resolve(JSON.parse(request.response));
            }
        });
        request.open('GET', url, true);
        request.send();
    });
}
