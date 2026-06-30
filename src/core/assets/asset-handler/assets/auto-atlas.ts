import { Asset } from '@cocos/asset-db';
import { createTextureBaseUserDataConfig, makeDefaultTextureBaseAssetUserData } from './texture-base';

import { getDependUUIDList } from '../utils';
import { AssetHandler } from '../../@types/protected';
import { AutoAtlasAssetUserData } from '../../@types/userDatas';

const defaultAutoAtlasUserData = {
    maxWidth: 1024,
    maxHeight: 1024,

    // padding of image.
    padding: 2,

    allowRotation: true,
    forceSquared: false,
    powerOfTwo: false,
    algorithm: 'MaxRects',
    format: 'png',
    quality: 80,
    contourBleed: true,
    paddingBleed: true,
    filterUnused: true,
    removeTextureInBundle: true,
    removeImageInBundle: true,
    removeSpriteAtlasInBundle: true,
    compressSettings: {},
    textureSetting: makeDefaultTextureBaseAssetUserData(),
};

const AutoAtlasHandler: AssetHandler = {
    // Handler 的名字，用于指定 Handler as 等
    name: 'auto-atlas',

    // pac 文件实际上在编辑器下没用到，只有构建时会用。因此这里把类型设置为 cc.SpriteAtlas，方便构建时当成图集来处理。
    assetType: 'cc.SpriteAtlas',
    propertySchemaConfig: {
            maxWidth: {
                label: 'i18n:importer.property_schema.auto_atlas.max_width',
                default: defaultAutoAtlasUserData.maxWidth,
                render: {
                    ui: 'ui-number-input',
                    attributes: { min: 1, step: 1 },
                },
            },
            maxHeight: {
                label: 'i18n:importer.property_schema.auto_atlas.max_height',
                default: defaultAutoAtlasUserData.maxHeight,
                render: {
                    ui: 'ui-number-input',
                    attributes: { min: 1, step: 1 },
                },
            },
            padding: {
                label: 'i18n:importer.property_schema.auto_atlas.padding',
                default: defaultAutoAtlasUserData.padding,
                render: {
                    ui: 'ui-number-input',
                    attributes: { min: 0, step: 1 },
                },
            },
            allowRotation: {
                label: 'i18n:importer.property_schema.auto_atlas.allow_rotation',
                default: defaultAutoAtlasUserData.allowRotation,
                render: { ui: 'ui-checkbox' },
            },
            forceSquared: {
                label: 'i18n:importer.property_schema.auto_atlas.force_squared',
                default: defaultAutoAtlasUserData.forceSquared,
                render: { ui: 'ui-checkbox' },
            },
            powerOfTwo: {
                label: 'i18n:importer.property_schema.auto_atlas.power_of_two',
                default: defaultAutoAtlasUserData.powerOfTwo,
                render: { ui: 'ui-checkbox' },
            },
            algorithm: {
                label: 'i18n:importer.property_schema.auto_atlas.algorithm',
                default: defaultAutoAtlasUserData.algorithm,
                render: {
                    ui: 'ui-select',
                    items: [
                        { label: 'i18n:importer.property_schema.auto_atlas.max_rects', value: 'MaxRects' },
                    ],
                },
            },
            format: {
                label: 'i18n:importer.property_schema.auto_atlas.format',
                default: defaultAutoAtlasUserData.format,
                render: {
                    ui: 'ui-select',
                    items: [
                        { label: 'i18n:importer.property_schema.auto_atlas.png', value: 'png' },
                        { label: 'i18n:importer.property_schema.auto_atlas.jpg', value: 'jpg' },
                    ],
                },
            },
            quality: {
                label: 'i18n:importer.property_schema.auto_atlas.quality',
                default: defaultAutoAtlasUserData.quality,
                render: {
                    ui: 'ui-number-input',
                    attributes: { min: 0, max: 100, step: 1 },
                },
            },
            contourBleed: {
                label: 'i18n:importer.property_schema.auto_atlas.contour_bleed',
                default: defaultAutoAtlasUserData.contourBleed,
                render: { ui: 'ui-checkbox' },
            },
            paddingBleed: {
                label: 'i18n:importer.property_schema.auto_atlas.padding_bleed',
                default: defaultAutoAtlasUserData.paddingBleed,
                render: { ui: 'ui-checkbox' },
            },
            filterUnused: {
                label: 'i18n:importer.property_schema.auto_atlas.filter_unused',
                default: defaultAutoAtlasUserData.filterUnused,
                render: { ui: 'ui-checkbox' },
            },
            removeTextureInBundle: {
                label: 'i18n:importer.property_schema.auto_atlas.remove_texture_in_bundle',
                default: defaultAutoAtlasUserData.removeTextureInBundle,
                render: { ui: 'ui-checkbox' },
            },
            removeImageInBundle: {
                label: 'i18n:importer.property_schema.auto_atlas.remove_image_in_bundle',
                default: defaultAutoAtlasUserData.removeImageInBundle,
                render: { ui: 'ui-checkbox' },
            },
            removeSpriteAtlasInBundle: {
                label: 'i18n:importer.property_schema.auto_atlas.remove_sprite_atlas_in_bundle',
                default: defaultAutoAtlasUserData.removeSpriteAtlasInBundle,
                render: { ui: 'ui-checkbox' },
            },
            textureSetting: {
                label: 'i18n:importer.property_schema.auto_atlas.texture_setting',
                type: 'object',
                default: defaultAutoAtlasUserData.textureSetting,
                itemConfigs: createTextureBaseUserDataConfig(),
            },
    },
    createInfo: {
        generateMenuInfo() {
            return [
                {
                    label: 'i18n:ENGINE.assets.newPac',
                    fullFileName: 'auto-atlas.pac',
                    template: `db://internal/default_file_content/${AutoAtlasHandler.name}/default.pac`,
                    name: 'default',
                },
            ];
        },
    },

    importer: {
        version: '1.0.8',

        /**
         * 实际导入流程
         * 需要自己控制是否生成、拷贝文件
         *
         * 返回是否导入成功的标记
         * 如果返回 false，则 imported 标记不会变成 true
         * 后续的一系列操作都不会执行
         * @param asset
         */
        async import(asset: Asset) {
            const userData = asset.userData as AutoAtlasAssetUserData;
            // @ts-ignore
            Object.keys(defaultAutoAtlasUserData).forEach((key: string) => {
                if (!(key in userData)) {
                    // @ts-ignore
                    userData[key] = defaultAutoAtlasUserData[key];
                }
            });
            // @ts-ignore
            const autoAtlas = new cc.SpriteAtlas();
            autoAtlas.name = asset.basename || '';

            const serializeJSON = EditorExtends.serialize(autoAtlas);
            await asset.saveToLibrary('.json', serializeJSON);

            const depends = getDependUUIDList(serializeJSON);
            asset.setData('depends', depends);

            return true;
        },
    },
};

export default AutoAtlasHandler;
