import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';

export interface SourceMetaSnapshot {
  relativePath: string;
  json: unknown;
}

async function collectMetaFiles(dir: string, suffix: string, output: string[]): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      await collectMetaFiles(fullPath, suffix, output);
    } else if (entry.isFile() && entry.name.endsWith(suffix)) {
      output.push(fullPath);
    }
  }
}

export async function collectSourceMetaSnapshot(root: string, suffix = '.anim.meta'): Promise<SourceMetaSnapshot[]> {
  const files: string[] = [];
  await collectMetaFiles(join(root, 'assets'), suffix, files);

  const snapshots = await Promise.all(files.map(async (file) => ({
    relativePath: relative(root, file).replace(/\\/g, '/'),
    json: JSON.parse(await readFile(file, 'utf8')),
  })));

  return snapshots.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

export function findMeta(snapshot: SourceMetaSnapshot[], relativePath: string): SourceMetaSnapshot | undefined {
  const normalized = relativePath.replace(/\\/g, '/');
  return snapshot.find((entry) => entry.relativePath === normalized);
}
