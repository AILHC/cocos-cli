import { describe, expect, it } from 'vitest';
import { createRuntimeAssetPathCanonicalizer } from '@runtime-preview/path/runtime-asset-path-canonicalizer';

function normalizePath(input: string): string {
  return input.replace(/\\/g, '/');
}

function createShortPathCanonicalizer(options: {
  existingPaths?: string[];
  realpathMap?: Record<string, string>;
} = {}) {
  const existingPaths = new Set((options.existingPaths ?? [
    'D:/project',
    'D:/project/assets',
    'D:/project/assets/resources',
    'D:/project/assets/resources/cfg',
    'D:/project/assets/RESOUR~1',
    'D:/project/assets/RESOUR~1/cfg',
  ]).map(normalizePath));
  const realpathMap = new Map(Object.entries(options.realpathMap ?? {
    'D:/project/assets': 'D:/project/assets',
    'D:/project/assets/resources': 'D:/project/assets/resources',
    'D:/project/assets/resources/cfg': 'D:/project/assets/resources/cfg',
    'D:/project/assets/RESOUR~1': 'D:/project/assets/resources',
    'D:/project/assets/RESOUR~1/cfg': 'D:/project/assets/resources/cfg',
  }));

  return createRuntimeAssetPathCanonicalizer({
    projectRoot: 'D:/project',
    fs: {
      existsSync: (path) => existingPaths.has(normalizePath(path)),
      realpathSyncNative: (path) => realpathMap.get(normalizePath(path)) ?? path,
    },
  });
}

