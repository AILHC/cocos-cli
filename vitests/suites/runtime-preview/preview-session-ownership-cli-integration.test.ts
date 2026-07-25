/**
 * Preview session ownership 的真实 CLI child process 集成测试(spec Testing Decisions
 * 集成层,issues/18-spec-revision-pack 第 5 条):
 * 1. 真双进程并发启动竞争 claim —— 只有一个成为 owner,另一个按分支退出,绝无双 writable backend;
 * 2. stale recovery(SIGTERM 非 SIGKILL)—— 死亡确认语义下重启,新 sessionId 发布、旧 claim 回收;
 * 3. draining 窗口验活 —— claim 未释放时 fail closed,释放后新 preview 不报错接管。
 *
 * 测试层级:Vitest 集成(真实 dist/cli.js child process)。
 * fixture:tests/fixtures/projects/asset-operation 的系统 temp 隔离副本
 * (排除 library/temp、改写 cocos-cli.enginePath;内置小 fixture 的临时副本)。
 * 环境变量:harness 要求 COCOS_CLI_TEST_ENGINE_ROOT(vitest.config.ts);
 * 被测 child process 一律不注入 COCOS_CLI_TEST_*(productionChildEnv /
 * useTestEnvironment:false 先例),engine root 仅从副本 package.json 解析。
 * 前置:必须先 npm run compile 构建 dist。
 * 不能证明:真实业务项目行为;unreachable-owner-alive 的 SIGTERM+死亡确认回收路径
 * (该路径需要「进程存活但 endpoint 不可达」的形态,由 T1 Jest 单测覆盖)。
 */
import { spawn } from 'node:child_process';
import { basename } from 'node:path';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { startRuntimePreviewCliProcess, type StartedRuntimePreviewCliProcess } from '@shared/runtime-preview-cli-process';
import {
  createIsolatedProjectCopy,
  findAvailablePort,
  listPreviewSessionClaimDirs,
  PREVIEW_READY_MARKER,
  removeClaimDirFully,
  SCENE_PROCESS_START_PATTERN,
  seedDrainingClaim,
  serverUrlOf,
  spawnRawPreviewCli,
  wait,
  waitUntil,
  type RawPreviewCliProcess,
} from '@shared/preview-session-cli-fixture';
import { PREVIEW_SESSION_PROTOCOL_VERSION } from '../../../src/core/preview-session';

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

async function fetchIdentity(url: string): Promise<{ sessionId: string; state: string; projectRoot: string }> {
  const response = await fetch(`${url}/__cocos-cli/session`);
  expect(response.status).toBe(200);
  return await response.json() as { sessionId: string; state: string; projectRoot: string };
}

