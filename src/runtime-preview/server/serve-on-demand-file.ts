import type { ResolvedRuntimePreviewFile } from '../library/resolve-library-request';

export type RuntimePreviewHttpResponse =
    | RuntimePreviewBodyResponse
    | RuntimePreviewFileResponse;

export interface RuntimePreviewBodyResponse {
    kind: 'body';
    statusCode: number;
    headers: Record<string, string>;
    body: string | Buffer;
}

export interface RuntimePreviewFileResponse {
    kind: 'file';
    statusCode: number;
    headers: Record<string, string>;
    absolutePath: string;
}

export function guessContentType(filePath: string): string {
    const normalized = filePath.replace(/\\/g, '/');
    if (normalized.endsWith('.json')) {
        return 'application/json; charset=utf-8';
    }
    if (normalized.endsWith('.js')) {
        return 'application/javascript; charset=utf-8';
    }
    if (normalized.endsWith('.wasm')) {
        return 'application/wasm';
    }
    if (normalized.endsWith('.ttf')) {
        return 'font/ttf';
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

export function serveOnDemandFile(file: ResolvedRuntimePreviewFile): RuntimePreviewHttpResponse {
    return {
        kind: 'file',
        statusCode: 200,
        headers: {
            'content-type': guessContentType(file.absolutePath),
        },
        absolutePath: file.absolutePath,
    };
}

export function textResponse(statusCode: number, body: string, contentType = 'text/plain; charset=utf-8'): RuntimePreviewHttpResponse {
    return {
        kind: 'body',
        statusCode,
        headers: {
            'content-type': contentType,
        },
        body,
    };
}
