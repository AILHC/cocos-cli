import chalk from 'chalk';
import type { AcquirePreviewSessionOwnershipResult } from '../core/preview-session';

/**
 * 第二次 `cocos preview` 发现已有 session 时的 command 层分支处理。
 * 决策来源:.scratch/preview-session-cli-discovery/spec.md「第二次 cocos preview」
 * (issues/06、17、18):live-compatible + ready → 报 URL/开页/exit 0;
 * starting / live-incompatible / conflict → 报错非零退出,不开页;
 * 参数差异忽略并 stderr warn;live loser 不进入 stdin.resume() 保活路径。
 */

export type PreviewExistingSessionOutcome = 'reused' | 'failed';

export interface ReportExistingPreviewSessionOptions {
    // 与首次启动一致的 open 语义(commander --no-open 时 options.open === false)。
    open: boolean;
    openPage: 'runtime' | 'scene-editor';
    // 第二次启动显式携带、复用 session 时不会生效的参数(见 collectIgnoredPreviewParams)。
    ignoredParams: string[];
    openUrl: (url: string) => Promise<void>;
}

type FailedAcquireResult = Extract<AcquirePreviewSessionOwnershipResult, { acquired: false }>;

export async function reportExistingPreviewSession(
    result: FailedAcquireResult,
    options: ReportExistingPreviewSessionOptions,
): Promise<PreviewExistingSessionOutcome> {
    const descriptor = result.descriptor;
    const reusable = result.reason === 'existing-session'
        && result.liveness === 'live-compatible'
        && descriptor?.state === 'ready'
        && typeof descriptor.serverUrl === 'string'
        && descriptor.serverUrl.length > 0;
    if (!reusable) {
        // starting / live-incompatible / conflict / 回收失败:T1 message 已含 PID 与恢复路径。
        console.error(chalk.red(`Error: ${result.message}`));
        return 'failed';
    }
    const serverUrl = descriptor!.serverUrl!;
    if (options.ignoredParams.length > 0) {
        console.warn(chalk.yellow(
            `Warning: reusing the running preview session; these parameters have no effect: ${options.ignoredParams.join(', ')}`,
        ));
    }
    console.log(chalk.green('A preview session is already running for this project.'));
    console.log(chalk.gray(`Project: ${descriptor!.projectRoot}`));
    console.log(chalk.gray(`URL: ${serverUrl}`));
    console.log(chalk.gray(`Session: ${descriptor!.sessionId} (PID ${descriptor!.pid})`));
    if (options.open) {
        const pageUrl = options.openPage === 'scene-editor' ? `${serverUrl}/scene-editor/` : serverUrl;
        await options.openUrl(pageUrl);
    }
    return 'reused';
}

/**
 * 收集第二次启动显式携带的关键参数。session 参数属于运行中的 owner,descriptor 不存
 * 启动参数,无法逐项比对;凡显式给出的关键参数在复用 session 时一律不生效,列出 warn
 * (issues/06:忽略差异,stderr warn 列出未生效参数)。
 */
export function collectIgnoredPreviewParams(options: any, mode: string): string[] {
    const ignored: string[] = [];
    if (mode === 'build') {
        // mode 差异(issues/F12):本次显式要求 full build,而复用运行中的 session 意味着
        // 完全不会 build,必须明确 warn。descriptor 不记录 owner 的启动 mode,反向
        // (owner 是 build owner 而本次是 runtime)无法可靠判定,只覆盖可判定方向。
        ignored.push('--build');
    }
    if (options.watchAssets === true) {
        ignored.push('--watch-assets');
    }
    if (options.scene !== undefined) {
        ignored.push(`--scene ${options.scene}`);
    }
    if (options.host !== undefined) {
        ignored.push(`--host ${options.host}`);
    }
    if (options.refreshOnReload === true) {
        ignored.push('--refresh-on-reload');
    }
    if (options.clearProgrammingCache === true) {
        ignored.push('--clear-programming-cache');
    }
    if (options.settingsTimeoutMs !== undefined) {
        ignored.push('--settings-timeout-ms');
    }
    if (options.scriptLoadConcurrency !== undefined) {
        ignored.push('--script-load-concurrency');
    }
    if (options.port !== undefined && String(options.port) !== '9527') {
        ignored.push(`--port ${options.port}`);
    }
    if (mode === 'build') {
        if (options.platform !== undefined) {
            ignored.push(`--platform ${options.platform}`);
        }
        if (options.buildConfig !== undefined) {
            ignored.push(`--build-config ${options.buildConfig}`);
        }
    }
    return ignored;
}
