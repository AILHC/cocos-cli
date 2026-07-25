/**
 * descriptor(claim 目录内的 session 描述文件)的读写与校验。
 * 发布与更新一律 tmp+rename,读者不会看到半个 JSON;
 * 崩溃残留的 tmp 文件由下次回收路径清理(issues/18 m2)。
 */
import { join } from 'path';
import type { PreviewSessionFileSystem } from './deps';
import { PREVIEW_SESSION_DESCRIPTOR_NAME, PREVIEW_SESSION_DESCRIPTOR_TMP_NAME, PREVIEW_SESSION_MCP_PATH } from './constants';
import type {
    PreviewSessionDescriptor,
    PreviewSessionDescriptorReadResult,
    PreviewSessionIdentity,
    PreviewSessionState,
} from './types';

const VALID_STATES: ReadonlySet<string> = new Set<PreviewSessionState>(['starting', 'ready', 'draining']);

// 由 serverUrl 推导 mcpUrl,不单独存储(issues/13)。
export function deriveMcpUrl(serverUrl: string): string {
    return `${serverUrl.replace(/\/+$/, '')}${PREVIEW_SESSION_MCP_PATH}`;
}

// 结构化校验 descriptor 字段集合;ready 态必须带 serverUrl,starting 时不依赖 serverUrl。
export function parsePreviewSessionDescriptor(raw: unknown): PreviewSessionDescriptor | null {
    if (!isRecord(raw)) {
        return null;
    }
    if (typeof raw.sessionId !== 'string' || raw.sessionId === '') {
        return null;
    }
    if (typeof raw.projectRoot !== 'string' || raw.projectRoot === '') {
        return null;
    }
    if (typeof raw.pid !== 'number' || !Number.isInteger(raw.pid) || raw.pid <= 0) {
        return null;
    }
    if (typeof raw.state !== 'string' || !VALID_STATES.has(raw.state)) {
        return null;
    }
    if (typeof raw.protocolVersion !== 'number' || !Number.isInteger(raw.protocolVersion)) {
        return null;
    }
    if (typeof raw.startedAt !== 'string' || raw.startedAt === '') {
        return null;
    }
    if (raw.serverUrl !== undefined && typeof raw.serverUrl !== 'string') {
        return null;
    }
    if (raw.state === 'ready' && (typeof raw.serverUrl !== 'string' || raw.serverUrl === '')) {
        return null;
    }
    return {
        sessionId: raw.sessionId,
        projectRoot: raw.projectRoot,
        pid: raw.pid,
        state: raw.state as PreviewSessionState,
        protocolVersion: raw.protocolVersion,
        ...(raw.serverUrl !== undefined ? { serverUrl: raw.serverUrl } : {}),
        startedAt: raw.startedAt,
    };
}

// 结构化校验 identity endpoint 响应;形状非法时按不可达处理(返回 null)。
export function parsePreviewSessionIdentity(raw: unknown): PreviewSessionIdentity | null {
    if (!isRecord(raw)) {
        return null;
    }
    if (typeof raw.sessionId !== 'string' || raw.sessionId === '') {
        return null;
    }
    if (typeof raw.projectRoot !== 'string' || raw.projectRoot === '') {
        return null;
    }
    if (typeof raw.state !== 'string' || !VALID_STATES.has(raw.state)) {
        return null;
    }
    if (typeof raw.protocolVersion !== 'number' || !Number.isInteger(raw.protocolVersion)) {
        return null;
    }
    if (typeof raw.serverUrl !== 'string' || raw.serverUrl === '') {
        return null;
    }
    if (typeof raw.mcpUrl !== 'string' || raw.mcpUrl === '') {
        return null;
    }
    if (typeof raw.startedAt !== 'string' || raw.startedAt === '') {
        return null;
    }
    return {
        sessionId: raw.sessionId,
        projectRoot: raw.projectRoot,
        state: raw.state as PreviewSessionState,
        protocolVersion: raw.protocolVersion,
        serverUrl: raw.serverUrl,
        mcpUrl: raw.mcpUrl,
        startedAt: raw.startedAt,
    };
}

export function descriptorPathOf(claimDir: string): string {
    return join(claimDir, PREVIEW_SESSION_DESCRIPTOR_NAME);
}

// 读取并校验 descriptor;损坏(半 JSON / schema 非法 / 缺失)一律返回 ok:false,
// 由验活层归类为 invalid。
export async function readPreviewSessionDescriptor(
    fs: PreviewSessionFileSystem,
    claimDir: string,
): Promise<PreviewSessionDescriptorReadResult> {
    let content: string;
    try {
        content = await fs.readFile(descriptorPathOf(claimDir));
    } catch {
        return { ok: false, reason: 'missing' };
    }
    let raw: unknown;
    try {
        raw = JSON.parse(content);
    } catch {
        return { ok: false, reason: 'parse-error' };
    }
    const descriptor = parsePreviewSessionDescriptor(raw);
    if (!descriptor) {
        return { ok: false, reason: 'invalid-schema' };
    }
    return { ok: true, descriptor };
}

// tmp+rename 原子发布/更新 descriptor;rename 在同一目录内,保证原子性。
export async function writePreviewSessionDescriptorAtomic(
    fs: PreviewSessionFileSystem,
    claimDir: string,
    descriptor: PreviewSessionDescriptor,
): Promise<void> {
    const tmpPath = join(claimDir, PREVIEW_SESSION_DESCRIPTOR_TMP_NAME);
    await fs.writeFile(tmpPath, `${JSON.stringify(descriptor, null, 2)}\n`);
    await fs.rename(tmpPath, descriptorPathOf(claimDir));
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
