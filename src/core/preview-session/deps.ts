/**
 * preview-session 模块的可注入依赖。
 * fs、process(pid 存活检查 / SIGTERM)、identity endpoint 探测、时钟与 sleep
 * 全部设计为可注入,便于 Jest 单测用临时目录 + fake process table 确定性覆盖
 * 验活与回收路径,不需要启动真实进程。
 */
import { spawnSync } from 'child_process';
import { promises as fsp } from 'fs';
import {
    DEFAULT_IDENTITY_FETCH_TIMEOUT_MS,
    PREVIEW_SESSION_IDENTITY_PATH,
    PREVIEW_SESSION_PROTOCOL_VERSION,
} from './constants';
import { parsePreviewSessionIdentity } from './descriptor';
import type { PreviewSessionIdentity } from './types';

// 模块所需的窄 fs 接口;默认实现包装 node fs/promises。
// 注意 mkdir / rmdir 刻意不递归:mkdir 是 ownership 的唯一原子仲裁点,
// rmdir 只能删空目录,是 release 防误删的第二重保护。
export interface PreviewSessionFileSystem {
    ensureDir(path: string): Promise<void>;
    mkdir(path: string): Promise<void>;
    readdir(path: string): Promise<string[]>;
    readFile(path: string): Promise<string>;
    writeFile(path: string, content: string): Promise<void>;
    rename(from: string, to: string): Promise<void>;
    unlink(path: string): Promise<void>;
    rmdir(path: string): Promise<void>;
    // 不存在或不可访问时返回 null,不抛错。
    stat(path: string): Promise<{ isDirectory(): boolean } | null>;
    realpath(path: string): Promise<string>;
}

// 进程操作原语:pid 存活检查、单进程 SIGTERM 与进程树终止。
// 平台语义(issues/16):Windows 上 SIGTERM 是硬杀、不触发 handler;POSIX 走优雅关闭。
// 回收 owner 必须用 terminateTree:scene 等子进程依赖树终止,
// 不能假设它们都能经 IPC disconnect 自愈退出。
export interface PreviewSessionProcessControl {
    isAlive(pid: number): boolean;
    terminate(pid: number): void;
    // 终止 pid 对应的整棵进程树;进程已退出等失败一律忽略,
    // 交由调用方后续的死亡确认轮询判定。
    terminateTree(pid: number): void;
}

// identity endpoint 探测;返回 null 表示不可达(连接失败、超时、非 2xx、响应形状非法)。
export type PreviewSessionIdentityFetcher = (serverUrl: string) => Promise<PreviewSessionIdentity | null>;

export interface PreviewSessionDeps {
    fs?: PreviewSessionFileSystem;
    processControl?: PreviewSessionProcessControl;
    fetchIdentity?: PreviewSessionIdentityFetcher;
    sleep?: (ms: number) => Promise<void>;
    now?: () => number;
    // 本端协议版本,默认 PREVIEW_SESSION_PROTOCOL_VERSION;测试可注入以模拟版本不匹配。
    protocolVersion?: number;
}

export interface ResolvedPreviewSessionDeps {
    fs: PreviewSessionFileSystem;
    processControl: PreviewSessionProcessControl;
    fetchIdentity: PreviewSessionIdentityFetcher;
    sleep: (ms: number) => Promise<void>;
    now: () => number;
    protocolVersion: number;
}

function createNodeFileSystem(): PreviewSessionFileSystem {
    return {
        ensureDir: async (path) => {
            await fsp.mkdir(path, { recursive: true });
        },
        mkdir: (path) => fsp.mkdir(path),
        readdir: (path) => fsp.readdir(path),
        readFile: (path) => fsp.readFile(path, 'utf8'),
        writeFile: (path, content) => fsp.writeFile(path, content, 'utf8'),
        rename: (from, to) => fsp.rename(from, to),
        unlink: (path) => fsp.unlink(path),
        rmdir: (path) => fsp.rmdir(path),
        stat: async (path) => {
            try {
                return await fsp.stat(path);
            } catch {
                return null;
            }
        },
        realpath: (path) => fsp.realpath(path),
    };
}

function createNodeProcessControl(): PreviewSessionProcessControl {
    return {
        isAlive: (pid) => {
            try {
                process.kill(pid, 0);
                return true;
            } catch (error) {
                // EPERM 表示进程存在但无权限发信号,仍按存活处理。
                return (error as NodeJS.ErrnoException).code === 'EPERM';
            }
        },
        terminate: (pid) => {
            try {
                process.kill(pid, 'SIGTERM');
            } catch {
                // 进程已退出或信号失败:交由后续死亡确认轮询判定。
            }
        },
        terminateTree: (pid) => {
            if (process.platform === 'win32') {
                try {
                    // /T 终止整棵进程树、/F 强制;进程已退出时 taskkill 报错,忽略,
                    // 交由后续死亡确认轮询判定。
                    spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
                } catch {
                    // taskkill 不可用:同样交由死亡确认轮询判定。
                }
                return;
            }
            // POSIX:向 owner 发 SIGTERM 走优雅关闭。不向进程组(负 pid)发信号——
            // preview 不以独立进程组启动,误伤同组其它进程;scene 子进程在父进程
            // 退出后随 IPC disconnect 退出。
            try {
                process.kill(pid, 'SIGTERM');
            } catch {
                // 进程已退出或信号失败:交由后续死亡确认轮询判定。
            }
        },
    };
}

function createDefaultIdentityFetcher(): PreviewSessionIdentityFetcher {
    return async (serverUrl) => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), DEFAULT_IDENTITY_FETCH_TIMEOUT_MS);
        try {
            const response = await fetch(new URL(PREVIEW_SESSION_IDENTITY_PATH, serverUrl), {
                signal: controller.signal,
            });
            if (!response.ok) {
                return null;
            }
            return parsePreviewSessionIdentity(await response.json());
        } catch {
            return null;
        } finally {
            clearTimeout(timer);
        }
    };
}

export function resolvePreviewSessionDeps(deps: PreviewSessionDeps = {}): ResolvedPreviewSessionDeps {
    return {
        fs: deps.fs ?? createNodeFileSystem(),
        processControl: deps.processControl ?? createNodeProcessControl(),
        fetchIdentity: deps.fetchIdentity ?? createDefaultIdentityFetcher(),
        sleep: deps.sleep ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms))),
        now: deps.now ?? (() => Date.now()),
        protocolVersion: deps.protocolVersion ?? PREVIEW_SESSION_PROTOCOL_VERSION,
    };
}
