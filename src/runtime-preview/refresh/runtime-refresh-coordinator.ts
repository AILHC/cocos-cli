import {
    createScriptCompileDiagnostic,
    formatScriptCompileDiagnosticSummary,
    type RuntimePreviewOutputState,
    type ScriptCompileDiagnostic,
} from '../../core/scripting/compile-error-diagnostics';
import {
    createRuntimeAssetPathCanonicalizer,
    type RuntimeAssetPathCanonicalizer,
} from '../path/runtime-asset-path-canonicalizer';
import type {
    RuntimeAssetDbIntegrityCheck,
    RuntimeAssetDbIntegrityIssue,
    RuntimeAssetDbIntegrityPhase,
} from './runtime-assetdb-integrity';

export type RuntimeRefreshReason = 'endpoint' | 'reload' | 'asset-db';
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
    failureType?: 'asset-db-integrity';
    assetDbIntegrity?: RuntimeAssetDbIntegrityResult;
    durationMs: number;
    error?: string;
    assetDbGeneration?: number;
}

export interface RuntimeAssetDbIntegrityVerification extends RuntimeAssetDbIntegrityCheck {
    phase: RuntimeAssetDbIntegrityPhase;
    durationMs: number;
    samples: Array<RuntimeAssetDbIntegrityIssue & { queryPhase: RuntimeAssetDbIntegrityPhase }>;
}

export interface RuntimeAssetDbIntegrityResult {
    status: 'passed' | 'recovered' | 'failed';
    initial: RuntimeAssetDbIntegrityVerification;
    recovery?: {
        attempted: true;
        action: 'refresh-db-assets';
        target: 'db://assets';
        durationMs: number;
        changedAssetCount: number | null;
        error?: string;
    };
    final?: RuntimeAssetDbIntegrityVerification;
}

