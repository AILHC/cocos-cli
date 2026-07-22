export const PREVIEW_ENGINE_CACHE_VERSION = '4';

/**
 * Spine 版本由 ccbuild 的 build-time constants 和 moduleOverrides 决定，不能在同一个
 * preview engine artifact 中同时启用。配置感知的 cache profile 完成前固定使用 3.8。
 */
export function resolvePreviewEngineFeatures(features: readonly string[]): string[] {
    return [
        ...features.filter((feature) => !feature.startsWith('spine-')),
        'spine-3.8',
    ];
}
