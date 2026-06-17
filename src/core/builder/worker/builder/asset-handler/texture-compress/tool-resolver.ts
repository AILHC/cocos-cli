import { existsSync } from 'fs';
import { dirname, join } from 'path';
import { execFile } from 'child_process';
import { GlobalPaths } from '../../../../../../global';

const VERSION_PROBE_TIMEOUT = 5000;

export type TextureCompressToolKind = 'pvr';

export type TextureCompressToolSource =
    | 'explicit-tool-path'
    | 'explicit-tools-root'
    | 'creator-resources'
    | 'creator-root'
    | 'bundled-creator-3.8.6'
    | 'cli-bundled';

export interface TextureCompressToolResolution {
    kind: TextureCompressToolKind;
    path: string;
    source: TextureCompressToolSource;
    version: string;
    checkedPaths: string[];
}

export interface TextureCompressToolPathResolution {
    path: string;
    source: TextureCompressToolSource;
    checkedPaths: string[];
}

interface Candidate {
    path: string;
    source: TextureCompressToolSource;
}

const resolveCache = new Map<string, Promise<TextureCompressToolResolution>>();
const toolPathCache = new Map<string, Promise<TextureCompressToolPathResolution>>();
const versionCache = new Map<string, Promise<string>>();

function getPVRToolRelativePath() {
    if (process.platform === 'win32') {
        return join('PVRTexTool_win32', 'PVRTexToolCLI.exe');
    }

    // 保留历史语义：非 Windows 环境沿用 darwin 路径。
    return join('PVRTexTool_darwin', 'PVRTexToolCLI');
}

function getPVRToolCandidates(): Candidate[] {
    const relativePath = getPVRToolRelativePath();
    const candidates: Candidate[] = [];

    if (process.env.COCOS_CLI_PVRTEXTOOL_PATH) {
        candidates.push({
            path: process.env.COCOS_CLI_PVRTEXTOOL_PATH,
            source: 'explicit-tool-path',
        });
    }

    candidates.push(...getTextureCompressToolPathCandidates(relativePath));

    return candidates;
}

function getTextureCompressToolPathCandidates(relativePath: string): Candidate[] {
    const candidates: Candidate[] = [];
    if (process.env.COCOS_CLI_TEXTURE_TOOLS_ROOT) {
        candidates.push({
            path: join(process.env.COCOS_CLI_TEXTURE_TOOLS_ROOT, relativePath),
            source: 'explicit-tools-root',
        });
    }

    if (process.env.COCOS_CREATOR_RESOURCES_PATH) {
        candidates.push({
            path: join(process.env.COCOS_CREATOR_RESOURCES_PATH, 'tools', relativePath),
            source: 'creator-resources',
        });
    }

    if (process.env.COCOS_CREATOR_ROOT) {
        candidates.push({
            path: join(process.env.COCOS_CREATOR_ROOT, 'resources', 'tools', relativePath),
            source: 'creator-root',
        });
    }

    candidates.push({
        path: join(GlobalPaths.staticDir, 'tools', 'creator-3.8.6', relativePath),
        source: 'bundled-creator-3.8.6',
    });

    candidates.push({
        path: join(GlobalPaths.staticDir, 'tools', relativePath),
        source: 'cli-bundled',
    });

    return candidates;
}

function toText(value: string | Buffer | undefined) {
    if (typeof value === 'string') {
        return value;
    }
    if (value === undefined || value === null) {
        return '';
    }
    return value.toString();
}

function escapeSingleQuoteForPowershell(path: string) {
    return path.replace(/'/g, "''");
}

function execFileWithTimeout(file: string, args: string[], timeout: number): Promise<{ stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
        execFile(file, args, { timeout }, (error, stdout, stderr) => {
            if (error) {
                reject(error);
                return;
            }

            resolve({
                stdout: toText(stdout),
                stderr: toText(stderr),
            });
        });
    });
}

