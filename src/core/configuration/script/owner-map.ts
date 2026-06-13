import * as utils from './utils';

export type ConfigRecord = Record<string, any>;

const CLI_OWNED_CONFIG_PATHS = [
    'import.restoreAssetDBFromCache',
    'import.globList',
    'import.createTemplateRoot',
] as const;

const PERSISTENCE_METADATA_PATHS = [
    'version',
    '$schema',
] as const;

const EDITOR_OWNED_ROOTS = [
    'builder',
    'engine',
    'script',
    'scene',
] as const;

function hasPath(value: ConfigRecord, path: string): boolean {
    return utils.getByDotPath(value, path) !== undefined;
}

function pickPaths(source: ConfigRecord, paths: readonly string[]): ConfigRecord {
    const result: ConfigRecord = {};
    for (const path of paths) {
        const value = utils.getByDotPath(source, path);
        if (value !== undefined) {
            utils.setByDotPath(result, path, cloneConfigValue(value));
        }
    }
    return result;
}

function cloneConfigValue<T>(value: T): T {
    if (value === undefined || value === null || typeof value !== 'object') {
        return value;
    }
    return JSON.parse(JSON.stringify(value));
}

export function isCliOwnedConfigPath(path: string): boolean {
    return [...CLI_OWNED_CONFIG_PATHS, ...PERSISTENCE_METADATA_PATHS].includes(path as never);
}

export function isEditorOwnedConfigPath(path: string): boolean {
    if (isCliOwnedConfigPath(path)) {
        return false;
    }
    if (path === 'import' || path.startsWith('import.')) {
        return true;
    }
    return EDITOR_OWNED_ROOTS.some((root) => path === root || path.startsWith(`${root}.`));
}

export function pickCliOwnedConfig(source: ConfigRecord): ConfigRecord {
    return pickPaths(source, CLI_OWNED_CONFIG_PATHS);
}

export function pickPersistenceMetadata(source: ConfigRecord): ConfigRecord {
    return pickPaths(source, PERSISTENCE_METADATA_PATHS);
}

export function buildPersistedCliConfig(source: ConfigRecord): ConfigRecord {
    return utils.deepMerge(
        pickPersistenceMetadata(source),
        pickCliOwnedConfig(source),
    ) as ConfigRecord;
}

export function mergeRuntimeProjectConfig(editorConfig: ConfigRecord, cliPersistedConfig: ConfigRecord): ConfigRecord {
    const runtimeConfig = cloneConfigValue(editorConfig);
    const cliOwnedConfig = pickCliOwnedConfig(cliPersistedConfig);

    for (const path of CLI_OWNED_CONFIG_PATHS) {
        if (hasPath(cliOwnedConfig, path)) {
            utils.setByDotPath(runtimeConfig, path, utils.getByDotPath(cliOwnedConfig, path));
        }
    }

    return runtimeConfig;
}
