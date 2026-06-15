import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { collectSourceMetaSnapshot, findMeta } from '@shared/source-meta-parity';

const projectRoot = process.env.COCOS_CLI_SOURCE_META_PROJECT_ROOT;
const editorProjectRoot = process.env.COCOS_CLI_EDITOR_PROJECT_ROOT;

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function normalizeUserData(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeUserData(item));
  }

  if (value && typeof value === 'object') {
    const normalized: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      if (key !== 'userData') {
        normalized[key] = normalizeUserData(item);
      }
    }

    return normalized;
  }

  return value;
}

describe('build 3D source .meta editor alignment', () => {
  it('matches Editor 3.8.6 for 3D source meta except userData rewrites', async () => {
    expect(projectRoot, 'COCOS_CLI_SOURCE_META_PROJECT_ROOT is required').toBeTruthy();
    expect(editorProjectRoot, 'COCOS_CLI_EDITOR_PROJECT_ROOT is required').toBeTruthy();
    expect(existsSync(projectRoot!), `missing CLI project root ${projectRoot}`).toBe(true);
    expect(existsSync(editorProjectRoot!), `missing Editor project root ${editorProjectRoot}`).toBe(true);

    const suffixes = ['.gltf.meta', '.glb.meta', '.fbx.meta'];
    const editorSnapshot = await collectSourceMetaSnapshot(editorProjectRoot!, suffixes);
    const cliSnapshot = await collectSourceMetaSnapshot(projectRoot!, suffixes);

    expect(editorSnapshot.length).toBeGreaterThan(0);

    for (const editorMeta of editorSnapshot) {
      const cliMeta = findMeta(cliSnapshot, editorMeta.relativePath);
      expect(cliMeta, `missing CLI meta ${editorMeta.relativePath}`).toBeDefined();

      const normalizedCliJson = normalizeUserData(cloneJson(cliMeta!.json));
      const normalizedEditorJson = normalizeUserData(cloneJson(editorMeta.json));
      expect(normalizedCliJson, editorMeta.relativePath).toEqual(normalizedEditorJson);
    }
  });
});
