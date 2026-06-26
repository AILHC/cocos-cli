import { describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { shouldUseTentativePrerequisiteImportsMod } from '../../../src/core/scripting/packer-driver/target-policy';
import { main } from '../../../src/runtime-preview/preview-app/src/main';
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

  it('records cc.game.init as the phase that contains engine prerequisite loading', async () => {
    const originalWindow = (globalThis as any).window;
    const originalSystem = (globalThis as any).System;
    const originalFetch = (globalThis as any).fetch;
    const originalCustomEvent = (globalThis as any).CustomEvent;
    const dateNow = vi.spyOn(Date, 'now');
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    let now = 1000;
    dateNow.mockImplementation(() => now);

    const windowLike = {
      location: {
        href: 'http://127.0.0.1:19657/',
        search: '',
      },
      dispatchEvent: vi.fn(),
      __RUNTIME_PREVIEW_PHASE_TIMINGS__: undefined,
    };
    (globalThis as any).window = windowLike;
    (globalThis as any).CustomEvent = class {
      readonly type: string;
      readonly detail: unknown;

      constructor(type: string, init?: { detail?: unknown }) {
        this.type = type;
        this.detail = init?.detail;
      }
    };
    (globalThis as any).fetch = async (url: string) => ({
      ok: true,
      json: async () => ({
        imports: {
          'cce:/internal/x/prerequisite-imports': './chunks/prereq.js',
        },
        scopes: {
          './chunks/prereq.js': {},
        },
      }),
      text: async () => (String(url).endsWith('prereq.js') ? 'System.register([], function () {})' : ''),
    });

    let initOption: any;
    const system = {
      instantiate: async () => undefined,
      import: async (id: string) => {
        if (id === 'cc') {
          return {
            DebugMode: { INFO: 1 },
            game: {
              init: async (option: any) => {
                initOption = option;
                now += 50;
                await system.import('cce:/internal/x/prerequisite-imports');
                now += 20;
              },
              run: async (callback: () => Promise<void>) => {
                await callback();
              },
              pause: vi.fn(),
              resume: vi.fn(),
            },
            director: {
              once: vi.fn(),
            },
            Director: {
              EVENT_AFTER_SCENE_LAUNCH: 'after-scene-launch',
            },
            assetManager: {
              onAssetMissing: vi.fn(),
            },
            Node: class {},
            js: {
              getClassName: () => 'FakeClass',
            },
          };
        }
        return undefined;
      },
    };
    (globalThis as any).System = system;

    try {
      await main({
        debugMode: 'INFO',
        showFps: false,
        frameRate: 60,
        isFullscreen: () => false,
        hideSplash: vi.fn(),
        hintEmptyScene: vi.fn(),
        showLoading: vi.fn(),
        reportLoadProgress: vi.fn(),
        showError: vi.fn(),
      } as any, {
        engineBaseUrl: '/scripting/engine',
        devices: {},
        settings: {
          launch: {
            launchScene: '',
          },
        },
      });
    } finally {
      info.mockRestore();
      dateNow.mockRestore();
      (globalThis as any).window = originalWindow;
      (globalThis as any).System = originalSystem;
      (globalThis as any).fetch = originalFetch;
      (globalThis as any).CustomEvent = originalCustomEvent;
    }

    expect(windowLike.__RUNTIME_PREVIEW_PHASE_TIMINGS__).toContainEqual(expect.objectContaining({
      phase: 'gameInit',
      durationMs: 70,
    }));
    expect(windowLike.__RUNTIME_PREVIEW_PHASE_TIMINGS__).toContainEqual(expect.objectContaining({
      phase: 'gameRunCallbackDelay',
      durationMs: 0,
    }));
    expect(initOption.overrideSettings.splashScreen.totalTime).toBe(50);
  });
});
