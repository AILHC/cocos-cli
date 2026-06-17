import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { ensureDirSync, removeSync, writeFileSync } from 'fs-extra';

const mockExecFile = jest.fn();
type ExecFileMockResult = {
    error?: Error | null;
    stdout?: string;
    stderr?: string;
};
const execFileMockQueue: ExecFileMockResult[] = [];

function enqueueExecFileFailure(error = new Error('mock execFile failure')) {
    execFileMockQueue.push({
        error,
        stdout: '',
        stderr: '',
    });
}

jest.mock('child_process', () => {
    const actual = jest.requireActual('child_process');
    return {
        ...actual,
        execFile: (...args: any[]) => {
            mockExecFile(...args);
            const cb = args[args.length - 1];
            if (typeof cb === 'function') {
                const result = execFileMockQueue.shift() || { error: null, stdout: '1.0.0', stderr: '' };
                cb(result.error ?? null, result.stdout, result.stderr);
            }
            return null;
        },
    };
});

const originalEnv = { ...process.env };
const testRoot = join(tmpdir(), 'cocos-cli-tool-resolver-tests');
const staticDir = join(tmpdir(), 'cocos-cli-tool-resolver-static');

jest.mock('../../../global', () => ({
    GlobalPaths: {
        staticDir,
    },
}));

function getPlatformRelativePVRToolPath(platform: NodeJS.Platform = process.platform) {
    if (platform === 'win32') {
        return join('PVRTexTool_win32', 'PVRTexToolCLI.exe');
    }
    return join('PVRTexTool_darwin', 'PVRTexToolCLI');
}

function getExpectedToolPath(baseDir: string, platform: NodeJS.Platform = process.platform) {
    return join(baseDir, 'tools', getPlatformRelativePVRToolPath(platform));
}

function getExpectedCreatorBundledToolPath(baseDir: string, platform: NodeJS.Platform = process.platform) {
    return join(baseDir, 'tools', 'creator-3.8.6', getPlatformRelativePVRToolPath(platform));
}

function resetResolverEnv() {
    delete process.env.COCOS_CLI_PVRTEXTOOL_PATH;
    delete process.env.COCOS_CLI_TEXTURE_TOOLS_ROOT;
    delete process.env.COCOS_CREATOR_RESOURCES_PATH;
    delete process.env.COCOS_CREATOR_ROOT;
}

function restoreOriginalEnv() {
    const keys = Object.keys(process.env);
    for (const key of keys) {
        delete process.env[key];
    }
    Object.assign(process.env, originalEnv);
}

function touchTool(filePath: string) {
    ensureDirSync(dirname(filePath));
    writeFileSync(filePath, 'fake tool');
}

