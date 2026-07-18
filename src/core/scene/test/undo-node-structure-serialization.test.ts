const mockPrefabSerialize = jest.fn();
const mockGetNodePath = jest.fn((node: MockNode) => node.path);
const mockEditorExtrasTag = Symbol('editorExtrasTag');
const mockNodeManager = { emit: jest.fn() };
const mockIsNodeInCurrentScene = jest.fn();
const mockGetEditorNodeManager = jest.fn();
const mockGetEditorExtends = jest.fn();
const mockGetMountedRoot = jest.fn((target: any) => target?.[mockEditorExtrasTag]?.mountedRoot);
const mockSetMountedRoot = jest.fn((target: any, mountedRoot: MockNode | undefined) => {
    target[mockEditorExtrasTag] ??= {};
    target[mockEditorExtrasTag].mountedRoot = mountedRoot;
});
const mockDeserializeFull = jest.fn();
const mockLoadWithJson = jest.fn();
const mockInstantiate = jest.fn();

class MockNode {
    isValid = true;
    components: Array<{ uuid: string; __prefab?: unknown; [mockEditorExtrasTag]?: { mountedRoot?: MockNode } }> = [];
    children: MockNode[] = [];
    parent: MockNode | null = null;
    path = '';
    _prefab?: unknown;
    [mockEditorExtrasTag]?: { mountedRoot?: MockNode };

    constructor(public uuid: string, public name = uuid) { }

    getSiblingIndex(): number {
        return this.parent ? this.parent.children.indexOf(this) : 0;
    }

    addChild(child: MockNode): void {
        child.setParent(this);
    }

    setParent(parent: MockNode | null): void {
        if (this.parent === parent) return;
        if (this.parent) {
            const index = this.parent.children.indexOf(this);
            if (index >= 0) this.parent.children.splice(index, 1);
        }
        this.parent = parent;
        if (parent && !parent.children.includes(this)) {
            parent.children.push(this);
        }
    }

    setSiblingIndex(index: number): void {
        if (!this.parent) return;
        const children = this.parent.children;
        const currentIndex = children.indexOf(this);
        if (currentIndex >= 0) children.splice(currentIndex, 1);
        children.splice(index, 0, this);
    }

    isChildOf(parent: MockNode): boolean {
        let current = this.parent;
        while (current) {
            if (current === parent) return true;
            current = current.parent;
        }
        return false;
    }
}

jest.mock('cc', () => ({
    editorExtrasTag: mockEditorExtrasTag,
    Node: MockNode,
}));

jest.mock('../scene-process/service/node/index', () => ({
    __esModule: true,
    default: mockNodeManager,
}));

jest.mock('../scene-process/service/prefab/prefab-editor-utils', () => ({
    editorPrefabUtils: {
        serialize: mockPrefabSerialize,
    },
}));

jest.mock('../scene-process/service/prefab/utils', () => ({
    prefabUtils: {
        getMountedRoot: mockGetMountedRoot,
        setMountedRoot: mockSetMountedRoot,
    },
}));

jest.mock('../scene-process/service/undo/commands/command-utils-shared', () => ({
    createUndoId: jest.fn((type: string) => `${type}:id`),
    success: jest.fn((meta: unknown) => ({ success: true, meta })),
    failure: jest.fn((meta: unknown, reason: string) => ({ success: false, meta, reason })),
    isNodeInCurrentScene: mockIsNodeInCurrentScene,
    getEditorNodeManager: mockGetEditorNodeManager,
    getEditorExtends: mockGetEditorExtends,
    getNodePath: mockGetNodePath,
}));

import {
    captureNodeStructureSnapshot,
    restoreNodeStructureSnapshot,
} from '../scene-process/service/undo/commands/node-structure-command-utils';

