import { readdir, stat } from 'fs/promises';
import { join } from 'path';
import type { RuntimePreviewProgrammingManifest } from './types';

async function pathExists(file: string): Promise<boolean> {
    try {
        await stat(file);
        return true;
    } catch {
        return false;
    }
}

async function requireFile(file: string, label: string): Promise<string> {
    if (!await pathExists(file)) {
        throw new Error(`Missing runtime preview programming ${label}: ${file}`);
    }
    return file;
}

async function walkFiles(dir: string): Promise<string[]> {
    if (!await pathExists(dir)) {
        return [];
    }

    const entries = await readdir(dir, { withFileTypes: true });
    const files: string[] = [];
    for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
            files.push(...await walkFiles(fullPath));
        } else if (entry.isFile()) {
            files.push(fullPath);
        }
    }
    return files;
}

export async function buildRuntimePreviewProgrammingManifest(root: string): Promise<RuntimePreviewProgrammingManifest> {
    const programmingRoot = await pathExists(join(root, 'packer-driver'))
        ? root
        : join(root, 'programming');
    const previewTargetRoot = join(programmingRoot, 'packer-driver', 'targets', 'preview');
    const chunksRoot = join(previewTargetRoot, 'chunks');

    return {
        root: programmingRoot,
        previewTargetRoot,
        previewImportMap: await requireFile(join(previewTargetRoot, 'import-map.json'), 'import-map.json'),
        previewMainRecord: await requireFile(join(previewTargetRoot, 'main-record.json'), 'main-record.json'),
        previewAssemblyRecord: await requireFile(join(previewTargetRoot, 'assembly-record.json'), 'assembly-record.json'),
        previewChunks: (await walkFiles(chunksRoot)).sort(),
    };
}
