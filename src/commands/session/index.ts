/**
 * `cocos session` 命令组(agent 入口)。
 * runner 为纯逻辑(可注入 deps),command 为 commander 接线层。
 */
export { SessionCommand } from './command';
export {
    createDefaultSessionRunnerDeps,
    normalizeCallException,
    normalizeCallResult,
    runSessionCommand,
    EXIT_FAILURE,
    EXIT_SUCCESS,
    EXIT_USAGE,
    SESSION_ERROR_CODE,
    type SessionAction,
    type SessionCommandDetail,
    type SessionCommandSummary,
    type SessionEnvelope,
    type SessionErrorBody,
    type SessionRunnerDeps,
    type SessionRunOutcome,
    type SessionSummary,
    type SessionTargetOptions,
} from './runner';
export {
    createDefaultSessionMcpClientFactory,
    DEFAULT_SESSION_MCP_TIMEOUT_MS,
    type SessionMcpClient,
    type SessionMcpClientFactory,
    type SessionToolCallRaw,
    type SessionToolInfo,
} from './mcp-client';
