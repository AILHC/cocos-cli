const mockGetModules = jest.fn();
const mockGetConfigPath = jest.fn();
const mockPathExists = jest.fn();
const mockReadJSON = jest.fn();

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

jest.mock('fs-extra', () => ({
    pathExists: mockPathExists,
    readJSON: mockReadJSON,
    stat: jest.fn(),
    readFile: jest.fn(),
}));

import { scriptingRoutes } from '../scripting-routes';

describe('preview scripting routes', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockGetModules.mockReturnValue(['base', 'custom-pipeline']);
        mockGetConfigPath.mockResolvedValue('E:/project/cocos.config.json');
        mockPathExists.mockResolvedValue(true);
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
});
