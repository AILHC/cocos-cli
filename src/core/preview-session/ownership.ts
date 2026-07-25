/**
 * ownership 主流程:acquire(mkdir 原子 claim + 初始 starting descriptor 发布)、
 * stale 回收接管、release(先删 descriptor 再 rmdir,核对 sessionId)。
 *
 * 代码接缝(spec / issues/18):command 层参数验证与 canonicalization 之后、
 * 构造 Launcher 之前调用 acquire——早于任何项目写入;close 开始即调用
 * markDraining + release(issues/17),启动失败回滚同一规则。
 *
 * race 仲裁:claim 目录名自带 sessionId+pid(unique),单个 mkdir 不互斥;
 * 互斥由「mkdir 后 re-list」保证——发现并发兄弟时按确定性规则选出唯一 winner:
 * 已发布 descriptor 的兄弟视为已确立 owner,一律让位;其余(同在 mkdir→发布
 * 窗口内的竞争者)按 claim 目录名排序,最小者保留,其余让位删除自己的 claim。
 * 双方同时 re-list 时恰有一方胜出(绝不双 owner,也避免双方同时让位的 livelock);
 * 让位方按现存 claim 走冲突处理。stale 回收后 exclusive retry 仍仅一次(issues/16)。
 */
import { randomUUID } from 'crypto';
import { join } from 'path';
import { cliTempDirOf, formatClaimDirName, listPreviewSessionClaims } from './claim';
import { resolvePreviewSessionDeps, type PreviewSessionDeps, type ResolvedPreviewSessionDeps } from './deps';
import { descriptorPathOf, readPreviewSessionDescriptor, writePreviewSessionDescriptorAtomic } from './descriptor';
import { probePreviewSessionClaim } from './liveness';
import { canonicalizeProjectRoot } from './project-root';
import { reclaimPreviewSessionClaim, type PreviewSessionReclaimTiming } from './reclaim';
import type {
    PreviewSessionClaimInfo,
    PreviewSessionDescriptor,
    PreviewSessionIdentity,
    PreviewSessionLiveness,
    PreviewSessionProbeResult,
} from './types';

// 持有 ownership 期间的句柄;T3 在 ready / close / 启动失败回滚时调用对应方法。
export interface PreviewSessionOwnership {
    sessionId: string;
    pid: number;
    projectRoot: string;
    claimDir: string;
    // 全部能力 ready 后调用:补 serverUrl 并原子切 ready。
    publishReady(serverUrl: string): Promise<void>;
    // close 开始调用:descriptor 仍存在时原子切 draining(best-effort,不抛错)。
    markDraining(): Promise<void>;
    // 释放 claim:先删 descriptor 再 rmdir;核对 sessionId,不动后继 claim。
    // best-effort,不抛错;可重复调用。
    release(): Promise<void>;
}

export interface AcquirePreviewSessionOwnershipOptions {
    // 项目根(允许非 canonical,内部会 realpath 归一)。
    projectRoot: string;
    sessionId?: string;
    pid?: number;
    timing?: PreviewSessionReclaimTiming;
}

export type AcquirePreviewSessionOwnershipResult =
    | { acquired: true; ownership: PreviewSessionOwnership }
    | {
        acquired: false;
        // existing-session:存在不可回收或回收失败的 claim;
        // conflict:同启竞争让位后无现存 claim,或回收后 retry 仍被抢占。
        reason: 'existing-session' | 'conflict';
        liveness: PreviewSessionLiveness | null;
        claimDir: string | null;
        descriptor: PreviewSessionDescriptor | null;
        identity: PreviewSessionIdentity | null;
        message: string;
    };

// 不可回收的 liveness:live-compatible / live-incompatible / starting 一律阻塞,
// invalid-owner-alive(claim 损坏但 PID 活)fail closed 同样阻塞;
// draining 通过等待释放处理,不算阻塞。
const NON_RECLAIMABLE: ReadonlySet<PreviewSessionLiveness> = new Set([
    'live-compatible',
    'live-incompatible',
    'starting',
    'invalid-owner-alive',
]);

