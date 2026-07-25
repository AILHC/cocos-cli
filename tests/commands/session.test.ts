/**
 * `cocos session` 命令组 runner 的 focused 单测。
 * 测试层级:Jest 单元测试;fixture 语义:全部 T1 API(resolve/discover/fetchIdentity)
 * 与 MCP client 均为内存 fake,不启动真实 server、不访问真实文件系统;
 * 能证明:发现分支(含 invalid-owner-alive fail closed)、--project/--url 互斥、
 * loopback 安全边界、mcpUrl 本地推导、blocking owner 非 editing session 识别、
 * 错误归一化各层映射与 envelope 形状;
 * 不能证明:真实 Preview / 真实 MCP server 的端到端行为(属 Vitest 集成层)。
 */
import type {
    PreviewSessionIdentity,
    PreviewSessionProbeResult,
} from '../../src/core/preview-session';
import {
    runSessionCommand,
    SESSION_ERROR_CODE,
    type SessionRunnerDeps,
} from '../../src/commands/session/runner';
import type { SessionMcpClient, SessionToolCallRaw, SessionToolInfo } from '../../src/commands/session/mcp-client';

const PROJECT_ROOT = '/fake/project';
const SERVER_URL = 'http://127.0.0.1:7456';
const MCP_URL = `${SERVER_URL}/mcp`;

function makeIdentity(overrides: Partial<PreviewSessionIdentity> = {}): PreviewSessionIdentity {
    return {
        sessionId: 'session-1',
        projectRoot: PROJECT_ROOT,
        state: 'ready',
        protocolVersion: 1,
        serverUrl: SERVER_URL,
        mcpUrl: MCP_URL,
        startedAt: '2026-07-24T00:00:00.000Z',
        ...overrides,
    };
}

function makeProbe(liveness: PreviewSessionProbeResult['liveness'], overrides: Partial<PreviewSessionProbeResult> = {}): PreviewSessionProbeResult {
    const live = liveness === 'live-compatible';
    return {
        claim: { claimDir: `${PROJECT_ROOT}/temp/cli/preview-session-session-1-4321`, sessionId: 'session-1', pid: 4321 },
        liveness,
        descriptor: live || liveness === 'live-incompatible'
            ? {
                sessionId: 'session-1',
                projectRoot: PROJECT_ROOT,
                pid: 4321,
                state: 'ready',
                protocolVersion: liveness === 'live-incompatible' ? 99 : 1,
                serverUrl: SERVER_URL,
                startedAt: '2026-07-24T00:00:00.000Z',
            }
            : null,
        descriptorError: null,
        identity: live ? makeIdentity() : null,
        ...overrides,
    };
}

interface FakeClient extends SessionMcpClient {
    connect: jest.Mock<Promise<void>, []>;
    listTools: jest.Mock<Promise<SessionToolInfo[]>, []>;
    callTool: jest.Mock<Promise<SessionToolCallRaw>, [string, Record<string, unknown>]>;
    close: jest.Mock<Promise<void>, []>;
}

function makeFakeClient(behavior: Partial<{
    connectError: unknown;
    tools: SessionToolInfo[];
    listError: unknown;
    callResult: SessionToolCallRaw;
    callError: unknown;
}> = {}): FakeClient {
    return {
        connect: behavior.connectError
            ? jest.fn().mockRejectedValue(behavior.connectError)
            : jest.fn().mockResolvedValue(undefined),
        listTools: behavior.listError
            ? jest.fn().mockRejectedValue(behavior.listError)
            : jest.fn().mockResolvedValue(behavior.tools ?? []),
        callTool: behavior.callError
            ? jest.fn().mockRejectedValue(behavior.callError)
            : jest.fn().mockResolvedValue(behavior.callResult ?? {}),
        close: jest.fn().mockResolvedValue(undefined),
    };
}

interface FakeDepsOptions {
    probe?: PreviewSessionProbeResult | null;
    identity?: PreviewSessionIdentity | null;
    client?: FakeClient;
    stdin?: string;
    files?: Record<string, string>;
    logs?: string[];
}

