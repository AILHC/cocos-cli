import path from 'path';
import os from 'os';
import fse from 'fs-extra';
import { ConfigurationManager } from '../script/manager';
import { configurationRegistry } from '../script/registry';

describe('ConfigurationManager with real Editor files', () => {
    let projectPath = '';
    let manager: ConfigurationManager;

    beforeEach(async () => {
        projectPath = await fse.mkdtemp(path.join(os.tmpdir(), 'cocos-cli-manager-editor-files-'));
        manager = new ConfigurationManager();
    });

    afterEach(async () => {
        await configurationRegistry.unregister('engine').catch(() => undefined);
        manager.reset();
        await fse.remove(projectPath);
    });

    it('initializes editor-owned runtime config from Editor files even when cocos.config.json has current version stale fields', async () => {
        await fse.ensureDir(path.join(projectPath, 'settings/v2/packages'));
        await fse.writeJSON(path.join(projectPath, 'settings/v2/packages/engine.json'), {
            modules: {
                configs: {},
                globalConfigKey: 'from-editor',
                graphics: {},
            },
        });
        await fse.writeJSON(path.join(projectPath, 'cocos.config.json'), {
            version: '1.0.0',
            engine: {
                globalConfigKey: 'from-stale-cocos-config',
            },
            import: {
                globList: ['!**/*.tmp'],
            },
        });

        await manager.initialize(projectPath);
        const engineConfig = await configurationRegistry.register('engine', { defaults: {} });

        await expect(engineConfig.get('globalConfigKey')).resolves.toBe('from-editor');

        await manager.save(true);
        const persisted = await fse.readJSON(path.join(projectPath, 'cocos.config.json'));
        expect(persisted.engine).toBeUndefined();
        expect(persisted.import.globList).toEqual(['!**/*.tmp']);
    });
});