export async function acquirePreviewSessionOwnership(
    options: AcquirePreviewSessionOwnershipOptions,
    deps: PreviewSessionDeps = {},
): Promise<AcquirePreviewSessionOwnershipResult> {
    const resolved = resolvePreviewSessionDeps(deps);
    const projectRoot = await canonicalizeProjectRoot(options.projectRoot, resolved.fs);
    const sessionId = options.sessionId ?? randomUUID();
    const pid = options.pid ?? process.pid;
    const cliTempDir = cliTempDirOf(projectRoot);
    // acquire 前确保 temp/cli 存在(issues/18 m3)。
    await resolved.fs.ensureDir(cliTempDir);
    const claimDir = join(cliTempDir, formatClaimDirName(sessionId, pid));

    let conflicts = await listPreviewSessionClaims(resolved.fs, projectRoot);
    if (conflicts.length === 0) {
        const slot = await tryClaimSlot(resolved, projectRoot, claimDir);
        if (slot.owned) {
            const ownership = await createOwnership(resolved, claimDir, sessionId, pid, projectRoot);
            return { acquired: true, ownership };
        }
        conflicts = slot.claims;
        if (conflicts.length === 0) {
            // 同启竞争双方同时让位(fail-safe):不循环重试,交给调用方。
            return conflictResult('Concurrent preview startup race resolved with no surviving claim; retry the command.');
        }
    }

    // 冲突路径:对现存 claim 逐一完整验活。
    const probes: PreviewSessionProbeResult[] = [];
    for (const claim of conflicts) {
        probes.push(await probePreviewSessionClaim(claim.claimDir, deps));
    }
    const blocking = probes.find((probe) => NON_RECLAIMABLE.has(probe.liveness));
    if (blocking) {
        return {
            acquired: false,
            reason: 'existing-session',
            liveness: blocking.liveness,
            claimDir: blocking.claim.claimDir,
            descriptor: blocking.descriptor,
            identity: blocking.identity,
            message: messageForLiveness(blocking.liveness, blocking.claim.pid),
        };
    }

    // 全部可回收:回收内部会重读 descriptor 并重新完整验活。
    for (const probe of probes) {
        const result = await reclaimPreviewSessionClaim(probe.claim.claimDir, options.timing, deps);
        if (!result.reclaimed) {
            // 用回收阶段的最终 probe 构造结果:窗口内 owner 可能已从
            // invalid/unreachable 恢复为 live-compatible,不能用第一次的旧数据。
            return {
                acquired: false,
                reason: 'existing-session',
                liveness: result.probe.liveness,
                claimDir: result.probe.claim.claimDir,
                descriptor: result.probe.descriptor,
                identity: result.probe.identity,
                message: result.message,
            };
        }
    }

    // 回收后 exclusive retry,仅一次(issues/16);被并发进程抢占则 fail closed。
    const retry = await tryClaimSlot(resolved, projectRoot, claimDir);
    if (retry.owned) {
        const ownership = await createOwnership(resolved, claimDir, sessionId, pid, projectRoot);
        return { acquired: true, ownership };
    }
    return conflictResult('Another process claimed the preview session while reclaiming; retry the command.');
}

function conflictResult(message: string): AcquirePreviewSessionOwnershipResult {
    return {
        acquired: false,
        reason: 'conflict',
        liveness: null,
        claimDir: null,
        descriptor: null,
        identity: null,
        message,
    };
}

function messageForLiveness(liveness: PreviewSessionLiveness, pid: number): string {
    switch (liveness) {
        case 'live-compatible':
            return `A live preview session (PID ${pid}) already owns this project.`;
        case 'live-incompatible':
            return `A live preview session (PID ${pid}) uses an incompatible protocol version; restart the Preview.`;
        case 'starting':
            return `A preview session (PID ${pid}) is still starting; retry later.`;
        case 'invalid-owner-alive':
            return `The existing preview session claim is corrupted or its identity does not match, ` +
                `but its process (PID ${pid}) is still alive; the claim was left untouched. ` +
                'Stop the process and remove the claim manually, then retry.';
        default:
            return `Existing preview session claim is ${liveness}.`;
    }
}

type ClaimSlotOutcome = { owned: true } | { owned: false; claims: PreviewSessionClaimInfo[] };

// mkdir 创建自身 claim 后 re-list:发现并发兄弟时按确定性规则仲裁——
// 已发布 descriptor(含损坏可读到的非 missing 情形)的兄弟视为已确立 owner,
// 一律让位;同在发布窗口内(尚无 descriptor)的竞争者按 claim 目录名排序,
// 最小者保留,其余让位删除自己的 claim。双方同时 re-list 时恰有一个 winner,
// 既绝不双 owner,也避免双方同时让位的 livelock。
async function tryClaimSlot(
    resolved: ResolvedPreviewSessionDeps,
    projectRoot: string,
    claimDir: string,
): Promise<ClaimSlotOutcome> {
    try {
        await resolved.fs.mkdir(claimDir);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
            return { owned: false, claims: await listPreviewSessionClaims(resolved.fs, projectRoot) };
        }
        throw error;
    }
    // listPreviewSessionClaims 按目录名排序返回,首个即最小 claim key。
    const claims = await listPreviewSessionClaims(resolved.fs, projectRoot);
    const siblings = claims.filter((claim) => claim.claimDir !== claimDir);
    if (siblings.length === 0) {
        return { owned: true };
    }
    let hasEstablishedSibling = false;
    for (const sibling of siblings) {
        const read = await readPreviewSessionDescriptor(resolved.fs, sibling.claimDir);
        if (read.ok || read.reason !== 'missing') {
            hasEstablishedSibling = true;
            break;
        }
    }
    if (!hasEstablishedSibling && claims[0]?.claimDir === claimDir) {
        // 确定性 winner:其余竞争者按同一规则自行让位。
        return { owned: true };
    }
    // 让位:此时 descriptor 尚未发布,目录为空,rmdir 即可。
    await ignoreClaimErrors(() => resolved.fs.rmdir(claimDir));
    return { owned: false, claims: await listPreviewSessionClaims(resolved.fs, projectRoot) };
}