function makeDeps(options: FakeDepsOptions = {}): { deps: SessionRunnerDeps; client: FakeClient } {
    const client = options.client ?? makeFakeClient();
    const deps: SessionRunnerDeps = {
        cwd: '/fake/cwd',
        protocolVersion: 1,
        resolveProjectRootFromCwd: jest.fn().mockResolvedValue(PROJECT_ROOT),
        discoverPreviewSession: jest.fn().mockResolvedValue(
            options.probe === undefined ? makeProbe('live-compatible') : options.probe,
        ),
        fetchIdentity: jest.fn().mockResolvedValue(
            options.identity === undefined ? makeIdentity() : options.identity,
        ),
        createMcpClient: jest.fn(() => client),
        readInputFile: jest.fn().mockImplementation(async (path: string) => {
            const content = options.files?.[path];
            if (content === undefined) {
                throw new Error(`ENOENT: ${path}`);
            }
            return content;
        }),
        readStdin: jest.fn().mockResolvedValue(options.stdin ?? ''),
        log: jest.fn((message: string) => {
            options.logs?.push(message);
        }),
    };
    return { deps, client };
}

describe('runSessionCommand — target flags', () => {
    it('--project 与 --url 同给:互斥报错,exit 2,不做任何发现', async () => {
        const { deps } = makeDeps();
        const { envelope, exitCode } = await runSessionCommand(
            { kind: 'info' },
            { project: '/x', url: SERVER_URL },
            deps,
        );
        expect(exitCode).toBe(2);
        expect(envelope.ok).toBe(false);
        expect(envelope.error?.code).toBe(SESSION_ERROR_CODE.INVALID_INPUT);
        expect(envelope.error?.reason).toContain('互斥');
        expect(deps.discoverPreviewSession).not.toHaveBeenCalled();
        expect(deps.fetchIdentity).not.toHaveBeenCalled();
    });
});

