import { middlewareService } from '../../server/middleware';

/**
 * 浏览器游戏预览的统一注册入口。
 *
 * 仅普通浏览器游戏预览入口走到这里。Runtime Preview Session 与 Scene 初始化均不注册
 * GamePreview，避免共享 server 的根路径和资源路由被普通 preview 占用。
 *
 * 注册顺序敏感：GamePreview 的 `/` 及资源路由（settings / assets / bundle / scene json）必须
 * 在其它宽泛路由（`/:dir/:uuid.:ext` 等）之前注册，否则 `/preview/settings.js`、
 * `/assets/<bundle>/config.json` 等会被吞成 404。这些 handler 在非游戏预览资源时会
 * `next()` 放行。
 *
 * 前置条件：调用前需已完成 `startServer` 与 builder 初始化（settings 在请求时惰性计算）。
 */
let extensionHost: { dispose(): void } | undefined;
let registered = false;

export async function registerBrowserPreview(projectPath: string): Promise<void> {
    if (registered) {
        return;
    }
    registered = true;

    // 先加载并注册项目扩展的预览后端（contributions.server + messages，跑扩展原码），
    // 必须在 GamePreview 之前注册，使扩展具体路由优先于 scriptingRoutes 的宽泛正则。
    // 失败隔离：扩展宿主任何异常都不应阻断预览启动。
    try {
        const { loadExtensionPreviewHost } = await import('./extension-host');
        extensionHost = await loadExtensionPreviewHost(projectPath);
    } catch (err) {
        console.warn('[ExtensionHost] init failed:', err);
    }

    // 注册游戏预览路由
    const { default: GamePreviewMiddleware } = await import('./game-preview.middleware');
    middlewareService.register('GamePreview', GamePreviewMiddleware);

    // 注册热重载（浏览器预览监听 browser:reload，脚本/资源变化后自动刷新）
    const { registerLiveReload } = await import('./live-reload');
    await registerLiveReload();
}

/**
 * 释放浏览器预览相关资源（扩展预览后端 + 热重载监听）。预览关闭时调用。
 *
 * 注意：`middlewareService` 目前只支持追加路由、不支持注销，因此已注册的 GamePreview 路由
 * 无法在此移除；同进程内重启预览会重复注册路由（已知限制，见 review 遗留项）。这里负责清理
 * 有状态的部分（扩展宿主 + 热重载监听 / 定时器），并复位注册标志。
 */
export async function disposeBrowserPreview(): Promise<void> {
    try {
        const { unregisterLiveReload } = await import('./live-reload');
        unregisterLiveReload();
    } catch (err) {
        console.warn('[LiveReload] unregister failed:', err);
    }
    try {
        extensionHost?.dispose();
    } catch (err) {
        console.warn('[ExtensionHost] dispose failed:', err);
    }
    extensionHost = undefined;
    registered = false;
}
