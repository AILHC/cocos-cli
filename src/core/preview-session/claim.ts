/**
 * ownership claim(lock dir)的命名、解析与枚举。
 * claim = temp/cli/ 下 mkdir 原子创建的目录,目录名自带 sessionId 与 pid,
 * mkdir 成功即 ownership 成立,不存在「半个 claim」(issues/15)。
 */
import { basename, join } from 'path';
import type { PreviewSessionFileSystem } from './deps';
import { CLI_TEMP_DIR, PREVIEW_SESSION_CLAIM_PREFIX } from './constants';
import type { PreviewSessionClaimInfo } from './types';

export function formatClaimDirName(sessionId: string, pid: number): string {
    return `${PREVIEW_SESSION_CLAIM_PREFIX}${sessionId}-${pid}`;
}

// sessionId 允许含连字符(如 UUID),pid 固定为末尾数字段。
export function parseClaimDirName(name: string): { sessionId: string; pid: number } | null {
    const match = /^preview-session-(.+)-(\d+)$/.exec(name);
    if (!match) {
        return null;
    }
    return { sessionId: match[1], pid: Number.parseInt(match[2], 10) };
}

export function cliTempDirOf(projectRoot: string): string {
    return join(projectRoot, CLI_TEMP_DIR);
}

// 枚举项目下全部 claim 目录;目录名不可解析或非目录的条目直接忽略。
export async function listPreviewSessionClaims(
    fs: PreviewSessionFileSystem,
    projectRoot: string,
): Promise<PreviewSessionClaimInfo[]> {
    const cliTempDir = cliTempDirOf(projectRoot);
    const stat = await fs.stat(cliTempDir);
    if (!stat || !stat.isDirectory()) {
        return [];
    }
    const entries = (await fs.readdir(cliTempDir)).sort();
    const claims: PreviewSessionClaimInfo[] = [];
    for (const entry of entries) {
        const parsed = parseClaimDirName(entry);
        if (!parsed) {
            continue;
        }
        const claimDir = join(cliTempDir, entry);
        const entryStat = await fs.stat(claimDir);
        if (!entryStat || !entryStat.isDirectory()) {
            continue;
        }
        claims.push({ claimDir, ...parsed });
    }
    return claims;
}

// 从 claim 目录名提取身份信息(供 probe/release 核对使用)。
export function claimInfoFromDir(claimDir: string): PreviewSessionClaimInfo | null {
    const parsed = parseClaimDirName(basename(claimDir));
    if (!parsed) {
        return null;
    }
    return { claimDir, ...parsed };
}
