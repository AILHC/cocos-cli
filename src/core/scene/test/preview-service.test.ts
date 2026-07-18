const mockRequest = jest.fn();
const mockRepaintInEditMode = jest.fn();
const mockPreviewInstances: any[] = [];

const mockCreatePreviewClass = (kind: string) => class {
    kind = kind;
    init = jest.fn();
    setMaterialByUuid = jest.fn();
    setModel = jest.fn();
    setMesh = jest.fn();
    setPrefab = jest.fn();
    setSkeleton = jest.fn();
    setSpine = jest.fn();
    queryPreviewData = jest.fn().mockResolvedValue(new Uint8Array([1, 2, 3]));
    camera = { changeTargetWindow: jest.fn(), enabled: false, isWindowSize: false, scene: null };
    cameraComp = { camera: this.camera, enabled: false };
    scene = { renderScene: { addCamera: jest.fn() } };

    constructor() {
        mockPreviewInstances.push(this);
    }
};

jest.mock('../scene-process/rpc', () => ({
    Rpc: {
        getInstance: () => ({ request: mockRequest }),
    },
}));

jest.mock('../scene-process/service/core', () => ({
    BaseService: class {},
    register: () => (target: unknown) => target,
    Service: {
        Engine: {
            repaintInEditMode: mockRepaintInEditMode,
        },
    },
}));

jest.mock('../scene-process/service/preview/preview-base', () => ({
    PreviewBase: mockCreatePreviewClass('base'),
}));
jest.mock('../scene-process/service/preview/interactive-preview', () => ({
    InteractivePreview: class {},
}));
jest.mock('../scene-process/service/preview/scene-preview', () => {
    const ScenePreview = mockCreatePreviewClass('scene');
    return { ScenePreview, scenePreview: new ScenePreview() };
});
jest.mock('../scene-process/service/preview/mini-preview', () => ({
    MiniPreview: mockCreatePreviewClass('mini'),
}));
jest.mock('../scene-process/service/preview/material-preview', () => ({
    MaterialPreview: mockCreatePreviewClass('material'),
}));
jest.mock('../scene-process/service/preview/model-preview', () => ({
    ModelPreview: mockCreatePreviewClass('model'),
}));
jest.mock('../scene-process/service/preview/mesh-preview', () => ({
    MeshPreview: mockCreatePreviewClass('mesh'),
}));
jest.mock('../scene-process/service/preview/skeleton-preview', () => ({
    SkeletonPreview: mockCreatePreviewClass('skeleton'),
}));
jest.mock('../scene-process/service/preview/prefab-preview', () => ({
    PrefabPreview: mockCreatePreviewClass('prefab'),
}));
jest.mock('../scene-process/service/preview/spine-preview', () => ({
    SpinePreview: mockCreatePreviewClass('spine'),
}));

import { PreviewService } from '../scene-process/service/preview';

describe('PreviewService', () => {
    const mainWindow = {};

    beforeEach(() => {
        jest.clearAllMocks();
        mockPreviewInstances.length = 0;
        (globalThis as any).cc = {
            director: {
                root: { mainWindow },
            },
        };
    });

    it.each([
        ['cc.Material', undefined, 'material', 'setMaterialByUuid'],
        ['cc.FBX', undefined, 'model', 'setModel'],
        ['cc.GLTF', undefined, 'model', 'setModel'],
        ['cc.ModelAsset', undefined, 'model', 'setModel'],
        ['cc.Mesh', undefined, 'mesh', 'setMesh'],
        ['cc.Prefab', undefined, 'prefab', 'setPrefab'],
        ['cc.Skeleton', undefined, 'skeleton', 'setSkeleton'],
        ['sp.SkeletonData', undefined, 'spine', 'setSpine'],
        ['cc.Asset', 'fbx', 'model', 'setModel'],
    ])('opens %s with the %s preview', async (type, importer, kind, setup) => {
        mockRequest.mockResolvedValue({ type, importer });
        const service = new PreviewService();
        service.init();

        const active = await service.open('asset-uuid') as any;

        expect(active?.kind).toBe(kind);
        expect(active[setup]).toHaveBeenCalledWith('asset-uuid');
        expect(active.camera.changeTargetWindow).toHaveBeenCalledWith(mainWindow);
        expect(active.cameraComp.enabled).toBe(true);
        expect(mockRepaintInEditMode).toHaveBeenCalledTimes(1);
    });

    it('returns null for unsupported assets', async () => {
        mockRequest.mockResolvedValue({ type: 'cc.AudioClip' });
        const service = new PreviewService();
        service.init();

        await expect(service.open('audio-uuid')).resolves.toBeNull();
        expect(mockRepaintInEditMode).not.toHaveBeenCalled();
    });

    it('disables the previous camera when active preview changes', async () => {
        mockRequest
            .mockResolvedValueOnce({ type: 'cc.Material' })
            .mockResolvedValueOnce({ type: 'cc.Mesh' });
        const service = new PreviewService();
        service.init();

        const first = await service.open('material-uuid') as any;
        const second = await service.open('mesh-uuid') as any;

        expect(first.cameraComp.enabled).toBe(false);
        expect(second.cameraComp.enabled).toBe(true);
        expect(service.activePreview).toBe(second);
    });

    it('generates a thumbnail without replacing the active preview', async () => {
        mockRequest.mockResolvedValue({ type: 'cc.Material' });
        const service = new PreviewService();
        service.init();
        const active = await service.open('material-uuid');

        const thumbnail = await service.generateThumbnail('mesh-uuid', 'cc.Mesh', 96, 64);
        const mesh = mockPreviewInstances.find((instance) => instance.kind === 'mesh');

        expect(mesh.setMesh).toHaveBeenCalledWith('mesh-uuid');
        expect(mesh.queryPreviewData).toHaveBeenCalledWith({ width: 96, height: 64 });
        expect(thumbnail).toEqual(new Uint8Array([1, 2, 3]));
        expect(service.activePreview).toBe(active);
    });
});
