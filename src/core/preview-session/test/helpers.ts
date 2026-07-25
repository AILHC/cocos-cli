/**
 * preview-session 单测共享辅助:临时目录 fixture、claim 播种、
 * fake process table 与 fake clock。
 * fixture 语义:全部为系统 temp 下的临时 fixture,不涉及真实项目;
 * fs 一律使用真实文件系统(临时目录),进程与网络行为全部 fake。
 */
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { formatClaimDirName } from '../claim';
import { CLI_TEMP_DIR, PREVIEW_SESSION_DESCRIPTOR_NAME, PREVIEW_SESSION_PROTOCOL_VERSION } from '../constants';
import type { PreviewSessionProcessControl } from '../deps';
import type { PreviewSessionDescriptor, PreviewSessionIdentity } from '../types';

export function createFixtureRoot(): string {
    return mkdtempSync(join(tmpdir(), 'cocos-cli-preview-session-'));
}

export function cleanupFixtureRoot(root: string): void {
    rmSync(root, { recursive: true, force: true });
}

// 创建带三标志(package.json + assets/ + settings/)的项目 fixture,返回 canonical root。
export function createProjectFixture(parent: string, name = 'project'): string {
    const root = join(parent, name);
    mkdirSync(join(root, 'assets'), { recursive: true });
    mkdirSync(join(root, 'settings'), { recursive: true });
    writeFileSync(join(root, 'package.json'), '{}', 'utf8');
    return realpathSync(root);
}

export interface SeedClaimOptions {
    sessionId?: string;
    pid?: number;
    state?: 'starting' | 'ready' | 'draining';
    serverUrl?: string;
    protocolVersion?: number;
    startedAt?: string;
    projectRoot?: string;
    // 直接写入损坏的 descriptor 内容(半 JSON / schema 非法)。
    rawDescriptor?: string;
    // 不写 descriptor(模拟 mkdir 后尚未发布 / 崩溃残留)。
    skipDescriptor?: boolean;
}

export interface SeededClaim {
    claimDir: string;
    sessionId: string;
    pid: number;
    descriptor: PreviewSessionDescriptor;
}

// 在 <project>/temp/cli 下播种一个 claim 目录及 descriptor。
export function seedClaim(projectRoot: string, options: SeedClaimOptions = {}): SeededClaim {
    const sessionId = options.sessionId ?? '11111111-2222-4333-8444-555555555555';
    const pid = options.pid ?? 40001;
    const state = options.state ?? 'ready';
    const serverUrl = options.serverUrl ?? 'http://127.0.0.1:7456';
    const claimDir = join(projectRoot, CLI_TEMP_DIR, formatClaimDirName(sessionId, pid));
    mkdirSync(claimDir, { recursive: true });
    const descriptor: PreviewSessionDescriptor = {
        sessionId,
        projectRoot: options.projectRoot ?? projectRoot,
        pid,
        state,
        protocolVersion: options.protocolVersion ?? PREVIEW_SESSION_PROTOCOL_VERSION,
        ...(state === 'ready' || options.serverUrl ? { serverUrl } : {}),
        startedAt: options.startedAt ?? '2026-07-24T00:00:00.000Z',
    };
    if (!options.skipDescriptor) {
        writeFileSync(
            join(claimDir, PREVIEW_SESSION_DESCRIPTOR_NAME),
            options.rawDescriptor ?? JSON.stringify(descriptor, null, 2),
            'utf8',
        );
    }
    return { claimDir, sessionId, pid, descriptor };
}

export interface FakeProcessTable {
    control: PreviewSessionProcessControl;
    alive: Set<number>;
    terminated: number[];
    terminatedTrees: number[];
}

// fake process table:killOnTerminate=false 模拟终止后拒绝退出的进程。
export function createFakeProcessControl(alivePids: number[] = [], killOnTerminate = true): FakeProcessTable {
    const alive = new Set(alivePids);
    const terminated: number[] = [];
    const terminatedTrees: number[] = [];
    return {
        alive,
        terminated,
        terminatedTrees,
        control: {
            isAlive: (pid) => alive.has(pid),
            terminate: (pid) => {
                terminated.push(pid);
                if (killOnTerminate) {
                    alive.delete(pid);
                }
            },
            terminateTree: (pid) => {
                terminatedTrees.push(pid);
                if (killOnTerminate) {
                    alive.delete(pid);
                }
            },
        },
    };
}

// fake clock:sleep 推进时间,配合超时分支做确定性测试。
export function createFakeClock(): { now: () => number; sleep: (ms: number) => Promise<void> } {
    let now = 0;
    return {
        now: () => now,
        sleep: async (ms: number) => {
            now += ms;
        },
    };
}

export function buildIdentity(overrides: Partial<PreviewSessionIdentity> = {}): PreviewSessionIdentity {
    const serverUrl = overrides.serverUrl ?? 'http://127.0.0.1:7456';
    return {
        sessionId: '11111111-2222-4333-8444-555555555555',
        projectRoot: '',
        state: 'ready',
        protocolVersion: PREVIEW_SESSION_PROTOCOL_VERSION,
        serverUrl,
        mcpUrl: `${serverUrl}/mcp`,
        startedAt: '2026-07-24T00:00:00.000Z',
        ...overrides,
    };
}
