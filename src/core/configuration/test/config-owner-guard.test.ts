import { BaseConfiguration } from '../script/config';

describe('BaseConfiguration owner guard', () => {
    it('rejects editor-owned project-scope writes before mutating configs', async () => {
        const config = new BaseConfiguration('import', {});

        await expect(config.set('fbx.material.smart', true)).rejects.toThrow('is maintained by Cocos Creator Editor');
        expect(config.getAll()).toEqual({});
    });

    it('allows CLI-owned project-scope writes', async () => {
        const config = new BaseConfiguration('import', {});

        await expect(config.set('globList', ['!**/*.tmp'])).resolves.toBe(true);
        expect(config.getAll()).toEqual({ globList: ['!**/*.tmp'] });
    });
});
