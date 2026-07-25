/**
 * liveness 验活(issues/16):对单个 claim 执行一次完整探测并分级。
 * 回收重读 descriptor 时必须重新调用本函数执行完整 probe,
 * 窗口内恢复健康的 owner 不被误杀。
 */
import { resolvePreviewSessionDeps, type PreviewSessionDeps } from './deps';
import { claimInfoFromDir } from './claim';
import { readPreviewSessionDescriptor } from './descriptor';
import { canonicalizeProjectRoot } from './project-root';
import type { PreviewSessionProbeResult } from './types';

export async function probePreviewSessionClaim(
    claimDir: string,
    deps: PreviewSessionDeps = {},
): Promise<PreviewSessionProbeResult> {
    const resolved = resolvePreviewSessionDeps(deps);
    const claim = claimInfoFromDir(claimDir);
    if (!claim) {
        // 目录名不可解析:不是合法的 claim,按 invalid 处理。
        return {
            claim: { claimDir, sessionId: '', pid: 0 },
            liveness: 'invalid',
            descriptor: null,
            descriptorError: 'unparseable-claim-name',
            identity: null,
        };
    }

    const read = await readPreviewSessionDescriptor(resolved.fs, claimDir);
    if (!read.ok) {
        // descriptor 缺失/损坏:利用目录名自带的 pid 判读(issues/15「并发读者总能判读」)。
        if (read.reason === 'missing') {
            // 缺失且 pid 活:owner 正处于 mkdir 后发布 descriptor 的窗口内,
            // 按 starting 处理,避免把刚创建 claim 的新 owner 误回收;
            // 缺失且 pid 死:创建后崩溃,按 confirmed-dead 直接回收。
            const liveness = resolved.processControl.isAlive(claim.pid) ? 'starting' : 'confirmed-dead';
            return {
                claim,
                liveness,
                descriptor: null,
                descriptorError: read.reason,
                identity: null,
            };
        }
        // 损坏(半 JSON / schema 非法):PID 死的垃圾 claim 判 invalid 直接回收;
        // PID 活不能证明该进程不是仍在写项目的 owner,判 invalid-owner-alive,
        // fail closed——永不回收、不 SIGTERM,提示人工处理。
        const liveness = resolved.processControl.isAlive(claim.pid) ? 'invalid-owner-alive' : 'invalid';
        return {
            claim,
            liveness,
            descriptor: null,
            descriptorError: read.reason,
            identity: null,
        };
    }
    const descriptor = read.descriptor;

    // descriptor 与 claim 目录名身份不一致:descriptor 无效,不据此操作任何进程。
    // 与损坏同理按 PID 生死拆分 invalid / invalid-owner-alive。
    if (descriptor.sessionId !== claim.sessionId || descriptor.pid !== claim.pid) {
        const liveness = resolved.processControl.isAlive(claim.pid) ? 'invalid-owner-alive' : 'invalid';
        return {
            claim,
            liveness,
            descriptor,
            descriptorError: 'descriptor-claim-mismatch',
            identity: null,
        };
    }

    // PID 死:直接 confirmed-dead。PID 被操作系统复用时 isAlive 为真,
    // 会继续走 endpoint 身份比对,由 sessionId 不匹配兜住(判 invalid,不误杀)。
    if (!resolved.processControl.isAlive(claim.pid)) {
        return { claim, liveness: 'confirmed-dead', descriptor, descriptorError: null, identity: null };
    }

    // 验活先比 descriptor 版本(spec):与本地不一致立即 live-incompatible,
    // 在任何 endpoint 探测之前返回——旧 server 对新客户端可能 404 / schema 不符,
    // 绝不能因此落入 unreachable-owner-alive 被杀。live-incompatible 永不进回收。
    if (descriptor.protocolVersion !== resolved.protocolVersion) {
        return { claim, liveness: 'live-incompatible', descriptor, descriptorError: null, identity: null };
    }

    if (descriptor.state === 'starting') {
        // starting 不设超时:启动长尾期间一律按 live 处理。
        return { claim, liveness: 'starting', descriptor, descriptorError: null, identity: null };
    }
    if (descriptor.state === 'draining') {
        // close 窗口:按无 session 处理,等待释放,不杀。
        return { claim, liveness: 'draining', descriptor, descriptorError: null, identity: null };
    }

    // state=ready:经 identity endpoint 三重比对。
    const identity = await resolved.fetchIdentity(descriptor.serverUrl as string);
    if (!identity) {
        return { claim, liveness: 'unreachable-owner-alive', descriptor, descriptorError: null, identity: null };
    }
    // 端点 sessionId 与 descriptor 不匹配:descriptor 无效,原进程与本 session 无关,
    // 判 invalid(直接回收,不 SIGTERM)。
    if (identity.sessionId !== descriptor.sessionId) {
        return {
            claim,
            liveness: 'invalid',
            descriptor,
            descriptorError: 'identity-session-id-mismatch',
            identity,
        };
    }
    if (identity.protocolVersion !== resolved.protocolVersion) {
        return { claim, liveness: 'live-incompatible', descriptor, descriptorError: null, identity };
    }
    const identityProjectRoot = await canonicalizeProjectRoot(identity.projectRoot, resolved.fs);
    if (identityProjectRoot !== descriptor.projectRoot) {
        return {
            claim,
            liveness: 'invalid',
            descriptor,
            descriptorError: 'identity-project-root-mismatch',
            identity,
        };
    }
    return { claim, liveness: 'live-compatible', descriptor, descriptorError: null, identity };
}
