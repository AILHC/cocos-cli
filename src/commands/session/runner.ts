/**
 * `cocos session` 命令组的纯逻辑 runner:发现/验证 + MCP client 执行 + 错误归一化。
 * 决策来源:.scratch/preview-session-cli-discovery/spec.md 的「CLI 自动发现」
 * 「Agent 入口」「Command 通道与 identity endpoint」三节,以及 issues/07、10、18。
 *
 * 输出契约:stdout 只输出单个 JSON envelope(由 command 层打印):
 * - 成功 { ok:true, session:{sessionId, projectRoot, serverUrl}, result|commands|command|identity }
 * - 失败 { ok:false, session?, error:{code, reason, data?} }
 * 诊断/进度写 stderr(deps.log);失败 exitCode 非零(usage 错误为 2,其余为 1)。
 */
import { promises as fsp } from 'fs';
import {
    deriveMcpUrl,
    discoverPreviewSession,
    PREVIEW_SESSION_PROTOCOL_VERSION,
    resolvePreviewSessionDeps,
    resolveProjectRootFromCwd,
    type PreviewSessionIdentity,
    type PreviewSessionIdentityFetcher,
    type PreviewSessionProbeResult,
} from '../../core/preview-session';
import { createDefaultSessionMcpClientFactory, type SessionMcpClientFactory } from './mcp-client';

// ---------------------------------------------------------------------------
// envelope 与错误契约
// ---------------------------------------------------------------------------

export interface SessionSummary {
    sessionId: string;
    projectRoot: string;
    serverUrl: string;
}

export interface SessionCommandSummary {
    name: string;
    description: string;
}

export interface SessionCommandDetail {
    name: string;
    description: string;
    inputSchema?: unknown;
    outputSchema?: unknown;
}

export interface SessionErrorBody {
    code: number;
    reason: string;
    data?: unknown;
}

export interface SessionEnvelope {
    ok: boolean;
    session?: SessionSummary;
    identity?: PreviewSessionIdentity;
    commands?: SessionCommandSummary[];
    command?: SessionCommandDetail;
    // call 成功时透传的 CommonResult({ code, data?, reason? })。
    result?: unknown;
    error?: SessionErrorBody;
}

// 归一化后的错误码(HTTP 风格;tool 4xx/5xx 原样透传 CommonResult.code)。
export const SESSION_ERROR_CODE = {
    // usage / 输入错误(flags 互斥、--input JSON 非法、cwd 解析不到项目、Zod 参数错误、
    // --url 非 loopback)。
    INVALID_INPUT: 400,
    // 没有运行中的 session / unknown tool。
    NOT_FOUND: 404,
    // session 正在启动。
    STARTING: 409,
    // 对端是 blocking owner(如 cocos preview --build)等非 editing session,无 /mcp 能力。
    NOT_EDITING_SESSION: 409,
    // protocolVersion 不匹配。
    VERSION_MISMATCH: 426,
    // identity 不可达 / MCP 握手失败 / transport 错误 / 响应形状非法。
    BAD_GATEWAY: 502,
    // tool 报错但未给出 structured code。
    TOOL_ERROR: 500,
} as const;

export const EXIT_SUCCESS = 0;
export const EXIT_FAILURE = 1;
export const EXIT_USAGE = 2;

// ---------------------------------------------------------------------------
// action / target / deps
// ---------------------------------------------------------------------------

export type SessionAction =
    | { kind: 'info' }
    | { kind: 'list' }
    | { kind: 'describe'; name: string }
    | { kind: 'call'; name: string; input?: string };

export interface SessionTargetOptions {
    project?: string;
    url?: string;
}

// 全部副作用点可注入:测试用 fake T1 API 与 fake MCP client,不启动真实 server。
export interface SessionRunnerDeps {
    cwd: string;
    protocolVersion: number;
    // 同一向上解析(issues/F14):默认从 cwd 开始;--project 显式路径作为起点
    // 走完全相同的逻辑,最终拒绝非 Cocos 目录。
    resolveProjectRootFromCwd(start: string): Promise<string>;
    discoverPreviewSession(projectRoot: string): Promise<PreviewSessionProbeResult | null>;
    fetchIdentity: PreviewSessionIdentityFetcher;
    createMcpClient: SessionMcpClientFactory;
    readInputFile(path: string): Promise<string>;
    readStdin(): Promise<string>;
    // 诊断/进度输出(stderr)。
    log(message: string): void;
}

