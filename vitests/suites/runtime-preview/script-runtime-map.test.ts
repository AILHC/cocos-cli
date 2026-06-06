import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { getFixturePaths } from '@shared/fixture-paths';
import { createRuntimePreviewContext } from '@runtime-preview/context/runtime-preview-context';
import {
  findDependScriptModuleLinks,
  loadPreviewProgrammingRecords,
  resolveProgrammingRequest,
} from '@runtime-preview/programming/resolve-programming-request';

describe('runtime preview script import map and dependScripts linkage', () => {
  it('exposes preview programming records, chunks, and dependScripts module links on demand', async () => {
    const paths = getFixturePaths();
    const context = createRuntimePreviewContext({
      projectRoot: paths.projectRoot,
      engineRoot: paths.engineRoot,
      projectLibraryRoot: paths.editorLibraryRef,
      projectProgrammingRoot: join(paths.editorProgrammingRef, 'programming'),
    });

    const records = await loadPreviewProgrammingRecords(context);
    expect(Object.keys(records.importMap.imports ?? {}).length).toBeGreaterThan(0);
    expect(Object.keys(records.mainRecord.modules ?? {}).length).toBeGreaterThan(0);
    expect(Object.keys(records.assemblyRecord.chunks ?? {}).length).toBeGreaterThan(0);

    const importMapFile = await resolveProgrammingRequest(
      context,
      '/scripting/x/packer-driver/targets/preview/import-map.json',
    );
    const mainRecordFile = await resolveProgrammingRequest(
      context,
      '/scripting/x/packer-driver/targets/preview/main-record.json',
    );
    const assemblyRecordFile = await resolveProgrammingRequest(
      context,
      '/scripting/x/packer-driver/targets/preview/assembly-record.json',
    );
    expect(importMapFile?.absolutePath).toBeTruthy();
    expect(mainRecordFile?.absolutePath).toBeTruthy();
    expect(assemblyRecordFile?.absolutePath).toBeTruthy();

    const chunkRequests = Object.values(records.importMap.imports ?? {})
      .filter((value): value is string => typeof value === 'string' && value.startsWith('./chunks/'))
      .slice(0, 20)
      .map((value) => `/scripting/x/packer-driver/targets/preview/${value.slice('./'.length)}`);
    expect(chunkRequests.length).toBeGreaterThan(0);

    let systemRegisterChunkPath: string | null = null;
    for (const chunkRequest of chunkRequests) {
      const chunk = await resolveProgrammingRequest(context, chunkRequest);
      expect(chunk?.absolutePath, chunkRequest).toBeTruthy();
      expect(existsSync(chunk!.absolutePath), chunkRequest).toBe(true);

      const chunkSource = await readFile(chunk!.absolutePath, 'utf8');
      if (chunkSource.includes('System.register')) {
        systemRegisterChunkPath = chunk!.absolutePath;
        break;
      }
    }
    expect(systemRegisterChunkPath).toBeTruthy();

    const assetsDataPath = `${paths.editorLibraryRef}/.assets-data.json`;
    const assetsData = JSON.parse(await readFile(assetsDataPath, 'utf8')) as Record<string, unknown>;
    const dependScriptLinks = await findDependScriptModuleLinks(context, assetsData, { limit: 5 });

    expect(dependScriptLinks.length).toBeGreaterThan(0);
    for (const link of dependScriptLinks) {
      expect(link.assetUrl).toMatch(/^db:\/\/assets\/.*\.(scene|prefab)$/);
      expect(link.scriptAssetUrl).toMatch(/^db:\/\/assets\/.*\.(ts|js)$/);
      expect(records.importMap.imports?.[link.moduleUrl]).toBe(link.chunkImport);
      expect(records.mainRecord.modules?.[link.moduleUrl]?.mTimestamp?.uuid).toBe(link.scriptUuid);
      expect(records.mainRecord.modules?.[link.moduleUrl]?.chunkId).toBe(link.chunkId);
      expect(records.assemblyRecord.entries?.[link.moduleUrl]).toBe(link.chunkId);
      expect(records.assemblyRecord.chunks?.[link.chunkId]).toBeTruthy();
      expect(link.chunkImport).toMatch(new RegExp(`/${link.chunkId}\\.js$`));
      expect(existsSync(link.chunkAbsolutePath), link.chunkRequestPath).toBe(true);
    }
  });
});
