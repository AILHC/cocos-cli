/**
 * 只读 identity endpoint(GET /__cocos-cli/session)的 handler。
 * 决策来源:.scratch/preview-session-cli-discovery/spec.md「Command 通道与 identity endpoint」。
 * 每次请求从 claim descriptor 实时读取,保证状态新鲜;无 claim 或 descriptor
 * 不可读时返回明确的 404 JSON。不动 /__runtime-preview/health 的 readiness 语义。
 */
import type { Request, Response } from 'express';
import {
    deriveMcpUrl,
    readPreviewSessionDescriptor,
    resolvePreviewSessionDeps,
    type PreviewSessionFileSystem,
    type PreviewSessionIdentity,
} from '../../core/preview-session';

export interface PreviewSessionIdentityHandlerOptions {
    // ownership claim 目录;descriptor 在其内实时读取。
    claimDir: string;
    // descriptor 尚未发布 serverUrl(starting 态)时回落到当前 server URL。
    resolveServerUrl: () => string;
    // 测试可注入;默认 node fs(与 ownership 模块同一实现)。
    fs?: PreviewSessionFileSystem;
}

export function createPreviewSessionIdentityHandler(
    options: PreviewSessionIdentityHandlerOptions,
): (request: Request, response: Response) => Promise<void> {
    const fs = options.fs ?? resolvePreviewSessionDeps().fs;
    return async (_request: Request, response: Response): Promise<void> => {
        const read = await readPreviewSessionDescriptor(fs, options.claimDir);
        if (!read.ok) {
            response.status(404).json({
                error: 'preview-session-not-found',
                reason: read.reason,
            });
            return;
        }
        const descriptor = read.descriptor;
        const serverUrl = descriptor.serverUrl ?? options.resolveServerUrl();
        const identity: PreviewSessionIdentity = {
            sessionId: descriptor.sessionId,
            projectRoot: descriptor.projectRoot,
            state: descriptor.state,
            protocolVersion: descriptor.protocolVersion,
            serverUrl,
            mcpUrl: deriveMcpUrl(serverUrl),
            startedAt: descriptor.startedAt,
        };
        response.status(200).json(identity);
    };
}
