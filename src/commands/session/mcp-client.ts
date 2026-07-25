/**
 * `cocos session` 的 MCP client 封装:作为标准 MCP client 直连运行中 Preview 的
 * `/mcp`(initialize 握手 + tools/list + tools/call),与 MCP 走完全相同的执行路径,
 * server 端零改动(spec「Command 通道与 identity endpoint」)。
 *
 * 接口设计为可注入工厂,Jest 单测用 fake client 覆盖错误归一化,不启动真实 server。
 * 默认实现基于 @modelcontextprotocol/sdk 的 StreamableHTTPClientTransport,
 * 用法先例见 e2e/helpers/mcp-client.ts 与 vitests/scripts/unified-session-edit-acceptance.ts。
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

export interface SessionToolInfo {
    name: string;
    description?: string;
    inputSchema?: unknown;
    outputSchema?: unknown;
}

// client.callTool 的原始返回(结构上与 MCP CallToolResult 一致,此处只声明消费侧字段)。
export interface SessionToolCallRaw {
    isError?: boolean;
    structuredContent?: unknown;
    content?: unknown;
}

export interface SessionMcpClient {
    // initialize 握手;失败抛错(映射为 initialize 失败)。
    connect(): Promise<void>;
    listTools(): Promise<SessionToolInfo[]>;
    callTool(name: string, args: Record<string, unknown>): Promise<SessionToolCallRaw>;
    // best-effort 关闭;实现内部不得抛错。
    close(): Promise<void>;
}

export type SessionMcpClientFactory = (mcpUrl: string) => SessionMcpClient;

// 每次 CLI invocation 独立握手,单次请求默认 60s 超时(成本已在 spec 写明并接受)。
export const DEFAULT_SESSION_MCP_TIMEOUT_MS = 60_000;

export function createDefaultSessionMcpClientFactory(
    timeoutMs: number = DEFAULT_SESSION_MCP_TIMEOUT_MS,
): SessionMcpClientFactory {
    return (mcpUrl) => {
        const transport = new StreamableHTTPClientTransport(new URL(mcpUrl));
        const client = new Client(
            { name: 'cocos-cli-session', version: '1.0.0' },
            { capabilities: {} },
        );
        return {
            connect: () => client.connect(transport),
            listTools: async () => {
                const result = await client.listTools({}, { timeout: timeoutMs });
                return result.tools as SessionToolInfo[];
            },
            callTool: async (name, args) => {
                const result = await client.callTool(
                    { name, arguments: args },
                    undefined,
                    { timeout: timeoutMs },
                );
                return result as SessionToolCallRaw;
            },
            close: async () => {
                try {
                    await client.close();
                } catch {
                    // best-effort。
                }
                try {
                    await transport.close();
                } catch {
                    // best-effort。
                }
            },
        };
    };
}
