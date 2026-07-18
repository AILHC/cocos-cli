import type { Component, Node, Scene, SpriteFrame, Vec3, __private } from 'cc';

export interface EngineCcConsumerContract {
    component: Component;
    node: Node;
    scene: Scene;
    spriteFrame: SpriteFrame;
    vector: Vec3;
    sortingItem: __private._cocos_sorting_sorting_layers__SortingItem;
}
