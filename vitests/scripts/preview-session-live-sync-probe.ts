/**
 * 一次性诊断:MCP 改动是否实时反馈到 /scene-editor/ 页面。
 * 方法:headless 打开页面 → 记录节点列表 → MCP 建节点 → 等 5s(覆盖页面 2s 轮询周期)
 * → 不重载页面读节点列表 → 手动调页面 refreshNodeList() → 再读。
 * 判定:不重载时出现新节点 = 有推送;手动刷新后才出现 = 拉取模型。
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { chromium } from 'playwright-core';

const BASE = process.env.PROBE_BASE_URL ?? 'http://127.0.0.1:9528';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PROBE_NODE = 'LiveSyncProbe';

async function readNodeNames(page: import('playwright-core').Page): Promise<string[]> {
    return page.evaluate(() =>
        Array.from(document.querySelectorAll('#nodeList option')).map((option) => option.textContent ?? ''),
    );
}

async function main(): Promise<void> {
    const browser = await chromium.launch({ headless: true, executablePath: CHROME });
    const client = new Client({ name: 'live-sync-probe', version: '1.0.0' });
    try {
        const page = await browser.newPage();
        const consoleLines: string[] = [];
        page.on('console', (message) => consoleLines.push(`[${message.type()}] ${message.text()}`));
        page.on('pageerror', (error) => consoleLines.push(`[pageerror] ${error.message}`));
        await page.goto(`${BASE}/scene-editor/`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
        try {
            await page.waitForFunction(
                () => {
                    const currentWindow = window as typeof window & {
                        __SCENE_EDITOR_READY__?: unknown;
                        __SCENE_EDITOR_ERROR__?: string;
                    };
                    if (currentWindow.__SCENE_EDITOR_ERROR__) {
                        throw new Error(currentWindow.__SCENE_EDITOR_ERROR__);
                    }
                    return Boolean(currentWindow.__SCENE_EDITOR_READY__);
                },
                undefined,
                { timeout: 180_000 },
            );
        } catch (error) {
            const state = await page.evaluate(() => ({
                status: document.querySelector('#sceneStatus')?.textContent ?? null,
                ready: (window as unknown as { __SCENE_EDITOR_READY__?: unknown }).__SCENE_EDITOR_READY__ ?? null,
                bootError: (window as unknown as { __SCENE_EDITOR_ERROR__?: unknown }).__SCENE_EDITOR_ERROR__ ?? null,
            }));
            console.log(JSON.stringify({ stage: 'wait-loaded-timeout', state, consoleTail: consoleLines.slice(-30) }, null, 2));
            throw error;
        }
        // 页面不自动加载当前 scene:与验收脚本一致,填 scene uuid 并点 Load Scene。
        // uuid 从 session 的当前打开场景取(MCP scene-query-current)。
        await client.connect(new StreamableHTTPClientTransport(new URL(`${BASE}/mcp`)));
        const currentResult = await client.callTool({ name: 'scene-query-current', arguments: {} });
        const currentUuid = (currentResult.structuredContent as {
            result?: { data?: { assetUuid?: string } };
        } | undefined)?.result?.data?.assetUuid ?? '';
        if (!currentUuid) {
            throw new Error('No current editor scene uuid in session; open a scene first.');
        }
        await page.locator('#sceneInput').fill(currentUuid);
        await page.locator('#btnLoad').click();
        await page.waitForFunction(
            () => document.querySelector('#sceneStatus')?.textContent === 'Loaded',
            undefined,
            { timeout: 60_000 },
        );
        await page.evaluate(async () => {
            const currentWindow = window as typeof window & { refreshNodeList?: () => Promise<void> };
            await currentWindow.refreshNodeList?.();
        });
        const before = await readNodeNames(page);

        // 关键判定:页面 RPC(window.cli.Scene.Node.query)能否直接看到 worker 内存中
        // 未落盘的 MCP 改动 —— 区分「页面共享 live scene graph」与「页面持有独立副本」。
        const queryProbeNode = () => page.evaluate(async (nodePath) => {
            const currentWindow = window as typeof window & {
                cli?: { Scene?: { Node?: { query?: (params: { path: string; queryChildren: boolean; queryComponent: boolean }) => Promise<{
                    position?: { value?: { x?: number; y?: number; z?: number } };
                } | null> } } };
            };
            try {
                const node = await currentWindow.cli?.Scene?.Node?.query?.({
                    path: nodePath,
                    queryChildren: false,
                    queryComponent: false,
                });
                return { found: Boolean(node), position: node?.position?.value ?? null };
            } catch {
                return { found: false, position: null };
            }
        }, `Canvas/${PROBE_NODE}`);

        const queryBeforeCreate = await queryProbeNode();

        const createResult = await client.callTool({
            name: 'scene-create-node-by-type',
            arguments: { options: { path: 'Canvas', nodeType: 'Empty', name: PROBE_NODE } },
        });
        if (createResult.isError) {
            throw new Error(`create node failed: ${JSON.stringify(createResult.structuredContent)}`);
        }
        const queryAfterCreate = await queryProbeNode();

        // 再改一次 position,验证「修改」是否同样 live 可见。
        await client.callTool({
            name: 'scene-update-node',
            arguments: { options: { path: `Canvas/${PROBE_NODE}`, properties: { position: { x: 33, y: 44, z: 0 } } } },
        });
        const queryAfterUpdate = await queryProbeNode();

        // 再验证:页面点 Load Scene 重载后,拉取的是 worker 内存 live 场景还是磁盘资产。
        await page.locator('#sceneInput').fill(currentUuid);
        await page.locator('#btnLoad').click();
        await page.waitForFunction(
            () => document.querySelector('#sceneStatus')?.textContent === 'Loaded',
            undefined,
            { timeout: 60_000 },
        );
        const queryAfterSceneReload = await queryProbeNode();

        // 覆盖页面 refreshState/refreshRectInfo 的 2s 轮询周期。
        await new Promise((resolve) => setTimeout(resolve, 5_000));
        const afterNoReload = await readNodeNames(page);

        await page.evaluate(async () => {
            const currentWindow = window as typeof window & { refreshNodeList?: () => Promise<void> };
            await currentWindow.refreshNodeList?.();
        });
        const afterManualRefresh = await readNodeNames(page);

        // 清理:删除探针节点(内存操作,不落盘)。
        await client.callTool({
            name: 'scene-delete-node',
            arguments: { options: { path: `Canvas/${PROBE_NODE}` } },
        });

        const liveRpcVisible = queryAfterCreate.found && !queryBeforeCreate.found;
        const verdict = liveRpcVisible
            ? 'live-rpc: page RPC sees unsaved MCP edits (create + update) immediately'
            : queryAfterSceneReload.found
                ? 'snapshot-on-load: page misses unsaved MCP edits until scene reload (Load Scene pulls worker live scene)'
                : 'disk-copy: page misses unsaved MCP edits even after scene reload (Load Scene pulls disk asset)';
        console.log(JSON.stringify({
            verdict,
            liveRpcVisible,
            queryBeforeCreate,
            queryAfterCreate,
            queryAfterUpdate,
            queryAfterSceneReload,
            uiNodeList: { before, afterNoReload, afterManualRefresh },
        }, null, 2));
    } finally {
        await client.close().catch(() => undefined);
        await browser.close().catch(() => undefined);
    }
}

void main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
