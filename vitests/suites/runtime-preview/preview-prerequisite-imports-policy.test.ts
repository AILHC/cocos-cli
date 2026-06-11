import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { shouldUseTentativePrerequisiteImportsMod } from '../../../src/core/scripting/packer-driver/target-policy';

describe('runtime preview prerequisite imports policy', () => {
  it('uses tentative dynamic imports for preview target to avoid loading all chunks at once', () => {
    expect(shouldUseTentativePrerequisiteImportsMod('preview', { isEditor: false })).toBe(true);
  });

  it('keeps editor target tentative behavior', () => {
    expect(shouldUseTentativePrerequisiteImportsMod('editor', { isEditor: true })).toBe(true);
  });

  it('awaits the generated prerequisite import module before runtime scene loading', async () => {
    const previewMain = await readFile(join(process.cwd(), '..', 'src', 'runtime-preview', 'preview-app', 'src', 'main.ts'), 'utf8');

    expect(previewMain).toContain("System.import('cce:/internal/x/prerequisite-imports')");
    expect(previewMain).toContain('validateRuntimePreviewPrerequisiteImportMap');
    expect(previewMain).toContain('Runtime preview prerequisite scope is missing');
    expect(previewMain).not.toContain('prerequisite chunk import failed');
    const gameInitIndex = previewMain.indexOf('await cc.game.init(option)');
    const prerequisiteIndex = previewMain.indexOf('await loadRuntimePreviewPrerequisiteImports()');
    const readyResourcesIndex = previewMain.indexOf('const readyResources = await loadRuntimePreviewReadyResources(cc)');
    const loadSceneIndex = previewMain.indexOf('cc.assetManager.loadWithJson');

    expect(gameInitIndex).toBeGreaterThanOrEqual(0);
    expect(prerequisiteIndex).toBeGreaterThan(gameInitIndex);
    expect(prerequisiteIndex).toBeLessThan(readyResourcesIndex);
    expect(prerequisiteIndex).toBeLessThan(loadSceneIndex);
  });
});
