import type { IEngineService, IPublicEngineService } from '../common/engine';

describe('Engine service interface', () => {
    it('exposes custom layer initialization only on the internal engine service', () => {
        const assertInternal = (service: IEngineService) => {
            const result: Promise<void> = service.initCustomLayer([{ name: 'Gameplay', value: 1 << 3 }]);

            expect(result).toBeDefined();
        };

        const assertPublic = (service: IPublicEngineService) => {
            // @ts-expect-error custom layer initialization is scene-process internal.
            service.initCustomLayer([{ name: 'Gameplay', value: 1 << 3 }]);
        };

        expect(assertInternal).toBeDefined();
        expect(assertPublic).toBeDefined();
    });
});