describe('texture compress tool resolver', () => {
    beforeEach(() => {
        jest.resetModules();
        mockExecFile.mockReset();
        execFileMockQueue.length = 0;
        restoreOriginalEnv();
        resetResolverEnv();
        removeSync(testRoot);
        removeSync(staticDir);
    });

    afterEach(() => {
        jest.restoreAllMocks();
        restoreOriginalEnv();
        removeSync(testRoot);
        removeSync(staticDir);
    });

    afterAll(() => {
        restoreOriginalEnv();
        removeSync(testRoot);
        removeSync(staticDir);
    });

    it('explicit tool path has highest priority', async () => {
        const relativePath = getPlatformRelativePVRToolPath(process.platform);
        const explicitTool = join(testRoot, 'explicit', relativePath);
        const toolsRootTool = join(testRoot, 'root', 'tools', relativePath);
        touchTool(explicitTool);
        touchTool(toolsRootTool);

        process.env.COCOS_CLI_PVRTEXTOOL_PATH = explicitTool;
        process.env.COCOS_CLI_TEXTURE_TOOLS_ROOT = join(testRoot, 'root', 'tools');

        const { resolveTextureCompressTool } = await import('../worker/builder/asset-handler/texture-compress/tool-resolver');
        const result = await resolveTextureCompressTool('pvr');

        expect(result.path).toBe(explicitTool);
        expect(result.source).toBe('explicit-tool-path');
        expect(result.version).toBe('1.0.0');
    });

    it('supports tools root source', async () => {
        const toolsRoot = join(testRoot, 'tools-root');
        const toolPath = join(toolsRoot, getPlatformRelativePVRToolPath(process.platform));
        touchTool(toolPath);

        process.env.COCOS_CLI_TEXTURE_TOOLS_ROOT = toolsRoot;

        const { resolveTextureCompressTool } = await import('../worker/builder/asset-handler/texture-compress/tool-resolver');
        const result = await resolveTextureCompressTool('pvr');

        expect(result.path).toBe(toolPath);
        expect(result.source).toBe('explicit-tools-root');
    });

    it('supports Creator resources path source', async () => {
        const creatorResources = join(testRoot, 'creator-resources');
        const toolPath = join(creatorResources, 'tools', getPlatformRelativePVRToolPath(process.platform));
        touchTool(toolPath);

        process.env.COCOS_CREATOR_RESOURCES_PATH = creatorResources;

        const { resolveTextureCompressTool } = await import('../worker/builder/asset-handler/texture-compress/tool-resolver');
        const result = await resolveTextureCompressTool('pvr');

        expect(result.path).toBe(toolPath);
        expect(result.source).toBe('creator-resources');
    });

    it('supports Creator root source', async () => {
        const creatorRoot = join(testRoot, 'creator-root');
        const toolPath = join(creatorRoot, 'resources', 'tools', getPlatformRelativePVRToolPath(process.platform));
        touchTool(toolPath);

        process.env.COCOS_CREATOR_ROOT = creatorRoot;

        const { resolveTextureCompressTool } = await import('../worker/builder/asset-handler/texture-compress/tool-resolver');
        const result = await resolveTextureCompressTool('pvr');

        expect(result.path).toBe(toolPath);
        expect(result.source).toBe('creator-root');
    });

    it('Creator resources path should outrank Creator root', async () => {
        const creatorResources = join(testRoot, 'creator-resources-priority');
        const creatorRoot = join(testRoot, 'creator-root-priority');
        const relativeToolPath = getPlatformRelativePVRToolPath(process.platform);
        const resourcesTool = join(creatorResources, 'tools', relativeToolPath);
        const rootTool = join(creatorRoot, 'resources', 'tools', relativeToolPath);
        touchTool(resourcesTool);
        touchTool(rootTool);

        process.env.COCOS_CREATOR_RESOURCES_PATH = creatorResources;
        process.env.COCOS_CREATOR_ROOT = creatorRoot;

        const { resolveTextureCompressTool } = await import('../worker/builder/asset-handler/texture-compress/tool-resolver');
        const result = await resolveTextureCompressTool('pvr');

        expect(result.path).toBe(resourcesTool);
        expect(result.source).toBe('creator-resources');
    });

    it('uses bundled Creator 3.8.6 tool by default when no explicit path is available', async () => {
        const creatorBundledTool = getExpectedCreatorBundledToolPath(staticDir, process.platform);
        const cliBundledTool = getExpectedToolPath(staticDir, process.platform);
        touchTool(creatorBundledTool);
        touchTool(cliBundledTool);

        const { resolveTextureCompressTool } = await import('../worker/builder/asset-handler/texture-compress/tool-resolver');
        const result = await resolveTextureCompressTool('pvr');

        expect(result.path).toBe(creatorBundledTool);
        expect(result.source).toBe('bundled-creator-3.8.6');
    });

    it('uses bundled Creator 3.8.6 overlay for a texture compression tool path by default', async () => {
        const relativeToolPath = getPlatformRelativePVRToolPath(process.platform);
        const creatorToolPath = getExpectedCreatorBundledToolPath(staticDir, process.platform);
        const cliBundledTool = getExpectedToolPath(staticDir, process.platform);
        touchTool(creatorToolPath);
        touchTool(cliBundledTool);

        const { resolveTextureCompressToolPath } = await import('../worker/builder/asset-handler/texture-compress/tool-resolver');
        const result = await resolveTextureCompressToolPath(relativeToolPath);

        expect(result.path).toBe(creatorToolPath);
        expect(result.source).toBe('bundled-creator-3.8.6');
    });

    it('supports explicit tools root for a texture compression tool path', async () => {
        const explicitToolsRoot = join(testRoot, 'explicit-all-tools-root');
        const relativeToolPath = getPlatformRelativePVRToolPath(process.platform);
        const explicitTool = join(explicitToolsRoot, relativeToolPath);
        const creatorToolPath = getExpectedCreatorBundledToolPath(staticDir, process.platform);
        touchTool(explicitTool);
        touchTool(creatorToolPath);

        process.env.COCOS_CLI_TEXTURE_TOOLS_ROOT = explicitToolsRoot;

        const { resolveTextureCompressToolPath } = await import('../worker/builder/asset-handler/texture-compress/tool-resolver');
        const result = await resolveTextureCompressToolPath(relativeToolPath);

        expect(result.path).toBe(explicitTool);
        expect(result.source).toBe('explicit-tools-root');
    });

    it('falls back to CLI bundled tool path when bundled Creator 3.8.6 overlay is unavailable', async () => {
        const relativeToolPath = getPlatformRelativePVRToolPath(process.platform);
        const cliBundledTool = getExpectedToolPath(staticDir, process.platform);
        touchTool(cliBundledTool);

        const { resolveTextureCompressToolPath } = await import('../worker/builder/asset-handler/texture-compress/tool-resolver');
        const result = await resolveTextureCompressToolPath(relativeToolPath);

        expect(result.path).toBe(cliBundledTool);
        expect(result.source).toBe('cli-bundled');
    });

    it('falls back to CLI bundled tool when bundled Creator 3.8.6 tool is unavailable', async () => {
        const bundledTool = getExpectedToolPath(staticDir, process.platform);
        touchTool(bundledTool);

        const { resolveTextureCompressTool } = await import('../worker/builder/asset-handler/texture-compress/tool-resolver');
        const result = await resolveTextureCompressTool('pvr');

        expect(result.path).toBe(bundledTool);
        expect(result.source).toBe('cli-bundled');
    });

    it('throws with checked paths when no tool is found', async () => {
        const { resolveTextureCompressTool } = await import('../worker/builder/asset-handler/texture-compress/tool-resolver');
        const creatorBundledTool = getExpectedCreatorBundledToolPath(staticDir, process.platform);
        const pvrToolInStatic = getExpectedToolPath(staticDir, process.platform);

        let err: Error | undefined;
        try {
            await resolveTextureCompressTool('pvr');
        } catch (error) {
            err = error as Error;
        }

        expect(err).toBeTruthy();
        expect(err!.message).toContain('Unable to resolve pvr texture compression tool');
        expect(err!.message).toContain(creatorBundledTool);
        expect(err!.message).toContain(pvrToolInStatic);
    });

    it('reuses cached resolve result when env is unchanged', async () => {
        const toolsRoot = join(testRoot, 'cache-tools-root');
        const toolPath = join(toolsRoot, getPlatformRelativePVRToolPath(process.platform));
        touchTool(toolPath);

        process.env.COCOS_CLI_TEXTURE_TOOLS_ROOT = toolsRoot;

        const { resolveTextureCompressTool } = await import('../worker/builder/asset-handler/texture-compress/tool-resolver');
        const first = await resolveTextureCompressTool('pvr');
        const second = await resolveTextureCompressTool('pvr');

        expect(first.path).toBe(toolPath);
        expect(second.path).toBe(toolPath);
        expect(mockExecFile).toHaveBeenCalledTimes(1);
    });

    it('recomputes when relevant env changed', async () => {
        const creatorResources = join(testRoot, 'creator-resources-env');
        const resourcesTool = join(creatorResources, 'tools', getPlatformRelativePVRToolPath(process.platform));
        const explicitTool = join(testRoot, 'explicit-env', getPlatformRelativePVRToolPath(process.platform));
        touchTool(resourcesTool);
        touchTool(explicitTool);

        process.env.COCOS_CREATOR_RESOURCES_PATH = creatorResources;

        const { resolveTextureCompressTool } = await import('../worker/builder/asset-handler/texture-compress/tool-resolver');
        const fromResources = await resolveTextureCompressTool('pvr');
        expect(fromResources.path).toBe(resourcesTool);
        expect(fromResources.source).toBe('creator-resources');

        process.env.COCOS_CLI_PVRTEXTOOL_PATH = explicitTool;
        const fromExplicit = await resolveTextureCompressTool('pvr');
        expect(fromExplicit.path).toBe(explicitTool);
        expect(fromExplicit.source).toBe('explicit-tool-path');
    });

    it('tools root beats creator resources and creator root', async () => {
        const creatorResources = join(testRoot, 'creator-resources-priority-v2');
        const creatorRoot = join(testRoot, 'creator-root-priority-v2');
        const toolsRoot = join(testRoot, 'tools-root-priority-v2');
        const resourcesTool = join(creatorResources, 'tools', getPlatformRelativePVRToolPath(process.platform));
        const rootTool = join(creatorRoot, 'resources', 'tools', getPlatformRelativePVRToolPath(process.platform));
        const toolsRootTool = join(toolsRoot, getPlatformRelativePVRToolPath(process.platform));
        touchTool(resourcesTool);
        touchTool(rootTool);
        touchTool(toolsRootTool);

        process.env.COCOS_CREATOR_RESOURCES_PATH = creatorResources;
        process.env.COCOS_CREATOR_ROOT = creatorRoot;
        process.env.COCOS_CLI_TEXTURE_TOOLS_ROOT = toolsRoot;

        const { resolveTextureCompressTool } = await import('../worker/builder/asset-handler/texture-compress/tool-resolver');
        const result = await resolveTextureCompressTool('pvr');

        expect(result.path).toBe(toolsRootTool);
        expect(result.source).toBe('explicit-tools-root');
    });

    it('returns unknown tool version when version probe fails', async () => {
        const bundledTool = getExpectedCreatorBundledToolPath(staticDir, process.platform);
        touchTool(bundledTool);
        enqueueExecFileFailure(new Error('mocked version probe failed'));

        const { resolveTextureCompressTool } = await import('../worker/builder/asset-handler/texture-compress/tool-resolver');
        const result = await resolveTextureCompressTool('pvr');

        expect(result.path).toBe(bundledTool);
        expect(result.version).toBe('unknown');
        expect(result.source).toBe('bundled-creator-3.8.6');
    });

    it('explicit path beats creator resources/root and bundled tools', async () => {
        const creatorResources = join(testRoot, 'creator-resources-override');
        const creatorRoot = join(testRoot, 'creator-root-override');
        const explicitRoot = join(testRoot, 'explicit-override');
        const creatorBundledTool = getExpectedCreatorBundledToolPath(staticDir, process.platform);
        const bundledTool = getExpectedToolPath(staticDir, process.platform);
        const resourcesTool = join(creatorResources, 'tools', getPlatformRelativePVRToolPath(process.platform));
        const rootTool = join(creatorRoot, 'resources', 'tools', getPlatformRelativePVRToolPath(process.platform));
        const explicitTool = join(explicitRoot, getPlatformRelativePVRToolPath(process.platform));
        touchTool(creatorBundledTool);
        touchTool(bundledTool);
        touchTool(resourcesTool);
        touchTool(rootTool);
        touchTool(explicitTool);

        process.env.COCOS_CREATOR_RESOURCES_PATH = creatorResources;
        process.env.COCOS_CREATOR_ROOT = creatorRoot;
        process.env.COCOS_CLI_PVRTEXTOOL_PATH = explicitTool;

        const { resolveTextureCompressTool } = await import('../worker/builder/asset-handler/texture-compress/tool-resolver');
        const result = await resolveTextureCompressTool('pvr');

        expect(result.path).toBe(explicitTool);
        expect(result.source).toBe('explicit-tool-path');
    });

    it('rejects unsupported texture tool kinds', async () => {
        const { resolveTextureCompressTool } = await import('../worker/builder/asset-handler/texture-compress/tool-resolver');
        await expect(resolveTextureCompressTool('astc' as any)).rejects.toThrow('Unsupported texture compress tool kind');
    });

    it('maps non-PVR compression formats', async () => {
        const { getCompressFunc, compressAstc, compressEtc, compressWebp } = await import('../worker/builder/asset-handler/texture-compress/compress-tool');

        expect(getCompressFunc('astc_4x4')).toBe(compressAstc);
        expect(getCompressFunc('etc2_rgba')).toBe(compressEtc);
        expect(getCompressFunc('webp')).toBe(compressWebp);
    });

    it('reports invalid pvr format before resolving tool', async () => {
        const { compressPVR } = await import('../worker/builder/asset-handler/texture-compress/compress-tool');
        const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);

        await expect(compressPVR({
            src: join(testRoot, 'invalid-src.png'),
            dest: join(testRoot, 'invalid-dest.pvr'),
            format: 'invalid-pvr-format',
            compressOptions: {
                quality: 4,
            },
            uuid: 'invalid-format',
        } as any)).resolves.toBeUndefined();

        expect(consoleErrorSpy).toHaveBeenCalledWith('Invalid pvr compress format invalid-pvr-format');
        expect(mockExecFile).not.toHaveBeenCalled();
        consoleErrorSpy.mockRestore();
    });

    it('uses platform tool path pattern according to current platform', () => {
        const expected = getPlatformRelativePVRToolPath(process.platform);
        if (process.platform === 'win32') {
            expect(expected).toBe(join('PVRTexTool_win32', 'PVRTexToolCLI.exe'));
        } else {
            expect(expected).toBe(join('PVRTexTool_darwin', 'PVRTexToolCLI'));
        }
    });
});
