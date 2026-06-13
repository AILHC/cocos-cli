import path from 'path';
import os from 'os';
import fse from 'fs-extra';
import { CocosMigrationManager } from '../migration';
import type { IMigrationTarget } from '../migration';

describe('editor-owned config snapshot loading', () => {
    afterEach(() => {
        CocosMigrationManager.clear();
        (CocosMigrationManager as any)._initialized = false;
    });

    it('does not reuse stale project path or package cache between migrations', async () => {
        const projectA = await fse.mkdtemp(path.join(os.tmpdir(), 'cocos-cli-project-a-'));
        const projectB = await fse.mkdtemp(path.join(os.tmpdir(), 'cocos-cli-project-b-'));

        try {
            await fse.ensureDir(path.join(projectA, 'settings/v2/packages'));
            await fse.ensureDir(path.join(projectB, 'settings/v2/packages'));
            await fse.writeJSON(path.join(projectA, 'settings/v2/packages/engine.json'), {
                modules: {
                    globalConfigKey: 'project-a',
                },
            });
            await fse.writeJSON(path.join(projectB, 'settings/v2/packages/engine.json'), {
                modules: {
                    globalConfigKey: 'project-b',
                },
            });

            const target: IMigrationTarget = {
                sourceScope: 'project',
                pluginName: 'engine',
                migrate: async (oldConfig: Record<string, any>) => ({
                    engine: {
                        globalConfigKey: oldConfig.modules.globalConfigKey,
                    },
                }),
            };
            CocosMigrationManager.clear();
            CocosMigrationManager.register(target);
            (CocosMigrationManager as any)._initialized = true;

            await expect(CocosMigrationManager.loadEditorOwnedConfig(projectA)).resolves.toEqual({
                engine: { globalConfigKey: 'project-a' },
            });
            await expect(CocosMigrationManager.loadEditorOwnedConfig(projectB)).resolves.toEqual({
                engine: { globalConfigKey: 'project-b' },
            });
        } finally {
            await fse.remove(projectA);
            await fse.remove(projectB);
            CocosMigrationManager.clear();
            (CocosMigrationManager as any)._initialized = false;
        }
    });
});
