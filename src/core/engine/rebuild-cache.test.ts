import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { rebuildEngineCache } from './rebuild-cache';

describe('rebuildEngineCache', () => {
    let fixtureRoot: string;

    beforeEach(() => {
        fixtureRoot = mkdtempSync(join(tmpdir(), 'cocos-cli-engine-cache-'));
    });

    afterEach(() => {
        rmSync(fixtureRoot, { recursive: true, force: true });
    });

    it('rebuilds editor and web cache for the selected engine root', async () => {
        const engineRoot = join(fixtureRoot, 'engine');
        const compilerEntry = join(fixtureRoot, 'compiler.js');
        mkdirSync(engineRoot, { recursive: true });
        writeFileSync(join(engineRoot, 'cc.config.json'), '{}', 'utf8');
        writeFileSync(compilerEntry, '', 'utf8');
        const compileEngine = jest.fn().mockResolvedValue(undefined);

        await expect(rebuildEngineCache(engineRoot, {
            compilerEntry,
            loadCompiler: () => ({ compileEngine }),
        })).resolves.toBe(join(engineRoot, 'bin', '.cache', 'dev-cli'));

        expect(compileEngine).toHaveBeenNthCalledWith(1, engineRoot);
        expect(compileEngine).toHaveBeenNthCalledWith(2, engineRoot, true);
    });

    it('rejects a path that is not a Cocos engine root', async () => {
        await expect(rebuildEngineCache(fixtureRoot)).rejects.toThrow('Invalid Cocos engine root');
    });
});
