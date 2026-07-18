import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { build, Plugin, stop } from 'esbuild';

type ElementNode = {
    type?: string | { name?: string };
    props?: Record<string, any>;
};

const repoRoot = resolve(__dirname, '../../../..');
const distRoot = join(repoRoot, 'dist');
const platformsRoot = join(distRoot, 'core/builder/platforms');
const platforms = ['ios', 'google-play', 'android', 'web-mobile'] as const;

function walk(node: unknown, output: ElementNode[] = []): ElementNode[] {
    if (Array.isArray(node)) {
        node.forEach((item) => walk(item, output));
        return output;
    }
    if (!node || typeof node !== 'object') {
        return output;
    }
    const element = node as ElementNode;
    output.push(element);
    walk(element.props?.children, output);
    return output;
}

const testRuntimePlugin: Plugin = {
    name: 'pink-view-test-runtime',
    setup(context) {
        context.onResolve({ filter: /^(react|react\/jsx-runtime|@pink\/ui-kit)$/ }, (args) => ({
            path: args.path,
            namespace: 'pink-test',
        }));
        context.onLoad({ filter: /.*/, namespace: 'pink-test' }, (args) => {
            if (args.path === 'react') {
                return {
                    loader: 'js',
                    contents: `
                        export const useState = (initial) => [typeof initial === 'function' ? initial() : initial, () => {}];
                        export const useEffect = () => {};
                        export const useMemo = (factory) => factory();
                        export const useRef = (value) => ({ current: value });
                    `,
                };
            }
            if (args.path === 'react/jsx-runtime') {
                return {
                    loader: 'js',
                    contents: `
                        export const Fragment = 'fragment';
                        export const jsx = (type, props, key) => ({ type, props: props || {}, key });
                        export const jsxs = jsx;
                    `,
                };
            }
            return {
                loader: 'js',
                contents: `
                    export function Checkbox() {}
                    export function FilePicker() {}
                    export function TypedField() {}
                `,
            };
        });
    },
};

async function loadView(platform: typeof platforms[number]): Promise<(props: Record<string, unknown>) => ElementNode> {
    const entry = join(platformsRoot, platform, 'dist/view/build-config.js');
    const result = await build({
        entryPoints: [entry],
        bundle: true,
        format: 'cjs',
        platform: 'node',
        target: 'node18',
        write: false,
        plugins: [testRuntimePlugin],
        logLevel: 'silent',
    });
    const module = { exports: {} as { default?: (props: Record<string, unknown>) => ElementNode } };
    Function('module', 'exports', 'require', result.outputFiles[0].text)(module, module.exports, require);
    expect(typeof module.exports.default).toBe('function');
    return module.exports.default!;
}

function loadHost(platform: typeof platforms[number]): Record<string, (...args: any[]) => any> {
    const hostPath = join(platformsRoot, platform, 'dist/view/build-config-host.js');
    delete require.cache[require.resolve(hostPath)];
    const host = require(hostPath) as {
        activate(context: { registerMethod(name: string, handler: (...args: any[]) => any): void }): void;
    };
    const methods: Record<string, (...args: any[]) => any> = {};
    host.activate({ registerMethod: (name, handler) => { methods[name] = handler; } });
    return methods;
}

