import { existsSync, readdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { getFixturePaths } from '@shared/fixture-paths';

const frozenEditorMetadataFiles = [
  '.assets-data.json',
  '.assets-info1.0.0.json',
  '.assets-dependency.json',
  '.internal-data.json',
  '.internal-info1.0.0.json',
  '.internal-dependency.json',
];

const cliProjectAssetMetadataFiles = [
  '.assets-data.json',
  '.assets-info.json',
  '.assets-dependency.json',
];

const engineInternalMetadataFiles = [
  '.internal-data.json',
  '.internal-info.json',
  '.internal-dependency.json',
];

const representativeProjectAssetFiles = [
  '00/00614c43-17eb-4463-be7a-c162c2b92d43.json',
  '01/014b2d77-d625-4e91-9e51-081e353db503.png',
  '0d/0d687c8c-1928-4af0-8caa-195c7cd6ada3.atlas',
];

const representativeProjectAssetUuids = [
  '00614c43-17eb-4463-be7a-c162c2b92d43',
  '014b2d77-d625-4e91-9e51-081e353db503',
  '0d687c8c-1928-4af0-8caa-195c7cd6ada3',
];

const representativeInternalFiles = [
  '08/0835f102-5471-47a3-9a76-01c07ac9cdb2/OpenSans-Regular.ttf',
  '12/1263d74c-8167-4928-91a6-4e2672411f47@17020.bin',
];

const representativeInternalUuids = [
  '0835f102-5471-47a3-9a76-01c07ac9cdb2',
  '1263d74c-8167-4928-91a6-4e2672411f47',
  '1263d74c-8167-4928-91a6-4e2672411f47@17020',
];

interface AssetDataEntry {
  url?: string;
  value?: {
    depends?: unknown;
  };
  versionCode?: unknown;
}

interface VersionCodeDiff {
  uuid: string;
  expected: unknown;
  actual: unknown;
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, 'utf8')) as T;
}

async function readMetadataShape(root: string): Promise<Record<string, string[]>> {
  const shape: Record<string, string[]> = {};
  for (const fileName of frozenEditorMetadataFiles) {
    const absolutePath = join(root, fileName);
    expect(existsSync(absolutePath), `${absolutePath} should exist`).toBe(true);
    shape[fileName] = Object.keys(await readJson<Record<string, unknown>>(absolutePath)).sort();
  }
  return shape;
}

function listMetadataFiles(root: string, domain: 'assets' | 'internal'): string[] {
  if (!existsSync(root)) {
    return [];
  }
  const pattern = new RegExp(`^\\.${domain}-info(?:1\\.0\\.0)?\\.json$`);
  return readdirSync(root).filter((fileName) => pattern.test(fileName)).sort();
}

function pickLoadRelevantDataEntry(entry: AssetDataEntry | undefined): AssetDataEntry | undefined {
  if (!entry) {
    return undefined;
  }
  return {
    url: entry.url,
    value: {
      depends: entry.value?.depends,
    },
  };
}

function pickLoadRelevantDataEntries(data: Record<string, AssetDataEntry>, uuids: string[]): Record<string, AssetDataEntry | undefined> {
  return Object.fromEntries(uuids.map((uuid) => [uuid, pickLoadRelevantDataEntry(data[uuid])]));
}

function collectVersionCodeDiffs(
  actualData: Record<string, AssetDataEntry>,
  expectedData: Record<string, AssetDataEntry>,
  uuids: string[],
): VersionCodeDiff[] {
  return uuids.flatMap((uuid) => {
    const actual = actualData[uuid]?.versionCode;
    const expected = expectedData[uuid]?.versionCode;
    return actual === expected ? [] : [{ uuid, expected, actual }];
  });
}

interface CliOutputDiagnostics {
  category:
    | 'complete'
    | 'missing-cli-output-roots'
    | 'missing-cli-programming-import-map'
    | 'missing-source-backed-library-parts'
    | 'source-backed-split-library-layout';
  libraryRootExists: boolean;
  programmingRootExists: boolean;
  missingCliProjectAssetMetadataFiles: string[];
  missingEngineInternalMetadataFiles: string[];
  missingProjectAssetFiles: string[];
  missingInternalFilesInEngineLibrary: string[];
  editorVersionedInfoFiles: string[];
  cliUnversionedInfoFiles: string[];
  engineInternalRootExists: boolean;
  hasPreviewImportMap: boolean;
}

