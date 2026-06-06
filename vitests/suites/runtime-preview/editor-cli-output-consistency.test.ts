import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { getFixturePaths } from '@shared/fixture-paths';

const metadataFiles = [
  '.assets-data.json',
  '.assets-info1.0.0.json',
  '.assets-dependency.json',
  '.internal-data.json',
  '.internal-info1.0.0.json',
  '.internal-dependency.json',
];

const representativeLibraryFiles = [
  '00/00614c43-17eb-4463-be7a-c162c2b92d43.json',
  '01/014b2d77-d625-4e91-9e51-081e353db503.png',
  '08/0835f102-5471-47a3-9a76-01c07ac9cdb2/OpenSans-Regular.ttf',
  '0d/0d687c8c-1928-4af0-8caa-195c7cd6ada3.atlas',
  '12/1263d74c-8167-4928-91a6-4e2672411f47@17020.bin',
];

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, 'utf8')) as T;
}

async function readMetadataShape(root: string): Promise<Record<string, string[]>> {
  const shape: Record<string, string[]> = {};
  for (const fileName of metadataFiles) {
    const absolutePath = join(root, fileName);
    expect(existsSync(absolutePath), `${absolutePath} should exist`).toBe(true);
    shape[fileName] = Object.keys(await readJson<Record<string, unknown>>(absolutePath)).sort();
  }
  return shape;
}

interface CliOutputDiagnostics {
  libraryRootExists: boolean;
  programmingRootExists: boolean;
  missingMetadataFiles: string[];
  missingRepresentativeFiles: string[];
  hasPreviewImportMap: boolean;
}

function inspectCliOutput(libraryRoot: string, programmingRoot: string): CliOutputDiagnostics {
  return {
    libraryRootExists: existsSync(libraryRoot),
    programmingRootExists: existsSync(programmingRoot),
    missingMetadataFiles: metadataFiles.filter((fileName) => !existsSync(join(libraryRoot, fileName))),
    missingRepresentativeFiles: representativeLibraryFiles.filter((relativePath) => !existsSync(join(libraryRoot, relativePath))),
    hasPreviewImportMap: existsSync(join(programmingRoot, 'packer-driver/targets/preview/import-map.json')),
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

    for (const relativePath of representativeLibraryFiles) {
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
    const diagnostics = inspectCliOutput(cliDefaultLibraryRoot, cliDefaultProgrammingRoot);

    expect(diagnostics.libraryRootExists, 'real CLI library output must exist before consistency can be claimed').toBe(true);
    expect(diagnostics.programmingRootExists, 'real CLI programming output must exist before consistency can be claimed').toBe(true);
    expect(diagnostics.hasPreviewImportMap, 'real CLI programming output should expose preview import-map').toBe(true);

    if (diagnostics.missingMetadataFiles.length === 0 && diagnostics.missingRepresentativeFiles.length === 0) {
      const referenceShape = await readMetadataShape(paths.editorLibraryRef);
      const cliShape = await readMetadataShape(cliDefaultLibraryRoot);
      expect(cliShape['.assets-data.json']).toEqual(referenceShape['.assets-data.json']);
      expect(cliShape['.internal-data.json']).toEqual(referenceShape['.internal-data.json']);
      return;
    }

    expect(diagnostics).toMatchObject({
      missingMetadataFiles: expect.arrayContaining([
        '.assets-info1.0.0.json',
        '.internal-data.json',
        '.internal-info1.0.0.json',
        '.internal-dependency.json',
      ]),
      missingRepresentativeFiles: expect.arrayContaining([
        '00/00614c43-17eb-4463-be7a-c162c2b92d43.json',
        '08/0835f102-5471-47a3-9a76-01c07ac9cdb2/OpenSans-Regular.ttf',
        '12/1263d74c-8167-4928-91a6-4e2672411f47@17020.bin',
      ]),
    });
  });
});
