// @vitest-environment node
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  assertPreviewOutputIntegritySeal,
  assertScriptChunkRegistersUuid,
  getPreviewOutputIntegritySealPath,
  hasValidPreviewOutputIntegritySeal,
  preparePreviewCacheForLoad,
  removePreviewOutputIntegritySeal,
  writePreviewOutputIntegritySeal,
} from '../../../src/core/scripting/packer-driver/script-registration-integrity';

const workspaces: string[] = [];

async function createWorkspace(prefix: string): Promise<string> {
  const workspace = await mkdtemp(join(tmpdir(), prefix));
  workspaces.push(workspace);
  return workspace;
}

async function createOutputShape(workspace: string): Promise<void> {
  await mkdir(join(workspace, 'chunks'), { recursive: true });
  await Promise.all([
    writeFile(join(workspace, 'main-record.json'), '{}', 'utf8'),
    writeFile(join(workspace, 'assembly-record.json'), '{}', 'utf8'),
    writeFile(join(workspace, 'import-map.json'), '{}', 'utf8'),
    writeFile(join(workspace, 'resolution-detail-map.json'), '{}', 'utf8'),
  ]);
}

describe('runtime preview script registration integrity', () => {
  afterEach(async () => {
    await Promise.all(workspaces.splice(0).map((workspace) => rm(workspace, { recursive: true, force: true })));
  });

  it('accepts the generated RF push and pop for the expected UUID', () => {
    expect(() => assertScriptChunkRegistersUuid(
      'file:///assets/Foo.ts',
      'System.register([],function(){_cclegacy._RF.push({}, "compressed/id+", "Foo", undefined);_cclegacy._RF.pop();});',
      'compressed/id+',
    )).not.toThrow();
  });

  it('rejects missing or mismatched registration metadata', () => {
    expect(() => assertScriptChunkRegistersUuid(
      'file:///assets/Foo.ts',
      'System.register([], function () {})',
      'expected',
    )).toThrow(/does not register UUID expected/);
    expect(() => assertScriptChunkRegistersUuid(
      'file:///assets/Foo.ts',
      '_cclegacy._RF.push({}, "other", "Foo", undefined);_cclegacy._RF.pop();',
      'expected',
    )).toThrow(/does not register UUID expected/);
  });

  it('trusts only a complete output shape with a valid seal', async () => {
    const workspace = await createWorkspace('preview-integrity-trusted-');
    await createOutputShape(workspace);
    writePreviewOutputIntegritySeal(workspace);

    expect(preparePreviewCacheForLoad(workspace)).toBe('trusted');
    expect(hasValidPreviewOutputIntegritySeal(workspace)).toBe(true);
    expect(() => assertPreviewOutputIntegritySeal(workspace)).not.toThrow();
  });

  it('invalidates legacy or interrupted output without reading chunk contents', async () => {
    const workspace = await createWorkspace('preview-integrity-invalid-');
    await createOutputShape(workspace);
    await writeFile(join(workspace, 'chunks', 'stale.js'), 'bad chunk', 'utf8');

    expect(preparePreviewCacheForLoad(workspace)).toBe('invalidated');
    await expect(readFile(join(workspace, 'chunks', 'stale.js'), 'utf8')).rejects.toThrow();
    expect(hasValidPreviewOutputIntegritySeal(workspace)).toBe(false);
  });

  it('treats a removed seal as an uncommitted cache', async () => {
    const workspace = await createWorkspace('preview-integrity-uncommitted-');
    await createOutputShape(workspace);
    writePreviewOutputIntegritySeal(workspace);
    removePreviewOutputIntegritySeal(workspace);

    expect(() => assertPreviewOutputIntegritySeal(workspace)).toThrow(/uncommitted/);
    expect(preparePreviewCacheForLoad(workspace)).toBe('invalidated');
    await expect(readFile(getPreviewOutputIntegritySealPath(workspace), 'utf8')).rejects.toThrow();
  });
});
