import { join } from 'path';
import i18n from '../../base/i18n';
import { TestGlobalEnv } from '../../../tests/global-env';

describe('engine render-config localization', () => {
    afterEach(() => {
        i18n.setLanguage('en');
    });

    it('should translate render-config labels and descriptions into English', () => {
        const dynamicMetadata = jest.requireActual('../dynamic-metadata') as any;
        const enLocalization = require(join(TestGlobalEnv.engineRoot, 'editor', 'i18n', 'en', 'localization.js'));

        i18n.setLanguage('en');
        const renderConfig = dynamicMetadata.getLocalizedEngineRenderConfig(TestGlobalEnv.engineRoot);

        expect(renderConfig.features.base.label).toBe(enLocalization.features.core.label);
        expect(renderConfig.features.base.description).toBe(enLocalization.features.core.description);
        expect(renderConfig.features.physics.options['physics-ammo'].label).toBe(enLocalization.features.physics_ammo.label);
        expect(renderConfig.features.physics.options['physics-ammo'].flags.LOAD_BULLET_MANUALLY.description)
            .toBe(enLocalization.features.flags.bullet.loadManual.description);
        expect(renderConfig.categories.graphics.label).toBe(enLocalization.features.graphics.label);
        expect(renderConfig.features.base.label).not.toMatch(/^i18n:/);
    });

    it('should follow the current language when translating render-config data', () => {
        const dynamicMetadata = jest.requireActual('../dynamic-metadata') as any;
        const zhLocalization = require(join(TestGlobalEnv.engineRoot, 'editor', 'i18n', 'zh', 'localization.js'));

        i18n.setLanguage('zh');
        const renderConfig = dynamicMetadata.getLocalizedEngineRenderConfig(TestGlobalEnv.engineRoot);

        expect(renderConfig.features.base.label).toBe(zhLocalization.features.core.label);
        expect(renderConfig.features.physics.options['physics-ammo'].label).toBe(zhLocalization.features.physics_ammo.label);
        expect(renderConfig.categories.graphics.label).toBe(zhLocalization.features.graphics.label);
        expect(renderConfig.features.base.label).not.toMatch(/^i18n:/);
    });
});
