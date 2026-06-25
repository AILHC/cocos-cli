export interface RuntimePreviewScriptLoadLimiterMetrics {
    active: number;
    maxActive: number;
    queuePeak: number;
    enqueued: number;
    completed: number;
    failed: number;
    retryCount: number;
    bypassed: number;
}

export interface RuntimePreviewScriptLoadLimiterState {
    hook: 'fetchScript' | 'instantiate';
    concurrency: number;
    metrics: RuntimePreviewScriptLoadLimiterMetrics;
}

export interface RuntimePreviewScriptLoadLimiterOptions {
    concurrency?: number;
    retry?: number;
}

type RuntimePreviewSystem = {
    fetchScript?: (...args: any[]) => Promise<unknown>;
    instantiate?: (...args: any[]) => Promise<unknown>;
    [key: string]: any;
};

type ReleaseSlot = () => void;
type QueueEntry = (release: ReleaseSlot) => void;

const INSTALL_STATE_KEY = '__runtimePreviewScriptLoadLimiterState';
const DEFAULT_CONCURRENCY = 32;
const DEFAULT_RETRY = 1;

export function isRuntimePreviewProjectChunkUrl(value: string): boolean {
    if (!value) {
        return false;
    }
    try {
        const base = typeof window !== 'undefined' ? window.location.href : 'http://127.0.0.1/';
        const parsed = new URL(value, base);
        return /\/scripting\/x\/packer-driver\/targets\/preview\/chunks\/[^/]+\/[^/]+\.js$/.test(parsed.pathname);
    } catch {
        return false;
    }
}

export function isScriptLoadFailure(error: unknown, url: string): boolean {
    const message = error instanceof Error
        ? `${error.message}\n${error.stack ?? ''}`
        : String(error ?? '');
    if (!message.includes(url)) {
        return false;
    }
    return message.includes('ERR_INSUFFICIENT_RESOURCES')
        || message.includes('Error loading')
        || /Get .* failed/.test(message)
        || /Loading script .* failed/.test(message);
}

export function installRuntimePreviewScriptLoadLimiter(
    system: RuntimePreviewSystem = (globalThis as any).System,
    options: RuntimePreviewScriptLoadLimiterOptions = {},
): RuntimePreviewScriptLoadLimiterState {
    if (!system) {
        throw new Error('SystemJS is missing.');
    }

    const existing = system[INSTALL_STATE_KEY] as RuntimePreviewScriptLoadLimiterState | undefined;
    if (existing) {
        return existing;
    }

    const hook = typeof system.fetchScript === 'function' ? 'fetchScript' : 'instantiate';
    const original = system[hook];
    if (typeof original !== 'function') {
        throw new Error('SystemJS script load hook is missing.');
    }

    const concurrency = resolveConcurrency(options.concurrency);
    const retry = resolveRetry(options.retry);
    const metrics: RuntimePreviewScriptLoadLimiterMetrics = {
        active: 0,
        maxActive: 0,
        queuePeak: 0,
        enqueued: 0,
        completed: 0,
        failed: 0,
        retryCount: 0,
        bypassed: 0,
    };
    const state: RuntimePreviewScriptLoadLimiterState = {
        hook,
        concurrency,
        metrics,
    };
    const queue: QueueEntry[] = [];

    const acquire = (): Promise<ReleaseSlot> => {
        if (metrics.active < concurrency) {
            metrics.active += 1;
            metrics.maxActive = Math.max(metrics.maxActive, metrics.active);
            return Promise.resolve(release);
        }

        return new Promise((resolve) => {
            queue.push(resolve);
            metrics.queuePeak = Math.max(metrics.queuePeak, queue.length);
        });
    };

    const release = (): void => {
        const next = queue.shift();
        if (next) {
            next(release);
            return;
        }
        metrics.active -= 1;
        metrics.active = Math.max(metrics.active, 0);
    };

    system[hook] = async function limitedRuntimePreviewScriptLoad(...args: any[]) {
        const url = String(args[0] ?? '');
        if (!isRuntimePreviewProjectChunkUrl(url)) {
            metrics.bypassed += 1;
            return original.apply(this, args);
        }

        metrics.enqueued += 1;
        const releaseSlot = await acquire();
        try {
            const result = await callWithRetry(original, this, args, url, retry, metrics);
            metrics.completed += 1;
            return result;
        } catch (error) {
            metrics.failed += 1;
            throw error;
        } finally {
            releaseSlot();
        }
    };

    system[INSTALL_STATE_KEY] = state;
    return state;
}

async function callWithRetry(
    original: (...args: any[]) => Promise<unknown>,
    receiver: unknown,
    args: any[],
    url: string,
    retry: number,
    metrics: RuntimePreviewScriptLoadLimiterMetrics,
): Promise<unknown> {
    let attempt = 0;
    for (;;) {
        try {
            return await original.apply(receiver, args);
        } catch (error) {
            if (attempt >= retry || !isScriptLoadFailure(error, url)) {
                throw error;
            }
            attempt += 1;
            metrics.retryCount += 1;
        }
    }
}

function resolveConcurrency(explicit: number | undefined): number {
    const candidate = explicit ?? readConcurrencyFromQuery();
    if (!Number.isFinite(candidate) || candidate < 1) {
        return DEFAULT_CONCURRENCY;
    }
    return Math.floor(candidate);
}

function resolveRetry(explicit: number | undefined): number {
    if (!Number.isFinite(explicit)) {
        return DEFAULT_RETRY;
    }
    return Math.max(0, Math.floor(explicit));
}

function readConcurrencyFromQuery(): number | undefined {
    if (typeof window === 'undefined') {
        return undefined;
    }
    const raw = new URLSearchParams(window.location.search).get('runtimePreviewScriptLoadConcurrency');
    if (!raw) {
        return undefined;
    }
    const value = Number(raw);
    return Number.isFinite(value) ? value : undefined;
}
