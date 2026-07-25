/**
 * stale claim 回收(issues/16、17):
 * - confirmed-dead / invalid → 直接回收(invalid 不 SIGTERM,对端已证明不是本 session);
 * - unreachable-owner-alive → 进程树终止(terminateTree)后轮询确认死亡,确认后才删 claim;
 *   超时 fail closed,报错请用户人工处理,不接管;
 * - draining → 等待 claim 被 owner 自行释放,超时 fail closed;
 * - live-compatible / live-incompatible / starting / invalid-owner-alive → 永不回收。
 * 进入回收前会重新执行一次完整 liveness probe(重读窗口内恢复健康的 owner 不被误杀);
 * 结果中带回这次最终 probe,调用方构造结果时必须使用它而非进入回收前的旧 probe。
 */
import { join } from 'path';
import { resolvePreviewSessionDeps, type PreviewSessionDeps, type PreviewSessionFileSystem, type ResolvedPreviewSessionDeps } from './deps';
import { DEFAULT_DRAIN_TIMEOUT_MS, DEFAULT_POLL_INTERVAL_MS, DEFAULT_SIGTERM_TIMEOUT_MS } from './constants';
import { probePreviewSessionClaim } from './liveness';
import type { PreviewSessionLiveness, PreviewSessionProbeResult } from './types';

export interface PreviewSessionReclaimTiming {
    sigtermTimeoutMs?: number;
    drainTimeoutMs?: number;
    pollIntervalMs?: number;
}

// liveness 为最终 probe 的分级(与 probe.liveness 相同),probe 是回收前重读的完整验活结果。
export type PreviewSessionReclaimResult =
    | { reclaimed: true; liveness: PreviewSessionLiveness; probe: PreviewSessionProbeResult }
    | { reclaimed: false; liveness: PreviewSessionLiveness; probe: PreviewSessionProbeResult; message: string };

export async function reclaimPreviewSessionClaim(
    claimDir: string,
    timing: PreviewSessionReclaimTiming = {},
    deps: PreviewSessionDeps = {},
): Promise<PreviewSessionReclaimResult> {
    const resolved = resolvePreviewSessionDeps(deps);
    // 重读 descriptor 并重新完整验活。
    const probe = await probePreviewSessionClaim(claimDir, deps);
    const pollIntervalMs = timing.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;

    switch (probe.liveness) {
        case 'confirmed-dead':
        case 'invalid':
            // invalid 不终止进程:PID 死的垃圾,或 identity 已证明对端不是本 session。
            await removeClaimDir(resolved.fs, claimDir);
            return { reclaimed: true, liveness: probe.liveness, probe };
        case 'unreachable-owner-alive': {
            // 进程树终止:scene 等子进程依赖树终止,而非 IPC disconnect 自愈。
            resolved.processControl.terminateTree(probe.claim.pid);
            const timeoutMs = timing.sigtermTimeoutMs ?? DEFAULT_SIGTERM_TIMEOUT_MS;
            const dead = await waitUntil(resolved, timeoutMs, pollIntervalMs,
                () => !resolved.processControl.isAlive(probe.claim.pid));
            if (!dead) {
                // fail closed:不删 claim、不接管,交给用户人工处理。
                return {
                    reclaimed: false,
                    liveness: probe.liveness,
                    probe,
                    message: `Timed out waiting for preview process (PID ${probe.claim.pid}) to exit after termination; ` +
                        'the existing claim was left untouched. Stop the process manually and retry.',
                };
            }
            await removeClaimDir(resolved.fs, claimDir);
            return { reclaimed: true, liveness: probe.liveness, probe };
        }
        case 'draining': {
            const timeoutMs = timing.drainTimeoutMs ?? DEFAULT_DRAIN_TIMEOUT_MS;
            const gone = await waitUntil(resolved, timeoutMs, pollIntervalMs,
                async () => (await resolved.fs.stat(claimDir)) === null);
            if (!gone) {
                return {
                    reclaimed: false,
                    liveness: probe.liveness,
                    probe,
                    message: `Timed out waiting for the draining preview session (PID ${probe.claim.pid}) to release its claim; retry later.`,
                };
            }
            return { reclaimed: true, liveness: probe.liveness, probe };
        }
        default:
            // live-compatible / live-incompatible / starting / invalid-owner-alive 永不进回收。
            return {
                reclaimed: false,
                liveness: probe.liveness,
                probe,
                message: `Existing preview session claim is ${probe.liveness} and must not be reclaimed.`,
            };
    }
}

// 删除 claim 目录内全部文件(descriptor 与崩溃残留的 tmp)后 rmdir。
async function removeClaimDir(fs: PreviewSessionFileSystem, claimDir: string): Promise<void> {
    const stat = await fs.stat(claimDir);
    if (!stat) {
        return;
    }
    const entries = await fs.readdir(claimDir);
    for (const entry of entries) {
        await ignoreMissing(() => fs.unlink(join(claimDir, entry)));
    }
    await ignoreMissing(() => fs.rmdir(claimDir));
}

// 在注入时钟下轮询条件直至满足或超时。
async function waitUntil(
    deps: ResolvedPreviewSessionDeps,
    timeoutMs: number,
    pollIntervalMs: number,
    predicate: () => boolean | Promise<boolean>,
): Promise<boolean> {
    if (await predicate()) {
        return true;
    }
    const deadline = deps.now() + timeoutMs;
    while (deps.now() < deadline) {
        await deps.sleep(pollIntervalMs);
        if (await predicate()) {
            return true;
        }
    }
    return predicate();
}

async function ignoreMissing(action: () => Promise<void>): Promise<void> {
    try {
        await action();
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
            throw error;
        }
    }
}
