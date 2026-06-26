import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it, vi } from 'vitest';
import { createRuntimePreviewContext } from '@runtime-preview/context/runtime-preview-context';
import { createImportReplacementExtensionResolver } from '@runtime-preview/server/import-replacement-extension-cache';

describe('runtime preview import replacement extension cache', () => {
  it('returns .cconb before .ccon and caches the result per uuid', async () => {
    const root = await mkdtemp(join(tmpdir(), 'runtime-preview-ext-cache-'));
    const uuid = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
    const bucket = join(root, uuid.slice(0, 2));
    await mkdir(bucket, { recursive: true });
    await writeFile(join(bucket, `${uuid}.cconb`), 'binary');
    await writeFile(join(bucket, `${uuid}.ccon`), 'json');

    const context = createRuntimePreviewContext({
      projectRoot: root,
      engineRoot: root,
      projectLibraryRoot: root,
      internalLibraryRoot: join(root, 'internal'),
      projectProgrammingRoot: join(root, 'programming'),
    });
    const resolver = createImportReplacementExtensionResolver(context);

    await expect(resolver.query(uuid)).resolves.toBe('.cconb');
    await rm(join(bucket, `${uuid}.cconb`));
    await expect(resolver.query(uuid)).resolves.toBe('.cconb');
  });

  it('checks project, extension, then internal library roots', async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'runtime-preview-ext-cache-order-'));
    const uuid = 'bbbbbbbb-bbbb-4ccc-8ddd-eeeeeeeeeeee';
    const projectRoot = join(tempRoot, 'project-library');
    const extensionRoot = join(tempRoot, 'cli-extensions', 'view-state-group');
    const internalRoot = join(tempRoot, 'internal');
    await mkdir(join(projectRoot, uuid.slice(0, 2)), { recursive: true });
    await mkdir(join(extensionRoot, uuid.slice(0, 2)), { recursive: true });
    await mkdir(join(internalRoot, uuid.slice(0, 2)), { recursive: true });
    await writeFile(join(projectRoot, uuid.slice(0, 2), `${uuid}.ccon`), 'project');
    await writeFile(join(extensionRoot, uuid.slice(0, 2), `${uuid}.ccon`), 'extension');
    await writeFile(join(internalRoot, uuid.slice(0, 2), `${uuid}.cconb`), 'internal');

    const context = createRuntimePreviewContext({
      projectRoot: tempRoot,
      engineRoot: tempRoot,
      projectLibraryRoot: projectRoot,
      extensionLibraryRoots: [{ name: 'view-state-group', root: extensionRoot }],
      internalLibraryRoot: internalRoot,
      projectProgrammingRoot: join(tempRoot, 'programming'),
    });
    const resolver = createImportReplacementExtensionResolver(context);

    await expect(resolver.query(uuid)).resolves.toBe('.ccon');
  });

  it('does not cache missing payloads', async () => {
    const root = await mkdtemp(join(tmpdir(), 'runtime-preview-ext-cache-miss-'));
    const uuid = 'cccccccc-cccc-4ccc-8ddd-eeeeeeeeeeee';
    const context = createRuntimePreviewContext({
      projectRoot: root,
      engineRoot: root,
      projectLibraryRoot: root,
      internalLibraryRoot: join(root, 'internal'),
      projectProgrammingRoot: join(root, 'programming'),
    });
    const resolver = createImportReplacementExtensionResolver(context);

    await expect(resolver.query('../bad')).resolves.toBe('');
    await expect(resolver.query(uuid)).resolves.toBe('');
    await mkdir(join(root, uuid.slice(0, 2)), { recursive: true });
    await writeFile(join(root, uuid.slice(0, 2), `${uuid}.ccon`), 'created after miss');
    await expect(resolver.query(uuid)).resolves.toBe('.ccon');
  });

  it('coalesces concurrent lookups for the same uuid', async () => {
    const root = await mkdtemp(join(tmpdir(), 'runtime-preview-ext-cache-concurrent-'));
    const uuid = 'dddddddd-dddd-4ccc-8ddd-eeeeeeeeeeee';
    const context = createRuntimePreviewContext({
      projectRoot: root,
      engineRoot: root,
      projectLibraryRoot: root,
      internalLibraryRoot: join(root, 'internal'),
      projectProgrammingRoot: join(root, 'programming'),
    });
    let releaseLookup!: () => void;
    const lookupStarted = new Promise<void>((resolve) => {
      releaseLookup = resolve;
    });
    const statFile = vi.fn(async () => {
      await lookupStarted;
      return { isFile: () => true };
    });
    const resolver = createImportReplacementExtensionResolver(context, { statFile });

    const firstQuery = resolver.query(uuid);
    const secondQuery = resolver.query(uuid);
    await Promise.resolve();

    expect(statFile).toHaveBeenCalledTimes(1);
    releaseLookup();
    await expect(Promise.all([firstQuery, secondQuery])).resolves.toEqual(['.cconb', '.cconb']);
    expect(statFile).toHaveBeenCalledTimes(1);
  });

  it('does not repopulate a stale positive result when clear happens during an in-flight lookup', async () => {
    const root = await mkdtemp(join(tmpdir(), 'runtime-preview-ext-cache-clear-race-'));
    const uuid = 'eeeeeeee-eeee-4ccc-8ddd-eeeeeeeeeeee';
    const context = createRuntimePreviewContext({
      projectRoot: root,
      engineRoot: root,
      projectLibraryRoot: root,
      internalLibraryRoot: join(root, 'internal'),
      projectProgrammingRoot: join(root, 'programming'),
    });
    let releaseFirstLookup!: () => void;
    let fileExists = true;
    const firstLookupStarted = new Promise<void>((resolve) => {
      releaseFirstLookup = resolve;
    });
    const statFile = vi.fn(async (filePath: string) => {
      if (!filePath.endsWith(`${uuid}.cconb`)) {
        throw new Error('ENOENT');
      }
      if (statFile.mock.calls.length === 1) {
        await firstLookupStarted;
        return { isFile: () => true };
      }
      if (!fileExists) {
        throw new Error('ENOENT');
      }
      return { isFile: () => true };
    });
    const resolver = createImportReplacementExtensionResolver(context, { statFile });

    const staleQuery = resolver.query(uuid);
    await Promise.resolve();
    expect(statFile).toHaveBeenCalledTimes(1);

    resolver.clear();
    fileExists = false;
    releaseFirstLookup();
    await expect(staleQuery).resolves.toBe('.cconb');

    await expect(resolver.query(uuid)).resolves.toBe('');
    expect(statFile.mock.calls.length).toBeGreaterThan(1);
  });
});
