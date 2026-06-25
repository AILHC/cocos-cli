import { describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { shouldUseTentativePrerequisiteImportsMod } from '../../../src/core/scripting/packer-driver/target-policy';
import { loadRuntimePreviewPrerequisiteImports } from '../../../src/runtime-preview/preview-app/src/prerequisite-imports';
import { readRuntimePreviewPrerequisiteEvidence } from '@shared/runtime-preview-prerequisite-evidence';

describe('runtime preview prerequisite imports policy', () => {
  it('uses static prerequisite imports for preview target to match Editor browser preview output', () => {
    expect(shouldUseTentativePrerequisiteImportsMod('preview', { isEditor: false })).toBe(false);
  });

  it('keeps editor target tentative behavior', () => {
    expect(shouldUseTentativePrerequisiteImportsMod('editor', { isEditor: true })).toBe(true);
  });

  it('installs the script load limiter before importing the generated prerequisite module', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const calls: string[] = [];
    const system = {
      instantiate: async () => undefined,
      import: async (id: string) => {
        calls.push(`import:${id}`);
        return undefined;
      },
    };

    try {
      await loadRuntimePreviewPrerequisiteImports({
        system: system as any,
        installLimiter: () => {
          calls.push('install-limiter');
          return {
            hook: 'instantiate',
            concurrency: 32,
            metrics: {
              active: 0,
              maxActive: 0,
              queuePeak: 0,
              enqueued: 0,
              completed: 0,
              failed: 0,
              retryCount: 0,
              bypassed: 0,
            },
          };
        },
        validateImportMap: async () => {
          calls.push('validate-import-map');
        },
        now: () => 1,
      });
    } finally {
      info.mockRestore();
    }

    expect(calls).toEqual([
      'install-limiter',
      'import:cce:/internal/x/prerequisite-imports',
      'validate-import-map',
    ]);
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
