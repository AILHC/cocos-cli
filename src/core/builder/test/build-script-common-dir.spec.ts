import { resolveBuildScriptCommonDir } from '../worker/builder/tasks/data-task/script';

function normalizePath(path: string) {
    return path.replace(/\\/g, '/');
}

describe('build script data task commonDir', () => {
    it('keeps a platform-provided commonDir when one is already configured', () => {
        expect(resolveBuildScriptCommonDir('E:/build/wechatgame', 'E:/build/wechatgame/src/bundle-scripts')).toBe('E:/build/wechatgame/src/bundle-scripts');
    });

    it('falls back to src/chunks when the platform does not provide a commonDir', () => {
        expect(normalizePath(resolveBuildScriptCommonDir('E:/build/wechatgame', ''))).toBe('E:/build/wechatgame/src/chunks');
    });
});
