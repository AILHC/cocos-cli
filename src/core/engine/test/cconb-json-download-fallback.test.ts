import { installCCONBJsonDownloadFallback } from '../cconb-json-download-fallback';

type Complete = (error: Error | null, data?: any) => void;
type Handler = (url: string, options: Record<string, any>, onComplete: Complete) => void;

function createDownloader(jsonHandler: Handler, cconbHandler: Handler = jest.fn()) {
    const handlers: Record<string, Handler> = {
        '.json': jsonHandler,
        '.cconb': cconbHandler,
    };
    const downloader = {
        handlers,
        register: jest.fn((type: string, handler: Handler) => {
            handlers[type] = handler;
        }),
    };
    return { assetManager: { downloader }, downloader, handlers };
}

function response(body: string, ok = true): Response {
    return {
        ok,
        text: async () => body,
        json: async () => JSON.parse(body),
    } as Response;
}

async function flushAsyncFallback(): Promise<void> {
    await new Promise<void>((resolve) => setImmediate(resolve));
}

describe('installCCONBJsonDownloadFallback', () => {
    const originalFetch = globalThis.fetch;

    afterEach(() => {
        globalThis.fetch = originalFetch;
        jest.restoreAllMocks();
    });

    it('resolves canonical versioned subasset JSON URLs to the official CCONB handler', async () => {
        const downloadError = new Error('json 404');
        const jsonHandler = jest.fn((_url, _options, done: Complete) => done(downloadError));
        const ccon = { document: {} };
        const cconbHandler = jest.fn((_url, _options, done: Complete) => done(null, ccon));
        const { assetManager, handlers } = createDownloader(jsonHandler, cconbHandler);
        globalThis.fetch = jest.fn(async () => response('.cconb')) as typeof fetch;

        expect(installCCONBJsonDownloadFallback(assetManager, { isBrowser: true })).toBe(true);
        const complete = jest.fn();
        handlers['.json'](
            'http://localhost:9527/e1/e17f686a-b17e-44ad-814a-f771b44111b4@b47c0.a1b2c3.json?x=1#hash',
            { priority: 1 },
            complete,
        );
        await flushAsyncFallback();

        expect(globalThis.fetch).toHaveBeenCalledWith(
            'http://localhost:9527/scene/query-extname/e17f686a-b17e-44ad-814a-f771b44111b4%40b47c0',
        );
        expect(cconbHandler).toHaveBeenCalledWith(
            'http://localhost:9527/import/e17f686a-b17e-44ad-814a-f771b44111b4%40b47c0.bin?isBrowser=true',
            { priority: 1 },
            expect.any(Function),
        );
        expect(complete).toHaveBeenCalledTimes(1);
        expect(complete).toHaveBeenCalledWith(null, ccon);
    });

    it('does not probe ordinary JSON URLs and preserves the original error', () => {
        const downloadError = new Error('config missing');
        const jsonHandler = jest.fn((_url, _options, done: Complete) => done(downloadError));
        const { assetManager, handlers } = createDownloader(jsonHandler);
        globalThis.fetch = jest.fn() as typeof fetch;
        installCCONBJsonDownloadFallback(assetManager);

        const complete = jest.fn();
        handlers['.json']('http://localhost:9527/config.json?x=1', {}, complete);

        expect(globalThis.fetch).not.toHaveBeenCalled();
        expect(complete).toHaveBeenCalledWith(downloadError, undefined);
    });

    it('rejects mismatched import prefix and non-http URLs', () => {
        const downloadError = new Error('json 404');
        const jsonHandler = jest.fn((_url, _options, done: Complete) => done(downloadError));
        const { assetManager, handlers } = createDownloader(jsonHandler);
        globalThis.fetch = jest.fn() as typeof fetch;
        installCCONBJsonDownloadFallback(assetManager);
        const complete = jest.fn();

        handlers['.json']('http://localhost:9527/ff/e17f686a-b17e-44ad-814a-f771b44111b4.json', {}, complete);
        handlers['.json']('file:///e1/e17f686a-b17e-44ad-814a-f771b44111b4.json', {}, complete);

        expect(globalThis.fetch).not.toHaveBeenCalled();
        expect(complete).toHaveBeenCalledTimes(2);
        expect(complete).toHaveBeenNthCalledWith(1, downloadError, undefined);
        expect(complete).toHaveBeenNthCalledWith(2, downloadError, undefined);
    });

    it('uses an explicit server URL for relative engine import URLs', async () => {
        const downloadError = new Error('json 404');
        const jsonHandler = jest.fn((_url, _options, done: Complete) => done(downloadError));
        const cconbHandler = jest.fn((_url, _options, done: Complete) => done(null, { document: {} }));
        const { assetManager, handlers } = createDownloader(jsonHandler, cconbHandler);
        globalThis.fetch = jest.fn(async () => response('.cconb')) as typeof fetch;
        installCCONBJsonDownloadFallback(assetManager, { serverURL: 'http://localhost:9527' });

        handlers['.json']('/e1/e17f686a-b17e-44ad-814a-f771b44111b4.json', {}, jest.fn());
        await flushAsyncFallback();

        expect(globalThis.fetch).toHaveBeenCalledWith(
            'http://localhost:9527/scene/query-extname/e17f686a-b17e-44ad-814a-f771b44111b4',
        );
    });

    it('preserves the original JSON error when the CCONB handler fails', async () => {
        const downloadError = new Error('json 404');
        const jsonHandler = jest.fn((_url, _options, done: Complete) => done(downloadError));
        const cconbHandler = jest.fn((_url, _options, done: Complete) => done(new Error('binary invalid')));
        const { assetManager, handlers } = createDownloader(jsonHandler, cconbHandler);
        globalThis.fetch = jest.fn(async () => response('.cconb')) as typeof fetch;
        installCCONBJsonDownloadFallback(assetManager);
        const complete = jest.fn();

        handlers['.json']('http://localhost:9527/e1/e17f686a-b17e-44ad-814a-f771b44111b4.json', {}, complete);
        await flushAsyncFallback();

        expect(complete).toHaveBeenCalledTimes(1);
        expect(complete).toHaveBeenCalledWith(downloadError, undefined);
        expect(cconbHandler).toHaveBeenCalledWith(
            'http://localhost:9527/import/e17f686a-b17e-44ad-814a-f771b44111b4.bin',
            {},
            expect.any(Function),
        );
    });

    it('completes once when the downstream callback throws inside the fallback task', async () => {
        const downloadError = new Error('json 404');
        const jsonHandler = jest.fn((_url, _options, done: Complete) => done(downloadError));
        const { assetManager, handlers } = createDownloader(jsonHandler);
        globalThis.fetch = jest.fn(async () => response('')) as typeof fetch;
        installCCONBJsonDownloadFallback(assetManager);
        const complete = jest.fn(() => {
            throw new Error('downstream failure');
        });

        handlers['.json']('http://localhost:9527/e1/e17f686a-b17e-44ad-814a-f771b44111b4.json', {}, complete);
        await flushAsyncFallback();

        expect(complete).toHaveBeenCalledTimes(1);
    });

    it('installs once and captures the current JSON handler', () => {
        const jsonHandler = jest.fn((_url, _options, done: Complete) => done(null, { ok: true }));
        const { assetManager, downloader, handlers } = createDownloader(jsonHandler);

        expect(installCCONBJsonDownloadFallback(assetManager)).toBe(true);
        expect(installCCONBJsonDownloadFallback(assetManager)).toBe(false);
        handlers['.json']('http://localhost:9527/config.json', {}, jest.fn());

        expect(downloader.register).toHaveBeenCalledTimes(1);
        expect(jsonHandler).toHaveBeenCalledTimes(1);
    });
});
