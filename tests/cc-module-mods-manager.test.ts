import { mkdtemp, mkdir, rm, writeFile } from 'fs/promises';
import Module from 'module';
import { tmpdir } from 'os';
import { join } from 'path';

import { EngineLoader } from '../packages/cc-module/src/loader';

const ModuleInternal = Module as typeof Module & {
    _resolveFilename(this: Module, request: string): unknown;
    _load(this: Module, request: string): unknown;
};

describe('cc-module mods manager bridge', () => {
    it('sync imports preloaded modules, rejects unknown modules, and resets cleanly on re-init', async () => {
        const workspace = await mkdtemp(join(tmpdir(), 'cc-module-mods-manager-'));
        const originalResolveFilename = ModuleInternal._resolveFilename;
        const originalLoad = ModuleInternal._load;

        try {
            const firstEngine = await createFakeEngineLoader(workspace, 'first', {
                cc: { generation: 'first-cc' },
                'cc/editor/serialization': { generation: 'first-serialization' },
            });
            await EngineLoader.init(firstEngine, ['cc', 'cc/editor/serialization']);

            const installedResolveFilename = ModuleInternal._resolveFilename;
            const installedLoad = ModuleInternal._load;
            const firstModsManager = (ModuleInternal._load as (request: string) => unknown)('cc/mods-mgr') as {
                syncImport(id: string): unknown;
            };

            expect(firstModsManager.syncImport('cc/editor/serialization'))
                .toBe(EngineLoader.getEngineModuleById('cc/editor/serialization'));
            expect(() => firstModsManager.syncImport('cc/editor/missing')).toThrow(
                'Can not sync import engine module: cc/editor/missing. Module was not preloaded.',
            );

            const secondEngine = await createFakeEngineLoader(workspace, 'second', {
                'cc/editor/material': { generation: 'second-material' },
            });
            await EngineLoader.init(secondEngine, ['cc/editor/material']);

            expect(ModuleInternal._resolveFilename).toBe(installedResolveFilename);
            expect(ModuleInternal._load).toBe(installedLoad);
            expect(firstModsManager.syncImport('cc/editor/material'))
                .toBe(EngineLoader.getEngineModuleById('cc/editor/material'));
            expect(() => firstModsManager.syncImport('cc/editor/serialization')).toThrow(
                'Can not sync import engine module: cc/editor/serialization. Module was not preloaded.',
            );
        } finally {
            ModuleInternal._resolveFilename = originalResolveFilename;
            ModuleInternal._load = originalLoad;
            const loaderState = EngineLoader as unknown as {
                engineModules: Record<string, unknown>;
                loader: undefined;
                resolveFilenameHook: undefined;
                loadHook: undefined;
            };
            loaderState.engineModules = {};
            loaderState.loader = undefined;
            loaderState.resolveFilenameHook = undefined;
            loaderState.loadHook = undefined;
            await rm(workspace, { recursive: true, force: true });
        }
    });
});

async function createFakeEngineLoader(
    workspace: string,
    name: string,
    modules: Record<string, unknown>,
): Promise<string> {
    const engineDevPath = join(workspace, name);
    const editorPath = join(engineDevPath, 'editor');
    await mkdir(editorPath, { recursive: true });
    await writeFile(join(editorPath, 'loader.js'), `
const modules = ${JSON.stringify(modules)};
module.exports.default = {
    async import(id) {
        if (!Object.prototype.hasOwnProperty.call(modules, id)) {
            throw new Error('Unknown fake engine module: ' + id);
        }
        return modules[id];
    },
};
`, 'utf8');
    return engineDevPath;
}