describe('final Pink platform views', () => {
    afterAll(() => {
        stop();
    });

    afterEach(() => {
        jest.restoreAllMocks();
        delete process.env.ANDROID_HOME;
        delete process.env.ANDROID_SDK_ROOT;
    });

    it('publishes each package, static asset and final view/host bundle', () => {
        for (const platform of platforms) {
            const root = join(platformsRoot, platform);
            const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
            expect(pkg.contributes.pinkBuilder.platform).toBe(platform);
            for (const relative of [
                'package.json',
                'src/config.js',
                'src/hooks.js',
                'static/card.png',
                'static/icon.png',
                'dist/view/build-config.js',
                'dist/view/build-config-host.js',
            ]) {
                expect(existsSync(join(root, relative))).toBe(true);
            }
        }
        expect(existsSync(join(platformsRoot, 'google-play/package.json'))).toBe(true);
        expect(existsSync(join(platformsRoot, 'fb-instant-games/package.json'))).toBe(false);
    });

    it('loads browser ESM bundles and preserves platform field read/write contracts', async () => {
        const onIOSChange = jest.fn();
        const ios = await loadView('ios');
        const iosTree = walk(ios({ value: { developerTeam: 'TEAM_HASH' }, onChange: onIOSChange }));
        const teamInput = iosTree.find((node) => node.type === 'input' && node.props?.value === 'TEAM_HASH');
        expect(teamInput).toBeDefined();
        teamInput!.props!.onChange({ target: { value: 'NEXT_TEAM' } });
        expect(onIOSChange).toHaveBeenCalledWith(['developerTeam'], 'NEXT_TEAM');

        const onAndroidChange = jest.fn();
        const android = await loadView('android');
        const androidTree = walk(android({
            value: { apiLevel: 31, useDebugKeystore: false, keystorePath: 'C:/custom.keystore' },
            commonValue: {},
            onChange: onAndroidChange,
        }));
        const apiSelect = androidTree.find((node) => node.type === 'select' && node.props?.value === '31');
        apiSelect!.props!.onChange({ target: { value: '33' } });
        const filePicker = androidTree.find((node) => (node.type as { name?: string })?.name === 'FilePicker');
        filePicker!.props!.onChange({ target: { value: 'D:/next.keystore' } });
        expect(onAndroidChange).toHaveBeenCalledWith(['apiLevel'], 33);
        expect(onAndroidChange).toHaveBeenCalledWith(['keystorePath'], 'D:/next.keystore');
        expect(androidTree.some((node) => node.props?.error)).toBe(true);

        const onGoogleChange = jest.fn();
        const google = await loadView('google-play');
        const googleTree = walk(google({
            value: { apiLevel: 32, customIcon: 'custom', useDebugKeystore: true },
            commonValue: {},
            onChange: onGoogleChange,
        }));
        const googleAPI = googleTree.find((node) => node.type === 'select' && node.props?.value === '32');
        googleAPI!.props!.onChange({ target: { value: '35' } });
        expect(onGoogleChange).toHaveBeenCalledWith(['apiLevel'], 35);

        const onWebChange = jest.fn();
        const web = await loadView('web-mobile');
        const webTree = walk(web({ value: { useWebGPU: true }, commonValue: {}, onChange: onWebChange }));
        const webGPU = webTree.find((node) => (node.type as { name?: string })?.name === 'Checkbox' && node.props?.checked === true);
        webGPU!.props!.onCheckedChange(false);
        expect(onWebChange).toHaveBeenCalledWith(['useWebGPU'], false);
    });

    it('exposes Android SDK fallback and settings command bridge methods', async () => {
        const sdkRoot = mkdtempSync(join(tmpdir(), 'cocos-cli-android-sdk-'));
        mkdirSync(join(sdkRoot, 'platforms/android-18'), { recursive: true });
        mkdirSync(join(sdkRoot, 'platforms/android-35'), { recursive: true });
        mkdirSync(join(sdkRoot, 'platforms/android-23'), { recursive: true });
        process.env.ANDROID_HOME = sdkRoot;

        const executeCommand = jest.fn().mockResolvedValue(undefined);
        jest.doMock('vscode', () => ({ commands: { executeCommand } }), { virtual: true });
        const methods = loadHost('android');
        expect(methods.getAndroidAPILevels()).toEqual([35, 23]);
        expect(methods.getNativeEngineInfo()).toMatchObject({ type: 'builtin' });
        await expect(methods.openEngineSettings()).resolves.toBe(true);
        await expect(methods.openProgramSettings()).resolves.toBe(true);
        expect(executeCommand).toHaveBeenCalledWith('pinkSettings.start', { scope: 'global', nodeId: 'cocos.engine' });
        expect(executeCommand).toHaveBeenCalledWith('pinkSettings.start', { scope: 'global', nodeId: 'pinkProgramManagerSettings' });
        rmSync(sdkRoot, { recursive: true, force: true });
    });

    it('returns Web Mobile preview URL, QR and secure-context branches from the host', async () => {
        const serverModule = require(join(distRoot, 'server/server.js')) as { serverService: any };
        const service = serverModule.serverService;
        const previous = { server: service.server, port: service._port, useHttps: service.useHttps };
        service.server = { listening: true };
        service._port = 9753;

        try {
            service.useHttps = false;
            let methods = loadHost('web-mobile');
            const httpInfo = await methods.getPreviewInfo({ outputName: 'web-mobile', useWebGPU: true });
            expect(httpInfo.previewUrl).toBe('http://localhost:9753/web-mobile/web-mobile/index.html');
            expect(httpInfo.webGPUTips).not.toBe('');
            expect(httpInfo.qrcodeSrc).toBe('');

            service.useHttps = true;
            methods = loadHost('web-mobile');
            const httpsInfo = await methods.getPreviewInfo({ outputName: 'release', useWebGPU: true });
            expect(httpsInfo.previewUrl).toBe('https://localhost:9753/web-mobile/release/index.html');
            expect(httpsInfo.webGPUTips).toBe('');
            expect(httpsInfo.qrcodeSrc).not.toBe('');
        } finally {
            service.server = previous.server;
            service._port = previous.port;
            service.useHttps = previous.useHttps;
        }
    });

    it('loads iOS and Google Play hosts, including icon and API methods', async () => {
        const iosMethods = loadHost('ios');
        expect(typeof iosMethods.queryTeamInfo).toBe('function');
        expect(typeof iosMethods['query-team-info']).toBe('function');

        const googleMethods = loadHost('google-play');
        expect(typeof googleMethods.getAndroidAPILevels).toBe('function');
        expect(typeof googleMethods.getDisplayCustomIcon).toBe('function');
        expect(typeof googleMethods.saveCustomIcon).toBe('function');
        const iconPath = join(platformsRoot, 'google-play/static/icon.png');
        expect(googleMethods.fileImageSrc(iconPath)).toMatch(/^data:image\/png;base64,/);
    });
});
