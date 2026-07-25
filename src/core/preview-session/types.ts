/**
 * Preview session descriptor / identity / liveness 的类型定义。
 * 字段集合定稿见 issues/13-descriptor-schema.md;liveness 六级(另含 draining 瞬态)
 * 见 issues/16-stale-reclaim-revision.md 与 issues/17-state-semantics-revision.md。
 */

// session 状态机三态:starting(初始发布,serverUrl 缺席)/ ready(全部能力就绪)/
// draining(close 开始的瞬态,按无 session 处理,claim 随即被释放)。
export type PreviewSessionState = 'starting' | 'ready' | 'draining';

// claim 目录内 descriptor 文件的内容。不含秘密,默认文件权限。
export interface PreviewSessionDescriptor {
    sessionId: string;
    // canonical project root(realpath 归一)。
    projectRoot: string;
    pid: number;
    state: PreviewSessionState;
    protocolVersion: number;
    // starting 时缺席;ready 后由 tmp+rename 原子更新补上。
    serverUrl?: string;
    // 纯诊断字段。
    startedAt: string;
}

// GET /__cocos-cli/session 的响应形状(T2 实现,此处固定消费侧契约)。
export interface PreviewSessionIdentity {
    sessionId: string;
    projectRoot: string;
    state: PreviewSessionState;
    protocolVersion: number;
    serverUrl: string;
    mcpUrl: string;
    startedAt: string;
}

/**
 * liveness 分级:
 * - live-compatible:endpoint 可达且 sessionId + canonical projectRoot 一致,
 *   且 descriptor 与 identity 的 protocolVersion 都与本地一致;
 * - live-incompatible:descriptor 或 identity 的 protocolVersion 与本地不符,
 *   验活先比 descriptor 版本(永不回收、不 SIGTERM);
 * - starting:PID 活且 state=starting(不设超时);
 * - draining:PID 活且 state=draining(close 窗口,等待释放,不杀);
 * - unreachable-owner-alive:PID 活、ready、版本一致、endpoint 不可达
 *   (进程树终止 + 死亡确认后回收);
 * - confirmed-dead:PID 死(直接回收);
 * - invalid:PID 死的损坏/垃圾 claim,或 identity 证明非本 session
 *   (直接回收,不 SIGTERM);
 * - invalid-owner-alive:descriptor 损坏或身份不匹配但 PID 活——损坏不能证明
 *   该进程不是仍在写项目的 owner,fail closed(永不回收、不 SIGTERM,
 *   提示人工处理)。
 */
export type PreviewSessionLiveness =
    | 'live-compatible'
    | 'live-incompatible'
    | 'starting'
    | 'draining'
    | 'unreachable-owner-alive'
    | 'confirmed-dead'
    | 'invalid'
    | 'invalid-owner-alive';

// 从 claim 目录名解析出的不可变身份信息。
export interface PreviewSessionClaimInfo {
    claimDir: string;
    sessionId: string;
    pid: number;
}

export type PreviewSessionDescriptorReadResult =
    | { ok: true; descriptor: PreviewSessionDescriptor }
    | { ok: false; reason: 'missing' | 'parse-error' | 'invalid-schema' };

// 单次完整验活的结果。
export interface PreviewSessionProbeResult {
    claim: PreviewSessionClaimInfo;
    liveness: PreviewSessionLiveness;
    descriptor: PreviewSessionDescriptor | null;
    descriptorError: string | null;
    identity: PreviewSessionIdentity | null;
}