export interface SessionRunOutcome {
    envelope: SessionEnvelope;
    exitCode: number;
}

export function createDefaultSessionRunnerDeps(): SessionRunnerDeps {
    const t1 = resolvePreviewSessionDeps();
    return {
        cwd: process.cwd(),
        protocolVersion: PREVIEW_SESSION_PROTOCOL_VERSION,
        resolveProjectRootFromCwd: (start) => resolveProjectRootFromCwd(start),
        discoverPreviewSession: (projectRoot) => discoverPreviewSession(projectRoot),
        fetchIdentity: t1.fetchIdentity,
        createMcpClient: createDefaultSessionMcpClientFactory(),
        readInputFile: (path) => fsp.readFile(path, 'utf8'),
        readStdin: () => new Promise<string>((resolve, reject) => {
            const chunks: Buffer[] = [];
            process.stdin.on('data', (chunk) => chunks.push(chunk as Buffer));
            process.stdin.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
            process.stdin.on('error', reject);
        }),
        log: (message) => process.stderr.write(`${message}\n`),
    };
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------

export async function runSessionCommand(
    action: SessionAction,
    target: SessionTargetOptions,
    deps: SessionRunnerDeps,
): Promise<SessionRunOutcome> {
    // --project 与 --url 互斥,同时给出立即报错(issues/07,沿用 compile-engine 先例)。
    if (target.project && target.url) {
        return failure({
            code: SESSION_ERROR_CODE.INVALID_INPUT,
            reason: '--project 与 --url 互斥,请只指定其一。',
        }, EXIT_USAGE);
    }

    const verified = target.url
        ? await verifyExplicitUrl(target.url, deps)
        : await discoverAndVerify(target, deps);
    if (!verified.ok) {
        return failure(verified.error, exitCodeFor(verified.error.code));
    }
    const identity = verified.identity;

    // loopback 安全边界(issues/F9):无鉴权方案只在本机成立;identity 报告的
    // serverUrl 必须是 loopback,否则拒绝连接(可能是伪服务或配置错误)。
    if (!isLoopbackUrl(identity.serverUrl)) {
        return failure({
            code: SESSION_ERROR_CODE.BAD_GATEWAY,
            reason: `identity 报告的 serverUrl(${identity.serverUrl})不是本机 loopback 地址,` +
                '拒绝连接:cocos session 只驱动本机 Preview。',
            data: { serverUrl: identity.serverUrl, sessionId: identity.sessionId },
        }, EXIT_FAILURE);
    }

    const session = sessionSummaryOf(identity);

    // mcpUrl 不信任对端字段:由已验证的 serverUrl 本地推导固定 /mcp 路径(issues/F9)。
    const mcpUrl = deriveMcpUrl(identity.serverUrl);

    // call 的 --input 在连接前解析,失败即 usage 错误,不做无谓握手。
    let callArguments: Record<string, unknown> | undefined;
    if (action.kind === 'call') {
        const parsed = await parseCallInput(action.input, deps);
        if (!parsed.ok) {
            return failure(parsed.error, EXIT_USAGE, session);
        }
        callArguments = parsed.args;
    }

    deps.log(`connecting to ${mcpUrl} (session ${identity.sessionId})`);
    const client = deps.createMcpClient(mcpUrl);
    try {
        try {
            await client.connect();
        } catch (error) {
            // identity 可达但 /mcp 404:对端是 blocking owner(如 cocos preview --build),
            // 不是 editing session(issues/19),给出明确文案而非通用握手失败。
            if (isHttpNotFoundError(error)) {
                return failure({
                    code: SESSION_ERROR_CODE.NOT_EDITING_SESSION,
                    reason: `该 session(${identity.sessionId})不是 editing session` +
                        `(${mcpUrl} 不存在,可能由 cocos preview --build 启动的 blocking owner),` +
                        `无法用 cocos session 驱动;请直接使用其 Preview URL:${identity.serverUrl}。`,
                    data: { sessionId: identity.sessionId, serverUrl: identity.serverUrl, mcpUrl },
                }, EXIT_FAILURE, session);
            }
            return failure({
                code: SESSION_ERROR_CODE.BAD_GATEWAY,
                reason: `MCP initialize 握手失败(${mcpUrl}):${messageOf(error)}。` +
                    '请确认 Preview 仍在运行,必要时重启 cocos preview。',
            }, EXIT_FAILURE, session);
        }

        switch (action.kind) {
            case 'info':
                return success({ session, identity });
            case 'list':
                return await runList(client, session);
            case 'describe':
                return await runDescribe(client, action.name, session);
            case 'call':
                return await runCall(client, action.name, callArguments ?? {}, session);
            default:
                throw new Error(`unknown session action: ${JSON.stringify(action)}`);
        }
    } finally {
        try {
            await client.close();
        } catch {
            // 关闭失败不影响结果。
        }
    }
}

// ---------------------------------------------------------------------------
// 发现与验证
// ---------------------------------------------------------------------------

type VerifiedIdentity =
    | { ok: true; identity: PreviewSessionIdentity }
    | { ok: false; error: SessionErrorBody };

// 默认 cwd 向上解析 / --project 同一流程 → discoverPreviewSession → liveness 分支。
// --project 以显式路径为起点走同一向上解析(issues/F14):非 Cocos 目录在
// resolver 抛错处归一为 400,而不是落到「没有运行中的 Preview」的 404。
async function discoverAndVerify(
    target: SessionTargetOptions,
    deps: SessionRunnerDeps,
): Promise<VerifiedIdentity> {
    let projectRoot: string;
    try {
        projectRoot = await deps.resolveProjectRootFromCwd(target.project ?? deps.cwd);
    } catch (error) {
        return {
            ok: false,
            error: {
                code: SESSION_ERROR_CODE.INVALID_INPUT,
                reason: `${messageOf(error)}可用 --project <path> 显式指定项目,或用 --url <endpoint> 直连。`,
            },
        };
    }

    const probe = await deps.discoverPreviewSession(projectRoot);
    if (!probe) {
        return { ok: false, error: noSessionError(projectRoot, probe) };
    }

    switch (probe.liveness) {
        case 'live-compatible':
            if (!probe.identity) {
                return { ok: false, error: noSessionError(projectRoot, probe) };
            }
            return { ok: true, identity: probe.identity };
        case 'starting':
            return {
                ok: false,
                error: {
                    code: SESSION_ERROR_CODE.STARTING,
                    reason: `session 正在启动(PID ${probe.claim.pid}),稍后重试。`,
                    data: { projectRoot, pid: probe.claim.pid, sessionId: probe.claim.sessionId },
                },
            };
        case 'live-incompatible':
            return {
                ok: false,
                error: {
                    code: SESSION_ERROR_CODE.VERSION_MISMATCH,
                    reason: `Preview 版本不匹配(PID ${probe.claim.pid};protocolVersion 对端 ` +
                        `${probe.descriptor?.protocolVersion ?? 'unknown'},本地 ${deps.protocolVersion}),请重启 Preview。`,
                    data: {
                        projectRoot,
                        pid: probe.claim.pid,
                        remoteProtocolVersion: probe.descriptor?.protocolVersion ?? null,
                        localProtocolVersion: deps.protocolVersion,
                    },
                },
            };
        case 'unreachable-owner-alive':
            return {
                ok: false,
                error: {
                    code: SESSION_ERROR_CODE.BAD_GATEWAY,
                    reason: `Preview session endpoint 不可达(PID ${probe.claim.pid} 存活但 identity endpoint 无响应),` +
                        '请重启 Preview(cocos preview)。',
                    data: { projectRoot, pid: probe.claim.pid, liveness: probe.liveness },
                },
            };
        case 'invalid-owner-alive':
            // claim 损坏/身份不匹配但 PID 活,fail closed(issues/F2):
            // 同类错误——不是「无 session」,提示人工处理,绝不建议直接重启覆盖。
            return {
                ok: false,
                error: {
                    code: SESSION_ERROR_CODE.BAD_GATEWAY,
                    reason: `Preview session claim 损坏或身份不匹配,但其进程(PID ${probe.claim.pid})仍存活;` +
                        'claim 未被改动。请人工确认该进程不是仍在写项目的 owner 后,' +
                        '停止进程并删除 <project>/temp/cli 下对应 claim 目录,再重试。',
                    data: { projectRoot, pid: probe.claim.pid, liveness: probe.liveness },
                },
            };
        default:
            // confirmed-dead / invalid / draining:按无 live session 处理。
            return { ok: false, error: noSessionError(projectRoot, probe) };
    }
}

// --url 直连:无 descriptor 可比对,验证强度为 identity endpoint 可达 +
// protocolVersion 匹配 + 对端确为 cocos-cli(响应形状合法,issues/18 m7)。
// loopback 边界(issues/F9):--url 必须是本机 loopback 地址,否则按 usage 错误拒绝。
async function verifyExplicitUrl(url: string, deps: SessionRunnerDeps): Promise<VerifiedIdentity> {
    if (!isLoopbackUrl(url)) {
        return {
            ok: false,
            error: {
                code: SESSION_ERROR_CODE.INVALID_INPUT,
                reason: `--url 只允许本机 loopback 地址(127.0.0.1 / localhost / [::1]),收到:${url}。` +
                    'cocos session 不连接非本机 endpoint(无鉴权方案的安全边界)。',
                data: { url },
            },
        };
    }
    const identity = await deps.fetchIdentity(url);
    if (!identity) {
        return {
            ok: false,
            error: {
                code: SESSION_ERROR_CODE.BAD_GATEWAY,
                reason: `无法验证 ${url} 为运行中的 cocos-cli Preview session` +
                    '(identity endpoint 不可达或响应非法)。请确认 Preview 已启动,或在项目目录内省略 --url 走自动发现。',
                data: { url },
            },
        };
    }
    if (identity.protocolVersion !== deps.protocolVersion) {
        return {
            ok: false,
            error: {
                code: SESSION_ERROR_CODE.VERSION_MISMATCH,
                reason: `Preview 版本不匹配(protocolVersion 对端 ${identity.protocolVersion},` +
                    `本地 ${deps.protocolVersion}),请重启 Preview。`,
                data: {
                    url,
                    remoteProtocolVersion: identity.protocolVersion,
                    localProtocolVersion: deps.protocolVersion,
                },
            },
        };
    }
    if (identity.state === 'starting') {
        return {
            ok: false,
            error: {
                code: SESSION_ERROR_CODE.STARTING,
                reason: `session 正在启动(${url}),稍后重试。`,
                data: { url, sessionId: identity.sessionId },
            },
        };
    }
    if (identity.state !== 'ready') {
        return {
            ok: false,
            error: {
                code: SESSION_ERROR_CODE.NOT_FOUND,
                reason: `没有运行中的 Preview(${url} 状态为 ${identity.state}),请先运行 cocos preview。`,
                data: { url, state: identity.state },
            },
        };
    }
    return { ok: true, identity };
}

function noSessionError(projectRoot: string, probe: PreviewSessionProbeResult | null): SessionErrorBody {
    const liveness = probe?.liveness;
    return {
        code: SESSION_ERROR_CODE.NOT_FOUND,
        reason: `没有运行中的 Preview(project: ${projectRoot}),请先运行 cocos preview。` +
            (liveness ? `(检测到残留 claim,状态:${liveness})` : ''),
        data: { projectRoot, ...(liveness ? { liveness, pid: probe?.claim.pid } : {}) },
    };
}

// ---------------------------------------------------------------------------
// MCP 执行
// ---------------------------------------------------------------------------

async function runList(
    client: ReturnType<SessionMcpClientFactory>,
    session: SessionSummary,
): Promise<SessionRunOutcome> {
    const listed = await listToolsNormalized(client, session);
    if (!listed.ok) {
        return listed.outcome;
    }
    const commands: SessionCommandSummary[] = listed.tools.map((tool) => ({
        name: tool.name,
        description: firstLine(tool.description),
    }));
    return success({ session, commands });
}

// describe = initialize + 全量 tools/list + client 过滤(MCP 无单 tool describe,
// 成本已在 spec「Agent 入口」写明并接受)。
async function runDescribe(
    client: ReturnType<SessionMcpClientFactory>,
    name: string,
    session: SessionSummary,
): Promise<SessionRunOutcome> {
    const listed = await listToolsNormalized(client, session);
    if (!listed.ok) {
        return listed.outcome;
    }
    const tool = listed.tools.find((candidate) => candidate.name === name);
    if (!tool) {
        return failure({
            code: SESSION_ERROR_CODE.NOT_FOUND,
            reason: `unknown command:${name}。可用 command 见 data.available,或运行 cocos session list。`,
            data: { tool: name, available: listed.tools.map((candidate) => candidate.name) },
        }, EXIT_FAILURE, session);
    }
    return success({
        session,
        command: {
            name: tool.name,
            description: firstLine(tool.description),
            ...(tool.inputSchema !== undefined ? { inputSchema: tool.inputSchema } : {}),
            ...(tool.outputSchema !== undefined ? { outputSchema: tool.outputSchema } : {}),
        },
    });
}

async function runCall(
    client: ReturnType<SessionMcpClientFactory>,
    name: string,
    args: Record<string, unknown>,
    session: SessionSummary,
): Promise<SessionRunOutcome> {
    let raw: Awaited<ReturnType<ReturnType<SessionMcpClientFactory>['callTool']>>;
    try {
        raw = await client.callTool(name, args);
    } catch (error) {
        return failure(normalizeCallException(name, error), EXIT_FAILURE, session);
    }
    const normalized = normalizeCallResult(name, raw);
    if (!normalized.ok) {
        return failure(normalized.error, EXIT_FAILURE, session);
    }
    return success({ session, result: normalized.result });
}

type ListToolsOutcome =
    | { ok: true; tools: import('./mcp-client').SessionToolInfo[] }
    | { ok: false; outcome: SessionRunOutcome };

async function listToolsNormalized(
    client: ReturnType<SessionMcpClientFactory>,
    session: SessionSummary,
): Promise<ListToolsOutcome> {
    try {
        return { ok: true, tools: await client.listTools() };
    } catch (error) {
        return {
            ok: false,
            outcome: failure({
                code: SESSION_ERROR_CODE.BAD_GATEWAY,
                reason: `MCP tools/list 失败:${messageOf(error)}。请确认 Preview 仍在运行,必要时重启 cocos preview。`,
            }, EXIT_FAILURE, session),
        };
    }
}

// ---------------------------------------------------------------------------
// 错误归一化(issues/18 第 1 条)
// ---------------------------------------------------------------------------

interface CommonResultLike {
    code: number;
    reason?: unknown;
    data?: unknown;
}

// 解包 structuredContent.result:CommonResult.code >= 400 → 失败
// (MCP isError 仅 5xx 置位,不能单独依赖)。
export function normalizeCallResult(
    name: string,
    raw: { isError?: boolean; structuredContent?: unknown; content?: unknown },
): { ok: true; result: CommonResultLike } | { ok: false; error: SessionErrorBody } {
    const structured = raw.structuredContent as { result?: CommonResultLike } | undefined;
    const result = structured?.result;
    if (result && typeof result === 'object' && typeof result.code === 'number') {
        if (result.code >= 400) {
            return {
                ok: false,
                error: {
                    code: result.code,
                    reason: typeof result.reason === 'string' && result.reason
                        ? result.reason
                        : `command ${name} 失败(code ${result.code})。`,
                    ...(result.data !== undefined ? { data: result.data } : {}),
                },
            };
        }
        return { ok: true, result };
    }
    if (raw.isError) {
        return {
            ok: false,
            error: {
                code: SESSION_ERROR_CODE.TOOL_ERROR,
                reason: `command ${name} 失败,且响应缺少 structuredContent.result。`,
                data: raw.content,
            },
        };
    }
    // transport 层面拿到了非预期响应(非 JSON / 形状非法)。
    return {
        ok: false,
        error: {
            code: SESSION_ERROR_CODE.BAD_GATEWAY,
            reason: `MCP 响应形状非法(command ${name} 缺少 structuredContent.result)。`,
            data: raw.content,
        },
    };
}

// tools/call 抛出的协议/transport 异常:unknown tool(-32601 或 "not found")→ 404;
// Zod 参数错误(-32602 InvalidParams)→ 400;其余(transport 500、连接中断等)→ 502。
export function normalizeCallException(name: string, error: unknown): SessionErrorBody {
    const message = messageOf(error);
    const code = (error as { code?: unknown })?.code;
    if (code === -32601 || (code === -32602 && /not found/i.test(message))) {
        return {
            code: SESSION_ERROR_CODE.NOT_FOUND,
            reason: `unknown command:${name}。运行 cocos session list 查看可用 command。`,
            data: { tool: name, detail: message },
        };
    }
    if (code === -32602) {
        return {
            code: SESSION_ERROR_CODE.INVALID_INPUT,
            reason: `command ${name} 参数校验失败:${message}。` +
                `运行 cocos session describe ${name} 查看 input schema。`,
            data: { tool: name },
        };
    }
    return {
        code: SESSION_ERROR_CODE.BAD_GATEWAY,
        reason: `MCP transport 错误(command ${name}):${message}。请确认 Preview 仍在运行,必要时重启 cocos preview。`,
    };
}

// ---------------------------------------------------------------------------
// --input 解析
// ---------------------------------------------------------------------------

type ParsedCallInput =
    | { ok: true; args: Record<string, unknown> }
    | { ok: false; error: SessionErrorBody };

// --input 支持三种形态:内联 JSON、`@<file>` 从文件读取、`-` 从 stdin 读取;
// 缺省按空参数对象处理。
async function parseCallInput(input: string | undefined, deps: SessionRunnerDeps): Promise<ParsedCallInput> {
    let source = input;
    if (source === undefined) {
        return { ok: true, args: {} };
    }
    if (source.startsWith('@')) {
        const file = source.slice(1);
        try {
            source = await deps.readInputFile(file);
        } catch (error) {
            return {
                ok: false,
                error: {
                    code: SESSION_ERROR_CODE.INVALID_INPUT,
                    reason: `--input 读取文件失败(${file}):${messageOf(error)}`,
                },
            };
        }
    } else if (source === '-') {
        source = await deps.readStdin();
    }
    let parsed: unknown;
    try {
        parsed = JSON.parse(source);
    } catch (error) {
        return {
            ok: false,
            error: {
                code: SESSION_ERROR_CODE.INVALID_INPUT,
                reason: `--input 不是合法 JSON:${messageOf(error)}`,
            },
        };
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        return {
            ok: false,
            error: {
                code: SESSION_ERROR_CODE.INVALID_INPUT,
                reason: '--input 必须是 JSON object(对应 command 的 arguments)。',
            },
        };
    }
    return { ok: true, args: parsed as Record<string, unknown> };
}

// ---------------------------------------------------------------------------
// 小工具
// ---------------------------------------------------------------------------

// loopback host 白名单(issues/F9):URL hostname 已小写化;IPv6 的 URL 形式带方括号。
const LOOPBACK_HOSTNAMES: ReadonlySet<string> = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);