describe('captureNodeStructureSnapshot serialization', () => {
    beforeEach(() => {
        mockPrefabSerialize.mockReset();
        mockPrefabSerialize.mockReturnValue(JSON.stringify({ __type__: 'cc.Prefab' }));
        mockGetNodePath.mockClear();
        mockNodeManager.emit.mockClear();
        mockIsNodeInCurrentScene.mockReset().mockReturnValue(false);
        mockGetEditorNodeManager.mockReset().mockReturnValue(null);
        mockGetMountedRoot.mockClear();
        mockSetMountedRoot.mockClear();
        mockDeserializeFull.mockReset();
        mockLoadWithJson.mockReset();
        mockInstantiate.mockReset();
        (global as any).EditorExtends = {
            serialize: jest.fn((node: MockNode) => JSON.stringify({
                __type__: 'cc.Node',
                uuid: node.uuid,
                name: node.name,
            })),
            deserializeFull: {
                deserializeFull: mockDeserializeFull,
            },
            Component: {
                getComponent: jest.fn(() => null),
                changeUUID: jest.fn(),
            },
        };
        mockGetEditorExtends.mockImplementation(() => (global as any).EditorExtends);
        (global as any).cc = {
            assetManager: {
                loadWithJson: mockLoadWithJson,
            },
            director: {
                getScene: jest.fn(() => null),
            },
            instantiate: mockInstantiate,
        };
    });

    it('serializes a plain node as node JSON instead of prefab JSON', () => {
        const node = new MockNode('plain-node', 'PlainNode');
        node.path = '/PlainNode';

        const snapshot = captureNodeStructureSnapshot(node as any);

        expect(snapshot).not.toBeNull();
        expect(snapshot!.serialization).toBe('node');
        expect((global as any).EditorExtends.serialize).toHaveBeenCalledWith(node);
        expect(mockPrefabSerialize).not.toHaveBeenCalled();
        expect(JSON.parse(snapshot!.serializedJson)).toMatchObject({
            __type__: 'cc.Node',
            uuid: 'plain-node',
        });
    });

    it('keeps prefab serialization for prefab-related nodes', () => {
        const node = new MockNode('prefab-node', 'PrefabNode') as MockNode & { _prefab?: unknown };
        node.path = '/PrefabNode';
        node._prefab = { instance: {} };

        const snapshot = captureNodeStructureSnapshot(node as any);

        expect(snapshot).not.toBeNull();
        expect(snapshot!.serialization).toBe('prefab');
        expect(mockPrefabSerialize).toHaveBeenCalledWith(node);
        expect((global as any).EditorExtends.serialize).not.toHaveBeenCalled();
        expect(JSON.parse(snapshot!.serializedJson)).toMatchObject({
            __type__: 'cc.Prefab',
        });
    });

    it('serializes mounted plain nodes as node JSON instead of prefab JSON', () => {
        const prefabRoot = new MockNode('prefab-root', 'PrefabRoot');
        const node = new MockNode('mounted-button', 'Button') as MockNode & {
            [mockEditorExtrasTag]?: { mountedRoot?: MockNode };
        };
        node.path = '/PrefabRoot/Button';
        node[mockEditorExtrasTag] = { mountedRoot: prefabRoot };
        node.components.push({
            uuid: 'button-comp',
            __prefab: { fileId: 'button-comp-file-id' },
            [mockEditorExtrasTag]: { mountedRoot: prefabRoot },
        });

        const snapshot = captureNodeStructureSnapshot(node as any);

        expect(snapshot).not.toBeNull();
        expect(snapshot!.serialization).toBe('node');
        expect(snapshot!.uuidTree).toMatchObject({
            mountedRootUuid: 'prefab-root',
            componentMountedRootUuids: ['prefab-root'],
        });
        expect((global as any).EditorExtends.serialize).toHaveBeenCalledWith(node);
        expect(mockPrefabSerialize).not.toHaveBeenCalled();
        expect(JSON.parse(snapshot!.serializedJson)).toMatchObject({
            __type__: 'cc.Node',
            uuid: 'mounted-button',
        });
    });

    it('can force prefab serialization for prefab undo snapshots', () => {
        const node = new MockNode('plain-prefab-editor-root', 'PlainPrefabRoot');
        node.path = '/PlainPrefabRoot';

        const snapshot = captureNodeStructureSnapshot(node as any, '', { serialization: 'prefab' });

        expect(snapshot).not.toBeNull();
        expect(mockPrefabSerialize).toHaveBeenCalledWith(node);
        expect((global as any).EditorExtends.serialize).not.toHaveBeenCalled();
    });

    it('restores node JSON with deserializeFull and rebuilds mountedRoot after UUID restoration', async () => {
        const prefabRoot = new MockNode('prefab-root', 'PrefabRoot');
        prefabRoot.path = '/PrefabRoot';
        const node = new MockNode('mounted-button', 'Button');
        node.path = '/PrefabRoot/Button';
        prefabRoot.addChild(node);
        node[mockEditorExtrasTag] = { mountedRoot: prefabRoot };
        node.components.push({
            uuid: 'button-comp',
            [mockEditorExtrasTag]: { mountedRoot: prefabRoot },
        });
        const snapshot = captureNodeStructureSnapshot(node as any)!;

        prefabRoot.children = [];
        node.parent = null;
        const restored = new MockNode('temporary-node', 'Button');
        const clonedParent = new MockNode('cloned-parent', 'New Node');
        clonedParent.addChild(restored);
        const restoredComponent = { uuid: 'temporary-component' };
        restored.components.push(restoredComponent);
        mockDeserializeFull.mockResolvedValue(restored);
        mockLoadWithJson.mockImplementation((_json, _options, callback) => callback(null, restored));
        let parentSeenAtRealAttach: MockNode | null | undefined;
        const attachToRealParent = prefabRoot.addChild.bind(prefabRoot);
        jest.spyOn(prefabRoot, 'addChild').mockImplementation((child: MockNode) => {
            parentSeenAtRealAttach = child.parent;
            attachToRealParent(child);
        });

        const editorNodeManager = {
            getNode: jest.fn((uuid: string) => uuid === prefabRoot.uuid ? prefabRoot : null),
            getNodeByPath: jest.fn(() => null),
            changeNodeUUID: jest.fn((_oldUuid: string, uuid: string) => {
                restored.uuid = uuid;
            }),
        };
        const componentManager = (global as any).EditorExtends.Component;
        componentManager.changeUUID.mockImplementation((_oldUuid: string, uuid: string) => {
            restoredComponent.uuid = uuid;
        });
        mockGetEditorNodeManager.mockReturnValue(editorNodeManager);
        mockIsNodeInCurrentScene.mockImplementation((target: MockNode | null) => target === prefabRoot || target === restored);

        const result = await restoreNodeStructureSnapshot(snapshot, {
            id: 'restore-node',
            label: 'Restore Node',
            type: 'node:remove',
            scope: { editorType: 'scene' },
            timestamp: 1,
        });

        expect(result.success).toBe(true);
        expect(mockDeserializeFull).toHaveBeenCalledWith(JSON.parse(snapshot.serializedJson));
        expect(mockLoadWithJson).not.toHaveBeenCalled();
        expect(parentSeenAtRealAttach).toBeNull();
        expect(clonedParent.children).not.toContain(restored);
        expect(restored.parent).toBe(prefabRoot);
        expect(restored.uuid).toBe('mounted-button');
        expect(restoredComponent.uuid).toBe('button-comp');
        expect(mockSetMountedRoot).toHaveBeenCalledWith(restored, prefabRoot);
        expect(mockSetMountedRoot).toHaveBeenCalledWith(restoredComponent, prefabRoot);
        expect(editorNodeManager.changeNodeUUID.mock.invocationCallOrder[0])
            .toBeLessThan(mockSetMountedRoot.mock.invocationCallOrder[0]);
        expect(componentManager.changeUUID.mock.invocationCallOrder[0])
            .toBeLessThan(mockSetMountedRoot.mock.invocationCallOrder[1]);
    });

    it('keeps prefab JSON restoration on loadWithJson and instantiate', async () => {
        const parent = new MockNode('parent', 'Parent');
        parent.path = '/Parent';
        const node = new MockNode('prefab-node', 'PrefabNode');
        node.path = '/Parent/PrefabNode';
        node._prefab = {};
        parent.addChild(node);
        const snapshot = captureNodeStructureSnapshot(node as any)!;

        parent.children = [];
        node.parent = null;
        const restored = new MockNode('temporary-prefab-node', 'PrefabNode');
        const prefabAsset = { data: restored };
        mockLoadWithJson.mockImplementation((_json, _options, callback) => callback(null, prefabAsset));
        mockInstantiate.mockImplementation((asset) => asset.data);
        mockGetEditorNodeManager.mockReturnValue({
            getNode: jest.fn((uuid: string) => uuid === parent.uuid ? parent : null),
            getNodeByPath: jest.fn(() => null),
            changeNodeUUID: jest.fn((_oldUuid: string, uuid: string) => {
                restored.uuid = uuid;
            }),
        });
        mockIsNodeInCurrentScene.mockImplementation((target: MockNode | null) => target === parent || target === restored);

        const result = await restoreNodeStructureSnapshot(snapshot, {
            id: 'restore-prefab',
            label: 'Restore Prefab',
            type: 'node:remove',
            scope: { editorType: 'scene' },
            timestamp: 1,
        });

        expect(result.success).toBe(true);
        expect(mockLoadWithJson).toHaveBeenCalled();
        expect(mockInstantiate).toHaveBeenCalledWith(prefabAsset);
        expect(mockDeserializeFull).not.toHaveBeenCalled();
    });
});
