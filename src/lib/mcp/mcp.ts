/**
 * MCP Facade Module
 *
 * Called by the cocos-code utility process to register MCP middleware
 * in an already-initialized environment.
 * Prerequisite: the Server module must be started before calling this module.
 * This module only handles MCP-specific work: populating the toolRegistry
 * and registering MCP routes on the running server.
 */

let mcpUrl: string | undefined;
let registeringPromise: Promise<string> | undefined;
let mcpHandle: import('../../mcp/mount-mcp').MountedMcp | undefined;

/**
 * Register MCP middleware on the running server.
 *
 * Note: the Express server must already be started via the Server module.
 * This function only:
 * 1. Imports API modules to populate the toolRegistry (@tool decorator side-effects)
 * 2. Creates McpMiddleware and registers routes on the server
 *
 * @returns MCP endpoint URL (e.g. http://localhost:9527/mcp)
 */
export async function register(): Promise<string> {
	if (mcpUrl) {
		return mcpUrl;
	}

	// Reuse in-flight registration if called concurrently
	registeringPromise ??= doRegisterMcp();
	try {
		return await registeringPromise;
	} finally {
		registeringPromise = undefined;
	}
}

async function doRegisterMcp(): Promise<string> {
	const [{ mountMcp }, { serverService }, { default: project }, { getUrl }] = await Promise.all([
		import('../../mcp/mount-mcp'),
		import('../../server/server'),
		import('../../core/project'),
		import('../server/server'),
	]);
	const serverUrl = getUrl();
	if (!serverUrl) {
		throw new Error('Cannot register MCP before the host server is started.');
	}
	mcpHandle = await mountMcp({
		router: serverService.router,
		serverUrl,
		projectPath: project.path,
	});
	mcpUrl = mcpHandle.url;

	console.log(`[MCP] Middleware registered at: ${mcpUrl}`);
	return mcpUrl;
}

/**
 * Clean up MCP state.
 * Note: does NOT stop the Express server — use the Server module for that.
 */
export async function unregister(): Promise<void> {
	if (!mcpHandle) {
		return;
	}

	const handle = mcpHandle;
	mcpHandle = undefined;
	mcpUrl = undefined;
	await handle.close();
	console.log('[MCP] Middleware unregistered');
}

/**
 * Get the MCP registration status.
 */
export function getStatus(): { registered: boolean; url?: string } {
	return { registered: !!mcpUrl, url: mcpUrl };
}