// 仅 http(s) + loopback host 才可信;无法解析或非 loopback 一律拒绝。
export function isLoopbackUrl(raw: string): boolean {
    let url: URL;
    try {
        url = new URL(raw);
    } catch {
        return false;
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        return false;
    }
    return LOOPBACK_HOSTNAMES.has(url.hostname.toLowerCase());
}

// identity 可达但 /mcp 404 的识别(issues/19):SDK transport 对非 2xx 抛
// StreamableHTTPError,message 含 HTTP 状态码;只在 MCP 握手失败归一化处使用。
function isHttpNotFoundError(error: unknown): boolean {
    const status = (error as { status?: unknown })?.status;
    if (status === 404) {
        return true;
    }
    return /\b404\b/.test(messageOf(error));
}

function sessionSummaryOf(identity: PreviewSessionIdentity): SessionSummary {
    return {
        sessionId: identity.sessionId,
        projectRoot: identity.projectRoot,
        serverUrl: identity.serverUrl,
    };
}

function firstLine(text: string | undefined): string {
    if (!text) {
        return '';
    }
    return text.split(/\r?\n/, 1)[0].trim();
}

function messageOf(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function success(fields: Omit<SessionEnvelope, 'ok'>): SessionRunOutcome {
    return { envelope: { ok: true, ...fields }, exitCode: EXIT_SUCCESS };
}

function failure(error: SessionErrorBody, exitCode: number, session?: SessionSummary): SessionRunOutcome {
    return {
        envelope: {
            ok: false,
            ...(session ? { session } : {}),
            error,
        },
        exitCode,
    };
}

function exitCodeFor(code: number): number {
    return code === SESSION_ERROR_CODE.INVALID_INPUT ? EXIT_USAGE : EXIT_FAILURE;
}