describe('runtime asset path canonicalizer', () => {
  it('canonicalizes Windows short file paths to db asset targets', () => {
    const canonicalizer = createShortPathCanonicalizer();

    expect(canonicalizer.fileEventPathToDbTarget('D:/project/assets/RESOUR~1/cfg/a.json'))
      .toBe('db://assets/resources/cfg/a.json');
  });

  it('canonicalizes a short filename when its parent directory is also a short alias', () => {
    const canonicalizer = createShortPathCanonicalizer({
      existingPaths: [
        'D:/project',
        'D:/project/assets',
        'D:/project/assets/resources',
        'D:/project/assets/resources/cfg',
        'D:/project/assets/RESOUR~1',
        'D:/project/assets/RESOUR~1/cfg',
        'D:/project/assets/RESOUR~1/cfg/ACCUM_~1.JSO',
      ],
      realpathMap: {
        'D:/project/assets': 'D:/project/assets',
        'D:/project/assets/resources': 'D:/project/assets/resources',
        'D:/project/assets/resources/cfg': 'D:/project/assets/resources/cfg',
        'D:/project/assets/RESOUR~1': 'D:/project/assets/resources',
        'D:/project/assets/RESOUR~1/cfg': 'D:/project/assets/resources/cfg',
        'D:/project/assets/RESOUR~1/cfg/ACCUM_~1.JSO': 'D:/project/assets/resources/cfg/accum_recharge_act.json',
      },
    });

    expect(canonicalizer.fileEventPathToDbTarget('D:/project/assets/RESOUR~1/cfg/ACCUM_~1.JSO'))
      .toBe('db://assets/resources/cfg/accum_recharge_act.json');
  });

  it('maps .meta events to the canonical source asset target', () => {
    const canonicalizer = createShortPathCanonicalizer();

    expect(canonicalizer.fileEventPathToDbTarget('D:/project/assets/RESOUR~1/cfg/a.json.meta'))
      .toBe('db://assets/resources/cfg/a.json');
  });

  it('maps short .meta filenames to the canonical source asset target', () => {
    const canonicalizer = createShortPathCanonicalizer({
      existingPaths: [
        'D:/project',
        'D:/project/assets',
        'D:/project/assets/resources',
        'D:/project/assets/resources/cfg',
        'D:/project/assets/RESOUR~1',
        'D:/project/assets/RESOUR~1/cfg',
        'D:/project/assets/RESOUR~1/cfg/ACCUM_~1.MET',
      ],
      realpathMap: {
        'D:/project/assets': 'D:/project/assets',
        'D:/project/assets/resources': 'D:/project/assets/resources',
        'D:/project/assets/resources/cfg': 'D:/project/assets/resources/cfg',
        'D:/project/assets/RESOUR~1': 'D:/project/assets/resources',
        'D:/project/assets/RESOUR~1/cfg': 'D:/project/assets/resources/cfg',
        'D:/project/assets/RESOUR~1/cfg/ACCUM_~1.MET': 'D:/project/assets/resources/cfg/accum_recharge_act.json.meta',
      },
    });

    expect(canonicalizer.fileEventPathToDbTarget('D:/project/assets/RESOUR~1/cfg/ACCUM_~1.MET'))
      .toBe('db://assets/resources/cfg/accum_recharge_act.json');
  });

  it('keeps ordinary .met files as source assets', () => {
    const canonicalizer = createShortPathCanonicalizer({
      existingPaths: [
        'D:/project',
        'D:/project/assets',
        'D:/project/assets/resources',
        'D:/project/assets/resources/cfg',
        'D:/project/assets/resources/cfg/sample.met',
        'D:/project/assets/RESOUR~1',
        'D:/project/assets/RESOUR~1/cfg',
      ],
      realpathMap: {
        'D:/project/assets': 'D:/project/assets',
        'D:/project/assets/resources': 'D:/project/assets/resources',
        'D:/project/assets/resources/cfg': 'D:/project/assets/resources/cfg',
        'D:/project/assets/resources/cfg/sample.met': 'D:/project/assets/resources/cfg/sample.met',
        'D:/project/assets/RESOUR~1': 'D:/project/assets/resources',
        'D:/project/assets/RESOUR~1/cfg': 'D:/project/assets/resources/cfg',
      },
    });

    expect(canonicalizer.fileEventPathToDbTarget('D:/project/assets/resources/cfg/sample.met'))
      .toBe('db://assets/resources/cfg/sample.met');
    expect(canonicalizer.refreshTargetToDbTarget('db://assets/resources/cfg/sample.met')).toMatchObject({
      ok: true,
      canonicalTarget: 'db://assets/resources/cfg/sample.met',
      changed: false,
    });
  });

  it('keeps ordinary filenames containing tilde with .met extension as source assets', () => {
    const canonicalizer = createShortPathCanonicalizer({
      existingPaths: [
        'D:/project',
        'D:/project/assets',
        'D:/project/assets/resources',
        'D:/project/assets/resources/cfg',
        'D:/project/assets/resources/cfg/foo~1.met',
        'D:/project/assets/resources/cfg/foo.META',
      ],
      realpathMap: {
        'D:/project/assets': 'D:/project/assets',
        'D:/project/assets/resources': 'D:/project/assets/resources',
        'D:/project/assets/resources/cfg': 'D:/project/assets/resources/cfg',
        'D:/project/assets/resources/cfg/foo~1.met': 'D:/project/assets/resources/cfg/foo~1.met',
        'D:/project/assets/resources/cfg/foo.META': 'D:/project/assets/resources/cfg/foo.META',
      },
    });

    expect(canonicalizer.fileEventPathToDbTarget('D:/project/assets/resources/cfg/foo~1.met'))
      .toBe('db://assets/resources/cfg/foo~1.met');
    expect(canonicalizer.refreshTargetToDbTarget('db://assets/resources/cfg/foo.META')).toMatchObject({
      ok: true,
      canonicalTarget: 'db://assets/resources/cfg/foo.META',
      changed: false,
    });
  });

  it('does not reuse stale exact short filename realpath when an alias is reused', () => {
    let currentLongMetaPath = 'D:/project/assets/resources/cfg/first.json.meta';
    const canonicalizer = createRuntimeAssetPathCanonicalizer({
      projectRoot: 'D:/project',
      fs: {
        existsSync: (path) => [
          'D:/project/assets',
          'D:/project/assets/resources',
          'D:/project/assets/resources/cfg',
          'D:/project/assets/RESOUR~1',
          'D:/project/assets/RESOUR~1/cfg',
          'D:/project/assets/RESOUR~1/cfg/ACCUM_~1.MET',
        ].includes(normalizePath(path)),
        realpathSyncNative: (path) => {
          const normalizedPath = normalizePath(path);
          if (normalizedPath === 'D:/project/assets/RESOUR~1/cfg/ACCUM_~1.MET') {
            return currentLongMetaPath;
          }
          return new Map([
            ['D:/project/assets', 'D:/project/assets'],
            ['D:/project/assets/resources', 'D:/project/assets/resources'],
            ['D:/project/assets/resources/cfg', 'D:/project/assets/resources/cfg'],
            ['D:/project/assets/RESOUR~1', 'D:/project/assets/resources'],
            ['D:/project/assets/RESOUR~1/cfg', 'D:/project/assets/resources/cfg'],
          ]).get(normalizedPath) ?? path;
        },
      },
    });

    expect(canonicalizer.fileEventPathToDbTarget('D:/project/assets/RESOUR~1/cfg/ACCUM_~1.MET'))
      .toBe('db://assets/resources/cfg/first.json');
    currentLongMetaPath = 'D:/project/assets/resources/cfg/second.json.meta';

    expect(canonicalizer.fileEventPathToDbTarget('D:/project/assets/RESOUR~1/cfg/ACCUM_~1.MET'))
      .toBe('db://assets/resources/cfg/second.json');
  });

  it('canonicalizes db asset targets before refresh', () => {
    const canonicalizer = createShortPathCanonicalizer();

    expect(canonicalizer.refreshTargetToDbTarget('db://assets/RESOUR~1/cfg/a.json')).toMatchObject({
      ok: true,
      originalTarget: 'db://assets/RESOUR~1/cfg/a.json',
      canonicalTarget: 'db://assets/resources/cfg/a.json',
      changed: true,
    });
  });

  it('maps db short .meta refresh targets to the canonical source asset target', () => {
    const canonicalizer = createShortPathCanonicalizer({
      existingPaths: [
        'D:/project',
        'D:/project/assets',
        'D:/project/assets/resources',
        'D:/project/assets/resources/cfg',
        'D:/project/assets/RESOUR~1',
        'D:/project/assets/RESOUR~1/cfg',
        'D:/project/assets/RESOUR~1/cfg/ACCUM_~1.MET',
      ],
      realpathMap: {
        'D:/project/assets': 'D:/project/assets',
        'D:/project/assets/resources': 'D:/project/assets/resources',
        'D:/project/assets/resources/cfg': 'D:/project/assets/resources/cfg',
        'D:/project/assets/RESOUR~1': 'D:/project/assets/resources',
        'D:/project/assets/RESOUR~1/cfg': 'D:/project/assets/resources/cfg',
        'D:/project/assets/RESOUR~1/cfg/ACCUM_~1.MET': 'D:/project/assets/resources/cfg/accum_recharge_act.json.meta',
      },
    });

    expect(canonicalizer.refreshTargetToDbTarget('db://assets/RESOUR~1/cfg/ACCUM_~1.MET')).toMatchObject({
      ok: true,
      canonicalTarget: 'db://assets/resources/cfg/accum_recharge_act.json',
      changed: true,
    });
  });

  it('maps absolute short .meta refresh targets to the canonical source asset target', () => {
    const canonicalizer = createShortPathCanonicalizer({
      existingPaths: [
        'D:/project',
        'D:/project/assets',
        'D:/project/assets/resources',
        'D:/project/assets/resources/cfg',
        'D:/project/assets/RESOUR~1',
        'D:/project/assets/RESOUR~1/cfg',
        'D:/project/assets/RESOUR~1/cfg/ACCUM_~1.MET',
      ],
      realpathMap: {
        'D:/project/assets': 'D:/project/assets',
        'D:/project/assets/resources': 'D:/project/assets/resources',
        'D:/project/assets/resources/cfg': 'D:/project/assets/resources/cfg',
        'D:/project/assets/RESOUR~1': 'D:/project/assets/resources',
        'D:/project/assets/RESOUR~1/cfg': 'D:/project/assets/resources/cfg',
        'D:/project/assets/RESOUR~1/cfg/ACCUM_~1.MET': 'D:/project/assets/resources/cfg/accum_recharge_act.json.meta',
      },
    });

    expect(canonicalizer.refreshTargetToDbTarget('D:/project/assets/RESOUR~1/cfg/ACCUM_~1.MET')).toMatchObject({
      ok: true,
      canonicalTarget: 'db://assets/resources/cfg/accum_recharge_act.json',
      changed: true,
    });
  });

  it('falls back to the canonical parent for missing db short filename refresh targets', () => {
    const canonicalizer = createShortPathCanonicalizer();

    expect(canonicalizer.refreshTargetToDbTarget('db://assets/RESOUR~1/cfg/ACCUM_~1.MET')).toMatchObject({
      ok: true,
      canonicalTarget: 'db://assets/resources/cfg',
      changed: true,
    });
  });

  it('falls back to the canonical parent for missing absolute short filename refresh targets', () => {
    const canonicalizer = createShortPathCanonicalizer();

    expect(canonicalizer.refreshTargetToDbTarget('D:/project/assets/RESOUR~1/cfg/ACCUM_~1.JSO')).toMatchObject({
      ok: true,
      canonicalTarget: 'db://assets/resources/cfg',
      changed: true,
    });
  });

  it('maps missing short directory .meta refresh targets to the canonical source directory', () => {
    const canonicalizer = createShortPathCanonicalizer();

    expect(canonicalizer.refreshTargetToDbTarget('db://assets/RESOUR~1.MET')).toMatchObject({
      ok: true,
      canonicalTarget: 'db://assets/resources',
      changed: true,
    });
    expect(canonicalizer.refreshTargetToDbTarget('D:/project/assets/RESOUR~1.MET')).toMatchObject({
      ok: true,
      canonicalTarget: 'db://assets/resources',
      changed: true,
    });
  });

  it('uses the nearest existing ancestor for missing deleted files', () => {
    const canonicalizer = createShortPathCanonicalizer();

    expect(canonicalizer.fileEventPathToDbTarget('D:/project/assets/RESOUR~1/cfg/missing.json'))
      .toBe('db://assets/resources/cfg/missing.json');
  });

  it('falls back to the canonical parent when a missing leaf still looks like a short alias', () => {
    const canonicalizer = createShortPathCanonicalizer();

    expect(canonicalizer.fileEventPathToDbTarget('D:/project/assets/RESOUR~1/cfg/ACCUM_~1.JSO'))
      .toBe('db://assets/resources/cfg');
  });

  it('uses cached alias directories after the alias directory is deleted', () => {
    const existingPaths = new Set([
      'D:/project',
      'D:/project/assets',
      'D:/project/assets/RESOUR~1',
      'D:/project/assets/RESOUR~1/cfg',
    ]);
    const canonicalizer = createShortPathCanonicalizer({
      existingPaths: Array.from(existingPaths),
    });

    expect(canonicalizer.fileEventPathToDbTarget('D:/project/assets/RESOUR~1/cfg/a.json'))
      .toBe('db://assets/resources/cfg/a.json');

    existingPaths.delete('D:/project/assets/RESOUR~1/cfg');
    existingPaths.delete('D:/project/assets/RESOUR~1');

    expect(canonicalizer.fileEventPathToDbTarget('D:/project/assets/RESOUR~1/cfg/deleted.json'))
      .toBe('db://assets/resources/cfg/deleted.json');
  });

  it('does not permanently cache a missing short directory alias after it is created', () => {
    const existingPaths = new Set([
      'D:/project',
      'D:/project/assets',
    ]);
    const canonicalizer = createRuntimeAssetPathCanonicalizer({
      projectRoot: 'D:/project',
      fs: {
        existsSync: (path) => existingPaths.has(normalizePath(path)),
        realpathSyncNative: (path) => new Map([
          ['D:/project/assets', 'D:/project/assets'],
          ['D:/project/assets/NEWDIR~1', 'D:/project/assets/new-directory'],
        ]).get(normalizePath(path)) ?? path,
      },
    });

    expect(canonicalizer.fileEventPathToDbTarget('D:/project/assets/NEWDIR~1/a.json'))
      .toBe('db://assets/NEWDIR~1/a.json');

    existingPaths.add('D:/project/assets/NEWDIR~1');

    expect(canonicalizer.fileEventPathToDbTarget('D:/project/assets/NEWDIR~1/a.json'))
      .toBe('db://assets/new-directory/a.json');
  });

  it('refreshes an existing short directory cache when the alias is reused', () => {
    let currentLongDirectory = 'D:/project/assets/first-directory';
    const canonicalizer = createRuntimeAssetPathCanonicalizer({
      projectRoot: 'D:/project',
      fs: {
        existsSync: (path) => [
          'D:/project/assets',
          'D:/project/assets/NEWDIR~1',
        ].includes(normalizePath(path)),
        realpathSyncNative: (path) => new Map([
          ['D:/project/assets', 'D:/project/assets'],
          ['D:/project/assets/NEWDIR~1', currentLongDirectory],
        ]).get(normalizePath(path)) ?? path,
      },
    });

    expect(canonicalizer.fileEventPathToDbTarget('D:/project/assets/NEWDIR~1/a.json'))
      .toBe('db://assets/first-directory/a.json');
    currentLongDirectory = 'D:/project/assets/second-directory';

    expect(canonicalizer.fileEventPathToDbTarget('D:/project/assets/NEWDIR~1/a.json'))
      .toBe('db://assets/second-directory/a.json');
  });

  it('refreshes an existing junction directory cache when the target changes', () => {
    let currentLinkTarget = 'D:/project/assets/first-link';
    const canonicalizer = createRuntimeAssetPathCanonicalizer({
      projectRoot: 'D:/project',
      fs: {
        existsSync: (path) => [
          'D:/project/assets',
          'D:/project/assets/link',
        ].includes(normalizePath(path)),
        realpathSyncNative: (path) => new Map([
          ['D:/project/assets', 'D:/project/assets'],
          ['D:/project/assets/link', currentLinkTarget],
        ]).get(normalizePath(path)) ?? path,
      },
    });

    expect(canonicalizer.fileEventPathToDbTarget('D:/project/assets/link/a.json'))
      .toBe('db://assets/first-link/a.json');
    currentLinkTarget = 'D:/project/assets/second-link';

    expect(canonicalizer.fileEventPathToDbTarget('D:/project/assets/link/a.json'))
      .toBe('db://assets/second-link/a.json');
  });

  it('returns null for paths outside the canonical assets root', () => {
    const canonicalizer = createShortPathCanonicalizer({
      existingPaths: [
        'D:/project',
        'D:/project/assets',
        'D:/project/assets/link',
      ],
      realpathMap: {
        'D:/project/assets': 'D:/project/assets',
        'D:/project/assets/link': 'D:/outside/shared',
      },
    });

    expect(canonicalizer.fileEventPathToDbTarget('D:/project/assets/link/a.json')).toBeNull();
  });

  it('fails soft when test project roots do not exist', () => {
    const canonicalizer = createRuntimeAssetPathCanonicalizer({
      projectRoot: 'D:/project',
      fs: {
        existsSync: () => false,
        realpathSyncNative: (path) => path,
      },
    });

    expect(canonicalizer.fileEventPathToDbTarget('D:/project/assets/resources/a.json'))
      .toBe('db://assets/resources/a.json');
  });

  it('preserves dot segment rejection for db refresh targets', () => {
    const canonicalizer = createShortPathCanonicalizer();

    for (const target of ['db://assets/../x', 'db://assets/foo/../../x']) {
      expect(canonicalizer.refreshTargetToDbTarget(target)).toMatchObject({
        ok: false,
        originalTarget: target,
        reason: 'dot-segment',
      });
    }
  });
});
