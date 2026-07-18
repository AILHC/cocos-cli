import path from 'path';

const mockGetInfo = jest.fn();
const mockPathExists = jest.fn();
const mockReadFile = jest.fn();
const mockRealpath = jest.fn();

jest.mock('../../engine', () => ({
    Engine: {
        getInfo: mockGetInfo,
    },
}));

jest.mock('../../assets/asset-config', () => ({
    __esModule: true,
    default: {
        data: {
            assetDBList: [
                { library: 'E:/project/library' },
                { library: 'E:/project/library/cli-extensions/example' },
            ],
        },
    },
}));

jest.mock('../../../global', () => ({
    GlobalPaths: {
        enginePath: 'E:/engine',
    },
}));

jest.mock('fs-extra', () => ({
    pathExists: mockPathExists,
    stat: jest.fn(),
    readFile: mockReadFile,
    realpath: mockRealpath,
}));

import { scriptingRoutes } from '../scripting-routes';

function createResponse() {
    const res: any = {
        status: jest.fn(),
        send: jest.fn(),
    };
    res.status.mockReturnValue(res);
    return res;
}

describe('preview scripting file route security', () => {
    const canonical = (value: string) => path.resolve(value);

    beforeEach(() => {
        jest.clearAllMocks();
        mockGetInfo.mockReturnValue({
            native: { path: 'E:/engine/native' },
            typescript: { path: 'E:/engine/typescript' },
        });
        mockPathExists.mockResolvedValue(true);
        mockReadFile.mockResolvedValue(Buffer.from('fixture'));
        mockRealpath.mockImplementation(async (value: string) => canonical(value));
    });

    async function request(filePath: string) {
        const route = scriptingRoutes.find((item) => item.url === '/engine/read-file-sync');
        const res = createResponse();
        expect(route).toBeDefined();
        await route!.handler({ query: { path: filePath } } as any, res, jest.fn());
        return res;
    }

    it.each([
        'E:/engine/typescript/bin/cc.js',
        'E:/project/library/imports/project.json',
        'E:/project/library/cli-extensions/example/imports/extension.json',
    ])('allows files under canonical engine or AssetDB library roots: %s', async (filePath) => {
        const res = await request(filePath);
        expect(res.status).toHaveBeenCalledWith(200);
        expect(mockReadFile).toHaveBeenCalledWith(canonical(filePath));
    });

    it.each([
        ['parent traversal', 'E:/project/library/../package.json'],
        ['percent-encoded traversal after Express decoding', decodeURIComponent('E:/project/library/%2e%2e/package.json')],
        ['prefix sibling', 'E:/project/library-backup/private.json'],
    ])('rejects %s', async (_label, filePath) => {
        const res = await request(filePath);
        expect(res.status).toHaveBeenCalledWith(403);
        expect(mockReadFile).not.toHaveBeenCalled();
    });

    it('rejects a library junction whose canonical target is outside the library root', async () => {
        const requestedPath = canonical('E:/project/library/junction/private.json');
        mockRealpath.mockImplementation(async (value: string) => {
            const resolved = canonical(value);
            return resolved === requestedPath ? canonical('E:/outside/private.json') : resolved;
        });

        const res = await request(requestedPath);
        expect(res.status).toHaveBeenCalledWith(403);
        expect(mockReadFile).not.toHaveBeenCalled();
    });
});
