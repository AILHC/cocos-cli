import type { Router } from 'express';
import type { IMiddlewareContribution } from '../server/interfaces';

export interface MountMcpOptions {
    router: Router;
    serverUrl: string;
    projectPath: string;
}

export interface MountedMcp {
    url: string;
    close: () => Promise<void>;
}

function mountContribution(router: Router, contribution: IMiddlewareContribution): void {
    contribution.get?.forEach(({ url, handler }) => {
        router.get(url, handler);
    });
    contribution.post?.forEach(({ url, handler }) => {
        router.post(url, handler);
    });
}

/**
 * Mount MCP on an already-started project session.
 *
 * This function owns only MCP resources. The caller remains responsible for
 * the HTTP server, project services, attached RPC, and scene worker.
 */
export async function mountMcp(options: MountMcpOptions): Promise<MountedMcp> {
    const { CocosAPI } = await import('../api');
    await CocosAPI.create();

    const { McpMiddleware } = await import('./mcp.middleware');
    const middleware = new McpMiddleware(() => options.projectPath);
    mountContribution(options.router, middleware.getMiddlewareContribution());

    const url = `${options.serverUrl.replace(/\/$/, '')}/mcp`;
    let closePromise: Promise<void> | null = null;
    return {
        url,
        close: () => {
            closePromise ??= middleware.close();
            return closePromise;
        },
    };
}
