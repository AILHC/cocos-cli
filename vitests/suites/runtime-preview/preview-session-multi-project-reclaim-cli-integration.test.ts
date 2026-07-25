/**
 * Preview session ownership 补缺口(review-impl-20260724.md 发现 10)的真实 CLI
 * child process 集成测试:
 * 1. 不同项目并行 owner —— 两个隔离副本同时 preview,各自 acquire 成功、claim 独立、
 *    URL/sessionId/PID 各自不同、互不拒绝;`cocos session info --project` 各自返回
 *    各自项目的 identity(不串台);关闭后各自 claim 按平台语义释放/残留。
 * 2. reclaimer 驱动的 stale 回收(非测试代杀)—— seed 一个 ready 态 claim,owner PID
 *    是存活的 dummy 进程、serverUrl 指向未监听端口(unreachable-owner-alive);随后
 *    真实运行 dist/cli.js preview:第二个进程作为 reclaimer 对该 dummy PID 发终止
 *    (Windows 为 terminateTree/taskkill,POSIX 为 SIGTERM)、死亡确认后回收旧 claim、
 *    自己成为新 owner(ready、新 sessionId、identity 200、单 scene PID),dummy 确实已死。
 * 3. 变体(POSIX only,Windows skip)—— dummy trap SIGTERM 杀不掉:回收超时 fail closed,
 *    非零退出、claim 原样保留、dummy 仍存活。Windows 上 taskkill /F /T 对同用户 node
 *    进程不可抵抗,无法构造「杀不掉」的稳定 fixture,故跳过(规范允许)。
 *
 * 测试层级:Vitest 集成(真实 dist/cli.js child process)。
 * fixture:tests/fixtures/projects/asset-operation 的系统 temp 隔离副本
 * (排除 library/temp、改写 cocos-cli.enginePath;场景 1 补建空 settings/ 供
 * `cocos session --project` 的向上解析三标志;内置小 fixture 的临时副本)。
 * 环境变量:harness 要求 COCOS_CLI_TEST_ENGINE_ROOT(vitest.config.ts);
 * 被测 child process 一律不注入 COCOS_CLI_TEST_*(productionChildEnv /
 * useTestEnvironment:false 先例),engine root 仅从副本 package.json 解析。
 * 前置:必须先 npm run compile 构建 dist。
 * 能证明:ownership/回收协议在真实 dist CLI 进程间的跨项目隔离与 unreachable-owner-alive
 * 回收路径(含 dummy 进程真实死亡);session info 按项目独立发现。
 * 不能证明:真实业务项目行为;Windows 上「杀不掉」形态的 fail closed(平台无稳定 fixture,
 * 该分支由 R1 Jest 单测 reclaim.test.ts 注入 deps 覆盖);browser runtime ready。
 */
import { spawn } from 'node:child_process';
import { realpath } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  startRuntimePreviewCliProcess,
  type StartedRuntimePreviewCliProcess,
} from '@shared/runtime-preview-cli-process';
import {
  createIsolatedProjectCopy,
  findAvailablePort,
  listPreviewSessionClaimDirs,
  runCliCommand,
  SCENE_PROCESS_START_PATTERN,
  seedReadyClaim,
  spawnRawPreviewCli,
} from '@shared/preview-session-cli-fixture';
import {
  parseClaimDirName,
  PREVIEW_SESSION_PROTOCOL_VERSION,
} from '../../../src/core/preview-session';

const repoRoot = join(process.cwd(), '..');

function engineRootOrThrow(): string {
  const engineRoot = process.env.COCOS_CLI_TEST_ENGINE_ROOT;
  if (!engineRoot) {
    throw new Error('Vitest harness must provide COCOS_CLI_TEST_ENGINE_ROOT.');
  }
  return engineRoot;
}

function count(source: string, pattern: RegExp): number {
  return source.match(pattern)?.length ?? 0;
}

// 与 src/core/preview-session/deps.ts 的 isAlive 同语义:signal 0 探测,EPERM 视为存活。
function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

