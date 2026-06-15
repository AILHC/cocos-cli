'use strict';

import { IPlatformBuildPluginConfig } from '../../@types/protected';

const PLATFORM_TYPE = 'miniGame';

const config: IPlatformBuildPluginConfig = {
    displayName: 'i18n:wechatgame.title',
    platformType: 'WECHAT',
    hooks: './hooks',
    textureCompressConfig: {
        platformType: 'miniGame',
        support: {
            rgb: [
                'etc1_rgb',
                'etc2_rgb',
                'pvrtc_4bits_rgb',
                'pvrtc_2bits_rgb',
                'astc_4x4',
                'astc_5x5',
                'astc_6x6',
                'astc_8x8',
            ],
            rgba: [
                'etc1_rgb_a',
                'etc2_rgba',
                'pvrtc_4bits_rgba',
                'pvrtc_2bits_rgba',
                'astc_4x4',
                'astc_5x5',
                'astc_6x6',
                'astc_8x8',
            ],
        },
    },
    assetBundleConfig: {
        supportedCompressionTypes: ['none', 'merge_dep', 'merge_all_json', 'subpackage'],
        platformType: PLATFORM_TYPE,
    },
    options: {
        appid: {
            label: 'i18n:wechatgame.options.appid',
            type: 'string',
            default: '',
        },
        orientation: {
            label: 'i18n:wechatgame.options.orientation',
            type: 'enum',
            items: ['portrait', 'landscape'],
            default: 'portrait',
        },
        highPerformanceMode: {
            label: 'i18n:wechatgame.options.high_performance_mode',
            type: 'boolean',
            default: false,
        },
    },
};

export default config;
