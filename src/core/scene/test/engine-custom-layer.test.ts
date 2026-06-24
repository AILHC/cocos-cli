jest.mock('cc', () => ({
    Component: class Component {},
    Node: class Node {},
    GeometryRenderer: class GeometryRenderer {},
    director: {
        getTotalFrames: jest.fn(() => 0),
        tick: jest.fn(),
    },
}));

type CustomLayer = { name: string; value: number };

const layers = {
    deleteLayer: jest.fn(),
    addLayer: jest.fn(),
};

(globalThis as any).cc = {
    Layers: layers,
};

import { EngineService } from '../scene-process/service/engine';

describe('Engine custom layer', () => {
    beforeEach(() => {
        layers.deleteLayer.mockClear();
        layers.addLayer.mockClear();
    });

    it('resets custom layer slots and adds valid layer masks', async () => {
        const service = new EngineService() as unknown as {
            initCustomLayer(layers?: CustomLayer[]): Promise<void>;
        };

        await service.initCustomLayer([
            { name: 'Gameplay', value: 1 << 3 },
            { name: 'InvalidBit', value: 1 << 23 },
            { name: 'UIOverride', value: 1 << 0 },
        ]);

        expect(layers.deleteLayer).toHaveBeenCalledTimes(20);
        expect(layers.deleteLayer.mock.calls.map(([index]) => index)).toEqual([
            0, 1, 2, 3, 4, 5, 6, 7, 8, 9,
            10, 11, 12, 13, 14, 15, 16, 17, 18, 19,
        ]);
        expect(layers.addLayer).toHaveBeenCalledTimes(2);
        expect(layers.addLayer).toHaveBeenNthCalledWith(1, 'Gameplay', 3);
        expect(layers.addLayer).toHaveBeenNthCalledWith(2, 'UIOverride', 0);
    });

    it('ignores missing layer config', async () => {
        const service = new EngineService() as unknown as {
            initCustomLayer(layers?: CustomLayer[]): Promise<void>;
        };

        await service.initCustomLayer();

        expect(layers.deleteLayer).not.toHaveBeenCalled();
        expect(layers.addLayer).not.toHaveBeenCalled();
    });
});
