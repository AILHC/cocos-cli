import { globalSetup } from '../../test/global-setup';
import { checkProjectSetting, checkStartScene } from '../share/common-options-validator';

describe('check-options', () => {
    const defaultPhysicsMaterial = 'ba21476f-2866-4f81-9c4d-6e359316e448';

    beforeAll(async () => {
        await globalSetup();
    });
    
    describe('check-start-scene', () => {
        it('check-start-scene by uuid', () => {
            const startScene = 'f895c111-fd50-4ed6-b07c-f514972cfbd1';
            const result = checkStartScene(startScene);
            expect(result).toBe(true);
        });
        it('check-start-scene by url', async () => {
            const startScene = 'db://assets/scene-2d.scene';
            const result = checkStartScene(startScene);
            expect(result).toBe(true);
        });
        it('check-start-scene by invalid uuid', () => {
            const startScene = '123';
            const result = checkStartScene(startScene);
            expect(result).toBeInstanceOf(Error);
        });
        it('check-start-scene by invalid url', () => {
            const startScene = 'db://assets/scene-2d.scene1';
            const result = checkStartScene(startScene);
            expect(result).toBeInstanceOf(Error);
        });
    });

    describe('check-project-setting', () => {
        it('drops default 3D physics material from build options when no 3D physics backend is included', async () => {
            const options = {
                includeModules: ['2d', 'physics-2d-box2d-wasm'],
                physicsConfig: {
                    defaultMaterial: defaultPhysicsMaterial,
                    gravity: { x: 0, y: -10, z: 0 },
                },
            } as any;

            await checkProjectSetting(options);

            expect(options.physicsConfig.defaultMaterial).toBeUndefined();
            expect(options.physicsConfig.gravity).toEqual({ x: 0, y: -10, z: 0 });
        });

        it('does not add default 3D physics material for physics-framework without backend dependent asset', async () => {
            const options = {
                includeModules: ['2d', 'physics-framework'],
                physicsConfig: {},
            } as any;

            await checkProjectSetting(options);

            expect(options.physicsConfig.defaultMaterial).toBeUndefined();
        });

        it('keeps default 3D physics material in build options when a 3D physics backend is included', async () => {
            const options = {
                includeModules: ['2d', 'physics-cannon'],
                physicsConfig: {},
            } as any;

            await checkProjectSetting(options);

            expect(options.physicsConfig.defaultMaterial).toBe(defaultPhysicsMaterial);
        });
    });
});
