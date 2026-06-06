export interface CliPreviewSettingsResult {
    settings: Record<string, any>;
    script2library: Record<string, string>;
    bundleConfigs: Array<Record<string, any>>;
}

export type LoadPreviewSettings = (options?: Record<string, any>) => Promise<CliPreviewSettingsResult>;

export interface PreviewSettingsProviderOptions {
    loadPreviewSettings?: LoadPreviewSettings;
    buildOptions?: Record<string, any>;
    timeoutMs?: number;
    now?: () => number;
}

export interface PreviewAssetBaseConfig {
    importBase?: string;
    nativeBase?: string;
    server?: string;
    remoteBundles?: string[];
}

export interface PreviewScriptRuntimeMap {
    script2library: Record<string, string>;
}

export interface PreviewSettingsProviderResult {
    settings: Record<string, any>;
    settingsJsSource: string;
    bundleConfigs: Array<Record<string, any>>;
    scriptRuntimeMap: PreviewScriptRuntimeMap;
    assetBaseConfig: PreviewAssetBaseConfig;
    diagnostics: {
        source: 'cli-getPreviewSettings';
        elapsedMs: number;
        timeoutMs: number;
        normalBuildPipelineExecuted: false;
    };
}

const defaultTimeoutMs = 30_000;

async function defaultLoadPreviewSettings(options?: Record<string, any>): Promise<CliPreviewSettingsResult> {
    const builder = await import('../../core/builder');
    return builder.getPreviewSettings(options as never) as Promise<CliPreviewSettingsResult>;
}

function createSettingsJsSource(settings: Record<string, any>): string {
    return `window._CCSettings = ${JSON.stringify(settings)};`;
}

function extractAssetBaseConfig(settings: Record<string, any>): PreviewAssetBaseConfig {
    const assets = settings.assets ?? settings.overrideSettings?.assets ?? {};
    return {
        importBase: assets.importBase,
        nativeBase: assets.nativeBase,
        server: assets.server,
        remoteBundles: assets.remoteBundles,
    };
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<T>((_, reject) => {
        timeout = setTimeout(() => {
            reject(new Error(`Preview settings generation timed out after ${timeoutMs}ms`));
        }, timeoutMs);
    });

    return Promise.race([promise, timeoutPromise]).finally(() => {
        if (timeout) {
            clearTimeout(timeout);
        }
    });
}

export class PreviewSettingsProvider {
    private readonly loadPreviewSettings: LoadPreviewSettings;
    private readonly buildOptions?: Record<string, any>;
    private readonly timeoutMs: number;
    private readonly now: () => number;
    private cachedResult: PreviewSettingsProviderResult | null = null;

    constructor(options: PreviewSettingsProviderOptions = {}) {
        this.loadPreviewSettings = options.loadPreviewSettings ?? defaultLoadPreviewSettings;
        this.buildOptions = options.buildOptions;
        this.timeoutMs = options.timeoutMs ?? defaultTimeoutMs;
        this.now = options.now ?? Date.now;
    }

    async getPreviewSettings(): Promise<PreviewSettingsProviderResult> {
        if (this.cachedResult) {
            return this.cachedResult;
        }

        const start = this.now();
        const cliResult = await withTimeout(this.loadPreviewSettings(this.buildOptions), this.timeoutMs);
        const elapsedMs = this.now() - start;

        this.cachedResult = {
            settings: cliResult.settings,
            settingsJsSource: createSettingsJsSource(cliResult.settings),
            bundleConfigs: cliResult.bundleConfigs,
            scriptRuntimeMap: {
                script2library: cliResult.script2library,
            },
            assetBaseConfig: extractAssetBaseConfig(cliResult.settings),
            diagnostics: {
                source: 'cli-getPreviewSettings',
                elapsedMs,
                timeoutMs: this.timeoutMs,
                normalBuildPipelineExecuted: false,
            },
        };

        return this.cachedResult;
    }

    invalidate(): void {
        this.cachedResult = null;
    }
}
