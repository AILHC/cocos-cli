import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import { dirname, extname, isAbsolute, join, normalize, resolve } from 'node:path';

export async function sha256File(file: string): Promise<string> {
  const buffer = await readFile(file);
  return createHash('sha256').update(buffer).digest('hex').toUpperCase();
}

export async function collectTopLevelPartitionCounts(root: string): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  const entries = await readdir(root, { withFileTypes: true });

  for (const entry of entries) {
    const absolute = join(root, entry.name);
    if (entry.isFile()) {
      counts.root = (counts.root ?? 0) + 1;
      continue;
    }
    if (!entry.isDirectory()) {
      continue;
    }
    counts[entry.name] = await countFiles(absolute);
  }

  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
}

async function countFiles(root: string): Promise<number> {
  let count = 0;
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const absolute = join(root, entry.name);
    if (entry.isFile()) {
      count++;
    } else if (entry.isDirectory()) {
      count += await countFiles(absolute);
    }
  }
  return count;
}

export function extractGameJsLocalReferences(code: string): string[] {
  const refs: string[] = [];
  for (const match of code.matchAll(/\brequire\(\s*['"]([^'"]+)['"]\s*\)/g)) {
    addLocalReference(refs, match[1]);
  }
  for (const match of code.matchAll(/\bSystem\.import\(\s*['"]([^'"]+)['"]\s*\)/g)) {
    addLocalReference(refs, match[1]);
  }
  for (const match of code.matchAll(/\bimportMapUrl\s*:\s*['"]([^'"]+)['"]/g)) {
    addLocalReference(refs, match[1]);
  }
  return refs;
}

function addLocalReference(refs: string[], value: string) {
  if (!value || value.startsWith('plugin:') || value.startsWith('project:')) {
    return;
  }
  if (refs.includes(value)) {
    return;
  }
  if (value.startsWith('.') || value.startsWith('src/') || value.startsWith('assets/') || value.startsWith('remote/') || value.startsWith('cocos-js/')) {
    refs.push(value);
  }
}

export function resolveWechatgameLocalReference(root: string, fromFile: string, request: string): string {
  if (!request || isAbsolute(request)) {
    return '';
  }
  const normalizedRequest = request.replace(/\\/g, '/');
  if (normalizedRequest.split('/').includes('..')) {
    return '';
  }

  const base = normalizedRequest.startsWith('.') ? dirname(fromFile) : root;
  const candidates = [join(base, normalizedRequest)];
  if (!extname(normalizedRequest)) {
    candidates.push(join(base, `${normalizedRequest}.js`));
    candidates.push(join(base, `${normalizedRequest}.json`));
  }

  const normalizedRoot = normalize(root);
  for (const candidate of candidates) {
    const resolved = normalize(resolve(candidate));
    if (!resolved.startsWith(normalizedRoot) || !existsSync(resolved)) {
      continue;
    }
    return resolved;
  }
  return '';
}

export function normalizeJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeJson(item));
  }
  if (!value || typeof value !== 'object') {
    return value;
  }

  const normalized: Record<string, unknown> = {};
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    normalized[key] = normalizeJson((value as Record<string, unknown>)[key]);
  }
  return normalized;
}

export async function readJsonFile<T = unknown>(file: string): Promise<T> {
  return JSON.parse(await readFile(file, 'utf8')) as T;
}

export async function pathExistsAsDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}
