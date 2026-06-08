import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { RuntimePreviewContext } from '../context/runtime-preview-context';
import type { ResolvedRuntimePreviewFile } from '../library/resolve-library-request';

const scriptingPrefix = '/scripting/x/';
const scriptingSystemJsPrefix = '/scripting/systemjs/';
const scriptingUserMacroPath = '/scripting/userland/macro';
const previewRecordsBase = 'packer-driver/targets/preview';

export interface PreviewImportMap {
    imports?: Record<string, string>;
    scopes?: Record<string, unknown>;
}

export interface PreviewMainRecordModule {
    mTimestamp?: {
        mtime?: number;
        uuid?: string;
    };
    chunkId?: string;
    imports?: unknown[];
    type?: string;
    resolutions?: unknown[];
}

export interface PreviewMainRecord {
    modules?: Record<string, PreviewMainRecordModule>;
}

export interface PreviewAssemblyRecord {
    chunks?: Record<string, unknown>;
    entries?: Record<string, string>;
}

export interface PreviewProgrammingRecords {
    importMap: PreviewImportMap;
    mainRecord: PreviewMainRecord;
    assemblyRecord: PreviewAssemblyRecord;
}

export interface DependScriptModuleLink {
    assetUuid: string;
    assetUrl: string;
    scriptUuid: string;
    scriptAssetUrl: string;
    moduleUrl: string;
    chunkId: string;
    chunkImport: string;
    chunkRequestPath: string;
    chunkAbsolutePath: string;
}

export interface FindDependScriptModuleLinksOptions {
    limit?: number;
}

interface AssetDataRecord {
    url?: string;
    value?: {
        dependScripts?: unknown;
    };
}

interface ProgrammingRouteTarget {
    relativePath: string;
    preferCliRoot: boolean;
}

function toProgrammingRouteTarget(requestPath: string): ProgrammingRouteTarget | null {
    const normalized = requestPath.replace(/\\/g, '/');
    if (!normalized.startsWith(scriptingPrefix)) {
        if (normalized.startsWith(scriptingSystemJsPrefix)) {
            const relativePath = normalized.slice(scriptingSystemJsPrefix.length);
            if (!relativePath || relativePath.split('/').includes('..')) {
                return null;
            }

            return {
                relativePath: `preview/systemjs/${relativePath}`,
                preferCliRoot: true,
            };
        }

        if (normalized === scriptingUserMacroPath) {
            return {
                relativePath: 'custom-macro.js',
                preferCliRoot: true,
            };
        }

        return null;
    }

    const relativePath = normalized.slice(scriptingPrefix.length);
    if (!relativePath || relativePath.split('/').includes('..')) {
        return null;
    }

    return {
        relativePath,
        preferCliRoot: false,
    };
}

export function createRuntimePreviewGlobalImportMap(): PreviewImportMap {
    return {
        imports: {
            cc: 'q-bundled:///virtual/cc.js',
            'cc/env': 'cc/editor/populate-internal-constants',
            'cce.env': 'cc/editor/populate-internal-constants',
            'cc/userland/macro': './userland/macro',
        },
    };
}

export async function resolveProgrammingRequest(
    context: RuntimePreviewContext,
    requestPath: string,
): Promise<ResolvedRuntimePreviewFile | null> {
    const target = toProgrammingRouteTarget(requestPath);
    if (!target) {
        return null;
    }

    const roots = target.preferCliRoot
        ? [context.cliProgrammingRoot, context.projectProgrammingRoot].filter((value): value is string => Boolean(value))
        : [context.projectProgrammingRoot];
    for (const root of roots) {
        const absolutePath = resolve(root, target.relativePath);
        try {
            const fileStat = await stat(absolutePath);
            if (fileStat.isFile()) {
                return { absolutePath };
            }
        } catch {
            // Try the next fact-backed programming root candidate.
        }
    }

    return null;
}

async function readProgrammingJson<T>(context: RuntimePreviewContext, relativePath: string): Promise<T> {
    const requestPath = `${scriptingPrefix}${relativePath}`;
    const resolved = await resolveProgrammingRequest(context, requestPath);
    if (!resolved) {
        throw new Error(`Preview programming file is not resolvable: ${requestPath}`);
    }

    return JSON.parse(await readFile(resolved.absolutePath, 'utf8')) as T;
}

