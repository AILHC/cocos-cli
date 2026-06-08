import { readFile } from 'node:fs/promises';
import type { ResolvedRuntimePreviewFile } from '../library/resolve-library-request';

export interface RuntimePreviewHttpResponse {
    statusCode: number;
    headers: Record<string, string>;
    body: string | Buffer;
}

function guessContentType(filePath: string): string {
    const normalized = filePath.replace(/\\/g, '/');
    if (normalized.endsWith('.json')) {
        return 'application/json; charset=utf-8';
    }
    if (normalized.endsWith('.js')) {
        return 'application/javascript; charset=utf-8';
    }
    if (normalized.endsWith('.ccon') || normalized.endsWith('.cconb')) {
        return 'application/json; charset=utf-8';
    }
    if (normalized.endsWith('.png')) {
        return 'image/png';
    }
    if (normalized.endsWith('.jpg') || normalized.endsWith('.jpeg')) {
        return 'image/jpeg';
    }
    return 'application/octet-stream';
}

export async function serveOnDemandFile(file: ResolvedRuntimePreviewFile): Promise<RuntimePreviewHttpResponse> {
    return {
        statusCode: 200,
        headers: {
            'content-type': guessContentType(file.absolutePath),
        },
        body: await readFile(file.absolutePath),
    };
}

export function textResponse(statusCode: number, body: string, contentType = 'text/plain; charset=utf-8'): RuntimePreviewHttpResponse {
    return {
        statusCode,
        headers: {
            'content-type': contentType,
        },
        body,
    };
}