describe('runSessionCommand — 发现分支(cwd / --project)', () => {
    it('无 claim:「没有运行中的 Preview」+ 恢复路径,exit 1', async () => {
        const { deps } = makeDeps({ probe: null });
        const { envelope, exitCode } = await runSessionCommand({ kind: 'info' }, {}, deps);
        expect(exitCode).toBe(1);
        expect(envelope.ok).toBe(false);
        expect(envelope.error?.code).toBe(SESSION_ERROR_CODE.NOT_FOUND);
        expect(envelope.error?.reason).toContain('没有运行中的 Preview');
        expect(envelope.error?.reason).toContain('cocos preview');
        expect(envelope.session).toBeUndefined();
    });

    it('starting:「session 正在启动(PID x)」带 PID,exit 1', async () => {
        const { deps } = makeDeps({ probe: makeProbe('starting') });
        const { envelope, exitCode } = await runSessionCommand({ kind: 'info' }, {}, deps);
        expect(exitCode).toBe(1);
        expect(envelope.error?.code).toBe(SESSION_ERROR_CODE.STARTING);
        expect(envelope.error?.reason).toContain('session 正在启动');
        expect(envelope.error?.reason).toContain('4321');
    });

    it('live-incompatible:「版本不匹配,请重启 Preview」,exit 1,不连接', async () => {
        const { deps, client } = makeDeps({ probe: makeProbe('live-incompatible') });
        const { envelope, exitCode } = await runSessionCommand({ kind: 'info' }, {}, deps);
        expect(exitCode).toBe(1);
        expect(envelope.error?.code).toBe(SESSION_ERROR_CODE.VERSION_MISMATCH);
        expect(envelope.error?.reason).toContain('版本不匹配');
        expect(envelope.error?.reason).toContain('重启 Preview');
        expect(client.connect).not.toHaveBeenCalled();
    });

    it.each(['confirmed-dead', 'invalid', 'draining'] as const)(
        'stale/draining(%s):按无 session 处理,exit 1',
        async (liveness) => {
            const { deps } = makeDeps({ probe: makeProbe(liveness) });
            const { envelope, exitCode } = await runSessionCommand({ kind: 'info' }, {}, deps);
            expect(exitCode).toBe(1);
            expect(envelope.error?.code).toBe(SESSION_ERROR_CODE.NOT_FOUND);
            expect(envelope.error?.reason).toContain('没有运行中的 Preview');
            expect(envelope.error?.data).toMatchObject({ liveness });
        },
    );

    it('unreachable-owner-alive:endpoint 不可达,exit 1,提示重启', async () => {
        const { deps } = makeDeps({ probe: makeProbe('unreachable-owner-alive') });
        const { envelope, exitCode } = await runSessionCommand({ kind: 'info' }, {}, deps);
        expect(exitCode).toBe(1);
        expect(envelope.error?.code).toBe(SESSION_ERROR_CODE.BAD_GATEWAY);
        expect(envelope.error?.reason).toContain('不可达');
    });

    it('invalid-owner-alive:claim 损坏但 PID 活,fail closed 提示人工处理,exit 1', async () => {
        const { deps, client } = makeDeps({ probe: makeProbe('invalid-owner-alive') });
        const { envelope, exitCode } = await runSessionCommand({ kind: 'info' }, {}, deps);
        expect(exitCode).toBe(1);
        expect(envelope.error?.code).toBe(SESSION_ERROR_CODE.BAD_GATEWAY);
        expect(envelope.error?.reason).toContain('claim 损坏');
        expect(envelope.error?.reason).toContain('4321');
        expect(envelope.error?.reason).toContain('人工');
        expect(envelope.error?.data).toMatchObject({ liveness: 'invalid-owner-alive', pid: 4321 });
        expect(client.connect).not.toHaveBeenCalled();
    });

    it('cwd 向上解析失败:明确错误并提示 --project/--url', async () => {
        const { deps } = makeDeps();
        (deps.resolveProjectRootFromCwd as jest.Mock).mockRejectedValue(new Error('No Cocos project root found'));
        const { envelope, exitCode } = await runSessionCommand({ kind: 'info' }, {}, deps);
        expect(exitCode).toBe(2);
        expect(envelope.error?.code).toBe(SESSION_ERROR_CODE.INVALID_INPUT);
        expect(envelope.error?.reason).toContain('--project');
        expect(envelope.error?.reason).toContain('--url');
    });

    it('live-compatible:info 返回 identity 与 session 摘要,经 MCP 握手', async () => {
        const { deps, client } = makeDeps();
        const { envelope, exitCode } = await runSessionCommand({ kind: 'info' }, {}, deps);
        expect(exitCode).toBe(0);
        expect(envelope.ok).toBe(true);
        expect(envelope.session).toEqual({
            sessionId: 'session-1',
            projectRoot: PROJECT_ROOT,
            serverUrl: SERVER_URL,
        });
        expect(envelope.identity).toMatchObject({ sessionId: 'session-1', mcpUrl: MCP_URL });
        expect(client.connect).toHaveBeenCalledTimes(1);
        expect(client.close).toHaveBeenCalledTimes(1);
    });

    it('--project:以显式路径为起点走同一向上解析,再走发现流程', async () => {
        const { deps } = makeDeps();
        const { exitCode } = await runSessionCommand({ kind: 'info' }, { project: '/explicit/proj/subdir' }, deps);
        expect(exitCode).toBe(0);
        // 同一 resolver,显式路径作为起点(issues/F14)。
        expect(deps.resolveProjectRootFromCwd).toHaveBeenCalledWith('/explicit/proj/subdir');
        expect(deps.discoverPreviewSession).toHaveBeenCalledWith(PROJECT_ROOT);
    });

    it('--project 指向非 Cocos 目录(resolver 抛错):400 usage 错误而非 404', async () => {
        const { deps } = makeDeps();
        (deps.resolveProjectRootFromCwd as jest.Mock).mockRejectedValue(
            new Error('No Cocos project root found from cwd: /not/a/project'),
        );
        const { envelope, exitCode } = await runSessionCommand({ kind: 'info' }, { project: '/not/a/project' }, deps);
        expect(exitCode).toBe(2);
        expect(envelope.error?.code).toBe(SESSION_ERROR_CODE.INVALID_INPUT);
        expect(deps.discoverPreviewSession).not.toHaveBeenCalled();
    });
});