export async function loadPreviewProgrammingRecords(context: RuntimePreviewContext): Promise<PreviewProgrammingRecords> {
    const [importMap, mainRecord, assemblyRecord] = await Promise.all([
        readProgrammingJson<PreviewImportMap>(context, `${previewRecordsBase}/import-map.json`),
        readProgrammingJson<PreviewMainRecord>(context, `${previewRecordsBase}/main-record.json`),
        readProgrammingJson<PreviewAssemblyRecord>(context, `${previewRecordsBase}/assembly-record.json`),
    ]);

    return { importMap, mainRecord, assemblyRecord };
}

function moduleUrlCandidatesFromDbAssetUrl(context: RuntimePreviewContext, assetUrl: string): string[] {
    if (!assetUrl.startsWith('db://assets/')) {
        return [];
    }

    const assetRelativePath = assetUrl.slice('db://assets/'.length).replace(/\\/g, '/');
    if (!assetRelativePath || assetRelativePath.split('/').includes('..')) {
        return [];
    }

    const sourceAbsolutePath = resolve(context.projectRoot, 'assets', ...assetRelativePath.split('/'));
    const normalizedProjectRoot = context.projectRoot.replace(/\\/g, '/').replace(/\/$/, '');
    const literalFileUrl = `file:///${normalizedProjectRoot}/assets/${assetRelativePath}`;

    return Array.from(new Set([
        pathToFileURL(sourceAbsolutePath).href,
        literalFileUrl,
    ]));
}

function chunkRequestPathFromImport(chunkImport: string): string | null {
    if (!chunkImport.startsWith('./')) {
        return null;
    }

    const chunkRelativePath = chunkImport.slice('./'.length);
    if (!chunkRelativePath || chunkRelativePath.split('/').includes('..')) {
        return null;
    }

    return `${scriptingPrefix}${previewRecordsBase}/${chunkRelativePath}`;
}

function chunkImportMatchesId(chunkImport: string, chunkId: string): boolean {
    return chunkImport.replace(/\\/g, '/').endsWith(`/${chunkId}.js`);
}

export async function findDependScriptModuleLinks(
    context: RuntimePreviewContext,
    assetsData: Record<string, unknown>,
    options: FindDependScriptModuleLinksOptions = {},
): Promise<DependScriptModuleLink[]> {
    const limit = options.limit ?? 20;
    if (limit <= 0) {
        return [];
    }

    const records = await loadPreviewProgrammingRecords(context);
    const links: DependScriptModuleLink[] = [];

    for (const [assetUuid, rawRecord] of Object.entries(assetsData)) {
        const record = rawRecord as AssetDataRecord;
        const dependScripts = record.value?.dependScripts;
        if (!Array.isArray(dependScripts) || dependScripts.length === 0) {
            continue;
        }
        if (typeof record.url !== 'string' || !/\.(scene|prefab)$/.test(record.url)) {
            continue;
        }

        for (const scriptUuid of dependScripts) {
            if (typeof scriptUuid !== 'string') {
                continue;
            }

            const scriptRecord = assetsData[scriptUuid] as AssetDataRecord | undefined;
            if (typeof scriptRecord?.url !== 'string' || !/\.(ts|js)$/.test(scriptRecord.url)) {
                continue;
            }

            for (const moduleUrl of moduleUrlCandidatesFromDbAssetUrl(context, scriptRecord.url)) {
                const chunkImport = records.importMap.imports?.[moduleUrl];
                const moduleRecord = records.mainRecord.modules?.[moduleUrl];
                if (typeof chunkImport !== 'string' || moduleRecord?.mTimestamp?.uuid !== scriptUuid) {
                    continue;
                }

                const chunkRequestPath = chunkRequestPathFromImport(chunkImport);
                if (!chunkRequestPath || !moduleRecord.chunkId) {
                    continue;
                }
                if (records.assemblyRecord.entries?.[moduleUrl] !== moduleRecord.chunkId) {
                    continue;
                }
                if (!Object.prototype.hasOwnProperty.call(records.assemblyRecord.chunks ?? {}, moduleRecord.chunkId)) {
                    continue;
                }
                if (!chunkImportMatchesId(chunkImport, moduleRecord.chunkId)) {
                    continue;
                }

                const chunkFile = await resolveProgrammingRequest(context, chunkRequestPath);
                if (!chunkFile) {
                    continue;
                }

                links.push({
                    assetUuid,
                    assetUrl: record.url,
                    scriptUuid,
                    scriptAssetUrl: scriptRecord.url,
                    moduleUrl,
                    chunkId: moduleRecord.chunkId,
                    chunkImport,
                    chunkRequestPath,
                    chunkAbsolutePath: chunkFile.absolutePath,
                });

                if (links.length >= limit) {
                    return links;
                }
                break;
            }
        }
    }

    return links;
}