async function fetchIdentity(url: string): Promise<{ sessionId: string; state: string; projectRoot: string }> {
  const response = await fetch(`${url}/__cocos-cli/session`);
  expect(response.status).toBe(200);
  return await response.json() as { sessionId: string; state: string; projectRoot: string };
}

interface SessionEnvelope {
  ok: boolean;
  session?: { sessionId: string; projectRoot: string; serverUrl: string };
  identity?: { sessionId: string; state: string; serverUrl: string };
  error?: { code: number; reason: string };
}

function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

describe('preview session multi-project + reclaimer-driven reclaim (real CLI child processes)', () => {
  it('parallel owners on different projects: independent claims, no cross-project rejection, per-project session info', async () => {
    const engineRoot = engineRootOrThrow();
    // withSettingsDir:`cocos session --project` 的向上解析要求 package.json + assets/ + settings/。
    const copyA = await createIsolatedProjectCopy(repoRoot, engineRoot, { withSettingsDir: true });
    const copyB = await createIsolatedProjectCopy(repoRoot, engineRoot, { withSettingsDir: true });
    let cliA: StartedRuntimePreviewCliProcess | null = null;
    let cliB: StartedRuntimePreviewCliProcess | null = null;
    try {
      const portA = await findAvailablePort(20260);
      const portB = await findAvailablePort(20310);
      // 两个不同项目并发启动:互不共享 temp/cli,谁也不得被对方拒绝。
      [cliA, cliB] = await Promise.all([
        startRuntimePreviewCliProcess({
          repoRoot,
          projectRoot: copyA.projectRoot,
          engineRoot,
          host: '127.0.0.1',
          port: portA,
          startupTimeoutMs: 240_000,
          useRuntimeFlag: false,
          useTestEnvironment: false,
          noOpen: true,
        }),
        startRuntimePreviewCliProcess({
          repoRoot,
          projectRoot: copyB.projectRoot,
          engineRoot,
          host: '127.0.0.1',
          port: portB,
          startupTimeoutMs: 240_000,
          useRuntimeFlag: false,
          useTestEnvironment: false,
          noOpen: true,
        }),
      ]);
      // 双方各自 acquire 成功(helper 只在 preview:ready 后 resolve)且都存活、互不拒绝。
      expect(cliA.child.exitCode).toBeNull();
      expect(cliB.child.exitCode).toBeNull();
      expect(cliA.child.signalCode).toBeNull();
      expect(cliB.child.signalCode).toBeNull();

      // 各自 temp/cli 下恰好一个 claim,sessionId 互不相同。
      const claimsA = await listPreviewSessionClaimDirs(copyA.projectRoot);
      const claimsB = await listPreviewSessionClaimDirs(copyB.projectRoot);
      expect(claimsA).toHaveLength(1);
      expect(claimsB).toHaveLength(1);

      const identityA = await fetchIdentity(cliA.url);
      const identityB = await fetchIdentity(cliB.url);
      expect(identityA.state).toBe('ready');
      expect(identityB.state).toBe('ready');
      expect(claimsA[0]).toContain(identityA.sessionId);
      expect(claimsB[0]).toContain(identityB.sessionId);
      expect(identityA.sessionId).not.toBe(identityB.sessionId);

      // URL 不同、owner PID 不同、各自恰好一个 scene process。
      expect(stripTrailingSlash(cliA.url)).not.toBe(stripTrailingSlash(cliB.url));
      expect(cliA.pid).not.toBe(cliB.pid);
      expect(parseClaimDirName(claimsA[0])?.pid).toBe(cliA.pid);
      expect(parseClaimDirName(claimsB[0])?.pid).toBe(cliB.pid);
      expect(count(cliA.stdout, SCENE_PROCESS_START_PATTERN)).toBe(1);
      expect(count(cliB.stdout, SCENE_PROCESS_START_PATTERN)).toBe(1);

      // `cocos session info --project` 各自返回各自项目的 identity,互不串台。
      const canonicalA = resolve(await realpath(copyA.projectRoot));
      const canonicalB = resolve(await realpath(copyB.projectRoot));
      const infoA = await runCliCommand(repoRoot, ['session', 'info', '--project', copyA.projectRoot], { cwd: repoRoot });
      expect(infoA.exitCode, `stdout:\n${infoA.stdout}\nstderr:\n${infoA.stderr}`).toBe(0);
      const envelopeA = JSON.parse(infoA.stdout) as SessionEnvelope;
      expect(envelopeA.ok).toBe(true);
      expect(envelopeA.session?.sessionId).toBe(identityA.sessionId);
      expect(envelopeA.session?.projectRoot).toBe(canonicalA);
      expect(stripTrailingSlash(envelopeA.session?.serverUrl ?? '')).toBe(stripTrailingSlash(cliA.url));
      expect(envelopeA.identity?.state).toBe('ready');

      const infoB = await runCliCommand(repoRoot, ['session', 'info', '--project', copyB.projectRoot], { cwd: repoRoot });
      expect(infoB.exitCode, `stdout:\n${infoB.stdout}\nstderr:\n${infoB.stderr}`).toBe(0);
      const envelopeB = JSON.parse(infoB.stdout) as SessionEnvelope;
      expect(envelopeB.ok).toBe(true);
      expect(envelopeB.session?.sessionId).toBe(identityB.sessionId);
      expect(envelopeB.session?.projectRoot).toBe(canonicalB);
      expect(stripTrailingSlash(envelopeB.session?.serverUrl ?? '')).toBe(stripTrailingSlash(cliB.url));
      expect(envelopeB.identity?.state).toBe('ready');

      // 关闭:各自 claim 按平台语义处理——POSIX 优雅 close 自行释放(claim 清空);
      // Windows SIGTERM 硬杀,claim 残留但 owner PID 必死(confirmed-dead,可被下次
      // preview 回收,不阻塞任何一方)。
      const closeA = await cliA.close();
      const closeB = await cliB.close();
      expect(closeA.portReleased).toBe(true);
      expect(closeB.portReleased).toBe(true);
      for (const [projectRoot, label] of [[copyA.projectRoot, 'A'], [copyB.projectRoot, 'B']] as const) {
        const remaining = await listPreviewSessionClaimDirs(projectRoot);
        if (process.platform === 'win32') {
          for (const name of remaining) {
            const parsed = parseClaimDirName(name);
            expect(parsed, `stale claim ${name} of project ${label} must parse`).toBeTruthy();
            expect(isPidAlive(parsed!.pid), `stale claim ${name} of project ${label} must reference a dead PID`).toBe(false);
          }
        } else {
          expect(remaining, `project ${label} claim must be released after graceful close`).toEqual([]);
        }
      }
      cliA = null;
      cliB = null;
    } finally {
      const lateCloseA = cliA ? await cliA.close() : null;
      const lateCloseB = cliB ? await cliB.close() : null;
      expect(lateCloseA?.portReleased ?? true).toBe(true);
      expect(lateCloseB?.portReleased ?? true).toBe(true);
      await copyA.cleanup();
      await copyB.cleanup();
    }
  }, 600_000);

  it('reclaimer-driven stale reclaim: ready claim with unreachable endpoint and alive dummy PID is terminated then reclaimed', async () => {
    const engineRoot = engineRootOrThrow();
    const copy = await createIsolatedProjectCopy(repoRoot, engineRoot);
    // 存活 dummy 进程充当「PID 活但 endpoint 不可达」的 stale owner。
    const dummy = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
    expect(dummy.pid).toBeTruthy();
    let cli: StartedRuntimePreviewCliProcess | null = null;
    try {
      expect(isPidAlive(dummy.pid!)).toBe(true);
      // serverUrl 指向确认空闲(未监听)的端口:identity 探测 ECONNREFUSED → unreachable-owner-alive。
      const deadPort = await findAvailablePort(20360);
      const seeded = await seedReadyClaim(
        copy.projectRoot,
        dummy.pid!,
        `http://127.0.0.1:${deadPort}`,
        PREVIEW_SESSION_PROTOCOL_VERSION,
      );
      expect(await listPreviewSessionClaimDirs(copy.projectRoot)).toEqual([basename(seeded.claimDir)]);

      // 真实运行 dist/cli.js preview:作为 reclaimer 终止 dummy、死亡确认后回收 claim、自己成为新 owner。
      const port = await findAvailablePort(20410);
      cli = await startRuntimePreviewCliProcess({
        repoRoot,
        projectRoot: copy.projectRoot,
        engineRoot,
        host: '127.0.0.1',
        port,
        startupTimeoutMs: 240_000,
        useRuntimeFlag: false,
        useTestEnvironment: false,
        noOpen: true,
      });

      // 死亡确认先于 claim 删除、先于 acquire 成功:ready 时 dummy 必然已死。
      expect(isPidAlive(dummy.pid!), 'reclaimer must have terminated the dummy owner process').toBe(false);

      // 旧 claim 被回收;新 owner ready、新 sessionId、identity 200、单 scene PID。
      const identity = await fetchIdentity(cli.url);
      expect(identity.state).toBe('ready');
      expect(identity.sessionId).not.toBe(seeded.sessionId);
      const claims = await listPreviewSessionClaimDirs(copy.projectRoot);
      expect(claims).toHaveLength(1);
      expect(claims[0]).toContain(identity.sessionId);
      expect(claims[0]).not.toContain(seeded.sessionId);
      const parsed = parseClaimDirName(claims[0]);
      expect(parsed?.pid).toBe(cli.pid);
      expect(parsed?.pid).not.toBe(dummy.pid);
      expect(count(cli.stdout, SCENE_PROCESS_START_PATTERN)).toBe(1);
    } finally {
      // 测试失败时兜底清理 dummy,避免泄漏长命进程。
      if (dummy.pid && isPidAlive(dummy.pid)) {
        dummy.kill('SIGKILL');
      }
      const closeResult = cli ? await cli.close() : null;
      expect(closeResult?.portReleased ?? true).toBe(true);
      await copy.cleanup();
    }
  }, 420_000);

  // Windows 上 terminateTree 是 taskkill /F /T,同用户 node 进程无法抵抗,
  // 构造不出「杀不掉」的稳定 fixture,按规范跳过;POSIX 用 trap SIGTERM 的 dummy 验证。
  it.skipIf(process.platform === 'win32')(
    'unkillable owner (SIGTERM trapped): reclaim times out, fail closed, claim left untouched',
    async () => {
      const engineRoot = engineRootOrThrow();
      const copy = await createIsolatedProjectCopy(repoRoot, engineRoot);
      const dummy = spawn(
        process.execPath,
        ['-e', "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)"],
        { stdio: 'ignore' },
      );
      expect(dummy.pid).toBeTruthy();
      try {
        const deadPort = await findAvailablePort(20460);
        const seeded = await seedReadyClaim(
          copy.projectRoot,
          dummy.pid!,
          `http://127.0.0.1:${deadPort}`,
          PREVIEW_SESSION_PROTOCOL_VERSION,
        );

        const port = await findAvailablePort(20510);
        const failClosed = spawnRawPreviewCli({ repoRoot, projectRoot: copy.projectRoot, port });
        try {
          // POSIX 回收等待 SIGTERM 死亡确认,默认超时 10s 后 fail closed。
          const exit = await failClosed.waitForExit(120_000);
          expect(exit.exitCode).not.toBe(0);
          expect(failClosed.stderr).toMatch(
            /Timed out waiting for preview process \(PID \d+\) to exit after termination/,
          );
          expect(failClosed.stderr).toContain('the existing claim was left untouched');
          expect(failClosed.stdout).not.toContain('server:listening');
          // fail closed:不接管、不删 claim;dummy 仍存活。
          expect(await listPreviewSessionClaimDirs(copy.projectRoot)).toEqual([basename(seeded.claimDir)]);
          expect(isPidAlive(dummy.pid!)).toBe(true);
        } finally {
          await failClosed.close();
        }
      } finally {
        dummy.kill('SIGKILL');
        await copy.cleanup();
      }
    },
    240_000,
  );
});
