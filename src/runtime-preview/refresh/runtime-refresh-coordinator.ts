import { isAbsolute, relative, resolve } from 'node:path';

export type RuntimeRefreshReason = 'endpoint' | 'reload';
export type RuntimeRefreshScriptCompileStatus = 'done' | 'skipped' | 'failed';

export interface RuntimeRefreshScriptCompileResult {
    status: RuntimeRefreshScriptCompileStatus;
    durationMs: number;
    error?: string;
}

export interface RuntimeRefreshResult {
    ok: boolean;
    refreshId: string;
    target: string;
    reason: RuntimeRefreshReason;
    changedAssetCount: number | null;
    scriptCompile: RuntimeRefreshScriptCompileResult;
    durationMs: number;
    error?: string;
}

export interface RuntimeRefreshCoordinator {
    refresh(input: { reason: RuntimeRefreshReason; target?: unknown }): Promise<RuntimeRefreshResult>;
}

export interface RuntimeRefreshCoordinatorOptions {
    projectRoot: string;
    refreshTarget: (target: string) => Promise<number | null | undefined>;
    waitForIdle: () => Promise<void>;
    invalidateSettings: () => void | Promise<void>;
    clearImportReplacement: () => void | Promise<void>;
    logger?: { write: (line: string) => Promise<void> | void };
    now?: () => number;
    reloadDedupeMs?: number;
}

interface NormalizedRefreshTarget {
    ok: true;
    target: string;
}

interface InvalidRefreshTarget {
    ok: false;
    target: string;
    error: string;
}

type TargetNormalizationResult = NormalizedRefreshTarget | InvalidRefreshTarget;

const defaultReloadDedupeMs = 500;
const defaultRefreshTarget = 'db://assets';

function getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function isInsideOrSameRoot(filePath: string, root: string): boolean {
    const relativePath = relative(resolve(root), resolve(filePath));
    return !relativePath || (!relativePath.startsWith('..') && !isAbsolute(relativePath));
}

function normalizePathForDbUrl(path: string): string {
    return path.replace(/\\/g, '/').replace(/^\/+/, '');
}

function normalizeRefreshTarget(projectRoot: string, target: unknown): TargetNormalizationResult {
    if (target === undefined || target === '') {
        return { ok: true, target: defaultRefreshTarget };
    }

    if (typeof target !== 'string') {
        return {
            ok: false,
            target: defaultRefreshTarget,
            error: 'Runtime refresh target must be a string or undefined.',
        };
    }

    const trimmedTarget = target.trim();
    if (!trimmedTarget) {
        return { ok: true, target: defaultRefreshTarget };
    }

    if (trimmedTarget === 'db://assets' || trimmedTarget.startsWith('db://assets/')) {
        const relativeDbPath = trimmedTarget.slice('db://assets/'.length);
        if (relativeDbPath.split('/').some((segment) => segment === '.' || segment === '..')) {
            return {
                ok: false,
                target: defaultRefreshTarget,
                error: `Runtime refresh target must not contain dot segments: ${trimmedTarget}`,
            };
        }

        return { ok: true, target: trimmedTarget };
    }

    if (!isAbsolute(trimmedTarget)) {
        return {
            ok: false,
            target: defaultRefreshTarget,
            error: `Runtime refresh target is not under db://assets: ${trimmedTarget}`,
        };
    }

    const assetsRoot = resolve(projectRoot, 'assets');
    if (!isInsideOrSameRoot(trimmedTarget, assetsRoot)) {
        return {
            ok: false,
            target: defaultRefreshTarget,
            error: `Runtime refresh target is outside project assets root: ${trimmedTarget}`,
        };
    }

    const relativeAssetPath = normalizePathForDbUrl(relative(assetsRoot, resolve(trimmedTarget)));
    return {
        ok: true,
        target: relativeAssetPath ? `db://assets/${relativeAssetPath}` : defaultRefreshTarget,
    };
}

