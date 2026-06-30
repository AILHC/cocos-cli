import { readFile } from 'fs/promises';
import { isAbsolute, relative, resolve } from 'path';

const prerequisiteImportsSpecifier = 'cce:/internal/x/prerequisite-imports';
const unresolvedSpecifierPattern = /["'](__unresolved_\d+)["']/g;

interface RuntimePreviewImportMap {
    imports?: Record<string, unknown>;
    scopes?: Record<string, unknown>;
}

function getPlainObject(value: unknown): Record<string, unknown> | undefined {
    if (typeof value !== 'object' || value === null || Object.prototype.toString.call(value) !== '[object Object]') {
        return undefined;
    }
    return value as Record<string, unknown>;
}

function getScope(importMap: RuntimePreviewImportMap, prerequisiteChunk: string): Record<string, unknown> | undefined {
    const scopes = getPlainObject(importMap.scopes);
    if (!scopes) {
        return undefined;
    }
    const normalizedChunk = prerequisiteChunk.replace(/\\/g, '/');
    return getPlainObject(scopes[normalizedChunk])
        ?? getPlainObject(scopes[`./${normalizedChunk}`])
        ?? getPlainObject(scopes[normalizedChunk.replace(/^\.\//, '')]);
}

function isInsideDirectory(directory: string, filePath: string): boolean {
    const relativePath = relative(resolve(directory), resolve(filePath));
    return relativePath === '' || (
        !relativePath.startsWith('..')
        && !isAbsolute(relativePath)
    );
}

function resolveRuntimePreviewChunkPath(recordsRoot: string, chunkImport: string): string | null {
    if (chunkImport.includes('\\')) {
        return null;
    }
    const segments = chunkImport.split('/');
    if (
        segments.length !== 4
        || segments[0] !== '.'
        || segments[1] !== 'chunks'
        || !segments[2]
        || !segments[3]
        || !segments[3].endsWith('.js')
    ) {
        return null;
    }
    if (segments.slice(1).some((segment) => segment === '.' || segment === '..' || segment.length === 0)) {
        return null;
    }
    const chunksRoot = resolve(recordsRoot, 'chunks');
    const chunkPath = resolve(recordsRoot, ...segments.slice(1));
    return isInsideDirectory(chunksRoot, chunkPath) ? chunkPath : null;
}

export async function verifyPrerequisiteImportMapIntegrity(recordsRoot: string): Promise<void> {
    const normalizedRecordsRoot = resolve(recordsRoot);
    const importMapPath = resolve(normalizedRecordsRoot, 'import-map.json');
    const importMap = JSON.parse(await readFile(importMapPath, 'utf8')) as RuntimePreviewImportMap;
    const imports = getPlainObject(importMap.imports);
    const prerequisiteChunk = imports?.[prerequisiteImportsSpecifier];
    if (typeof prerequisiteChunk !== 'string') {
        throw new Error('Runtime preview programming output is inconsistent: prerequisite import is missing.');
    }
    const chunkPath = resolveRuntimePreviewChunkPath(normalizedRecordsRoot, prerequisiteChunk);
    if (!chunkPath) {
        throw new Error(`Runtime preview programming output is inconsistent: invalid prerequisite chunk ${prerequisiteChunk}.`);
    }
    const chunkSource = await readFile(chunkPath, 'utf8');
    const requiredSpecifiers = Array.from(new Set(
        Array.from(chunkSource.matchAll(unresolvedSpecifierPattern), (match) => match[1]),
    ));
    if (requiredSpecifiers.length === 0) {
        return;
    }

    const prerequisiteScope = getScope(importMap, prerequisiteChunk);
    if (!prerequisiteScope) {
        throw new Error('Runtime preview programming output is inconsistent: prerequisite import scope is missing.');
    }

    for (const specifier of requiredSpecifiers) {
        const chunkImport = prerequisiteScope[specifier];
        if (typeof chunkImport !== 'string' || !resolveRuntimePreviewChunkPath(normalizedRecordsRoot, chunkImport)) {
            throw new Error(`Runtime preview programming output is inconsistent: prerequisite scope is missing ${specifier}.`);
        }
    }
}
