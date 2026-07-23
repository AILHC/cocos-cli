import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { rebuildEngineCache, resolveCompileEngineTarget } from './rebuild-cache';

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

    it('resolves the current cwd project engine using the preview resolver', async () => {
        const projectRoot = join(fixtureRoot, 'project');
        const engineRoot = join(fixtureRoot, 'engine');
        mkdirSync(projectRoot, { recursive: true });
        mkdirSync(engineRoot, { recursive: true });
        writeFileSync(join(engineRoot, 'cc.config.json'), '{}', 'utf8');
        writeFileSync(join(projectRoot, 'package.json'), JSON.stringify({
            'cocos-cli': {
                enginePath: '../engine',
            },
        }), 'utf8');

        await expect(resolveCompileEngineTarget({ cwd: projectRoot })).resolves.toEqual({
            engineRoot,
            projectRoot,
            source: 'project-config',
        });
    });

    it('resolves an explicitly selected project instead of cwd', async () => {
        const projectRoot = join(fixtureRoot, 'project');
        const engineRoot = join(fixtureRoot, 'engine');
        mkdirSync(projectRoot, { recursive: true });
        mkdirSync(engineRoot, { recursive: true });
        writeFileSync(join(engineRoot, 'cc.config.json'), '{}', 'utf8');
        writeFileSync(join(projectRoot, 'package.json'), JSON.stringify({
            'cocos-cli': {
                enginePath: engineRoot,
            },
        }), 'utf8');

        await expect(resolveCompileEngineTarget({
            cwd: join(fixtureRoot, 'outside-project'),
            project: projectRoot,
        })).resolves.toEqual({
            engineRoot,
            projectRoot,
            source: 'project-config',
        });
    });

    it('accepts an explicit engine source without a project', async () => {
        const engineRoot = join(fixtureRoot, 'engine');
        mkdirSync(engineRoot, { recursive: true });
        writeFileSync(join(engineRoot, 'cc.config.json'), '{}', 'utf8');

        await expect(resolveCompileEngineTarget({
            cwd: fixtureRoot,
            engine: engineRoot,
        })).resolves.toEqual({
            engineRoot,
            source: 'explicit-engine',
        });
    });

    it('rejects ambiguous project and engine inputs', async () => {
        await expect(resolveCompileEngineTarget({
            cwd: fixtureRoot,
            project: fixtureRoot,
            engine: fixtureRoot,
        })).rejects.toThrow('--project and --engine are mutually exclusive');
    });

    it('does not fall back to a profile when cwd is not a project', async () => {
        await expect(resolveCompileEngineTarget({ cwd: fixtureRoot })).rejects.toThrow('Not a valid Cocos project');
    });
});
