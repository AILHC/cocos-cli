import { readdir } from 'fs/promises';
import { basename, extname, join, relative } from 'path';
import type { RuntimePreviewLibraryManifest } from './types';

async function walkFiles(root: string, dir = root): Promise<string[]> {
    const entries = await readdir(dir, { withFileTypes: true });
    const files: string[] = [];

    for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
            files.push(...await walkFiles(root, fullPath));
        } else if (entry.isFile()) {
            files.push(fullPath);
        }
    }

    return files;
}

function toManifestPath(root: string, file: string): string {
    return relative(root, file).replace(/\\/g, '/');
}

function isMetadataFile(file: string): boolean {
    return basename(file).startsWith('.');
}

function inferLibraryLayout(files: string[]): RuntimePreviewLibraryManifest['layout'] {
    return files.some((file) => /^[0-9a-f]{2}\//i.test(file)) ? 'uuid-hash-bucket' : 'unknown';
}

export async function buildRuntimePreviewLibraryManifest(root: string): Promise<RuntimePreviewLibraryManifest> {
    const files = (await walkFiles(root)).map((file) => toManifestPath(root, file)).sort();
    const metadataFiles = files.filter(isMetadataFile);
    const contentFiles = files.filter((file) => !isMetadataFile(file));

    return {
        root,
        layout: inferLibraryLayout(contentFiles),
        metadataFiles,
        serializedJsonFiles: contentFiles.filter((file) => extname(file).toLowerCase() === '.json'),
        nativeLikeFiles: contentFiles.filter((file) => extname(file).toLowerCase() !== '.json'),
    };
}