export interface RuntimeRefreshCoordinator {
    refresh(input: { reason: RuntimeRefreshReason; target?: unknown }): Promise<RuntimeRefreshResult>;
    refreshImportedAsset(input: { target: unknown; generation: number }): Promise<RuntimeRefreshResult>;
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
    verifyAssetDbIntegrity?: (input: {
        phase: RuntimeAssetDbIntegrityPhase;
    }) => Promise<RuntimeAssetDbIntegrityCheck>;
    withDeferredScriptCompile?: <T>(operation: () => Promise<T>) => Promise<T>;
    flushDeferredScriptCompile?: () => Promise<unknown>;
    dirtyProvider?: RuntimeRefreshDirtyProvider;
    maxDirtyRefreshPasses?: number;
    pathCanonicalizer?: RuntimeAssetPathCanonicalizer;
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

const defaultReloadDedupeMs = 500;
const defaultRefreshTarget = 'db://assets';
const dirtySetRefreshTarget = 'dirty-set';
const defaultFailureOutputState: RuntimePreviewOutputState = 'lastGoodDueToFailure';
const parentPathSeparator = '/';

function getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
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

function getTargetsWithChildren(targets: string[]): Set<string> {
    const sortedTargets = [...targets].sort();
    const targetsWithChildren = new Set<string>();
    for (let index = 0; index < sortedTargets.length - 1; index += 1) {
        const target = sortedTargets[index];
        const nextTarget = sortedTargets[index + 1];
        if (nextTarget.startsWith(`${target}/`)) {
            targetsWithChildren.add(target);
        }
    }
    return targetsWithChildren;
}

function optimizeDirtyBatchTargets(
    targets: string[],
    entries: RuntimeRefreshDirtyEntry[] | undefined,
    successfulTargets: Set<string>,
): string[] {
    const entriesByTarget = new Map(
        (entries ?? []).map((entry) => [entry.target, entry]),
    );
    const targetsWithChildren = getTargetsWithChildren(targets);

    return targets.filter((target) => {
        const entry = entriesByTarget.get(target);
        const eventTypes = entry?.eventTypes ?? [];
        const isDelete = eventTypes.includes('delete');
        const isPureDelete = isDelete && eventTypes.length === 1;

        if (!isPureDelete && targetsWithChildren.has(target)) {
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

function mergeDirtyEntry(
    entriesByTarget: Map<string, RuntimeRefreshDirtyEntry>,
    target: string,
    entry: RuntimeRefreshDirtyEntry | undefined,
): void {
    const existing = entriesByTarget.get(target) ?? {
        target,
        eventTypes: [],
        assetEventCount: 0,
        metaEventCount: 0,
    };
    const eventTypes = new Set(existing.eventTypes);
    for (const eventType of entry?.eventTypes ?? ['update']) {
        eventTypes.add(eventType);
    }
    existing.eventTypes = Array.from(eventTypes).sort();
    existing.assetEventCount = (existing.assetEventCount ?? 0) + (entry?.assetEventCount ?? 1);
    existing.metaEventCount = (existing.metaEventCount ?? 0) + (entry?.metaEventCount ?? 0);
    entriesByTarget.set(target, existing);
}

function canonicalizeDirtyBatchTargets(
    pathCanonicalizer: RuntimeAssetPathCanonicalizer,
    targets: string[],
    entries: RuntimeRefreshDirtyEntry[] | undefined,
): {
    targets: string[];
    entries: RuntimeRefreshDirtyEntry[];
    failedTargets: RuntimeRefreshFailedTarget[];
} {
    const entriesByTarget = new Map<string, RuntimeRefreshDirtyEntry>();
    const entriesByOriginalTarget = new Map(
        (entries ?? []).map((entry) => [entry.target, entry]),
    );
    const failedTargets: RuntimeRefreshFailedTarget[] = [];

    for (const target of targets) {
        const normalized = pathCanonicalizer.refreshTargetToDbTarget(target, 'dirty-target');
        if (!normalized.ok) {
            failedTargets.push({ target, error: normalized.message });
            continue;
        }
        const entry = entriesByOriginalTarget.get(target);
        mergeDirtyEntry(entriesByTarget, normalized.canonicalTarget, entry);
    }

    const canonicalEntries = Array.from(entriesByTarget.values())
        .sort((left, right) => left.target.localeCompare(right.target));
    return {
        targets: canonicalEntries.map((entry) => entry.target),
        entries: canonicalEntries,
        failedTargets,
    };
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
    | 'failureType'
    | 'assetDbIntegrity'
    | 'assetDbGeneration'
>>;

export function createRuntimeRefreshCoordinator(
    options: RuntimeRefreshCoordinatorOptions,
): RuntimeRefreshCoordinator {
    const now = options.now ?? Date.now;
    const reloadDedupeMs = options.reloadDedupeMs ?? defaultReloadDedupeMs;
    const pathCanonicalizer = options.pathCanonicalizer
        ?? createRuntimeAssetPathCanonicalizer({ projectRoot: options.projectRoot });
    const inFlight = new Map<string, Promise<RuntimeRefreshResult>>();
    const importedInFlight = new Map<string, Promise<RuntimeRefreshResult>>();
    const importedGenerationByTarget = new Map<string, number>();
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

    const verifyAssetDbIntegrity = async (
        phase: RuntimeAssetDbIntegrityPhase,
    ): Promise<RuntimeAssetDbIntegrityVerification | null> => {
        if (!options.verifyAssetDbIntegrity) {
            return null;
        }
        const startedAt = now();
        try {
            const result = await options.verifyAssetDbIntegrity({ phase });
            return {
                ...result,
                phase,
                durationMs: now() - startedAt,
                samples: result.samples.map((sample) => ({ ...sample, queryPhase: phase })),
            };
        } catch (error) {
            return {
                ok: false,
                phase,
                checkedUuidCount: 0,
                invalidUuidCount: 0,
                samples: [],
                sampleLimit: 0,
                durationMs: now() - startedAt,
                error: getErrorMessage(error),
            };
        }
    };

    const formatIntegrityError = (integrity: RuntimeAssetDbIntegrityResult): string => {
        const check = integrity.final ?? integrity.initial;
        const sampleUuids = check.samples.map((sample) => sample.uuid).join(', ');
        const detail = check.error
            ? ` Verification error: ${check.error}`
            : sampleUuids
                ? ` Invalid UUID sample: ${sampleUuids}.`
                : '';
        return `Runtime AssetDB integrity verification failed after ${check.phase}; invalidUuidCount=${check.invalidUuidCount}.${detail}`;
    };

    const runImportedAssetRefresh = async (
        refreshId: string,
        target: string,
        generation: number,
        startedAt: number,
    ): Promise<RuntimeRefreshResult> => {
        try {
            await options.invalidateSettings();
            await options.clearImportReplacement();
        } catch (error) {
            const result = createFailedResult(
                refreshId,
                target,
                'asset-db',
                startedAt,
                null,
                { status: 'skipped', durationMs: 0 },
                getErrorMessage(error),
                { assetDbGeneration: generation },
            );
            await writeResult(result);
            return result;
        }

        const result: RuntimeRefreshResult = {
            ok: true,
            refreshId,
            target,
            reason: 'asset-db',
            changedAssetCount: null,
            scriptCompile: {
                status: 'skipped',
                durationMs: 0,
            },
            durationMs: now() - startedAt,
            assetDbGeneration: generation,
        };
        importedGenerationByTarget.set(
            target,
            Math.max(importedGenerationByTarget.get(target) ?? 0, generation),
        );
        await writeResult(result);
        return result;
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

        const postRefresh = await runPostRefreshWork(
            refreshId,
            target,
            reason,
            startedAt,
            changedAssetCount,
            {},
            failureGenerationBeforeRefresh,
        );
        if (!postRefresh.ok) {
            return postRefresh.result;
        }
        const { scriptCompile, assetDbIntegrity } = postRefresh;

        const result: RuntimeRefreshResult = {
            ok: true,
            refreshId,
            target,
            reason,
            changedAssetCount,
            scriptCompile,
            ...(assetDbIntegrity ? { assetDbIntegrity } : {}),
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
    ): Promise<{
        ok: true;
        scriptCompile: RuntimeRefreshScriptCompileResult;
        assetDbIntegrity: RuntimeAssetDbIntegrityResult | null;
    } | { ok: false; result: RuntimeRefreshResult }> => {
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

        let assetDbIntegrity: RuntimeAssetDbIntegrityResult | null = null;
        const initialIntegrity = await verifyAssetDbIntegrity('post-incremental-refresh');
        if (initialIntegrity) {
            assetDbIntegrity = {
                status: initialIntegrity.ok ? 'passed' : 'failed',
                initial: initialIntegrity,
            };
        }

        if (initialIntegrity && !initialIntegrity.ok) {
            const recoveryIntegrity = assetDbIntegrity!;
            const recoveryStartedAt = now();
            const recoveryFailureGeneration = await getCompileFailureGeneration();
            let recoveryChangedAssetCount: number | null = null;
            try {
                const changed = await options.refreshTarget(defaultRefreshTarget);
                recoveryChangedAssetCount = typeof changed === 'number' ? changed : null;
            } catch (error) {
                recoveryIntegrity.recovery = {
                    attempted: true,
                    action: 'refresh-db-assets',
                    target: defaultRefreshTarget,
                    durationMs: now() - recoveryStartedAt,
                    changedAssetCount: recoveryChangedAssetCount,
                    error: getErrorMessage(error),
                };
                const result = createFailedResult(
                    refreshId,
                    target,
                    reason,
                    startedAt,
                    changedAssetCount,
                    scriptCompile,
                    formatIntegrityError(recoveryIntegrity),
                    {
                        ...patch,
                        failureType: 'asset-db-integrity',
                        assetDbIntegrity: recoveryIntegrity,
                    },
                );
                await writeResult(result);
                return { ok: false, result };
            }

            try {
                await options.flushDeferredScriptCompile?.();
                await options.waitForIdle({ sinceFailureGeneration: recoveryFailureGeneration });
                const failureDiagnostic = await getLastCompileFailureDiagnostic(
                    refreshId,
                    defaultRefreshTarget,
                    recoveryFailureGeneration,
                );
                if (failureDiagnostic) {
                    throw failureDiagnostic;
                }
                await options.verifyProgrammingOutput?.();
                scriptCompile.durationMs = now() - scriptStartedAt;
            } catch (error) {
                recoveryIntegrity.recovery = {
                    attempted: true,
                    action: 'refresh-db-assets',
                    target: defaultRefreshTarget,
                    durationMs: now() - recoveryStartedAt,
                    changedAssetCount: recoveryChangedAssetCount,
                    error: getErrorMessage(error),
                };
                const diagnostic = typeof error === 'object' && error !== null && 'location' in error
                    ? error as ScriptCompileDiagnostic
                    : createDiagnostic(error, refreshId, defaultRefreshTarget, reason);
                const result = createStructuredCompileFailureResult(
                    refreshId,
                    target,
                    reason,
                    startedAt,
                    changedAssetCount,
                    diagnostic,
                    now() - scriptStartedAt,
                    {
                        ...patch,
                        assetDbIntegrity: recoveryIntegrity,
                    },
                );
                await writeResult(result);
                return { ok: false, result };
            }

            recoveryIntegrity.recovery = {
                attempted: true,
                action: 'refresh-db-assets',
                target: defaultRefreshTarget,
                durationMs: now() - recoveryStartedAt,
                changedAssetCount: recoveryChangedAssetCount,
            };
            const finalIntegrity = await verifyAssetDbIntegrity('post-root-refresh');
            if (!finalIntegrity?.ok) {
                if (finalIntegrity) {
                    recoveryIntegrity.final = finalIntegrity;
                }
                const result = createFailedResult(
                    refreshId,
                    target,
                    reason,
                    startedAt,
                    changedAssetCount,
                    scriptCompile,
                    formatIntegrityError(recoveryIntegrity),
                    {
                        ...patch,
                        failureType: 'asset-db-integrity',
                        assetDbIntegrity: recoveryIntegrity,
                    },
                );
                await writeResult(result);
                return { ok: false, result };
            }
            recoveryIntegrity.status = 'recovered';
            recoveryIntegrity.final = finalIntegrity;
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

        return { ok: true, scriptCompile, assetDbIntegrity };
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

            const canonicalBatch = canonicalizeDirtyBatchTargets(pathCanonicalizer, batch.targets, batch.entries);
            const passInitialFailedTargets = canonicalBatch.failedTargets;

            const passTargets = optimizeDirtyBatchTargets(canonicalBatch.targets, canonicalBatch.entries, successfulTargetSet);
            const passTargetSet = new Set(passTargets);
            if (passTargets.length === 0 && passInitialFailedTargets.length === 0) {
                break;
            }

            const successfulTargets: string[] = [];
            const failedTargets: RuntimeRefreshFailedTarget[] = [...passInitialFailedTargets];
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
                    if (shouldSettleMissingDirtyTarget(canonicalBatch.entries, target, errorMessage)) {
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

            const refreshFailedTargets = failedTargets.filter(
                (item) => !passInitialFailedTargets.some((failed) => failed.target === item.target),
            );
            if (refreshFailedTargets.length > 0) {
                dirtyProvider.requeueTargets(refreshFailedTargets.map((item) => item.target));
                break;
            }
            if (passInitialFailedTargets.length > 0) {
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
            if (postRefresh.assetDbIntegrity) {
                basePatch.assetDbIntegrity = postRefresh.assetDbIntegrity;
            }
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
            ...(basePatch.assetDbIntegrity ? { assetDbIntegrity: basePatch.assetDbIntegrity } : {}),
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

            const normalized = pathCanonicalizer.refreshTargetToDbTarget(input.target, 'refresh-target');

            if (!normalized.ok) {
                const result = createSkippedResult(refreshId, defaultRefreshTarget, input.reason, startedAt, normalized.message);
                await writeResult(result);
                return result;
            }

            const target = normalized.canonicalTarget;
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
        async refreshImportedAsset(input): Promise<RuntimeRefreshResult> {
            const startedAt = now();
            const refreshId = createRefreshId();
            const normalized = pathCanonicalizer.refreshTargetToDbTarget(input.target, 'refresh-target');
            if (!normalized.ok) {
                const result = createSkippedResult(
                    refreshId,
                    defaultRefreshTarget,
                    'asset-db',
                    startedAt,
                    normalized.message,
                    { assetDbGeneration: input.generation },
                );
                await writeResult(result);
                return result;
            }
            if (!Number.isSafeInteger(input.generation) || input.generation <= 0) {
                const result = createSkippedResult(
                    refreshId,
                    normalized.canonicalTarget,
                    'asset-db',
                    startedAt,
                    'AssetDB success generation must be a positive safe integer.',
                    { assetDbGeneration: input.generation },
                );
                await writeResult(result);
                return result;
            }

            const target = normalized.canonicalTarget;
            const pending = importedInFlight.get(target);
            const runQueuedRefresh = async (): Promise<RuntimeRefreshResult> => {
                const completedGeneration = importedGenerationByTarget.get(target) ?? 0;
                if (completedGeneration >= input.generation) {
                    const result = createSkippedResult(
                        refreshId,
                        target,
                        'asset-db',
                        startedAt,
                        undefined,
                        { assetDbGeneration: input.generation },
                    );
                    await writeResult(result);
                    return result;
                }

                return runImportedAssetRefresh(
                    refreshId,
                    target,
                    input.generation,
                    startedAt,
                );
            };
            const refreshPromise = (
                pending
                    ? pending.then(runQueuedRefresh, runQueuedRefresh)
                    : runQueuedRefresh()
            ).finally(() => {
                if (importedInFlight.get(target) === refreshPromise) {
                    importedInFlight.delete(target);
                }
            });
            importedInFlight.set(target, refreshPromise);
            return refreshPromise;
        },
    };
}