describe('runSessionCommand — --url 直连验证', () => {
    it('identity 不可达/非 cocos-cli:502,不连接 MCP', async () => {
        const { deps, client } = makeDeps({ identity: null });
        const { envelope, exitCode } = await runSessionCommand({ kind: 'info' }, { url: SERVER_URL }, deps);
        expect(exitCode).toBe(1);
        expect(envelope.error?.code).toBe(SESSION_ERROR_CODE.BAD_GATEWAY);
        expect(envelope.error?.reason).toContain('无法验证');
        expect(client.connect).not.toHaveBeenCalled();
    });

    it('protocolVersion 不匹配:426,提示重启 Preview', async () => {
        const { deps } = makeDeps({ identity: makeIdentity({ protocolVersion: 99 }) });
        const { envelope, exitCode } = await runSessionCommand({ kind: 'info' }, { url: SERVER_URL }, deps);
        expect(exitCode).toBe(1);
        expect(envelope.error?.code).toBe(SESSION_ERROR_CODE.VERSION_MISMATCH);
        expect(envelope.error?.reason).toContain('版本不匹配');
        expect(envelope.error?.data).toMatchObject({ remoteProtocolVersion: 99, localProtocolVersion: 1 });
    });

    it('state=starting:409 稍后重试', async () => {
        const { deps } = makeDeps({ identity: makeIdentity({ state: 'starting' }) });
        const { envelope, exitCode } = await runSessionCommand({ kind: 'info' }, { url: SERVER_URL }, deps);
        expect(exitCode).toBe(1);
        expect(envelope.error?.code).toBe(SESSION_ERROR_CODE.STARTING);
    });

    it('验证通过:直连成功,不读 claim', async () => {
        const { deps } = makeDeps();
        const { envelope, exitCode } = await runSessionCommand({ kind: 'info' }, { url: SERVER_URL }, deps);
        expect(exitCode).toBe(0);
        expect(envelope.ok).toBe(true);
        expect(deps.discoverPreviewSession).not.toHaveBeenCalled();
    });

    it('--url 非 loopback:400 usage 错误 exit 2,不发起任何请求(issues/F9)', async () => {
        const { deps } = makeDeps();
        const { envelope, exitCode } = await runSessionCommand(
            { kind: 'info' },
            { url: 'http://192.168.1.10:7456' },
            deps,
        );
        expect(exitCode).toBe(2);
        expect(envelope.error?.code).toBe(SESSION_ERROR_CODE.INVALID_INPUT);
        expect(envelope.error?.reason).toContain('loopback');
        expect(deps.fetchIdentity).not.toHaveBeenCalled();
    });

    it('--url 无法解析或非 http(s):400 usage 错误', async () => {
        const { deps } = makeDeps();
        const { envelope, exitCode } = await runSessionCommand({ kind: 'info' }, { url: 'not-a-url' }, deps);
        expect(exitCode).toBe(2);
        expect(envelope.error?.code).toBe(SESSION_ERROR_CODE.INVALID_INPUT);
        expect(deps.fetchIdentity).not.toHaveBeenCalled();
    });

    it('identity 报告的 serverUrl 非 loopback:拒绝连接,不发起 MCP 握手(issues/F9)', async () => {
        const { deps, client } = makeDeps({
            identity: makeIdentity({ serverUrl: 'http://203.0.113.7:7456' }),
        });
        const { envelope, exitCode } = await runSessionCommand({ kind: 'info' }, { url: SERVER_URL }, deps);
        expect(exitCode).toBe(1);
        expect(envelope.error?.code).toBe(SESSION_ERROR_CODE.BAD_GATEWAY);
        expect(envelope.error?.reason).toContain('loopback');
        expect(client.connect).not.toHaveBeenCalled();
    });

    it('mcpUrl 不信任对端字段:由已验证 serverUrl 本地推导固定 /mcp(issues/F9)', async () => {
        const { deps } = makeDeps({
            identity: makeIdentity({ mcpUrl: 'http://evil.example:9999/mcp' }),
        });
        const { exitCode } = await runSessionCommand({ kind: 'info' }, { url: SERVER_URL }, deps);
        expect(exitCode).toBe(0);
        expect(deps.createMcpClient).toHaveBeenCalledWith(MCP_URL);
    });

    it('identity 可达但 /mcp 404:该 session 不是 editing session(issues/19)', async () => {
        const { deps } = makeDeps({
            client: makeFakeClient({ connectError: new Error('Error POSTing to endpoint (HTTP 404): 404 - Not Found') }),
        });
        const { envelope, exitCode } = await runSessionCommand({ kind: 'list' }, {}, deps);
        expect(exitCode).toBe(1);
        expect(envelope.error?.code).toBe(SESSION_ERROR_CODE.NOT_EDITING_SESSION);
        expect(envelope.error?.reason).toContain('不是 editing session');
        expect(envelope.error?.reason).toContain('--build');
        expect(envelope.session?.sessionId).toBe('session-1');
    });
});

