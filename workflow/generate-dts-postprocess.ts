function replaceTopLevelBlock(
    content: string,
    startMarker: string,
    transformer: (block: string) => string,
): string {
    const start = content.indexOf(startMarker);
    if (start === -1) {
        return content;
    }

    const nextExport = content.indexOf('\nexport ', start + startMarker.length);
    const end = nextExport === -1 ? content.length : nextExport + 1;
    const block = content.slice(start, end);
    const updatedBlock = transformer(block);

    if (updatedBlock === block) {
        return content;
    }

    return `${content.slice(0, start)}${updatedBlock}${content.slice(end)}`;
}

function ensureBuilderFilesystemImports(content: string): string {
    const imports = [
        "import { IAssetDeleteOptions } from './filesystem';",
        "import { IAssetWriteFileOptions } from './filesystem';",
    ];

    const missingImports = imports.filter((line) => !content.includes(line));
    if (missingImports.length === 0) {
        return content;
    }

    const pluginImport = "import type { PluginItem } from '@babel/core';";
    const streamImport = "import { EventEmitter as EventEmitter_2 } from 'stream';";

    let insertAt = content.indexOf(pluginImport);
    if (insertAt === -1) {
        const streamIndex = content.indexOf(streamImport);
        if (streamIndex === -1) {
            return content;
        }
        insertAt = streamIndex + streamImport.length + 1;
    }

    const prefix = content.slice(0, insertAt);
    const suffix = content.slice(insertAt);
    const insertion = `${missingImports.join('\n')}\n`;
    return `${prefix}${insertion}${suffix}`;
}

export function normalizeDtsRollupContent(fileName: string, content: string): string {
    if (fileName !== 'builder.d.ts') {
        return content;
    }

    let normalized = content;

    normalized = replaceTopLevelBlock(normalized, 'export declare class VirtualAsset {', (block) => (
        block.replace(
            'existsInLibrary(extOrFile: string): boolean;',
            'existsInLibrary(extOrFile: string): Promise<boolean>;',
        )
    ));

    normalized = replaceTopLevelBlock(normalized, 'export declare class Asset extends VirtualAsset {', (block) => (
        block.replace('save(): boolean;', 'save(): Promise<boolean>;')
    ));

    normalized = replaceTopLevelBlock(normalized, 'export declare class MetaManager {', (block) => (
        block
            .replace(
                'write(path: any): false | undefined;',
                'write(path: string, options?: IAssetWriteFileOptions): Promise<false | undefined>;',
            )
            .replace(
                'remove(path: string): void;',
                'remove(path: string, options?: IAssetDeleteOptions): Promise<void>;',
            )
            .replace(
                'get(path: string): MetaInfo;',
                'get(path: string): Promise<MetaInfo>;',
            )
    ));

    if (normalized.includes('IAssetDeleteOptions') || normalized.includes('IAssetWriteFileOptions')) {
        normalized = ensureBuilderFilesystemImports(normalized);
    }

    return normalized;
}
