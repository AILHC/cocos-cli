import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import {
  collectTopLevelPartitionCounts,
  extractGameJsLocalReferences,
  normalizeJson,
  resolveWechatgameLocalReference,
  sha256File,
} from '@shared/wechatgame-baseline-parity';

const tempRoots: string[] = [];

async function createTempRoot() {
  const root = await mkdtemp(join(tmpdir(), 'wechatgame-parity-'));
  tempRoots.push(root);
  return root;
}

describe('wechatgame baseline parity helpers', () => {
  afterEach(async () => {
    const { rm } = await import('node:fs/promises');
    await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  it('collects root and top-level directory file counts', async () => {
    const root = await createTempRoot();
    await writeFile(join(root, 'game.js'), '');
    await mkdir(join(root, 'src'), { recursive: true });
    await writeFile(join(root, 'src', 'settings.abcde.json'), '{}');
    await mkdir(join(root, 'subpackages', 'pkg-a'), { recursive: true });
    await writeFile(join(root, 'subpackages', 'pkg-a', 'game.js'), '');

    await expect(collectTopLevelPartitionCounts(root)).resolves.toEqual({
      root: 1,
      src: 1,
      subpackages: 1,
    });
  });

  it('extracts local startup references from game.js', () => {
    const code = `
      require('./web-adapter');
      require("src/polyfills.bundle.12345.js");
      const importMap = require("src/import-map.abcde.js").default;
      System.warmup({ importMapUrl: 'src/import-map.abcde.js' });
      System.import('./application.22222.js');
      requirePlugin('plugin-cocos');
    `;

    expect(extractGameJsLocalReferences(code)).toEqual([
      './web-adapter',
      'src/polyfills.bundle.12345.js',
      'src/import-map.abcde.js',
      './application.22222.js',
    ]);
  });

  it('resolves relative and root-based local references inside output root', async () => {
    const root = await createTempRoot();
    await writeFile(join(root, 'web-adapter.js'), '');
    await mkdir(join(root, 'src'), { recursive: true });
    await writeFile(join(root, 'src', 'import-map.abcde.js'), '');

    const gameJs = join(root, 'game.js');
    await writeFile(gameJs, '');

    expect(resolveWechatgameLocalReference(root, gameJs, './web-adapter')).toBe(join(root, 'web-adapter.js'));
    expect(resolveWechatgameLocalReference(root, gameJs, 'src/import-map.abcde.js')).toBe(join(root, 'src', 'import-map.abcde.js'));
    expect(resolveWechatgameLocalReference(root, gameJs, '../outside.js')).toBe('');
  });

  it('normalizes JSON objects by sorting object keys recursively', () => {
    expect(normalizeJson({ b: 1, a: { d: 4, c: 3 }, z: [{ b: 2, a: 1 }] })).toEqual({
      a: { c: 3, d: 4 },
      b: 1,
      z: [{ a: 1, b: 2 }],
    });
  });

  it('computes SHA256 for static file comparison', async () => {
    const root = await createTempRoot();
    const file = join(root, 'adapter.js');
    await writeFile(file, 'adapter-content');

    expect(existsSync(file)).toBe(true);
    await expect(sha256File(file)).resolves.toBe('961C3DC2FF6628168660EB67AEA807B652F280997F1267DAFBA764B2A87367DE');
  });
});