describe('runSessionCommand — list / describe', () => {
    const tools: SessionToolInfo[] = [
        {
            name: 'scene-open',
            description: 'Open a scene.\nMore details here.',
            inputSchema: { type: 'object' },
            outputSchema: { type: 'object' },
        },
        { name: 'scene-save', description: 'Save the scene.' },
    ];

    it('list:command 名 + 一句话描述(取首行)', async () => {
        const { deps } = makeDeps({ client: makeFakeClient({ tools }) });
        const { envelope, exitCode } = await runSessionCommand({ kind: 'list' }, {}, deps);
        expect(exitCode).toBe(0);
        expect(envelope.commands).toEqual([
            { name: 'scene-open', description: 'Open a scene.' },
            { name: 'scene-save', description: 'Save the scene.' },
        ]);
        expect(envelope.session?.sessionId).toBe('session-1');
    });

    it('describe:返回该 command 的 input/output schema(全量 list 后 client 过滤)', async () => {
        const { deps, client } = makeDeps({ client: makeFakeClient({ tools }) });
        const { envelope, exitCode } = await runSessionCommand({ kind: 'describe', name: 'scene-open' }, {}, deps);
        expect(exitCode).toBe(0);
        expect(client.listTools).toHaveBeenCalledTimes(1);
        expect(envelope.command).toEqual({
            name: 'scene-open',
            description: 'Open a scene.',
            inputSchema: { type: 'object' },
            outputSchema: { type: 'object' },
        });
    });

    it('describe unknown tool:404 并附可用 command 列表', async () => {
        const { deps } = makeDeps({ client: makeFakeClient({ tools }) });
        const { envelope, exitCode } = await runSessionCommand({ kind: 'describe', name: 'nope' }, {}, deps);
        expect(exitCode).toBe(1);
        expect(envelope.error?.code).toBe(SESSION_ERROR_CODE.NOT_FOUND);
        expect(envelope.error?.reason).toContain('unknown command');
        expect(envelope.error?.data).toMatchObject({ available: ['scene-open', 'scene-save'] });
        expect(envelope.session?.sessionId).toBe('session-1');
    });

    it('tools/list 失败:502', async () => {
        const { deps } = makeDeps({ client: makeFakeClient({ listError: new Error('fetch failed') }) });
        const { envelope, exitCode } = await runSessionCommand({ kind: 'list' }, {}, deps);
        expect(exitCode).toBe(1);
        expect(envelope.error?.code).toBe(SESSION_ERROR_CODE.BAD_GATEWAY);
        expect(envelope.error?.reason).toContain('tools/list');
    });
});

