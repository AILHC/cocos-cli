jest.mock('../src/core/assets', () => ({
    assetManager: {
        queryAssetInfos: jest.fn(),
    },
}));

import { HTTP_STATUS } from '../src/api/base/schema-base';
import { isToolErrorCode } from '../src/mcp/mcp.middleware';

describe('Bug #497 MCP tool error flagging', () => {
    it('treats only 5xx result codes as MCP tool errors', () => {
        expect(isToolErrorCode(HTTP_STATUS.BAD_REQUEST)).toBe(false);
        expect(isToolErrorCode(HTTP_STATUS.NOT_FOUND)).toBe(false);
        expect(isToolErrorCode(HTTP_STATUS.INTERNAL_SERVER_ERROR)).toBe(true);
    });
});
