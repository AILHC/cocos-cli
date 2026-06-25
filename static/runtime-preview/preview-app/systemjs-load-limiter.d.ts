export interface RuntimePreviewScriptLoadLimiterMetrics {
    active: number;
    maxActive: number;
    queuePeak: number;
    enqueued: number;
    completed: number;
    failed: number;
    retryCount: number;
    bypassed: number;
}
export interface RuntimePreviewScriptLoadLimiterState {
    hook: 'fetchScript' | 'instantiate';
    concurrency: number;
    metrics: RuntimePreviewScriptLoadLimiterMetrics;
}
export interface RuntimePreviewScriptLoadLimiterOptions {
    concurrency?: number;
    retry?: number;
}
type RuntimePreviewSystem = {
    fetchScript?: (...args: any[]) => Promise<unknown>;
    instantiate?: (...args: any[]) => Promise<unknown>;
    [key: string]: any;
};
export declare function isRuntimePreviewProjectChunkUrl(value: string): boolean;
export declare function isScriptLoadFailure(error: unknown, url: string): boolean;
export declare function installRuntimePreviewScriptLoadLimiter(system?: RuntimePreviewSystem, options?: RuntimePreviewScriptLoadLimiterOptions): RuntimePreviewScriptLoadLimiterState;
export {};
