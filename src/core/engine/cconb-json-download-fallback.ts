type DownloadComplete = (error: Error | null, data?: any) => void;
type DownloadHandler = (url: string, options: Record<string, any>, onComplete: DownloadComplete) => void;

interface DownloaderLike {
    handlers: Record<string, DownloadHandler | undefined>;
    register(type: string, handler: DownloadHandler): void;
}

export interface ICCONBJsonDownloadFallbackOptions {
    isBrowser?: boolean;
    serverURL?: string;
}

const installedDownloaders = new WeakSet<object>();
const IMPORT_JSON_URL_RE = /\/([0-9a-f]{2})\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\.[^/.]+)?\.json$/i;

function parseImportRequest(url: string, serverURL?: string): { origin: string; uuid: string } | null {
    let requestUrl: URL;
    try {
        if (/^https?:\/\//i.test(url)) {
            requestUrl = new URL(url);
        } else if (serverURL) {
            requestUrl = new URL(url, `${serverURL.replace(/\/?$/, '')}/`);
        } else {
            return null;
        }
        if (requestUrl.protocol !== 'http:' && requestUrl.protocol !== 'https:') return null;

        const match = decodeURIComponent(requestUrl.pathname).match(IMPORT_JSON_URL_RE);
        if (!match || match[1].toLowerCase() !== match[2].slice(0, 2).toLowerCase()) return null;
        return { origin: requestUrl.origin, uuid: match[2] };
    } catch {
        return null;
    }
}

export function installCCONBJsonDownloadFallback(
    assetManager: { downloader?: DownloaderLike } | null | undefined,
    options: ICCONBJsonDownloadFallbackOptions = {},
): boolean {
    const downloader = assetManager?.downloader;
    if (!downloader || installedDownloaders.has(downloader)) return false;

    const defaultDownloadJson = downloader.handlers['.json'];
    if (typeof defaultDownloadJson !== 'function') return false;

    downloader.register('.json', (url, downloadOptions, onComplete) => {
        let completed = false;
        const complete: DownloadComplete = (error, data) => {
            if (completed) return;
            completed = true;
            onComplete(error, data);
        };

        defaultDownloadJson(url, downloadOptions, (downloadError, data) => {
            if (completed) return;
            if (!downloadError) {
                complete(null, data);
                return;
            }

            const request = parseImportRequest(url, options.serverURL);
            if (!request) {
                complete(downloadError);
                return;
            }

            void (async () => {
                try {
                    const encodedUuid = encodeURIComponent(request.uuid);
                    const extResponse = await fetch(`${request.origin}/scene/query-extname/${encodedUuid}`);
                    if (!extResponse.ok || (await extResponse.text()).trim() !== '.cconb') {
                        complete(downloadError);
                        return;
                    }

                    const downloadCCONB = downloader.handlers['.cconb'];
                    if (typeof downloadCCONB !== 'function') {
                        complete(downloadError);
                        return;
                    }
                    const browserQuery = options.isBrowser ? '?isBrowser=true' : '';
                    downloadCCONB(
                        `${request.origin}/import/${encodedUuid}.bin${browserQuery}`,
                        downloadOptions,
                        (binaryError, ccon) => {
                            if (binaryError || !ccon) {
                                complete(downloadError);
                            } else {
                                complete(null, ccon);
                            }
                        },
                    );
                } catch {
                    complete(downloadError);
                }
            })();
        });
    });
    installedDownloaders.add(downloader);
    return true;
}
