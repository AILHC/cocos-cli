/**
 * `cocos session` 命令组的 usage error JSON envelope 契约测试(issues/F8)。
 *
 * 测试层级:Vitest 集成(真实 dist/cli.js child process,短生命周期调用)。
 * fixture:不需要项目与 engine——usage 错误在 commander 解析阶段即返回,
 * --url 非 loopback 在 runner 早期返回,均不触达项目/engine/静态资源。
 * 环境变量:child process 不注入 COCOS_CLI_TEST_*(productionChildEnv);
 * harness 的 COCOS_CLI_TEST_ENGINE_ROOT 仅 vitest.config.ts 全局要求,本测试不消费。
 * 前置:dist 由 `npx tsc -b` 产物即可(不依赖 build:static-web 等完整 compile 产物)。
 * 能证明:缺 <name>、缺 option value、未知参数、未知子命令、非 loopback --url
 * 均在 stdout 输出单个 {ok:false,error:{code:400,...}} envelope 并 exit 2;
 * help 语义不变(exit 0、stdout 为帮助文本而非 JSON)。
 * 不能证明:需要真实 session 的 runner 分支(见 session-command-cli-integration.test.ts)。
 */
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runCliCommand } from '@shared/preview-session-cli-fixture';

const repoRoot = join(process.cwd(), '..');

interface UsageEnvelope {
  ok: boolean;
  error?: { code: number; reason: string; data?: unknown };
}

async function expectUsageEnvelope(args: string[]): Promise<UsageEnvelope> {
  const result = await runCliCommand(repoRoot, args, { cwd: repoRoot, timeoutMs: 60_000 });
  expect(result.exitCode, `args=${args.join(' ')}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`).toBe(2);
  const envelope = JSON.parse(result.stdout) as UsageEnvelope;
  expect(envelope.ok).toBe(false);
  expect(envelope.error?.code).toBe(400);
  expect(envelope.error?.reason).toBeTruthy();
  return envelope;
}

describe('cocos session usage errors emit a JSON envelope on stdout with exit 2 (F8)', () => {
  it('missing <name>: session call / session describe', async () => {
    const call = await expectUsageEnvelope(['session', 'call']);
    expect(call.error?.reason).toContain('name');
    await expectUsageEnvelope(['session', 'describe']);
  }, 120_000);

  it('missing option value: session call scene-save --input', async () => {
    await expectUsageEnvelope(['session', 'call', 'scene-save', '--input']);
  }, 120_000);

  it('unknown option: session info --wat', async () => {
    await expectUsageEnvelope(['session', 'info', '--wat']);
  }, 120_000);

  it('unknown subcommand: session foo', async () => {
    await expectUsageEnvelope(['session', 'foo']);
  }, 120_000);

  it('non-loopback --url: runner 层 400 envelope,exit 2(issues/F9)', async () => {
    const envelope = await expectUsageEnvelope(['session', 'info', '--url', 'http://192.168.1.10:7456']);
    expect(envelope.error?.reason).toContain('loopback');
  }, 120_000);

  it('--project 与 --url 同给:互斥 400 envelope,exit 2', async () => {
    const envelope = await expectUsageEnvelope([
      'session', 'info', '--project', '/x', '--url', 'http://127.0.0.1:7456',
    ]);
    expect(envelope.error?.reason).toContain('互斥');
  }, 120_000);

  it('help semantics unchanged: session --help / session call --help exit 0 with help text', async () => {
    const groupHelp = await runCliCommand(repoRoot, ['session', '--help'], { cwd: repoRoot, timeoutMs: 60_000 });
    expect(groupHelp.exitCode, `stderr:\n${groupHelp.stderr}`).toBe(0);
    expect(groupHelp.stdout).toContain('Usage');
    expect(() => JSON.parse(groupHelp.stdout)).toThrow();

    const callHelp = await runCliCommand(repoRoot, ['session', 'call', '--help'], { cwd: repoRoot, timeoutMs: 60_000 });
    expect(callHelp.exitCode, `stderr:\n${callHelp.stderr}`).toBe(0);
    expect(callHelp.stdout).toContain('Usage');
  }, 120_000);
});