describe('runSessionCommand — call 与 --input', () => {
    const okResult: SessionToolCallRaw = {
        content: [{ type: 'text', text: '{}' }],
        structuredContent: { result: { code: 200, data: { saved: true } } },
    };

    it('成功:解包 structuredContent.result 原样透传', async () => {
        const { deps, client } = makeDeps({ client: makeFakeClient({ callResult: okResult }) });
        const { envelope, exitCode } = await runSessionCommand(
            { kind: 'call', name: 'scene-save', input: '{"options":{"force":true}}' },
            {},
            deps,
        );
        expect(exitCode).toBe(0);
        expect(envelope.result).toEqual({ code: 200, data: { saved: true } });
        expect(client.callTool).toHaveBeenCalledWith('scene-save', { options: { force: true } });
    });

    it('--input @file:从文件读取 JSON', async () => {
        const { deps, client } = makeDeps({
            client: makeFakeClient({ callResult: okResult }),
            files: { '/tmp/args.json': '{"a":1}' },
        });
        const { exitCode } = await runSessionCommand({ kind: 'call', name: 't', input: '@/tmp/args.json' }, {}, deps);
        expect(exitCode).toBe(0);
        expect(client.callTool).toHaveBeenCalledWith('t', { a: 1 });
    });

    it('--input -:从 stdin 读取 JSON', async () => {
        const { deps, client } = makeDeps({
            client: makeFakeClient({ callResult: okResult }),
            stdin: '{"b":2}',
        });
        const { exitCode } = await runSessionCommand({ kind: 'call', name: 't', input: '-' }, {}, deps);
        expect(exitCode).toBe(0);
        expect(client.callTool).toHaveBeenCalledWith('t', { b: 2 });
    });

    it('--input 缺省:按空对象调用', async () => {
        const { deps, client } = makeDeps({ client: makeFakeClient({ callResult: okResult }) });
        const { exitCode } = await runSessionCommand({ kind: 'call', name: 't' }, {}, deps);
        expect(exitCode).toBe(0);
        expect(client.callTool).toHaveBeenCalledWith('t', {});
    });

    it('--input 非法 JSON:usage 错误 exit 2,不发起 MCP 连接', async () => {
        const { deps, client } = makeDeps();
        const { envelope, exitCode } = await runSessionCommand({ kind: 'call', name: 't', input: '{bad' }, {}, deps);
        expect(exitCode).toBe(2);
        expect(envelope.error?.code).toBe(SESSION_ERROR_CODE.INVALID_INPUT);
        expect(envelope.error?.reason).toContain('JSON');
        expect(envelope.session?.sessionId).toBe('session-1');
        expect(client.connect).not.toHaveBeenCalled();
    });

    it('--input 非 object:usage 错误 exit 2', async () => {
        const { deps } = makeDeps();
        const { envelope, exitCode } = await runSessionCommand({ kind: 'call', name: 't', input: '[1,2]' }, {}, deps);
        expect(exitCode).toBe(2);
        expect(envelope.error?.reason).toContain('JSON object');
    });
});

