import { globalSetup } from '../../test/global-setup';
import { getPhysicsConfig } from '../worker/builder/tasks/setting-task/utils/project-options';

describe('builder physics settings', () => {
    const defaultMaterial = 'ba21476f-2866-4f81-9c4d-6e359316e448';

    beforeAll(async () => {
        await globalSetup();
    });

    it('drops default 3D physics material when no 3D physics backend is included', async () => {
        const config = await getPhysicsConfig(['2d', 'physics-2d-box2d-wasm'], {
            defaultMaterial,
            gravity: { x: 0, y: -10, z: 0 },
        } as any);

        expect(config.physicsEngine).toBe('');
        expect(config.defaultMaterial).toBeUndefined();
        expect(config.gravity).toEqual({ x: 0, y: -10, z: 0 });
    });

    it('does not treat the shared physics framework feature as a backend default material owner', async () => {
        const config = await getPhysicsConfig(['2d', 'physics-framework'], {
            defaultMaterial,
            gravity: { x: 0, y: -10, z: 0 },
        } as any);

        expect(config.physicsEngine).toBe('');
        expect(config.defaultMaterial).toBeUndefined();
    });

    it('keeps default 3D physics material when a 3D physics backend is included', async () => {
        const config = await getPhysicsConfig(['2d', 'physics-cannon'], {
            defaultMaterial,
            gravity: { x: 0, y: -10, z: 0 },
        } as any);

        expect(config.physicsEngine).toBe('physics-cannon');
        expect(config.defaultMaterial).toBe(defaultMaterial);
    });
});
