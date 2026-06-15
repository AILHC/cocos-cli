import { BundleCompressionType } from '../../../../@types';
import { BundleCompressionTypes, transformPlatformSettings } from '../../../../share/bundle-utils';
import { BundlePlatformType, CustomBundleConfig, PlatformBundleConfig } from '../../../../@types/protected';

export interface ProjectBundleOutputOptions {
    compressionType: BundleCompressionType;
    isRemote: boolean;
}

export function isCompressionTypeSupported(
    compressionType: BundleCompressionType,
    supportedCompressionTypes: BundleCompressionType[],
) {
    return !supportedCompressionTypes.length || supportedCompressionTypes.includes(compressionType);
}

export function isMiniGameBundlePlatform(platformType?: BundlePlatformType) {
    return platformType === 'miniGame';
}

export function shouldOutputProjectBundleWithExplicitConfigs(
    config: ProjectBundleOutputOptions,
    supportedCompressionTypes: BundleCompressionType[],
    platformType?: BundlePlatformType,
) {
    if (!isMiniGameBundlePlatform(platformType)) {
        return false;
    }

    if (!isCompressionTypeSupported(config.compressionType, supportedCompressionTypes)) {
        return false;
    }

    return config.isRemote;
}

export function transformBundleConfigCustomByPlatformType(
    bundleConfig: Record<string, CustomBundleConfig>,
    platformConfigs: Record<string, PlatformBundleConfig>,
) {
    const res: Record<string, Record<string, { isRemote: boolean; compressionType: BundleCompressionTypes }>> = {};

    Object.keys(bundleConfig).forEach((ID) => {
        const configs = bundleConfig[ID].configs;
        res[ID] = {};
        Object.keys(configs).forEach((platformType) => {
            const scopedPlatformConfigs = filterPlatformConfigsByType(platformConfigs, platformType as BundlePlatformType);
            const platformOption = transformPlatformSettings(configs[platformType as BundlePlatformType], scopedPlatformConfigs);
            Object.assign(res[ID], platformOption);
        });
    });

    return res;
}

function filterPlatformConfigsByType(
    platformConfigs: Record<string, PlatformBundleConfig>,
    platformType: BundlePlatformType,
) {
    const res: Record<string, PlatformBundleConfig> = {};
    Object.keys(platformConfigs).forEach((platform) => {
        if (platformConfigs[platform].platformType === platformType) {
            res[platform] = platformConfigs[platform];
        }
    });
    return res;
}
