/**
 * `cocos session` 命令组与 CORS 现状的真实 CLI child process 集成测试
 * (spec Testing Decisions 集成层,issues/18-spec-revision-pack 第 5 条):
 * 4. session info/list/describe/call 契约 —— stdout 单 JSON envelope、诊断在 stderr、
 *    成功 exit 0;无 session / unknown tool / 业务 4xx exit 非零;
 * 5. CORS 通配现状契约 —— identity endpoint 与 /mcp 的 OPTIONS preflight 与 ACAO 头
 *    (守护 issues/14「知情接受」决策,现状被未来改动时本测试显式变红)。
 *
 * 测试层级:Vitest 集成(真实 dist/cli.js child process;一个共享 preview + 多次 session CLI 调用)。
 * fixture:tests/fixtures/projects/asset-operation 的系统 temp 隔离副本
 * (排除 library/temp、改写 cocos-cli.enginePath、补建空 settings/ —— fixture 本身没有
 * settings/,而 session 的 cwd 向上解析要求 package.json + assets/ + settings/ 三标志,
 * 见 src/core/preview-session/project-root.ts;临时副本调整,不改 production 行为)。
 * 环境变量:harness 要求 COCOS_CLI_TEST_ENGINE_ROOT(vitest.config.ts);
 * 被测 child process 一律不注入 COCOS_CLI_TEST_*(productionChildEnv /
 * useTestEnvironment:false 先例)。
 * 前置:必须先 npm run compile 构建 dist。
 * 不能证明:真实业务项目行为;CORS 加固后的目标形态(本测试锁定的是现状通配)。
 */
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  startRuntimePreviewCliProcess,
  type StartedRuntimePreviewCliProcess,
} from '@shared/runtime-preview-cli-process';
import {
  createIsolatedProjectCopy,
  findAvailablePort,
  runCliCommand,
  type IsolatedProjectCopy,
} from '@shared/preview-session-cli-fixture';

const repoRoot = join(process.cwd(), '..');
// 与项目无关的跨源 Origin,用于 CORS 现状断言。
const CROSS_ORIGIN = 'https://cross-origin.example';

interface SessionEnvelope {
  ok: boolean;
  session?: { sessionId: string; projectRoot: string; serverUrl: string };
  identity?: { sessionId: string; state: string; serverUrl: string; mcpUrl: string; protocolVersion: number };
  commands?: Array<{ name: string; description: string }>;
  command?: { name: string; description: string; inputSchema?: unknown; outputSchema?: unknown };
  result?: { code: number; reason?: string; data?: unknown };
  error?: { code: number; reason: string; data?: unknown };
}

// stdout 必须恰好是一个可解析的 JSON envelope(诊断只允许出现在 stderr)。
function parseEnvelope(stdout: string): SessionEnvelope {
  return JSON.parse(stdout) as SessionEnvelope;
}

