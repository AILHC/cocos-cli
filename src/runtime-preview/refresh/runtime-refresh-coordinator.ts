import { isAbsolute, relative, resolve } from 'node:path';
import {
    createScriptCompileDiagnostic,
    formatScriptCompileDiagnosticSummary,
    type RuntimePreviewOutputState,
    type ScriptCompileDiagnostic,
} from '../../core/scripting/compile-error-diagnostics';

export type RuntimeRefreshReason = 'endpoint' | 'reload';
export type RuntimeRefreshScriptCompileStatus = 'done' | 'skipped' | 'failed';

export interface RuntimeRefreshScriptCompileResult {
    status: RuntimeRefreshScriptCompileStatus;
    durationMs: number;
    error?: string;
    diagnostic?: ScriptCompileDiagnostic;
}

export interface RuntimeRefreshCompileFailureState {
    message: string;
    diagnostic: ScriptCompileDiagnostic;
    createdAt: number;
    generation?: number;
}

type MaybePromise<T> = T | Promise<T>;

export interface RuntimeRefreshFailedTarget {
    target: string;
    error: string;
}

export interface RuntimeRefreshSettledTarget {
    target: string;
    error: string;
}

export interface RuntimeRefreshPassResult {
    index: number;
    targets: string[];
    successfulTargets: string[];
    failedTargets: RuntimeRefreshFailedTarget[];
    settledTargets: RuntimeRefreshSettledTarget[];
    dirtyEventCount: number;
    durationMs: number;
    parentFallbackTargets: string[];
    rootFallback: boolean;
}

export interface RuntimeRefreshResult {
    ok: boolean;
    refreshId: string;
    target: string;
    targets?: string[];
    passes?: RuntimeRefreshPassResult[];
    failedTargets?: RuntimeRefreshFailedTarget[];
    settledTargets?: RuntimeRefreshSettledTarget[];
    pendingDirtyTargetCount?: number;
    pendingSampleTargets?: string[];
    reason: RuntimeRefreshReason;
    changedAssetCount: number | null;
    dirtyEventCount?: number;
    watcher?: RuntimeRefreshWatcherStatus;
    scriptCompile: RuntimeRefreshScriptCompileResult;
    outputState?: RuntimePreviewOutputState;
    compileError?: ScriptCompileDiagnostic;
    durationMs: number;
    error?: string;
}

export interface RuntimeRefreshCoordinator {
    refresh(input: { reason: RuntimeRefreshReason; target?: unknown }): Promise<RuntimeRefreshResult>;
}

export interface RuntimeRefreshCoordinatorOptions {
    projectRoot: string;
    refreshTarget: (target: string) => Promise<number | null | undefined>;
    waitForIdle: (options?: { sinceFailureGeneration?: number }) => Promise<void>;
    invalidateSettings: () => void | Promise<void>;
    clearImportReplacement: () => void | Promise<void>;
    getLastCompileFailure?: (options?: { sinceGeneration?: number }) => MaybePromise<RuntimeRefreshCompileFailureState | null>;
    getCompileFailureGeneration?: () => MaybePromise<number>;
    clearLastCompileFailure?: () => MaybePromise<void>;
    verifyProgrammingOutput?: () => Promise<void>;
    withDeferredScriptCompile?: <T>(operation: () => Promise<T>) => Promise<T>;
    flushDeferredScriptCompile?: () => Promise<unknown>;
    dirtyProvider?: RuntimeRefreshDirtyProvider;
    maxDirtyRefreshPasses?: number;
    logger?: { write: (line: string) => Promise<void> | void };
    now?: () => number;
    reloadDedupeMs?: number;
}

export interface RuntimeRefreshWatcherStatus {
    enabled: boolean;
    running: boolean;
    assetsRoot: string;
    error?: string;
    eventCount: number;
    dirtyTargetCount: number;
    sampleTargets: string[];
}

export interface RuntimeRefreshDirtyProvider {
    drainDirtyTargets(): {
        targets: string[];
        entries?: RuntimeRefreshDirtyEntry[];
        eventCount: number;
        drainedAt: number;
    };
    requeueTargets(targets: string[]): void;
    getStatus(): RuntimeRefreshWatcherStatus;
}