describe('preview session ownership (real CLI child processes)', () => {
  it('concurrent startup: at most one owner, loser exits per branch, never two scene backends', async () => {
    const engineRoot = engineRootOrThrow();
    const copy = await createIsolatedProjectCopy(repoRoot, engineRoot);
    const raws: RawPreviewCliProcess[] = [];
    let survivor: StartedRuntimePreviewCliProcess | null = null;
    try {
      const portA = await findAvailablePort(19810);
      const portB = await findAvailablePort(19860);
      // 几乎同时启动两个 preview(错开 500ms,覆盖 claim 竞争窗口)。
      raws.push(spawnRawPreviewCli({ repoRoot, projectRoot: copy.projectRoot, port: portA }));
      await wait(500);
      raws.push(spawnRawPreviewCli({ repoRoot, projectRoot: copy.projectRoot, port: portB }));

      // 等每个进程要么 ready 要么退出。
      const settled = await waitUntil(
        () => raws.every((p) => p.exited || p.stdout.includes(PREVIEW_READY_MARKER)),
        240_000,
        500,
      );
      expect(
        settled,
        `preview processes did not settle.\nA stdout:\n${raws[0].stdout}\nA stderr:\n${raws[0].stderr}` +
          `\nB stdout:\n${raws[1].stdout}\nB stderr:\n${raws[1].stderr}`,
      ).toBe(true);

      const winners = raws.filter((p) => p.stdout.includes(PREVIEW_READY_MARKER));
      // 核心不变量:绝不允许双 owner / 双 writable backend。
      expect(winners.length).toBeLessThanOrEqual(1);
      expect(count(raws[0].stdout, SCENE_PROCESS_START_PATTERN) + count(raws[1].stdout, SCENE_PROCESS_START_PATTERN))
        .toBeLessThanOrEqual(1);

      let ownerStdout: string;
      let ownerUrl: string;
      if (winners.length === 0) {
        // fail-safe 双方让位(spec/ownership.ts:竞争落空时双方都可能让位,由调用方重试)。
        // 两个进程都必须按 conflict 非零退出;随后单独重试必须成功。
        for (const p of raws) {
          expect(p.exited).toBe(true);
          expect(p.exitCode).not.toBe(0);
          expect(p.stderr).toMatch(/no surviving claim|retry the command/);
        }
        const retryPort = await findAvailablePort(19910);
        survivor = await startRuntimePreviewCliProcess({
          repoRoot,
          projectRoot: copy.projectRoot,
          engineRoot,
          host: '127.0.0.1',
          port: retryPort,
          startupTimeoutMs: 180_000,
          useRuntimeFlag: false,
          useTestEnvironment: false,
          noOpen: true,
        });
        ownerStdout = survivor.stdout;
        ownerUrl = survivor.url;
      } else {
        const winner = winners[0];
        const loser = raws.find((p) => p !== winner)!;
        expect(loser.exited).toBe(true);
        // loser 不得产生第二个 scene process。
        expect(count(loser.stdout, SCENE_PROCESS_START_PATTERN)).toBe(0);
        expect(loser.stdout).not.toContain(PREVIEW_READY_MARKER);
        if (loser.exitCode === 0) {
          // live-compatible + ready 分支:报 URL,exit 0。
          expect(loser.stdout).toContain('A preview session is already running');
          expect(loser.stdout).toMatch(/URL: http:\/\//);
        } else {
          // starting / 竞争 conflict 分支:非零退出。
          expect(loser.exitCode).not.toBe(0);
          expect(loser.stderr).toMatch(
            /still starting|no surviving claim|claimed the preview session|already owns|incompatible protocol/,
          );
        }
        ownerStdout = winner.stdout;
        ownerUrl = serverUrlOf(winner.stdout)!;
        expect(ownerUrl).toBeTruthy();
      }

      // owner 只有一个 scene process;identity endpoint 与唯一 claim 对应。
      expect(count(ownerStdout, SCENE_PROCESS_START_PATTERN)).toBe(1);
      const identity = await fetchIdentity(ownerUrl);
      expect(identity.state).toBe('ready');
      const claims = await listPreviewSessionClaimDirs(copy.projectRoot);
      expect(claims).toHaveLength(1);
      expect(claims[0]).toContain(identity.sessionId);
    } finally {
      for (const p of raws) {
        await p.close();
      }
      const closeResult = survivor ? await survivor.close() : null;
      expect(closeResult?.portReleased ?? true).toBe(true);
      await copy.cleanup();
    }
  }, 420_000);

  it('stale recovery: SIGTERM (not SIGKILL) then restart reclaims the claim with a new sessionId', async () => {
    const engineRoot = engineRootOrThrow();
    const copy = await createIsolatedProjectCopy(repoRoot, engineRoot);
    let first: StartedRuntimePreviewCliProcess | null = null;
    let second: StartedRuntimePreviewCliProcess | null = null;
    try {
      const portA = await findAvailablePort(19960);
      first = await startRuntimePreviewCliProcess({
        repoRoot,
        projectRoot: copy.projectRoot,
        engineRoot,
        host: '127.0.0.1',
        port: portA,
        startupTimeoutMs: 180_000,
        useRuntimeFlag: false,
        useTestEnvironment: false,
        noOpen: true,
      });
      const identityA = await fetchIdentity(first.url);
      expect(identityA.state).toBe('ready');
      expect(count(first.stdout, SCENE_PROCESS_START_PATTERN)).toBe(1);
      const claimsA = await listPreviewSessionClaimDirs(copy.projectRoot);
      expect(claimsA).toHaveLength(1);
      expect(claimsA[0]).toContain(identityA.sessionId);

      // SIGTERM(非 SIGKILL):Windows 上是硬杀(claim 残留、PID 死亡 → confirmed-dead 回收);
      // POSIX 走优雅 close(owner 自行 markDraining + release)。两种形态下重启都必须成功。
      first.child.kill('SIGTERM');
      const exited = await waitUntil(
        () => first!.child.exitCode !== null || first!.child.signalCode !== null,
        30_000,
      );
      expect(exited, 'first preview did not exit after SIGTERM').toBe(true);

      const portB = await findAvailablePort(20010);
      second = await startRuntimePreviewCliProcess({
        repoRoot,
        projectRoot: copy.projectRoot,
        engineRoot,
        host: '127.0.0.1',
        port: portB,
        startupTimeoutMs: 180_000,
        useRuntimeFlag: false,
        useTestEnvironment: false,
        noOpen: true,
      });
      const identityB = await fetchIdentity(second.url);
      // 新 sessionId 发布;旧 claim 被回收(恰好一个 claim,属于新 session)。
      expect(identityB.sessionId).not.toBe(identityA.sessionId);
      expect(identityB.state).toBe('ready');
      const claimsB = await listPreviewSessionClaimDirs(copy.projectRoot);
      expect(claimsB).toHaveLength(1);
      expect(claimsB[0]).toContain(identityB.sessionId);
      expect(count(second.stdout, SCENE_PROCESS_START_PATTERN)).toBe(1);
    } finally {
      const closeA = first ? await first.close() : null;
      const closeB = second ? await second.close() : null;
      expect(closeA?.portReleased ?? true).toBe(true);
      expect(closeB?.portReleased ?? true).toBe(true);
      await copy.cleanup();
    }
  }, 600_000);

  it('draining window: fail closed while the claim is held, take over without error once released', async () => {
    const engineRoot = engineRootOrThrow();
    const copy = await createIsolatedProjectCopy(repoRoot, engineRoot);
    // 存活 dummy 进程充当 draining owner 的 PID(Windows SIGTERM 硬杀无法驱动优雅 close,
    // draining 瞬态用真实 claim 格式 + 存活 PID 构造)。
    const dummy = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
    expect(dummy.pid).toBeTruthy();
    let preview: RawPreviewCliProcess | null = null;
    try {
      // Case A:draining claim 持续不释放 → fail closed(非零退出),claim 原样保留。
      const seededA = await seedDrainingClaim(copy.projectRoot, dummy.pid!, PREVIEW_SESSION_PROTOCOL_VERSION);
      const portA = await findAvailablePort(20060);
      const failClosed = spawnRawPreviewCli({ repoRoot, projectRoot: copy.projectRoot, port: portA });
      try {
        const exitA = await failClosed.waitForExit(60_000);
        expect(exitA.exitCode).not.toBe(0);
        expect(failClosed.stderr).toMatch(/draining/);
        expect(failClosed.stdout).not.toContain('server:listening');
        // fail closed:不接管、不删 claim。
        expect(await listPreviewSessionClaimDirs(copy.projectRoot)).toEqual([basename(seededA.claimDir)]);
      } finally {
        await failClosed.close();
        await removeClaimDirFully(seededA.claimDir);
      }

      // Case B:draining claim 在 close 开始后释放 → 新 preview 等待并接管,不报错。
      const seededB = await seedDrainingClaim(copy.projectRoot, dummy.pid!, PREVIEW_SESSION_PROTOCOL_VERSION);
      const portB = await findAvailablePort(20110);
      preview = spawnRawPreviewCli({ repoRoot, projectRoot: copy.projectRoot, port: portB });
      // 等 CLI bootstrap 进入 acquire 的 drain 等待后再释放 claim(模拟 owner close 开始释放)。
      await wait(5_000);
      expect(preview.exited).toBe(false);
      await removeClaimDirFully(seededB.claimDir);
      const ready = await waitUntil(() => preview!.stdout.includes(PREVIEW_READY_MARKER), 180_000, 500);
      expect(
        ready,
        `preview did not take over after the draining claim was released.\nstdout:\n${preview.stdout}\nstderr:\n${preview.stderr}`,
      ).toBe(true);
      expect(preview.exited).toBe(false);

      const url = serverUrlOf(preview.stdout);
      expect(url).toBeTruthy();
      const identity = await fetchIdentity(url!);
      expect(identity.state).toBe('ready');
      expect(identity.sessionId).not.toBe(seededB.sessionId);
      const claims = await listPreviewSessionClaimDirs(copy.projectRoot);
      expect(claims).toHaveLength(1);
      expect(claims[0]).toContain(identity.sessionId);
      expect(count(preview.stdout, SCENE_PROCESS_START_PATTERN)).toBe(1);
    } finally {
      await preview?.close();
      dummy.kill('SIGKILL');
      await copy.cleanup();
    }
  }, 420_000);
});