function inspectCliOutput(editorLibraryRoot: string, libraryRoot: string, programmingRoot: string, engineInternalLibraryRoot: string): CliOutputDiagnostics {
  const libraryRootExists = existsSync(libraryRoot);
  const programmingRootExists = existsSync(programmingRoot);
  const engineInternalRootExists = existsSync(engineInternalLibraryRoot);
  const missingCliProjectAssetMetadataFiles = cliProjectAssetMetadataFiles.filter((fileName) => !existsSync(join(libraryRoot, fileName)));
  const missingEngineInternalMetadataFiles = engineInternalMetadataFiles.filter((fileName) => !existsSync(join(engineInternalLibraryRoot, fileName)));
  const missingProjectAssetFiles = representativeProjectAssetFiles.filter((relativePath) => !existsSync(join(libraryRoot, relativePath)));
  const missingInternalFilesInEngineLibrary = representativeInternalFiles.filter((relativePath) => !existsSync(join(engineInternalLibraryRoot, relativePath)));
  const editorVersionedInfoFiles = [
    ...listMetadataFiles(editorLibraryRoot, 'assets'),
    ...listMetadataFiles(editorLibraryRoot, 'internal'),
  ].filter((fileName) => fileName.endsWith('info1.0.0.json'));
  const cliUnversionedInfoFiles = [
    ...listMetadataFiles(libraryRoot, 'assets'),
    ...listMetadataFiles(engineInternalLibraryRoot, 'internal'),
  ].filter((fileName) => fileName.endsWith('info.json'));
  const hasPreviewImportMap = existsSync(join(programmingRoot, 'packer-driver/targets/preview/import-map.json'));
  const category = !libraryRootExists || !programmingRootExists
    ? 'missing-cli-output-roots'
    : !hasPreviewImportMap
      ? 'missing-cli-programming-import-map'
      : missingCliProjectAssetMetadataFiles.length > 0
        || !engineInternalRootExists
        || missingEngineInternalMetadataFiles.length > 0
        || missingProjectAssetFiles.length > 0
        || missingInternalFilesInEngineLibrary.length > 0
        ? 'missing-source-backed-library-parts'
        : editorVersionedInfoFiles.length > 0 && cliUnversionedInfoFiles.length > 0
          ? 'source-backed-split-library-layout'
          : 'complete';

  return {
    category,
    libraryRootExists,
    programmingRootExists,
    missingCliProjectAssetMetadataFiles,
    missingEngineInternalMetadataFiles,
    missingProjectAssetFiles,
    missingInternalFilesInEngineLibrary,
    editorVersionedInfoFiles,
    cliUnversionedInfoFiles,
    engineInternalRootExists,
    hasPreviewImportMap,
  };
}