export interface RuntimeRefreshDirtyEntry {
    target: string;
    eventTypes: string[];
    assetEventCount?: number;
    metaEventCount?: number;
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
const dirtySetRefreshTarget = 'dirty-set';
const defaultFailureOutputState: RuntimePreviewOutputState = 'lastGoodDueToFailure';
const parentPathSeparator = '/';

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

function dirnameForDbAssetTarget(target: string): string | null {
    if (target === defaultRefreshTarget) {
        return null;
    }

    const prefix = `${defaultRefreshTarget}/`;
    if (!target.startsWith(prefix)) {
        return null;
    }

    const relativePath = target.slice(prefix.length);
    const slashIndex = relativePath.lastIndexOf(parentPathSeparator);
    if (slashIndex < 0) {
        return defaultRefreshTarget;
    }

    return `${prefix}${relativePath.slice(0, slashIndex)}`;
}

function dedupeTargets(targets: string[]): string[] {
    return Array.from(new Set(targets));
}

function isMissingDirtyTargetError(message: string): boolean {
    const normalized = message.toLowerCase();
    return normalized.includes('can not find asset')
        || normalized.includes('not exists')
        || normalized.includes('not in asset-db');
}

function shouldSettleMissingDirtyTarget(
    entries: RuntimeRefreshDirtyEntry[] | undefined,
    target: string,
    errorMessage: string,
): boolean {
    if (!isMissingDirtyTargetError(errorMessage)) {
        return false;
    }

    const eventTypes = entries?.find((entry) => entry.target === target)?.eventTypes ?? [];
    return eventTypes.includes('delete') || (eventTypes.includes('create') && eventTypes.includes('delete'));
}

function hasChildTarget(parentTarget: string, targets: string[]): boolean {
    const prefix = `${parentTarget}/`;
    return targets.some((target) => target.startsWith(prefix));
}

function optimizeDirtyBatchTargets(
    targets: string[],
    entries: RuntimeRefreshDirtyEntry[] | undefined,
    successfulTargets: Set<string>,
): string[] {
    return targets.filter((target) => {
        const entry = entries?.find((item) => item.target === target);
        const eventTypes = entry?.eventTypes ?? [];
        const isDelete = eventTypes.includes('delete');
        const isPureDelete = isDelete && eventTypes.length === 1;

        if (!isPureDelete && hasChildTarget(target, targets)) {
            return false;
        }

        const assetEventCount = entry?.assetEventCount ?? 1;
        const metaEventCount = entry?.metaEventCount ?? 0;
        if (
            successfulTargets.has(target)
            && assetEventCount === 0
            && metaEventCount > 0
            && !isPureDelete
        ) {
            return false;
        }

        return true;
    });
}

type RuntimeRefreshResultPatch = Partial<Pick<
    RuntimeRefreshResult,
    'targets'
    | 'passes'
    | 'failedTargets'
    | 'settledTargets'
    | 'pendingDirtyTargetCount'
    | 'pendingSampleTargets'
    | 'dirtyEventCount'
    | 'watcher'
>>;

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
        patch: RuntimeRefreshResultPatch = {},
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
        ...patch,
    });

    const createFailedResult = (
        refreshId: string,
        target: string,
        reason: RuntimeRefreshReason,
        startedAt: number,
        changedAssetCount: number | null,
        scriptCompile: RuntimeRefreshScriptCompileResult,
        error: string,
        patch: RuntimeRefreshResultPatch = {},
        structuredFailure: {
            compileError: ScriptCompileDiagnostic;
            outputState: RuntimePreviewOutputState;
        } | null = null,
    ): RuntimeRefreshResult => ({
        ok: false,
        refreshId,
        target,
        reason,
        changedAssetCount,
        scriptCompile,
        ...(structuredFailure ? {
            outputState: structuredFailure.outputState,
            compileError: structuredFailure.compileError,
        } : {}),
        durationMs: now() - startedAt,
        error,
        ...patch,
    });

    const createDiagnostic = (
        error: unknown,
        refreshId: string,
        target: string,
        reason: RuntimeRefreshReason,
    ): ScriptCompileDiagnostic => createScriptCompileDiagnostic(error, {
        phase: reason === 'reload' ? 'reload-refresh' : 'refresh',
        projectRoot: options.projectRoot,
        assetUrl: target,
        refreshId,
        outputState: defaultFailureOutputState,
    });

    const withRuntimeDiagnosticDefaults = (
        diagnostic: ScriptCompileDiagnostic,
        refreshId: string,
        target: string,
    ): ScriptCompileDiagnostic => {
        if (
            diagnostic.refreshId
            && diagnostic.outputState
            && diagnostic.location.assetUrl
        ) {
            return diagnostic;
        }

        return {
            ...diagnostic,
            refreshId: diagnostic.refreshId ?? refreshId,
            outputState: diagnostic.outputState ?? defaultFailureOutputState,
            location: {
                ...diagnostic.location,
                assetUrl: diagnostic.location.assetUrl ?? target,
            },
        };
    };

    const getLastCompileFailureDiagnostic = async (
        refreshId: string,
        target: string,
        sinceGeneration: number,
    ): Promise<ScriptCompileDiagnostic | null> => {
        let failure: RuntimeRefreshCompileFailureState | null | undefined;
        try {
            failure = await options.getLastCompileFailure?.({ sinceGeneration });
        } catch {
            return null;
        }
        return failure ? withRuntimeDiagnosticDefaults(failure.diagnostic, refreshId, target) : null;
    };

    const getCompileFailureGeneration = async (): Promise<number> => {
        try {
            return (await options.getCompileFailureGeneration?.()) ?? 0;
        } catch {
            return 0;
        }
    };

    const createStructuredCompileFailureResult = (
        refreshId: string,
        target: string,
        reason: RuntimeRefreshReason,
        startedAt: number,
        changedAssetCount: number | null,
        diagnostic: ScriptCompileDiagnostic,
        durationMs: number,
        patch: RuntimeRefreshResultPatch = {},
    ): RuntimeRefreshResult => {
        const outputState = diagnostic.outputState ?? defaultFailureOutputState;
        const error = formatScriptCompileDiagnosticSummary(diagnostic);
        const scriptCompile: RuntimeRefreshScriptCompileResult = {
            status: 'failed',
            durationMs,
            error,
            diagnostic,
        };
        return createFailedResult(
            refreshId,
            target,
            reason,
            startedAt,
            changedAssetCount,
            scriptCompile,
            error,
            patch,
            { compileError: diagnostic, outputState },
        );
    };

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
        const failureGenerationBeforeRefresh = await getCompileFailureGeneration();

        try {
            const changed = await options.refreshTarget(target);
            changedAssetCount = typeof changed === 'number' ? changed : null;
        } catch (error) {
            const diagnostic = await getLastCompileFailureDiagnostic(
                refreshId,
                target,
                failureGenerationBeforeRefresh,
            );
            const result = diagnostic
                ? createStructuredCompileFailureResult(
                    refreshId,
                    target,
                    reason,
                    startedAt,
                    changedAssetCount,
                    diagnostic,
                    now() - startedAt,
                )
                : createSkippedResult(refreshId, target, reason, startedAt, getErrorMessage(error));
            await writeResult(result);
            return result;
        }

        const scriptStartedAt = now();
        let scriptCompile: RuntimeRefreshScriptCompileResult;
        try {
            await options.flushDeferredScriptCompile?.();
            await options.waitForIdle({ sinceFailureGeneration: failureGenerationBeforeRefresh });
            scriptCompile = {
                status: 'done',
                durationMs: now() - scriptStartedAt,
            };
        } catch (error) {
            const diagnostic = await getLastCompileFailureDiagnostic(
                refreshId,
                target,
                failureGenerationBeforeRefresh,
            ) ?? createDiagnostic(error, refreshId, target, reason);
            const result = createStructuredCompileFailureResult(
                refreshId,
                target,
                reason,
                startedAt,
                changedAssetCount,
                diagnostic,
                now() - scriptStartedAt,
            );
            await writeResult(result);
            return result;
        }

        const failureDiagnostic = await getLastCompileFailureDiagnostic(
            refreshId,
            target,
            failureGenerationBeforeRefresh,
        );
        if (failureDiagnostic) {
            const result = createStructuredCompileFailureResult(
                refreshId,
                target,
                reason,
                startedAt,
                changedAssetCount,
                failureDiagnostic,
                now() - scriptStartedAt,
            );
            await writeResult(result);
            return result;
        }

        try {
            await options.verifyProgrammingOutput?.();
        } catch (error) {
            const result = createStructuredCompileFailureResult(
                refreshId,
                target,
                reason,
                startedAt,
                changedAssetCount,
                createDiagnostic(error, refreshId, target, reason),
                now() - scriptStartedAt,
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

    const runPostRefreshWork = async (
        refreshId: string,
        target: string,
        reason: RuntimeRefreshReason,
        startedAt: number,
        changedAssetCount: number | null,
        patch: RuntimeRefreshResultPatch,
        failureGenerationBeforeRefresh: number,
    ): Promise<{ ok: true; scriptCompile: RuntimeRefreshScriptCompileResult } | { ok: false; result: RuntimeRefreshResult }> => {
        const scriptStartedAt = now();
        let scriptCompile: RuntimeRefreshScriptCompileResult;
        try {
            await options.flushDeferredScriptCompile?.();
            await options.waitForIdle({ sinceFailureGeneration: failureGenerationBeforeRefresh });
            scriptCompile = {
                status: 'done',
                durationMs: now() - scriptStartedAt,
            };
        } catch (error) {
            const diagnostic = await getLastCompileFailureDiagnostic(
                refreshId,
                target,
                failureGenerationBeforeRefresh,
            ) ?? createDiagnostic(error, refreshId, target, reason);
            const result = createStructuredCompileFailureResult(
                refreshId,
                target,
                reason,
                startedAt,
                changedAssetCount,
                diagnostic,
                now() - scriptStartedAt,
                patch,
            );
            await writeResult(result);
            return { ok: false, result };
        }

        const failureDiagnostic = await getLastCompileFailureDiagnostic(
            refreshId,
            target,
            failureGenerationBeforeRefresh,
        );
        if (failureDiagnostic) {
            const result = createStructuredCompileFailureResult(
                refreshId,
                target,
                reason,
                startedAt,
                changedAssetCount,
                failureDiagnostic,
                now() - scriptStartedAt,
                patch,
            );
            await writeResult(result);
            return { ok: false, result };
        }

        try {
            await options.verifyProgrammingOutput?.();
        } catch (error) {
            const result = createStructuredCompileFailureResult(
                refreshId,
                target,
                reason,
                startedAt,
                changedAssetCount,
                createDiagnostic(error, refreshId, target, reason),
                now() - scriptStartedAt,
                patch,
            );
            await writeResult(result);
            return { ok: false, result };
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
                patch,
            );
            await writeResult(result);
            return { ok: false, result };
        }

        return { ok: true, scriptCompile };
    };

    const refreshDirtySet = async (
        refreshId: string,
        reason: RuntimeRefreshReason,
        startedAt: number,
    ): Promise<RuntimeRefreshResult> => {
        const dirtyProvider = options.dirtyProvider;
        if (!dirtyProvider) {
            throw new Error('Runtime dirty refresh requested without dirty provider.');
        }
        const withDeferredScriptCompile = options.withDeferredScriptCompile;
        const shouldDeferScriptCompile = !!withDeferredScriptCompile
            && dirtyProvider.getStatus().dirtyTargetCount > 0;
        const refreshDirtyTarget = (target: string): Promise<number | null | undefined> => (
            shouldDeferScriptCompile
                ? withDeferredScriptCompile(() => options.refreshTarget(target))
                : options.refreshTarget(target)
        );

        const maxPasses = options.maxDirtyRefreshPasses ?? 3;
        const allTargets: string[] = [];
        const allPasses: RuntimeRefreshPassResult[] = [];
        const allFailedTargets: RuntimeRefreshFailedTarget[] = [];
        const allSettledTargets: RuntimeRefreshSettledTarget[] = [];
        let changedAssetCount = 0;
        let dirtyEventCount = 0;
        const successfulTargetSet = new Set<string>();
        let failureGenerationBeforeRefresh: number | null = null;

        for (let passIndex = 1; passIndex <= maxPasses; passIndex += 1) {
            const passStartedAt = now();
            const batch = dirtyProvider.drainDirtyTargets();
            dirtyEventCount += batch.eventCount;

            if (batch.targets.length === 0) {
                if (allPasses.length === 0) {
                    const watcher = dirtyProvider.getStatus();
                    const result = createSkippedResult(refreshId, dirtySetRefreshTarget, reason, startedAt, undefined, {
                        targets: [],
                        passes: [],
                        dirtyEventCount: batch.eventCount,
                        watcher,
                    });
                    await writeResult(result);
                    return result;
                }
                break;
            }

            const passTargets = optimizeDirtyBatchTargets(batch.targets, batch.entries, successfulTargetSet);
            const passTargetSet = new Set(passTargets);
            if (passTargets.length === 0) {
                break;
            }

            const successfulTargets: string[] = [];
            const failedTargets: RuntimeRefreshFailedTarget[] = [];
            const settledTargets: RuntimeRefreshSettledTarget[] = [];
            const parentFallbackTargets: string[] = [];
            let rootFallback = false;
            const parentFallbackTargetSet = new Set<string>();
            failureGenerationBeforeRefresh ??= await getCompileFailureGeneration();

            for (const target of passTargets) {
                allTargets.push(target);
                try {
                    const changed = await refreshDirtyTarget(target);
                    successfulTargets.push(target);
                    successfulTargetSet.add(target);
                    if (typeof changed === 'number') {
                        changedAssetCount += changed;
                    }
                } catch (error) {
                    const errorMessage = getErrorMessage(error);
                    if (shouldSettleMissingDirtyTarget(batch.entries, target, errorMessage)) {
                        settledTargets.push({ target, error: errorMessage });
                        const parentTarget = dirnameForDbAssetTarget(target);
                        if (
                            parentTarget
                            && !passTargetSet.has(parentTarget)
                            && !successfulTargetSet.has(parentTarget)
                            && !parentFallbackTargetSet.has(parentTarget)
                        ) {
                            parentFallbackTargetSet.add(parentTarget);
                            parentFallbackTargets.push(parentTarget);
                            if (parentTarget === defaultRefreshTarget) {
                                rootFallback = true;
                            }
                            allTargets.push(parentTarget);
                            try {
                                const changed = await refreshDirtyTarget(parentTarget);
                                successfulTargets.push(parentTarget);
                                successfulTargetSet.add(parentTarget);
                                if (typeof changed === 'number') {
                                    changedAssetCount += changed;
                                }
                            } catch (parentError) {
                                failedTargets.push({
                                    target: parentTarget,
                                    error: getErrorMessage(parentError),
                                });
                            }
                        }
                    } else {
                        failedTargets.push({ target, error: errorMessage });
                    }
                }
            }

            allFailedTargets.push(...failedTargets);
            allSettledTargets.push(...settledTargets);
            allPasses.push({
                index: passIndex,
                targets: passTargets,
                successfulTargets,
                failedTargets,
                settledTargets,
                parentFallbackTargets,
                rootFallback,
                dirtyEventCount: batch.eventCount,
                durationMs: now() - passStartedAt,
            });

            if (failedTargets.length > 0) {
                dirtyProvider.requeueTargets(failedTargets.map((item) => item.target));
                break;
            }
        }

        const finalWatcher = dirtyProvider.getStatus();
        const targets = dedupeTargets(allTargets);
        const hasSuccessfulTargets = allPasses.some((pass) => pass.successfulTargets.length > 0);
        const basePatch: RuntimeRefreshResultPatch = {
            targets,
            passes: allPasses,
            dirtyEventCount,
            watcher: finalWatcher,
            ...(allFailedTargets.length > 0 ? { failedTargets: allFailedTargets } : {}),
            ...(allSettledTargets.length > 0 ? { settledTargets: allSettledTargets } : {}),
        };

        let scriptCompile: RuntimeRefreshScriptCompileResult = { status: 'skipped', durationMs: 0 };
        if (hasSuccessfulTargets) {
            const postRefresh = await runPostRefreshWork(
                refreshId,
                dirtySetRefreshTarget,
                reason,
                startedAt,
                changedAssetCount || null,
                basePatch,
                failureGenerationBeforeRefresh ?? 0,
            );
            if (!postRefresh.ok) {
                return postRefresh.result;
            }
            scriptCompile = postRefresh.scriptCompile;
        }

        if (allFailedTargets.length > 0) {
            const result = createFailedResult(
                refreshId,
                dirtySetRefreshTarget,
                reason,
                startedAt,
                changedAssetCount || null,
                scriptCompile,
                `Runtime refresh failed for ${allFailedTargets.length} dirty target(s).`,
                basePatch,
            );
            await writeResult(result);
            return result;
        }

        if (finalWatcher.dirtyTargetCount > 0) {
            const result = createFailedResult(
                refreshId,
                dirtySetRefreshTarget,
                reason,
                startedAt,
                changedAssetCount || null,
                scriptCompile,
                `Runtime asset dirty-set did not become stable within ${maxPasses} pass(es).`,
                {
                    ...basePatch,
                    pendingDirtyTargetCount: finalWatcher.dirtyTargetCount,
                    pendingSampleTargets: finalWatcher.sampleTargets,
                },
            );
            await writeResult(result);
            return result;
        }

        const result: RuntimeRefreshResult = {
            ok: true,
            refreshId,
            target: dirtySetRefreshTarget,
            targets,
            passes: allPasses,
            reason,
            changedAssetCount: hasSuccessfulTargets ? changedAssetCount : null,
            dirtyEventCount,
            watcher: finalWatcher,
            ...(allSettledTargets.length > 0 ? { settledTargets: allSettledTargets } : {}),
            scriptCompile,
            durationMs: now() - startedAt,
        };
        await writeResult(result);
        if (reason === 'endpoint') {
            lastEndpointSuccess = { target: dirtySetRefreshTarget, completedAt: now() };
        }
        return result;
    };

    return {
        async refresh(input: { reason: RuntimeRefreshReason; target?: unknown }): Promise<RuntimeRefreshResult> {
            const startedAt = now();
            const refreshId = createRefreshId();
            const shouldUseDirtyProvider = (input.target === undefined || input.target === '') && !!options.dirtyProvider;

            if (shouldUseDirtyProvider) {
                const pending = inFlight.get(dirtySetRefreshTarget);
                if (pending) {
                    const result = await pending;
                    return {
                        ...result,
                        refreshId,
                        reason: input.reason,
                        durationMs: now() - startedAt,
                    };
                }

                const watcher = options.dirtyProvider!.getStatus();
                if (watcher.enabled && !watcher.running) {
                    const result = createFailedResult(
                        refreshId,
                        dirtySetRefreshTarget,
                        input.reason,
                        startedAt,
                        null,
                        { status: 'skipped', durationMs: 0 },
                        watcher.error ? `Runtime asset watcher unavailable: ${watcher.error}` : 'Runtime asset watcher is not running.',
                        { watcher, targets: [] },
                    );
                    await writeResult(result);
                    return result;
                }

                const refreshPromise = refreshDirtySet(
                    refreshId,
                    input.reason,
                    startedAt,
                )
                    .finally(() => {
                        if (inFlight.get(dirtySetRefreshTarget) === refreshPromise) {
                            inFlight.delete(dirtySetRefreshTarget);
                        }
                    });
                inFlight.set(dirtySetRefreshTarget, refreshPromise);
                return refreshPromise;
            }

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

            const refreshPromise = runRefresh(
                refreshId,
                target,
                input.reason,
                startedAt,
            )
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