async function probeToolVersion(toolPath: string): Promise<string> {
    const cached = versionCache.get(toolPath);
    if (cached) {
        return cached;
    }

    const promise = (async () => {
        if (process.platform === 'win32') {
            try {
                const { stdout } = await execFileWithTimeout('powershell.exe', [
                    '-NoProfile',
                    '-NonInteractive',
                    '-Command',
                    `(Get-Item -LiteralPath '${escapeSingleQuoteForPowershell(toolPath)}').VersionInfo.ProductVersion`,
                ], VERSION_PROBE_TIMEOUT);
                const version = toText(stdout).trim();
                if (version) {
                    return version;
                }
            } catch {
                // 版本探测失败不阻塞构建，返回 unknown。
            }
            return 'unknown';
        }

        try {
            const { stdout, stderr } = await execFileWithTimeout(toolPath, ['-version'], VERSION_PROBE_TIMEOUT);
            const output = `${toText(stdout)} ${toText(stderr)}`.trim();
            if (output) {
                return output;
            }
        } catch {
            return 'unknown';
        }
        return 'unknown';
    })();

    versionCache.set(toolPath, promise);
    return promise;
}

function buildCacheKey(kind: string, candidates: Array<{ path: string; source: TextureCompressToolSource }>) {
    const signature = {
        kind,
        platform: process.platform,
        globalStaticDir: GlobalPaths.staticDir,
        env: {
            COCOS_CLI_PVRTEXTOOL_PATH: process.env.COCOS_CLI_PVRTEXTOOL_PATH || '',
            COCOS_CLI_TEXTURE_TOOLS_ROOT: process.env.COCOS_CLI_TEXTURE_TOOLS_ROOT || '',
            COCOS_CREATOR_RESOURCES_PATH: process.env.COCOS_CREATOR_RESOURCES_PATH || '',
            COCOS_CREATOR_ROOT: process.env.COCOS_CREATOR_ROOT || '',
        },
        candidatePaths: candidates.map((candidate) => `${candidate.source}:${candidate.path}`),
    };

    return JSON.stringify(signature);
}

export async function resolveTextureCompressToolPath(relativePath: string): Promise<TextureCompressToolPathResolution> {
    const candidates = getTextureCompressToolPathCandidates(relativePath);
    const cacheKey = buildCacheKey(`tool-path:${relativePath}`, candidates);
    const cacheItem = toolPathCache.get(cacheKey);
    if (cacheItem) {
        try {
            const cached = await cacheItem;
            if (existsSync(cached.path)) {
                return cached;
            }
            toolPathCache.delete(cacheKey);
        } catch {
            toolPathCache.delete(cacheKey);
        }
    }

    const resolutionPromise = (async () => {
        const checkedPaths = candidates.map((candidate) => candidate.path);
        const candidate = candidates.find((item) => existsSync(item.path));

        if (!candidate) {
            throw new Error(`Unable to resolve texture compression tool path ${relativePath}. Checked paths: ${checkedPaths.join(', ')}`);
        }

        return {
            path: candidate.path,
            source: candidate.source,
            checkedPaths,
        };
    })();

    toolPathCache.set(cacheKey, resolutionPromise);

    resolutionPromise.catch(() => {
        toolPathCache.delete(cacheKey);
    });

    return resolutionPromise;
}

export async function resolveTextureCompressTool(kind: TextureCompressToolKind): Promise<TextureCompressToolResolution> {
    if (kind !== 'pvr') {
        throw new Error(`Unsupported texture compress tool kind: ${kind}`);
    }

    const candidates = getPVRToolCandidates();
    const cacheKey = buildCacheKey(kind, candidates);
    const cacheItem = resolveCache.get(cacheKey);
    if (cacheItem) {
        try {
            const cached = await cacheItem;
            if (existsSync(cached.path)) {
                return cached;
            }
            resolveCache.delete(cacheKey);
        } catch {
            resolveCache.delete(cacheKey);
        }
    }

    const resolutionPromise = (async () => {
        const checkedPaths = candidates.map((candidate) => candidate.path);
        const candidate = candidates.find((item) => existsSync(item.path));

        if (!candidate) {
            throw new Error(`Unable to resolve ${kind} texture compression tool. Checked paths: ${checkedPaths.join(', ')}`);
        }

        const version = await probeToolVersion(candidate.path);

        return {
            kind,
            path: candidate.path,
            source: candidate.source,
            version,
            checkedPaths,
        };
    })();

    resolveCache.set(cacheKey, resolutionPromise);

    resolutionPromise.catch(() => {
        resolveCache.delete(cacheKey);
    });

    return resolutionPromise;
}

export function getTextureCompressToolDirectory(resolution: TextureCompressToolResolution) {
    return dirname(resolution.path);
}
