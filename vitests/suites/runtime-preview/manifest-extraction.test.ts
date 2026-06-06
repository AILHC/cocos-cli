import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { buildRuntimePreviewArtifactManifest } from '@runtime-preview/manifest/build-manifest';
import { getFixturePaths } from '@shared/fixture-paths';

describe('RuntimePreviewArtifactManifest extraction', () => {
  it('extracts editor library bucket files and programming preview target facts', async () => {
    const paths = getFixturePaths();
    const manifest = await buildRuntimePreviewArtifactManifest({
      projectRoot: paths.projectRoot,
      libraryRoot: paths.editorLibraryRef,
      programmingRoot: paths.editorProgrammingRef,
    });

    expect(manifest.library.layout).toBe('uuid-hash-bucket');
    expect(manifest.library.metadataFiles).toContain('.assets-data.json');
    expect(manifest.library.metadataFiles).toContain('.assets-info1.0.0.json');
    expect(manifest.library.serializedJsonFiles.length).toBeGreaterThanOrEqual(839);
    expect(manifest.library.nativeLikeFiles.some((file) => file.endsWith('.png'))).toBe(true);
    expect(manifest.library.nativeLikeFiles.some((file) => file.endsWith('.ttf'))).toBe(true);
    expect(manifest.programming.previewImportMap).toMatch(/import-map\.json$/);
    expect(existsSync(manifest.programming.previewImportMap)).toBe(true);
    expect(manifest.programming.previewMainRecord).toMatch(/main-record\.json$/);
    expect(existsSync(manifest.programming.previewMainRecord!)).toBe(true);
    expect(manifest.programming.previewAssemblyRecord).toMatch(/assembly-record\.json$/);
    expect(existsSync(manifest.programming.previewAssemblyRecord!)).toBe(true);
    expect(manifest.programming.previewChunks.length).toBeGreaterThan(0);
  });
});
