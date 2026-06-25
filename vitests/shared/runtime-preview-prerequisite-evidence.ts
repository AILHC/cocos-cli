import { readFile } from 'node:fs/promises';
import { dirname, join, normalize } from 'node:path';

export interface RuntimePreviewPrerequisiteEvidence {
    importMapPath: string;
    chunkPath: string;
    chunkSource: string;
    dependencyCount: number;
    unresolvedMappingCount: number;
    hasStaticSystemRegister: boolean;
    hasSequentialDynamicImportLoop: boolean;
}

function getChunkDependencies(source: string): string[] {
    const match = source.match(/System\.register\(\s*\[([\s\S]*?)\]/);
    if (!match) {
        return [];
    }
    return Array.from(match[1].matchAll(/"(__unresolved_\d+)"/g), (entry) => entry[1]);
}

function getChunkScope(importMap: unknown, chunkImportPath: string): Record<string, string> {
    const scopes = (importMap as { scopes?: Record<string, unknown> }).scopes ?? {};
    const normalizedChunkPath = chunkImportPath.replace(/\\/g, '/');
    const candidateKeys = [
        normalizedChunkPath,
        `./${normalizedChunkPath}`,
        normalizedChunkPath.replace(/^\.\//, ''),
    ];
    const chunkScope = candidateKeys
        .map((key) => scopes[key])
        .find((entry): entry is Record<string, string> => (
            typeof entry === 'object'
            && entry !== null
            && Object.prototype.toString.call(entry) === '[object Object]'
        ));
    if (!chunkScope) {
        return {};
    }
    return chunkScope as Record<string, string>;
}

export async function readRuntimePreviewPrerequisiteEvidence(
    importMapPath: string,
): Promise<RuntimePreviewPrerequisiteEvidence> {
    const importMapText = await readFile(importMapPath, 'utf8');
    const importMap = JSON.parse(importMapText) as unknown;
    const chunkImport = (importMap as { imports?: Record<string, unknown> }).imports?.['cce:/internal/x/prerequisite-imports'];
    if (typeof chunkImport !== 'string') {
        throw new Error(`Missing cce:/internal/x/prerequisite-imports in ${importMapPath}`);
    }
    const chunkPath = normalize(join(dirname(importMapPath), chunkImport));
    const chunkSource = await readFile(chunkPath, 'utf8');
    const dependencies = getChunkDependencies(chunkSource);
    const chunkScope = getChunkScope(importMap, chunkImport);
    return {
        importMapPath,
        chunkPath,
        chunkSource,
        dependencyCount: dependencies.length,
        unresolvedMappingCount: Object.keys(chunkScope).filter((key) => /^__unresolved_\d+$/.test(key)).length,
        hasStaticSystemRegister: /System\.register\(\s*\[/.test(chunkSource),
        hasSequentialDynamicImportLoop: /await\s+import\(|\(\)\s*=>\s*import\(|const\s+requests|for\s*\(\s*const\s+request/.test(chunkSource),
    };
}

