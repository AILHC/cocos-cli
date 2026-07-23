const mockGetModules = jest.fn();
const mockGetConfigPath = jest.fn();
const mockPathExists = jest.fn();
const mockStat = jest.fn();
const mockReadJSON = jest.fn();
const mockQueryAssetInfo = jest.fn();
const mockWaitForProgrammingFacet = jest.fn();

jest.mock('../../engine', () => ({
    Engine: {
        getModules: mockGetModules,
    },
}));

jest.mock('../../configuration', () => ({
    configurationManager: {
        getConfigPath: mockGetConfigPath,
    },
}));

jest.mock('../../assets', () => ({
    assetManager: {
        queryAssetInfo: mockQueryAssetInfo,
    },
}));

jest.mock('../../scripting/programming/FacetInstance', () => ({
    waitForProgrammingFacet: mockWaitForProgrammingFacet,
}));

jest.mock('fs-extra', () => ({
    pathExists: mockPathExists,
    readJSON: mockReadJSON,
    stat: mockStat,
    readFile: jest.fn(),
}));

import { scriptingRoutes } from '../scripting-routes';

describe('preview scripting routes', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockGetModules.mockReturnValue(['base', 'custom-pipeline']);
        mockGetConfigPath.mockResolvedValue('E:/project/cocos.config.json');
        mockPathExists.mockResolvedValue(true);
        mockStat.mockResolvedValue({ isFile: () => true });
        mockWaitForProgrammingFacet.mockResolvedValue({
            systemJsHomeDir: 'E:/workspace/.cache/systemjs',
        });
    });

    it('normalizes disk graphics settings when serving engine modules', async () => {
        mockReadJSON.mockResolvedValue({
            engine: {
                globalConfigKey: 'default',
                configs: {
                    default: {
                        includeModules: ['base', 'custom-pipeline', 'custom-pipeline-post-process'],
                    },
                },
                graphics: {
                    pipeline: 'legacy-pipeline',
                    'custom-pipeline-post-process': true,
                },
            },
        });
        const route = scriptingRoutes.find((item) => item.url === '/scripting/engine/modules');
        const res = {
            json: jest.fn(),
        };

        expect(route).toBeDefined();

        await route!.handler({} as any, res as any, jest.fn());

        expect(res.json).toHaveBeenCalledWith(['base', 'legacy-pipeline']);
    });

    it.each([
        ['a .cconb library output', { '.cconb': 'E:/project/library/example.cconb' }],
        ['a lone .bin library output', { '.bin': 'E:/project/library/example.bin' }],
    ])('reports .cconb for %s', async (_label, library) => {
        mockQueryAssetInfo.mockReturnValue({ library });
        const route = scriptingRoutes.find((item) => item.url instanceof RegExp && item.url.test('/query-extname/example-uuid'));
        const res = {
            status: jest.fn().mockReturnThis(),
            send: jest.fn(),
        };

        expect(route).toBeDefined();

        await route!.handler({ params: ['example-uuid'] } as any, res as any, jest.fn());

        expect(mockQueryAssetInfo).toHaveBeenCalledWith('example-uuid');
        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.send).toHaveBeenCalledWith('.cconb');
    });

    it.each([
        ['a .bin output accompanied by .json', { '.bin': 'E:/project/library/example.bin', '.json': 'E:/project/library/example.json' }],
        ['a .json-only output', { '.json': 'E:/project/library/example.json' }],
        ['no asset info', undefined],
    ])('reports an empty extension for %s', async (_label, library) => {
        mockQueryAssetInfo.mockReturnValue(library ? { library } : undefined);
        const route = scriptingRoutes.find((item) => item.url instanceof RegExp && item.url.test('/query-extname/example-uuid'));
        const res = {
            status: jest.fn().mockReturnThis(),
            send: jest.fn(),
        };

        expect(route).toBeDefined();

        await route!.handler({ params: ['example-uuid'] } as any, res as any, jest.fn());

        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.send).toHaveBeenCalledWith('');
    });

    it('allows CLI static web assets when the workspace is inside a dot directory', async () => {
        const route = scriptingRoutes.find((item) => (
            item.url instanceof RegExp && item.url.source === '^\\/static\\/web'
        ));
        const res = {
            sendFile: jest.fn(),
        };

        expect(route).toBeDefined();

        await route!.handler(
            { path: '/static/web/scene-editor-boot.js' } as any,
            res as any,
            jest.fn(),
        );

        expect(res.sendFile).toHaveBeenCalledWith(
            expect.stringContaining('scene-editor-boot.js'),
            { dotfiles: 'allow' },
        );
    });

    it('allows SystemJS assets when their controlled root is inside a dot directory', async () => {
        const route = scriptingRoutes.find((item) => (
            item.url instanceof RegExp && item.url.source === '^\\/scripting\\/systemjs'
        ));
        const res = {
            sendFile: jest.fn(),
        };

        expect(route).toBeDefined();

        await route!.handler(
            { path: '/scripting/systemjs/extras/named-register.js' } as any,
            res as any,
            jest.fn(),
        );

        expect(res.sendFile).toHaveBeenCalledWith(
            expect.stringContaining('named-register.js'),
            { dotfiles: 'allow' },
        );
    });
});
