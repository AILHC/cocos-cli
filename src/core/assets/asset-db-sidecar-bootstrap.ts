import { dirname, join, relative } from 'path';
import { ensureDir, pathExists, readJSON, writeJSON } from 'fs-extra';

interface AssetsSidecarRecordPaths {
    info: string;
    data: string;
    dependency: string;
    cache: string;
}

interface BootstrapAssetsSidecarRecordsOptions {
    target: string;
    library: string;
    records: AssetsSidecarRecordPaths;
}

interface EditorAssetsInfoRecord {
    version: string;
    map: Record<string, unknown>;
    missing?: Record<string, unknown>;
}

interface EditorAssetsDependencyRecord {
    path?: Record<string, string[]>;
    uuid?: Record<string, string[]>;
}

function toTargetRelativePath(target: string, file: string) {
    return relative(target, file).replace(/\\/g, '/');
}

function convertInfoMap(target: string, map: Record<string, unknown>) {
    return Object.fromEntries(
        Object.entries(map).map(([file, value]) => [
            toTargetRelativePath(target, file),
            value,
        ])
    );
}

function convertDependencyPathMap(target: string, map: Record<string, string[]> = {}) {
    return Object.fromEntries(
        Object.entries(map).map(([file, values]) => [
            toTargetRelativePath(target, file),
            values.map((value) => toTargetRelativePath(target, value)),
        ])
    );
}

function convertDependencyUuidMap(target: string, map: Record<string, string[]> = {}) {
    return Object.fromEntries(
        Object.entries(map).map(([file, values]) => [
            toTargetRelativePath(target, file),
            values,
        ])
    );
}

export async function bootstrapAssetsSidecarRecords(options: BootstrapAssetsSidecarRecordsOptions) {
    const cliRecordsExist = await pathExists(options.records.info)
        && await pathExists(options.records.data)
        && await pathExists(options.records.dependency)
        && await pathExists(options.records.cache);
    if (cliRecordsExist) {
        return;
    }

    const editorInfoPath = join(options.library, '.assets-info1.0.0.json');
    const editorDataPath = join(options.library, '.assets-data.json');
    const editorDependencyPath = join(options.library, '.assets-dependency.json');
    const editorRecordsExist = await pathExists(editorInfoPath)
        && await pathExists(editorDataPath)
        && await pathExists(editorDependencyPath);
    if (!editorRecordsExist) {
        return;
    }

    const editorInfo = await readJSON(editorInfoPath) as EditorAssetsInfoRecord;
    const editorData = await readJSON(editorDataPath);
    const editorDependency = await readJSON(editorDependencyPath) as EditorAssetsDependencyRecord;
    const cliInfoMap = convertInfoMap(options.target, editorInfo.map || {});

    await Promise.all([
        ensureDir(dirname(options.records.info)),
        ensureDir(dirname(options.records.data)),
        ensureDir(dirname(options.records.dependency)),
        ensureDir(dirname(options.records.cache)),
    ]);

    await writeJSON(options.records.info, {
        version: '1.0.1',
        map: cliInfoMap,
        missing: editorInfo.missing ?? {},
    }, { spaces: 4 });
    await writeJSON(options.records.data, editorData, { spaces: 4 });
    await writeJSON(options.records.dependency, {
        data: {
            path: convertDependencyPathMap(options.target, editorDependency.path),
            uuid: convertDependencyUuidMap(options.target, editorDependency.uuid),
        },
        version: '1.0.0',
    }, { spaces: 4 });
    await writeJSON(options.records.cache, {
        version: '1.0.1',
        data: {
            paths: Object.keys(cliInfoMap),
        },
    }, { spaces: 4 });
}
