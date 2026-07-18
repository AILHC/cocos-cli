import { configurationRegistry } from '../../configuration';
import { sceneConfigInstance, ISceneConfig } from '../scene-configs';

describe('SceneConfig', () => {
    let saveSpy: jest.SpyInstance;

    beforeEach(async () => {
        await sceneConfigInstance.init();
        const instance = configurationRegistry.getInstance('scene')!;
        saveSpy = jest.spyOn(instance, 'save').mockResolvedValue(true);
    });

    afterEach(async () => {
        saveSpy.mockRestore();
        await configurationRegistry.unregister('scene');
    });

    describe('init', () => {
        it('should register scene config in configurationRegistry', () => {
            const instance = configurationRegistry.getInstance('scene');
            expect(instance).toBeDefined();
            expect(instance!.moduleName).toBe('scene');
        });

        it('should return full default config when get() called without path', async () => {
            const config = await sceneConfigInstance.get<ISceneConfig>();
            expect(config.tick).toBe(false);
            expect(config.camera).toBeDefined();
            expect(config.gizmo).toBeDefined();
            expect(config.sceneView).toBeDefined();
        });
    });

    describe('get - read default values by path', () => {
        it('should get top-level tick config', async () => {
            expect(await sceneConfigInstance.get('tick')).toBe(false);
        });

        it('should get camera config object', async () => {
            const camera = await sceneConfigInstance.get<Record<string, any>>('camera');
            expect(camera.fov).toBe(45);
            expect(camera.far).toBe(10000);
            expect(camera.near).toBe(0.01);
            expect(camera.color).toEqual([48, 48, 48, 255]);
            expect(camera.enableAcceleration).toBe(true);
        });

        it('should get nested camera properties via dot path', async () => {
            expect(await sceneConfigInstance.get('camera.fov')).toBe(45);
            expect(await sceneConfigInstance.get('camera.wheelSpeed')).toBe(0.01);
        });

        it('should get gizmo config', async () => {
            const gizmo = await sceneConfigInstance.get<Record<string, any>>('gizmo');
            expect(gizmo.is2D).toBe(false);
            expect(gizmo.transformToolName).toBe('position');
            expect(gizmo.viewMode).toBe('select');
            expect(gizmo.pivot).toBe('pivot');
            expect(gizmo.coordinate).toBe('local');
            expect(gizmo.toolsVisibility3d).toBe(true);
            expect(gizmo.gridVisible).toBe(true);
            expect(gizmo.gridColor).toEqual([166, 166, 166, 255]);
            expect(gizmo.originAxis2D).toEqual({ x: true, y: true, z: false });
            expect(gizmo.originAxis3D).toEqual({ x: true, y: false, z: true });
        });

        it('should get deeply nested gizmo properties', async () => {
            expect(await sceneConfigInstance.get('gizmo.rectSnapConfig')).toEqual({
                enableSnapping: true,
                snapThreshold: 4,
            });
            expect(await sceneConfigInstance.get('gizmo.rectSnapConfig.snapThreshold')).toBe(4);
        });

        it('should get sceneView config', async () => {
            expect(await sceneConfigInstance.get('sceneView.sceneLightOn')).toBe(true);
        });
    });

    describe('project writes', () => {
        it.each([
            ['tick', true],
            ['camera.fov', 60],
            ['gizmo.is2D', true],
            ['gizmo.viewMode', 'view'],
            ['gizmo.snapConfigs', {
                position: { x: 2, y: 2, z: 2 },
                rotation: 15,
                scale: 0.5,
                isPositionSnapEnabled: true,
                isRotationSnapEnabled: true,
                isScaleSnapEnabled: false,
            }],
            ['sceneView.sceneLightOn', false],
        ])('should reject CLI persistence for Editor-owned path %s', async (path, value) => {
            await expect(sceneConfigInstance.set(path, value)).rejects.toThrow('maintained by Cocos Creator Editor');
        });
    });

    describe('set with scope', () => {
        it('should write to default scope and read back', async () => {
            await sceneConfigInstance.set('tick', true, 'default');
            expect(await sceneConfigInstance.get('tick', 'default')).toBe(true);
        });

        it('should reject explicit project scope for Editor-owned config', async () => {
            await expect(sceneConfigInstance.set('camera.fov', 90, 'project'))
                .rejects.toThrow('maintained by Cocos Creator Editor');
            expect(await sceneConfigInstance.get('camera.fov', 'default')).toBe(45);
        });
    });
});
