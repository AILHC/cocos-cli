import { describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { shouldUseTentativePrerequisiteImportsMod } from '../../../src/core/scripting/packer-driver/target-policy';
import { readRuntimePreviewPrerequisiteEvidence } from '@shared/runtime-preview-prerequisite-evidence';

describe('runtime preview prerequisite imports policy', () => {
  it('uses static prerequisite imports for preview target to match Editor browser preview output', () => {
    expect(shouldUseTentativePrerequisiteImportsMod('preview', { isEditor: false })).toBe(false);
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

  it('classifies generated prerequisite chunk shape from import-map output', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cocos-prerequisite-evidence-'));
    await mkdir(join(root, 'chunks', '6d'), { recursive: true });
    await writeFile(join(root, 'import-map.json'), JSON.stringify({
      imports: {
        'cce:/internal/x/prerequisite-imports': './chunks/6d/prereq.js',
      },
      scopes: {
        './chunks/6d/prereq.js': {
          __unresolved_0: './chunks/a.js',
          __unresolved_1: './chunks/b.js',
        },
      },
    }), 'utf8');
    await writeFile(join(root, 'chunks', '6d', 'prereq.js'), `System.register(["__unresolved_0", "__unresolved_1"], function () {
  return { setters: [() => {}, () => {}], execute: function () {} };
});
`, 'utf8');

    const evidence = await readRuntimePreviewPrerequisiteEvidence(join(root, 'import-map.json'));

    expect(evidence.hasStaticSystemRegister).toBe(true);
    expect(evidence.hasSequentialDynamicImportLoop).toBe(false);
    expect(evidence.dependencyCount).toBe(2);
    expect(evidence.unresolvedMappingCount).toBe(2);
  });
});
