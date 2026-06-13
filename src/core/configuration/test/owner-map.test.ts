import {
    buildPersistedCliConfig,
    mergeRuntimeProjectConfig,
    isCliOwnedConfigPath,
    isEditorOwnedConfigPath,
} from '../script/owner-map';

describe('configuration owner map', () => {
    it('keeps only CLI-owned import fields and persistence metadata in cocos.config.json', () => {
        const source = {
            version: '1.0.0',
            $schema: './temp/cli/cocos.config.schema.json',
            import: {
                restoreAssetDBFromCache: true,
                globList: ['!**/*.tmp'],
                createTemplateRoot: '.creator/custom-template-root',
                fbx: {
                    material: {
                        smart: true,
                    },
                },
            },
            engine: {
                globalConfigKey: 'stale-engine',
            },
            builder: {
                common: {
                    platform: 'web-mobile',
                },
            },
        };

        expect(buildPersistedCliConfig(source)).toEqual({
            version: '1.0.0',
            $schema: './temp/cli/cocos.config.schema.json',
            import: {
                restoreAssetDBFromCache: true,
                globList: ['!**/*.tmp'],
                createTemplateRoot: '.creator/custom-template-root',
            },
        });
    });

    it('merges editor-owned config before CLI-owned overlay', () => {
        const editorConfig = {
            import: {
                fbx: {
                    material: {
                        smart: false,
                    },
                },
            },
            engine: {
                globalConfigKey: 'from-editor',
            },
        };
        const cliConfig = {
            import: {
                globList: ['!**/*.cache'],
                fbx: {
                    material: {
                        smart: true,
                    },
                },
            },
            engine: {
                globalConfigKey: 'from-cocos-config',
            },
        };

        expect(mergeRuntimeProjectConfig(editorConfig, cliConfig)).toEqual({
            import: {
                globList: ['!**/*.cache'],
                fbx: {
                    material: {
                        smart: false,
                    },
                },
            },
            engine: {
                globalConfigKey: 'from-editor',
            },
        });
    });

    it('classifies config paths by owner', () => {
        expect(isCliOwnedConfigPath('import.globList')).toBe(true);
        expect(isCliOwnedConfigPath('import.restoreAssetDBFromCache')).toBe(true);
        expect(isCliOwnedConfigPath('import.createTemplateRoot')).toBe(true);
        expect(isCliOwnedConfigPath('version')).toBe(true);
        expect(isCliOwnedConfigPath('$schema')).toBe(true);
        expect(isCliOwnedConfigPath('import.fbx.material.smart')).toBe(false);
        expect(isCliOwnedConfigPath('import.someFutureEditorField')).toBe(false);

        expect(isEditorOwnedConfigPath('engine.globalConfigKey')).toBe(true);
        expect(isEditorOwnedConfigPath('builder.common.platform')).toBe(true);
        expect(isEditorOwnedConfigPath('script.useDefineForClassFields')).toBe(true);
        expect(isEditorOwnedConfigPath('scene.tick')).toBe(true);
        expect(isEditorOwnedConfigPath('import.fbx.material.smart')).toBe(true);
        expect(isEditorOwnedConfigPath('import.someFutureEditorField')).toBe(true);
        expect(isEditorOwnedConfigPath('import.restoreAssetDBFromCache')).toBe(false);
    });
});
