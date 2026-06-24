import type { ICocosConfigurationNode } from '../configuration/script/metadata';
import { createNode } from '../configuration/script/metadata';
import type { ISceneConfig } from './scene-configs';

export function createSceneMetadataNodes(defaultConfig: ISceneConfig): ICocosConfigurationNode[] {
    return [
        createNode('scene.tick', 'i18n:configuration.scene.tick.title', 'scene', {
            'scene.tick': {
                type: 'boolean',
                default: defaultConfig.tick,
                title: 'i18n:configuration.scene.tick.title',
                description: 'i18n:configuration.scene.tick.description',
            },
        }, 30),
    ];
}