// 创建句柄并立即发布初始 starting descriptor(serverUrl 缺席)。
async function createOwnership(
    resolved: ResolvedPreviewSessionDeps,
    claimDir: string,
    sessionId: string,
    pid: number,
    projectRoot: string,
): Promise<PreviewSessionOwnership> {
    const startedAt = new Date().toISOString();
    await writePreviewSessionDescriptorAtomic(resolved.fs, claimDir, {
        sessionId,
        projectRoot,
        pid,
        state: 'starting',
        protocolVersion: resolved.protocolVersion,
        startedAt,
    });

    let released = false;
    return {
        sessionId,
        pid,
        projectRoot,
        claimDir,
        publishReady: async (serverUrl) => {
            await writePreviewSessionDescriptorAtomic(resolved.fs, claimDir, {
                sessionId,
                projectRoot,
                pid,
                state: 'ready',
                protocolVersion: resolved.protocolVersion,
                serverUrl,
                startedAt,
            });
        },
        markDraining: async () => {
            // best-effort:descriptor 已被回收或替换时直接放弃。
            try {
                const read = await readPreviewSessionDescriptor(resolved.fs, claimDir);
                if (!read.ok || read.descriptor.sessionId !== sessionId) {
                    return;
                }
                await writePreviewSessionDescriptorAtomic(resolved.fs, claimDir, {
                    ...read.descriptor,
                    state: 'draining',
                });
            } catch {
                // 关闭路径不因此失败。
            }
        },
        release: async () => {
            if (released) {
                return;
            }
            released = true;
            // 核对 sessionId:claim 已被回收并被后继 owner 接管时,不动后继 claim
            // (issues/15:rmdir 只能删空目录提供第二重保护)。
            try {
                const read = await readPreviewSessionDescriptor(resolved.fs, claimDir);
                if (read.ok && read.descriptor.sessionId !== sessionId) {
                    return;
                }
            } catch {
                // 读失败按无 descriptor 处理,继续尝试 rmdir。
            }
            await ignoreClaimErrors(() => resolved.fs.unlink(descriptorPathOf(claimDir)));
            await ignoreClaimErrors(async () => {
                try {
                    await resolved.fs.rmdir(claimDir);
                } catch (error) {
                    // ENOTEMPTY:清理自身 tmp 残留后再试一次。
                    if ((error as NodeJS.ErrnoException).code === 'ENOTEMPTY') {
                        const entries = await resolved.fs.readdir(claimDir);
                        for (const entry of entries) {
                            if (entry.endsWith('.tmp')) {
                                await ignoreClaimErrors(() => resolved.fs.unlink(join(claimDir, entry)));
                            }
                        }
                        await resolved.fs.rmdir(claimDir);
                        return;
                    }
                    throw error;
                }
            });
        },
    };
}

// release / 让位路径 best-effort:claim 已被回收 / temp 被外部删除时不抛错。
async function ignoreClaimErrors(action: () => Promise<void>): Promise<void> {
    try {
        await action();
    } catch {
        // 忽略:迟到 cleanup 不构成失败。
    }
}

// T4 discovery 用:解析项目下当前 claim 并完整验活;无 claim 返回 null。
// 多个 claim 并存(同启竞争窗口的瞬态)时按协议语义优先级选取,
// 不用目录名字典序表达协议语义。
const DISCOVERY_LIVENESS_PRIORITY: readonly PreviewSessionLiveness[] = [
    'live-compatible',
    'live-incompatible',
    'starting',
    'unreachable-owner-alive',
    'invalid-owner-alive',
    'draining',
    'confirmed-dead',
    'invalid',
];

export async function discoverPreviewSession(
    projectRoot: string,
    deps: PreviewSessionDeps = {},
): Promise<PreviewSessionProbeResult | null> {
    const resolved = resolvePreviewSessionDeps(deps);
    const canonicalRoot = await canonicalizeProjectRoot(projectRoot, resolved.fs);
    const claims = await listPreviewSessionClaims(resolved.fs, canonicalRoot);
    if (claims.length === 0) {
        return null;
    }
    const probes: PreviewSessionProbeResult[] = [];
    for (const claim of claims) {
        probes.push(await probePreviewSessionClaim(claim.claimDir, deps));
    }
    let best = probes[0];
    for (const probe of probes) {
        if (DISCOVERY_LIVENESS_PRIORITY.indexOf(probe.liveness)
            < DISCOVERY_LIVENESS_PRIORITY.indexOf(best.liveness)) {
            best = probe;
        }
    }
    return best;
}