describe('runSessionCommand — 错误归一化映射', () => {
    it('tool 4xx(structuredContent.result.code=404,isError 未置位):失败并透传 code', async () => {
        const { deps } = makeDeps({
            client: makeFakeClient({
                callResult: { structuredContent: { result: { code: 404, reason: 'scene not found', data: { u: 1 } } } },
            }),
        });
        const { envelope, exitCode } = await runSessionCommand({ kind: 'call', name: 'scene-open' }, {}, deps);
        expect(exitCode).toBe(1);
        expect(envelope.ok).toBe(false);
        expect(envelope.error).toEqual({ code: 404, reason: 'scene not found', data: { u: 1 } });
        expect(envelope.session?.sessionId).toBe('session-1');
    });

    it('tool 5xx(isError=true):失败并透传 code', async () => {
        const { deps } = makeDeps({
            client: makeFakeClient({
                callResult: { isError: true, structuredContent: { result: { code: 500, reason: 'boom' } } },
            }),
        });
        const { envelope, exitCode } = await runSessionCommand({ kind: 'call', name: 't' }, {}, deps);
        expect(exitCode).toBe(1);
        expect(envelope.error?.code).toBe(500);
        expect(envelope.error?.reason).toBe('boom');
    });

    it('isError 但缺 structuredContent.result:500 TOOL_ERROR', async () => {
        const { deps } = makeDeps({
            client: makeFakeClient({ callResult: { isError: true, content: [{ type: 'text', text: 'raw' }] } }),
        });
        const { envelope, exitCode } = await runSessionCommand({ kind: 'call', name: 't' }, {}, deps);
        expect(exitCode).toBe(1);
        expect(envelope.error?.code).toBe(SESSION_ERROR_CODE.TOOL_ERROR);
    });

    it('响应形状非法(无 structuredContent 且无 isError):502', async () => {
        const { deps } = makeDeps({ client: makeFakeClient({ callResult: { content: 'weird' } }) });
        const { envelope, exitCode } = await runSessionCommand({ kind: 'call', name: 't' }, {}, deps);
        expect(exitCode).toBe(1);
        expect(envelope.error?.code).toBe(SESSION_ERROR_CODE.BAD_GATEWAY);
        expect(envelope.error?.reason).toContain('形状非法');
    });

    it('initialize 握手失败:502 并提示重启路径', async () => {
        const { deps } = makeDeps({ client: makeFakeClient({ connectError: new Error('fetch failed') }) });
        const { envelope, exitCode } = await runSessionCommand({ kind: 'info' }, {}, deps);
        expect(exitCode).toBe(1);
        expect(envelope.error?.code).toBe(SESSION_ERROR_CODE.BAD_GATEWAY);
        expect(envelope.error?.reason).toContain('initialize');
        expect(envelope.session?.sessionId).toBe('session-1');
    });

    it('unknown tool(JSON-RPC -32601):404', async () => {
        const { deps } = makeDeps({
            client: makeFakeClient({ callError: Object.assign(new Error('Tool not found'), { code: -32601 }) }),
        });
        const { envelope, exitCode } = await runSessionCommand({ kind: 'call', name: 'nope' }, {}, deps);
        expect(exitCode).toBe(1);
        expect(envelope.error?.code).toBe(SESSION_ERROR_CODE.NOT_FOUND);
        expect(envelope.error?.reason).toContain('unknown command');
    });

    it('Zod 参数错误(JSON-RPC -32602 InvalidParams):400 并提示 describe', async () => {
        const { deps } = makeDeps({
            client: makeFakeClient({
                callError: Object.assign(new Error('Invalid arguments: path: Required'), { code: -32602 }),
            }),
        });
        const { envelope, exitCode } = await runSessionCommand({ kind: 'call', name: 'scene-open' }, {}, deps);
        expect(exitCode).toBe(1);
        expect(envelope.error?.code).toBe(SESSION_ERROR_CODE.INVALID_INPUT);
        expect(envelope.error?.reason).toContain('参数校验失败');
        expect(envelope.error?.reason).toContain('describe');
    });

    it('-32602 但 message 含 not found:按 unknown tool 404 处理', async () => {
        const { deps } = makeDeps({
            client: makeFakeClient({ callError: Object.assign(new Error('Tool nope not found'), { code: -32602 }) }),
        });
        const { envelope } = await runSessionCommand({ kind: 'call', name: 'nope' }, {}, deps);
        expect(envelope.error?.code).toBe(SESSION_ERROR_CODE.NOT_FOUND);
    });

    it('transport 500 / 连接中断(无 JSON-RPC code):502', async () => {
        const { deps } = makeDeps({
            client: makeFakeClient({ callError: new Error('HTTP 500: Internal Server Error') }),
        });
        const { envelope, exitCode } = await runSessionCommand({ kind: 'call', name: 't' }, {}, deps);
        expect(exitCode).toBe(1);
        expect(envelope.error?.code).toBe(SESSION_ERROR_CODE.BAD_GATEWAY);
        expect(envelope.error?.reason).toContain('transport');
    });
});

describe('runSessionCommand — envelope 形状与诊断通道', () => {
    it('成功 envelope 只含 ok/session/结果键;诊断写 log(stderr)', async () => {
        const logs: string[] = [];
        const { deps } = makeDeps({ logs });
        const { envelope } = await runSessionCommand({ kind: 'info' }, {}, deps);
        expect(Object.keys(envelope).sort()).toEqual(['identity', 'ok', 'session']);
        expect(logs.some((line) => line.includes(MCP_URL))).toBe(true);
    });

    it('失败 envelope 只含 ok/error(/session)', async () => {
        const { deps } = makeDeps({ probe: null });
        const { envelope } = await runSessionCommand({ kind: 'info' }, {}, deps);
        expect(Object.keys(envelope).sort()).toEqual(['error', 'ok']);
    });
});
