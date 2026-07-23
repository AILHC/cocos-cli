/* global System, globalThis */

import { loadEngine } from '/static/web/engine-loader.js';

/**
 * 场景编辑器预览引导。
 *
 * 引擎加载流程与浏览器游戏预览的 game-boot.js 共用 engine-loader.js；区别在于这里以默认
 * 编辑器模式加载（不覆盖 CC_EDITOR/CC_PREVIEW），并在结尾加载 scene-bundle 启动场景服务，
 * 而不是运行游戏。
 */
export default async function boot() {
    try {
        const env = await loadEngine();

        const _originalSystem = System;
        // 与 game-boot 一致，先让当前 System 实例完成 cc 的加载。scene-bundle 的
        // importer-specific resolution 会把 cc 归一到 cce:/internal/x/cc；浏览器不认识
        // cce: 协议，因此把已加载的 namespace 注册到同一个 canonical id。
        const cc = await System.import('cc');
        System.set('cce:/internal/x/cc', cc);
        console.log('[Scene] loading scene bundle');
        // SystemJS natively awaits the attached import maps above
        const SceneBundle = await System.import('/static/web/scene-bundle.js');
        const { startup, Service } = SceneBundle;

        globalThis.System = _originalSystem;
        await startup({
            enginePath: env.enginePath,
            serverURL: env.serverURL,
        });

        Service?.Engine?.resume?.();
        globalThis.__SCENE_EDITOR_READY__ = {
            serverURL: env.serverURL,
            timestamp: Date.now(),
        };
        console.log('Cocos Engine and Scene Services loaded successfully');
    } catch (err) {
        globalThis.__SCENE_EDITOR_ERROR__ = String(err?.stack || err);
        console.error('Failed to load Cocos Engine or Services:', err.stack || err);
    }
}