describe('cocos session commands + CORS status quo (real CLI child processes)', () => {
  let copy: IsolatedProjectCopy;
  let cli: StartedRuntimePreviewCliProcess;

  beforeAll(async () => {
    const engineRoot = process.env.COCOS_CLI_TEST_ENGINE_ROOT;
    if (!engineRoot) {
      throw new Error('Vitest harness must provide COCOS_CLI_TEST_ENGINE_ROOT.');
    }
    copy = await createIsolatedProjectCopy(repoRoot, engineRoot, { withSettingsDir: true });
    const port = await findAvailablePort(20160);
    cli = await startRuntimePreviewCliProcess({
      repoRoot,
      projectRoot: copy.projectRoot,
      engineRoot,
      host: '127.0.0.1',
      port,
      startupTimeoutMs: 180_000,
      useRuntimeFlag: false,
      useTestEnvironment: false,
      noOpen: true,
    });
  }, 300_000);

  afterAll(async () => {
    const closeResult = cli ? await cli.close() : null;
    expect(closeResult?.portReleased ?? true).toBe(true);
    await copy?.cleanup();
  });

  it('session info/list/describe/call from a project subdirectory: single JSON envelope on stdout, exit 0', async () => {
    // 从项目子目录执行,走 cwd 向上解析 + 自动发现(不传 --project/--url)。
    const subdir = join(copy.projectRoot, 'assets');

    const info = await runCliCommand(repoRoot, ['session', 'info'], { cwd: subdir });
    expect(info.exitCode, `stdout:\n${info.stdout}\nstderr:\n${info.stderr}`).toBe(0);
    const infoEnvelope = parseEnvelope(info.stdout);
    expect(infoEnvelope.ok).toBe(true);
    expect(infoEnvelope.session?.sessionId).toBeTruthy();
    expect(infoEnvelope.session?.serverUrl?.replace(/\/$/, '')).toBe(cli.url.replace(/\/$/, ''));
    expect(infoEnvelope.identity?.state).toBe('ready');
    expect(infoEnvelope.identity?.sessionId).toBe(infoEnvelope.session?.sessionId);
    expect(infoEnvelope.identity?.mcpUrl?.replace(/\/$/, '')).toBe(`${cli.url.replace(/\/$/, '')}/mcp`);
    // 诊断/进度写 stderr。
    expect(info.stderr).toContain('connecting to');

    const list = await runCliCommand(repoRoot, ['session', 'list'], { cwd: subdir });
    expect(list.exitCode, `stdout:\n${list.stdout}\nstderr:\n${list.stderr}`).toBe(0);
    const listEnvelope = parseEnvelope(list.stdout);
    expect(listEnvelope.ok).toBe(true);
    const commandNames = listEnvelope.commands?.map((command) => command.name) ?? [];
    expect(commandNames).toEqual(expect.arrayContaining([
      'scene-create',
      'scene-open',
      'scene-query-current',
      'scene-save',
    ]));
    for (const command of listEnvelope.commands ?? []) {
      expect(typeof command.description).toBe('string');
    }

    const describeResult = await runCliCommand(repoRoot, ['session', 'describe', 'scene-query-current'], { cwd: subdir });
    expect(describeResult.exitCode, `stdout:\n${describeResult.stdout}\nstderr:\n${describeResult.stderr}`).toBe(0);
    const describeEnvelope = parseEnvelope(describeResult.stdout);
    expect(describeEnvelope.ok).toBe(true);
    expect(describeEnvelope.command?.name).toBe('scene-query-current');
    expect(typeof describeEnvelope.command?.description).toBe('string');

    const call = await runCliCommand(
      repoRoot,
      [
        'session',
        'call',
        'scene-create',
        '--input',
        JSON.stringify({ options: { baseName: 'session-cli-contract', dbURL: 'db://assets', templateType: '2d' } }),
      ],
      { cwd: subdir, timeoutMs: 180_000 },
    );
    expect(call.exitCode, `stdout:\n${call.stdout}\nstderr:\n${call.stderr}`).toBe(0);
    const callEnvelope = parseEnvelope(call.stdout);
    expect(callEnvelope.ok).toBe(true);
    expect(typeof callEnvelope.result?.code).toBe('number');
    expect(callEnvelope.result!.code).toBeLessThan(400);
    const created = callEnvelope.result?.data as { assetUrl?: string; assetUuid?: string } | undefined;
    expect(created?.assetUrl).toBe('db://assets/session-cli-contract.scene');
    expect(created?.assetUuid).toBeTruthy();
  }, 360_000);

  it('failure paths exit non-zero with a single JSON error envelope: no session, unknown tool, business 4xx', async () => {
    const subdir = join(copy.projectRoot, 'assets');

    // 无 session:另一个没有运行 preview 的项目副本。
    const idleCopy = await createIsolatedProjectCopy(repoRoot, process.env.COCOS_CLI_TEST_ENGINE_ROOT!, { withSettingsDir: true });
    try {
      const noSession = await runCliCommand(repoRoot, ['session', 'info'], { cwd: join(idleCopy.projectRoot, 'assets') });
      expect(noSession.exitCode).not.toBe(0);
      const noSessionEnvelope = parseEnvelope(noSession.stdout);
      expect(noSessionEnvelope.ok).toBe(false);
      expect(noSessionEnvelope.error?.code).toBe(404);
      expect(noSessionEnvelope.error?.reason).toContain('没有运行中的 Preview');
    } finally {
      await idleCopy.cleanup();
    }

    // unknown tool(describe):404 + data.available。
    const unknownDescribe = await runCliCommand(repoRoot, ['session', 'describe', 'definitely-not-a-tool'], { cwd: subdir });
    expect(unknownDescribe.exitCode).not.toBe(0);
    const unknownDescribeEnvelope = parseEnvelope(unknownDescribe.stdout);
    expect(unknownDescribeEnvelope.ok).toBe(false);
    expect(unknownDescribeEnvelope.error?.code).toBe(404);
    expect(unknownDescribeEnvelope.error?.reason).toContain('unknown command');

    // unknown tool(call):-32601 归一化为 404。
    const unknownCall = await runCliCommand(repoRoot, ['session', 'call', 'definitely-not-a-tool'], { cwd: subdir, timeoutMs: 180_000 });
    expect(unknownCall.exitCode).not.toBe(0);
    const unknownCallEnvelope = parseEnvelope(unknownCall.stdout);
    expect(unknownCallEnvelope.ok).toBe(false);
    expect(unknownCallEnvelope.error?.code).toBe(404);

    // 业务 4xx:打开不存在的 scene,CommonResult.code >= 400 原样透传。
    const businessError = await runCliCommand(
      repoRoot,
      [
        'session',
        'call',
        'scene-open',
        '--input',
        JSON.stringify({ options: { dbURLOrUUID: 'db://assets/definitely-missing-scene-cli.scene' } }),
      ],
      { cwd: subdir, timeoutMs: 180_000 },
    );
    expect(businessError.exitCode, `stdout:\n${businessError.stdout}\nstderr:\n${businessError.stderr}`).not.toBe(0);
    const businessEnvelope = parseEnvelope(businessError.stdout);
    expect(businessEnvelope.ok).toBe(false);
    expect(typeof businessEnvelope.error?.code).toBe('number');
    expect(businessEnvelope.error!.code).toBeGreaterThanOrEqual(400);
  }, 360_000);

  it('CORS wildcard status quo: OPTIONS preflight 204 + Access-Control-Allow-Origin * on identity and /mcp', async () => {
    // 现状契约(issues/14 知情接受):serverService 全局挂载 cors middleware
    // (src/server/utils/cors.ts),全部响应 ACAO:*,preflight 直接 204。
    const preflightIdentity = await fetch(`${cli.url}/__cocos-cli/session`, {
      method: 'OPTIONS',
      headers: {
        Origin: CROSS_ORIGIN,
        'Access-Control-Request-Method': 'GET',
      },
    });
    expect(preflightIdentity.status).toBe(204);
    expect(preflightIdentity.headers.get('access-control-allow-origin')).toBe('*');

    const preflightMcp = await fetch(`${cli.url}/mcp`, {
      method: 'OPTIONS',
      headers: {
        Origin: CROSS_ORIGIN,
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'content-type',
      },
    });
    expect(preflightMcp.status).toBe(204);
    expect(preflightMcp.headers.get('access-control-allow-origin')).toBe('*');
    expect(preflightMcp.headers.get('access-control-allow-methods')).toContain('POST');

    const identityResponse = await fetch(`${cli.url}/__cocos-cli/session`, {
      headers: { Origin: CROSS_ORIGIN },
    });
    expect(identityResponse.status).toBe(200);
    expect(identityResponse.headers.get('access-control-allow-origin')).toBe('*');

    // 跨源 POST /mcp 同样携带 ACAO:*(任意网页可驱动本机 session 的现状)。
    const mcpResponse = await fetch(`${cli.url}/mcp`, {
      method: 'POST',
      headers: {
        Origin: CROSS_ORIGIN,
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'cors-status-quo-probe', version: '0.0.0' },
        },
      }),
    });
    expect(mcpResponse.headers.get('access-control-allow-origin')).toBe('*');
  }, 60_000);
});
