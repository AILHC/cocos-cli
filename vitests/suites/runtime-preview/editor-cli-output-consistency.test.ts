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

describe('frozen editor output and CLI AssetDB output consistency', () => {
  it('classifies current output roots and verifies representative editor output shape', async () => {
    const paths = getFixturePaths();
    const activeProjectLibraryRoot = join(paths.projectRoot, 'library');
    const cliDefaultLibraryRoot = join(paths.projectRoot, 'library', 'cli');
    const activeProjectProgrammingRoot = join(paths.projectRoot, 'temp', 'programming');
    const cliDefaultProgrammingRoot = join(paths.projectRoot, 'temp', 'cli', 'programming');

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

    const cliOutputStatus = existsSync(cliDefaultLibraryRoot) || existsSync(cliDefaultProgrammingRoot)
      ? 'cli-output-present'
      : 'cli-output-not-generated-yet';

    expect(cliOutputStatus).toBe('cli-output-not-generated-yet');
  });
});
