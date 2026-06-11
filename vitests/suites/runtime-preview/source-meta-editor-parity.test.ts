import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { collectSourceMetaSnapshot, findMeta } from '@shared/source-meta-parity';

const projectRoot = process.env.COCOS_CLI_SOURCE_META_PROJECT_ROOT;
const editorProjectRoot = process.env.COCOS_CLI_EDITOR_PROJECT_ROOT;

describe('source .meta editor parity', () => {
  it('matches Editor 3.8.6 for .anim source meta after CLI import', async () => {
    expect(projectRoot, 'COCOS_CLI_SOURCE_META_PROJECT_ROOT is required').toBeTruthy();
    expect(editorProjectRoot, 'COCOS_CLI_EDITOR_PROJECT_ROOT is required').toBeTruthy();
    expect(existsSync(projectRoot!), `missing CLI project root ${projectRoot}`).toBe(true);
    expect(existsSync(editorProjectRoot!), `missing Editor project root ${editorProjectRoot}`).toBe(true);

    const editorSnapshot = await collectSourceMetaSnapshot(editorProjectRoot!);
    const cliSnapshot = await collectSourceMetaSnapshot(projectRoot!);

    expect(editorSnapshot.length).toBeGreaterThan(0);

    for (const editorMeta of editorSnapshot) {
      const cliMeta = findMeta(cliSnapshot, editorMeta.relativePath);
      expect(cliMeta, `missing CLI meta ${editorMeta.relativePath}`).toBeDefined();
      expect(cliMeta!.json).toEqual(editorMeta.json);
    }
  });
});