describe('frozen editor output and CLI AssetDB output consistency', () => {
  it('classifies current output roots and verifies representative editor output shape', async () => {
    const paths = getFixturePaths();
    const activeProjectLibraryRoot = join(paths.projectRoot, 'library');
    const activeProjectProgrammingRoot = join(paths.projectRoot, 'temp', 'programming');

    const referenceShape = await readMetadataShape(paths.editorLibraryRef);
    const activeProjectShape = await readMetadataShape(activeProjectLibraryRoot);

    expect(activeProjectShape['.assets-data.json']).toEqual(referenceShape['.assets-data.json']);
    expect(activeProjectShape['.internal-data.json']).toEqual(referenceShape['.internal-data.json']);

    for (const relativePath of representativeProjectAssetFiles) {
      expect(existsSync(join(paths.editorLibraryRef, relativePath)), `reference ${relativePath}`).toBe(true);
      expect(existsSync(join(activeProjectLibraryRoot, relativePath)), `active project ${relativePath}`).toBe(true);
    }
    for (const relativePath of representativeInternalFiles) {
      expect(existsSync(join(paths.editorLibraryRef, relativePath)), `reference ${relativePath}`).toBe(true);
      expect(existsSync(join(activeProjectLibraryRoot, relativePath)), `active project ${relativePath}`).toBe(true);
    }

    expect(existsSync(join(paths.editorProgrammingRef, 'programming/packer-driver/targets/preview/import-map.json'))).toBe(true);
    expect(existsSync(join(activeProjectProgrammingRoot, 'packer-driver/targets/preview/import-map.json'))).toBe(true);
  });

  it('diagnoses real CLI AssetDB output instead of treating missing output as success', async () => {
    const paths = getFixturePaths();
    const cliDefaultLibraryRoot = join(paths.projectRoot, 'library', 'cli');
    const cliDefaultProgrammingRoot = join(paths.projectRoot, 'temp', 'cli', 'programming');
    const engineInternalLibraryRoot = join(paths.engineRoot, 'editor', 'library');
    const diagnostics = inspectCliOutput(paths.editorLibraryRef, cliDefaultLibraryRoot, cliDefaultProgrammingRoot, engineInternalLibraryRoot);

    expect(diagnostics.category, 'real CLI output diagnostic category').toBe('source-backed-split-library-layout');
    expect(diagnostics.libraryRootExists, 'real CLI library output must exist before consistency can be claimed').toBe(true);
    expect(diagnostics.programmingRootExists, 'real CLI programming output must exist before consistency can be claimed').toBe(true);
    expect(diagnostics.hasPreviewImportMap, 'real CLI programming output should expose preview import-map').toBe(true);
    expect(diagnostics.engineInternalRootExists, 'engine internal library root should exist').toBe(true);

    expect(diagnostics.missingCliProjectAssetMetadataFiles).toEqual([]);
    expect(diagnostics.missingEngineInternalMetadataFiles).toEqual([]);
    expect(diagnostics.missingProjectAssetFiles).toEqual([]);
    expect(diagnostics.missingInternalFilesInEngineLibrary).toEqual([]);
    expect(diagnostics.editorVersionedInfoFiles).toEqual([
      '.assets-info1.0.0.json',
      '.internal-info1.0.0.json',
    ]);
    expect(diagnostics.cliUnversionedInfoFiles).toEqual([
      '.assets-info.json',
      '.internal-info.json',
    ]);

    const referenceAssetsData = await readJson<Record<string, AssetDataEntry>>(join(paths.editorLibraryRef, '.assets-data.json'));
    const cliAssetsData = await readJson<Record<string, AssetDataEntry>>(join(cliDefaultLibraryRoot, '.assets-data.json'));
    expect(pickLoadRelevantDataEntries(cliAssetsData, representativeProjectAssetUuids)).toEqual(
      pickLoadRelevantDataEntries(referenceAssetsData, representativeProjectAssetUuids),
    );
    expect(collectVersionCodeDiffs(cliAssetsData, referenceAssetsData, representativeProjectAssetUuids)).toEqual([]);

    const referenceInternalData = await readJson<Record<string, AssetDataEntry>>(join(paths.editorLibraryRef, '.internal-data.json'));
    const engineInternalData = await readJson<Record<string, AssetDataEntry>>(join(engineInternalLibraryRoot, '.internal-data.json'));
    expect(pickLoadRelevantDataEntries(engineInternalData, representativeInternalUuids)).toEqual(
      pickLoadRelevantDataEntries(referenceInternalData, representativeInternalUuids),
    );
    expect(collectVersionCodeDiffs(engineInternalData, referenceInternalData, representativeInternalUuids)).toEqual(
      [{
        uuid: '1263d74c-8167-4928-91a6-4e2672411f47',
        expected: 1,
        actual: 3,
      }],
    );
  });

  it('records small-project extension asset-db output facts without treating them as runtime trigger', async () => {
    const paths = getFixturePaths();
    const extensionPackageJson = await readJson<{
      name?: string;
      contributions?: {
        'asset-db'?: {
          mount?: {
            path?: string;
            readonly?: boolean;
          };
        };
      };
    }>(join(paths.projectRoot, 'extensions', 'ViewStateGroup', 'package.json'));

    expect(extensionPackageJson.name).toBe('view-state-group');
    expect(extensionPackageJson.contributions?.['asset-db']?.mount).toEqual({
      path: './assets',
      readonly: true,
    });

    const activeProjectExtensionData = await readJson<Record<string, AssetDataEntry>>(
      join(paths.projectRoot, 'library', '.view-state-group-data.json'),
    );
    const referenceExtensionData = await readJson<Record<string, AssetDataEntry>>(
      join(paths.editorLibraryRef, '.view-state-group-data.json'),
    );
    const cliExtensionLibraryRoot = join(paths.projectRoot, 'library', 'cli-extensions', 'view-state-group');
    const cliExtensionData = await readJson<Record<string, AssetDataEntry>>(
      join(cliExtensionLibraryRoot, '.view-state-group-data.json'),
    );

    expect(existsSync(join(paths.editorLibraryRef, '.view-state-group-info1.0.0.json'))).toBe(true);
    expect(existsSync(join(cliExtensionLibraryRoot, '.view-state-group-info.json'))).toBe(true);
    expect(Object.keys(activeProjectExtensionData).sort()).toEqual(Object.keys(referenceExtensionData).sort());
    expect(Object.keys(cliExtensionData).sort()).toEqual(Object.keys(referenceExtensionData).sort());
    const representativeExtensionUuids = [
      '68d4c31e-4ce2-4f01-8df9-f4b3385cdf5b',
      'fa669b29-ffd6-45a3-a288-ad2d3c86320b',
    ];
    for (const uuid of representativeExtensionUuids) {
      expect(referenceExtensionData[uuid], `reference extension ${uuid}`).toBeDefined();
      expect(cliExtensionData[uuid], `cli extension ${uuid}`).toBeDefined();
    }
    expect(pickLoadRelevantDataEntries(cliExtensionData, representativeExtensionUuids)).toEqual(
      pickLoadRelevantDataEntries(referenceExtensionData, representativeExtensionUuids),
    );
  });
});
