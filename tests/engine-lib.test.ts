jest.mock('../src/core/engine', () => ({
    Engine: {
        queryLocalizedRenderConfig: jest.fn(),
    },
}));

describe('engine lib api', () => {
    beforeEach(() => {
        jest.resetModules();
    });

    it('should delegate getRenderConfig to Engine.queryLocalizedRenderConfig', async () => {
        const expectedRenderConfig = {
            version: 'test-version',
            features: {
                base: {
                    label: 'Core',
                },
            },
            categories: {},
        };

        const { Engine } = require('../src/core/engine') as typeof import('../src/core/engine');
        Engine.queryLocalizedRenderConfig = jest.fn().mockReturnValue(expectedRenderConfig);

        const { getRenderConfig } = require('../src/lib/engine/engine') as typeof import('../src/lib/engine/engine');

        await expect(getRenderConfig()).resolves.toEqual(expectedRenderConfig);
        expect(Engine.queryLocalizedRenderConfig).toHaveBeenCalledTimes(1);
    });
});