export function createRuntimeRefreshCoordinator(
    options: RuntimeRefreshCoordinatorOptions,
): RuntimeRefreshCoordinator {
    const now = options.now ?? Date.now;
    const reloadDedupeMs = options.reloadDedupeMs ?? defaultReloadDedupeMs;
    const inFlight = new Map<string, Promise<RuntimeRefreshResult>>();
    let nextId = 1;
    let lastEndpointSuccess: { target: string; completedAt: number } | null = null;

    const createRefreshId = () => `runtime-refresh-${nextId++}`;

    const createSkippedResult = (
        refreshId: string,
        target: string,
        reason: RuntimeRefreshReason,
        startedAt: number,
        error?: string,
    ): RuntimeRefreshResult => ({
        ok: !error,
        refreshId,
        target,
        reason,
        changedAssetCount: null,
        scriptCompile: {
            status: 'skipped',
            durationMs: 0,
        },
        durationMs: now() - startedAt,
        ...(error ? { error } : {}),
    });

    const createFailedResult = (
        refreshId: string,
        target: string,
        reason: RuntimeRefreshReason,
        startedAt: number,
        changedAssetCount: number | null,
        scriptCompile: RuntimeRefreshScriptCompileResult,
        error: string,
    ): RuntimeRefreshResult => ({
        ok: false,
        refreshId,
        target,
        reason,
        changedAssetCount,
        scriptCompile,
        durationMs: now() - startedAt,
        error,
    });

    const writeResult = async (result: RuntimeRefreshResult): Promise<void> => {
        await options.logger?.write(`runtime-refresh ${JSON.stringify(result)}`);
    };

    const runRefresh = async (
        refreshId: string,
        target: string,
        reason: RuntimeRefreshReason,
        startedAt: number,
    ): Promise<RuntimeRefreshResult> => {
        let changedAssetCount: number | null = null;

        try {
            const changed = await options.refreshTarget(target);
            changedAssetCount = typeof changed === 'number' ? changed : null;
        } catch (error) {
            const result = createSkippedResult(refreshId, target, reason, startedAt, getErrorMessage(error));
            await writeResult(result);
            return result;
        }

        const scriptStartedAt = now();
        let scriptCompile: RuntimeRefreshScriptCompileResult;
        try {
            await options.waitForIdle();
            scriptCompile = {
                status: 'done',
                durationMs: now() - scriptStartedAt,
            };
        } catch (error) {
            const errorMessage = getErrorMessage(error);
            scriptCompile = {
                status: 'failed',
                durationMs: now() - scriptStartedAt,
                error: errorMessage,
            };
            const result = createFailedResult(
                refreshId,
                target,
                reason,
                startedAt,
                changedAssetCount,
                scriptCompile,
                errorMessage,
            );
            await writeResult(result);
            return result;
        }

        try {
            await options.invalidateSettings();
            await options.clearImportReplacement();
        } catch (error) {
            const result = createFailedResult(
                refreshId,
                target,
                reason,
                startedAt,
                changedAssetCount,
                scriptCompile,
                getErrorMessage(error),
            );
            await writeResult(result);
            return result;
        }

        const result: RuntimeRefreshResult = {
            ok: true,
            refreshId,
            target,
            reason,
            changedAssetCount,
            scriptCompile,
            durationMs: now() - startedAt,
        };
        await writeResult(result);
        if (reason === 'endpoint') {
            lastEndpointSuccess = { target, completedAt: now() };
        }
        return result;
    };

    return {
        async refresh(input: { reason: RuntimeRefreshReason; target?: unknown }): Promise<RuntimeRefreshResult> {
            const startedAt = now();
            const refreshId = createRefreshId();
            const normalized = normalizeRefreshTarget(options.projectRoot, input.target);

            if (!normalized.ok) {
                const result = createSkippedResult(refreshId, normalized.target, input.reason, startedAt, normalized.error);
                await writeResult(result);
                return result;
            }

            const target = normalized.target;
            if (
                input.reason === 'reload'
                && lastEndpointSuccess?.target === target
                && startedAt - lastEndpointSuccess.completedAt <= reloadDedupeMs
            ) {
                const result = createSkippedResult(refreshId, target, input.reason, startedAt);
                await writeResult(result);
                return result;
            }

            const pending = inFlight.get(target);
            if (pending) {
                const result = await pending;
                return {
                    ...result,
                    refreshId,
                    reason: input.reason,
                    durationMs: now() - startedAt,
                };
            }

            const refreshPromise = runRefresh(refreshId, target, input.reason, startedAt)
                .finally(() => {
                    if (inFlight.get(target) === refreshPromise) {
                        inFlight.delete(target);
                    }
                });
            inFlight.set(target, refreshPromise);
            return refreshPromise;
        },
    };
}
