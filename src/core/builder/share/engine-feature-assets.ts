import { readJSON } from 'fs-extra';
import { join } from 'path';
import { Engine } from '../../engine';

export const DEFAULT_PHYSICS_MATERIAL_UUID = 'ba21476f-2866-4f81-9c4d-6e359316e448';

interface IEngineFeatureConfig {
    dependentAssets?: string[];
    dependentModules?: string[];
}

interface IEngineCCConfig {
    features: Record<string, IEngineFeatureConfig>;
}

function collectDependentAssets(features: string[], featuresInConfig: Record<string, IEngineFeatureConfig>, checked: Set<string>, assets: Set<string>) {
    for (const featureName of features) {
        if (checked.has(featureName)) {
            continue;
        }
        checked.add(featureName);

        const feature = featuresInConfig[featureName];
        if (!feature) {
            continue;
        }

        for (const assetUuid of feature.dependentAssets ?? []) {
            assets.add(assetUuid);
        }

        if (feature.dependentModules?.length) {
            collectDependentAssets(feature.dependentModules, featuresInConfig, checked, assets);
        }
    }
}

export async function queryDependentAssetsOfFeatures(features: string[], enginePath = Engine.getInfo().typescript.path): Promise<string[]> {
    const ccConfigJson = await readJSON(join(enginePath, 'cc.config.json')) as IEngineCCConfig;
    const assets = new Set<string>();
    collectDependentAssets(features, ccConfigJson.features, new Set(), assets);
    return Array.from(assets);
}

export async function featureListIncludesDependentAsset(features: string[], assetUuid: string, enginePath = Engine.getInfo().typescript.path): Promise<boolean> {
    const dependentAssets = await queryDependentAssetsOfFeatures(features, enginePath);
    return dependentAssets.includes(assetUuid);
}

export async function findFeatureDeclaringDependentAsset(features: string[], assetUuid: string, enginePath = Engine.getInfo().typescript.path): Promise<string> {
    const ccConfigJson = await readJSON(join(enginePath, 'cc.config.json')) as IEngineCCConfig;
    for (const featureName of features) {
        const featureAssets = new Set<string>();
        collectDependentAssets([featureName], ccConfigJson.features, new Set(), featureAssets);
        if (featureAssets.has(assetUuid)) {
            return featureName;
        }
    }
    return '';
}
