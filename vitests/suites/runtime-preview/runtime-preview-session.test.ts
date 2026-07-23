import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { createServer as createNetServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { middlewareService } from '../../../src/server/middleware';
import { serverService } from '../../../src/server/server';
import SceneScriptingMiddleware from '../../../src/core/scene/scene.scripting.middleware';
import { mountMcp, type MountedMcp } from '../../../src/mcp/mount-mcp';
import { PreviewSettingsProvider } from '../../../src/runtime-preview/settings/preview-settings-provider';
import {
  startRuntimePreviewSession,
  type StartedRuntimePreviewSession,
} from '../../../src/runtime-preview/session/runtime-preview-session';
import type { IAssetSavedEvent } from '../../../src/core/assets/@types/public';

const sceneSessionMockState = vi.hoisted(() => ({
  projectPath: '',
}));

function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createNetServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Test server did not expose a TCP address.'));
        return;
      }
      server.close((error) => (error ? reject(error) : resolve(address.port)));
    });
  });
}

function canListen(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createNetServer();
    server.once('error', () => resolve(false));
    server.listen(port, '127.0.0.1', () => {
      server.close(() => resolve(true));
    });
  });
}

afterEach(async () => {
  await serverService.stop();
  vi.restoreAllMocks();
  vi.doUnmock('../../../src/core/scene/main-process/rpc');
  vi.doUnmock('../../../src/core/scripting');
  vi.resetModules();
});

describe('runtime preview session', () => {
  it('serves runtime, scene editor, and attached HTTP RPC from one shared server', async () => {
    const root = await mkdtemp(join(tmpdir(), 'runtime-preview-session-'));
    const projectRoot = join(root, 'project');
    const engineRoot = join(root, 'engine');
    const projectLibraryRoot = join(projectRoot, 'library', 'cli');
    const projectProgrammingRoot = join(projectRoot, 'temp', 'cli', 'programming');
    const canonicalAssetUuid = 'ab123456-1234-4abc-8def-1234567890ab';
    const canonicalAssetPath = join(projectLibraryRoot, 'ab', `${canonicalAssetUuid}.json`);
    const port = await getFreePort();
    const startAssetWatcher = vi.fn(async () => undefined);
    const stopAssetWatcher = vi.fn(async () => undefined);
    const executeLocal = vi.fn(async () => 'local-result');
    const sceneAssetPath = join(projectRoot, 'assets', 'scene.scene');
    const sceneMetaPath = `${sceneAssetPath}.meta`;
    const assetSavedListeners = new Set<(event: IAssetSavedEvent) => void | Promise<void>>();
    let assetSaveGeneration = 0;
    const assetSaveSource = {
      onAssetSaved(listener: (event: IAssetSavedEvent) => void | Promise<void>) {
        assetSavedListeners.add(listener);
        return () => assetSavedListeners.delete(listener);
      },
    };
    const saveThroughAssetDb = vi.fn(async () => {
      await writeFile(sceneAssetPath, '[{"__type__":"cc.SceneAsset"},{"__type__":"cc.Scene"}]', 'utf8');
      await writeFile(join(projectLibraryRoot, 'ab', 'abcdef.json'), '{"ok":"saved"}', 'utf8');
      const [sourceStat, metaStat] = await Promise.all([stat(sceneAssetPath), stat(sceneMetaPath)]);
      const event: IAssetSavedEvent = {
        generation: ++assetSaveGeneration,
        asset: {
          name: 'scene.scene',
          source: 'db://assets/scene.scene',
          loadUrl: 'db://assets/scene',
          url: 'db://assets/scene.scene',
          file: sceneAssetPath,
          uuid: 'scene-uuid',
          importer: 'scene',
          imported: true,
          invalid: false,
          type: 'cc.SceneAsset',
          isDirectory: false,
          library: { '.json': join(projectLibraryRoot, 'ab', 'abcdef.json') },
        },
        sourceFileGeneration: { mtimeMs: sourceStat.mtimeMs, size: sourceStat.size },
        metaFileGeneration: { mtimeMs: metaStat.mtimeMs, size: metaStat.size },
      };
      await Promise.all(Array.from(assetSavedListeners, (listener) => listener(event)));
      return event.asset;
    });
    const requestAttachedWorker = vi.fn(async (_service: string, method: string) => {
      if (method === 'queryCurrent') {
        return null;
      }
      if (method === 'save') {
        return saveThroughAssetDb();
      }
      throw new Error(`Unexpected attached RPC method: ${method}`);
    });
    const rpcStartup = vi.fn(async () => undefined);
    const rpcDispose = vi.fn();
    let session: StartedRuntimePreviewSession | undefined;
    let mcp: MountedMcp | undefined;
    let client: Client | undefined;

    try {
      sceneSessionMockState.projectPath = projectRoot;
      vi.doMock('../../../src/core/scripting', () => ({
        default: {
          projectPath: sceneSessionMockState.projectPath,
        },
      }));
      await mkdir(join(projectLibraryRoot, 'ab'), { recursive: true });
      await mkdir(join(projectRoot, 'assets'), { recursive: true });
      await mkdir(join(engineRoot, 'bin', '.cache', 'dev-cli', 'web'), { recursive: true });
      await mkdir(projectProgrammingRoot, { recursive: true });
      await writeFile(join(projectLibraryRoot, 'ab', 'abcdef.json'), '{"ok":true}', 'utf8');
      await writeFile(canonicalAssetPath, '{"ok":"node-path"}', 'utf8');
      await writeFile(sceneAssetPath, '[{"__type__":"cc.SceneAsset"},{"__type__":"cc.Scene"}]', 'utf8');
      await writeFile(sceneMetaPath, '{"ver":"1.0.0","importer":"scene"}', 'utf8');
      await writeFile(
        join(engineRoot, 'bin', '.cache', 'dev-cli', 'web', 'import-map.json'),
        '{"imports":{}}',
        'utf8',
      );

      const createServer = vi.spyOn(serverService, 'createServer');
      const stopServer = vi.spyOn(serverService, 'stop');
      const registerMiddleware = vi.spyOn(middlewareService, 'register');
      const settingsProvider = new PreviewSettingsProvider({
        loadPreviewSettings: async () => ({
          settings: {
            assets: {
              server: '',
              importBase: '',
              nativeBase: '',
            },
          },
          script2library: {},
          bundleConfigs: [],
        }),
      });
      const invalidateSettings = vi.spyOn(settingsProvider, 'invalidate');
      session = await startRuntimePreviewSession({
        projectRoot,
        engineRoot,
        projectLibraryRoot,
        projectProgrammingRoot,
        port,
        watchAssets: true,
        assetSaveSource,
        assetChangeWatcherFactory: () => ({
          start: startAssetWatcher,
          stop: stopAssetWatcher,
          getStatus: () => ({
            enabled: true,
            running: true,
            assetsRoot: join(projectRoot, 'assets'),
            eventCount: 0,
            dirtyTargetCount: 0,
            sampleTargets: [],
            startupDirtyTargetCount: 0,
            startupIgnoredMetaOnlyCount: 0,
            startupSampleTargets: [],
            startupIgnoredMetaOnlySample: [],
            startupSkippedSymlinkCount: 0,
            startupSkippedSymlinkSample: [],
          }),
        }),
        settingsProvider,
      });
      middlewareService.register('SceneScripting', SceneScriptingMiddleware);
      const processRpc = {
        executeLocal,
        request: requestAttachedWorker,
      };
      vi.doMock('../../../src/core/scene/main-process/rpc', () => ({
        Rpc: {
          startup: rpcStartup,
          dispose: rpcDispose,
          isConnect: () => true,
          getInstance: () => processRpc,
        },
      }));
      vi.doMock('../../../src/core/configuration/script/manager', () => ({
        configurationManager: {
          on: vi.fn(),
          off: vi.fn(),
        },
      }));
      vi.doMock('../../../src/core/assets', () => ({
        assetManager: {
          queryAssetInfos: vi.fn(() => []),
          queryAssetInfo: vi.fn((uuid: string) => (
            uuid === canonicalAssetUuid
              ? { library: { '.json': canonicalAssetPath } }
              : null
          )),
        },
        assetDBManager: {},
      }));
      vi.doMock('../../../src/core/assets/animation-mask', () => ({
        changeAnimationMaskDump: vi.fn(),
        clearAnimationMaskNodes: vi.fn(),
        importAnimationMaskSkeleton: vi.fn(),
        queryAnimationMask: vi.fn(),
        saveAnimationMask: vi.fn(),
      }));
      vi.doMock('../../../src/core/builder', () => ({
        build: vi.fn(),
        createBuildTemplate: vi.fn(),
        executeBuildStageTask: vi.fn(),
        queryDefaultBuildConfigByPlatform: vi.fn(),
      }));
      const { default: SceneMiddleware } = await import('../../../src/core/scene/scene.middleware');
      const { Rpc } = await import('../../../src/core/scene/main-process/rpc');
      const attachedProcess = { connected: true, send: vi.fn() };
      await Rpc.startup(attachedProcess as never);
      middlewareService.register('Scene', SceneMiddleware);
      mcp = await mountMcp({
        router: serverService.router,
        serverUrl: session.url,
        projectPath: projectRoot,
      });
      serverService.router.get('/future-session-route', (_request, response) => {
        response.json({ ok: true });
      });

      expect(createServer).toHaveBeenCalledTimes(1);
      expect(session.host).toBe('127.0.0.1');
      expect(session.port).toBe(port);
      expect(session.url).toBe(`http://127.0.0.1:${port}`);
      expect(startAssetWatcher).toHaveBeenCalledTimes(1);
      expect(registerMiddleware).toHaveBeenCalledWith('SceneScripting', SceneScriptingMiddleware);
      expect(registerMiddleware).toHaveBeenCalledWith('Scene', SceneMiddleware);
      expect(registerMiddleware).not.toHaveBeenCalledWith('GamePreview', expect.anything());
      expect(rpcStartup).toHaveBeenCalledWith(attachedProcess);
      expect(Rpc.isConnect()).toBe(true);
      expect(mcp.url).toBe(`${session.url}/mcp`);

      const rootResponse = await fetch(`${session.url}/`);
      const rootHtml = await rootResponse.text();
      expect(rootResponse.status).toBe(200);
      expect(rootHtml).toContain('type="systemjs-importmap"');
      const sceneEditorResponse = await fetch(`${session.url}/scene-editor/`);
      const sceneEditorHtml = await sceneEditorResponse.text();
      expect({ status: sceneEditorResponse.status, body: sceneEditorHtml }).toEqual({
        status: 200,
        body: expect.stringContaining('id="GameCanvas"'),
      });
      const nodeAssetResponse = await fetch(
        `${session.url}/ab/${canonicalAssetUuid}.json`,
        {
          headers: {
            'user-agent': 'Mozilla/5.0 (win32 x64) node.js/22.22.0 v8/12.4.254.21-node.24',
          },
        },
      );
      expect(nodeAssetResponse.status).toBe(200);
      expect(await nodeAssetResponse.text()).toBe(canonicalAssetPath);
      const rpcResponse = await fetch(`${session.url}/rpc/i18n/translate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '["scene.ready"]',
      });
      expect(await rpcResponse.json()).toEqual({ type: 'response', result: 'local-result' });
      expect(executeLocal).toHaveBeenCalledWith('i18n', 'translate', ['scene.ready']);
      expect((await fetch(`${session.url}/__runtime-preview/health`)).status).toBe(200);
      expect(
        await (await fetch(`${session.url}/assets/resources/import/ab/abcdef.json`)).json(),
      ).toEqual({ ok: true });
      expect(await (await fetch(`${session.url}/future-session-route`)).json()).toEqual({ ok: true });

      client = new Client({ name: 'runtime-preview-session-test', version: '1.0.0' });
      await client.connect(new StreamableHTTPClientTransport(new URL(mcp.url)));
      const tools = await client.listTools();
      expect(tools.tools.map((tool) => tool.name)).toEqual(expect.arrayContaining([
        'scene-query-current',
        'scene-save',
      ]));
      const queryResult = await client.callTool({
        name: 'scene-query-current',
        arguments: {},
      });
      const saveResult = await client.callTool({
        name: 'scene-save',
        arguments: {},
      });
      expect(queryResult.isError).toBe(false);
      expect(saveResult.isError).toBe(false);
      expect(requestAttachedWorker).toHaveBeenCalledWith('Editor', 'queryCurrent');
      expect(requestAttachedWorker).toHaveBeenCalledWith('Editor', 'save', [{}]);
      expect(saveThroughAssetDb).toHaveBeenCalledTimes(1);
      expect(invalidateSettings).toHaveBeenCalledTimes(1);
      expect(
        await (await fetch(`${session.url}/assets/resources/import/ab/abcdef.json`)).json(),
      ).toEqual({ ok: 'saved' });

      await client.close();
      client = undefined;
      await mcp.close();
      await mcp.close();
      expect(stopServer).not.toHaveBeenCalled();
      expect(Rpc.isConnect()).toBe(true);
      expect((await fetch(`${session.url}/`)).status).toBe(200);
      expect(await (await fetch(`${session.url}/rpc/i18n/translate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '["scene.still-ready"]',
      })).json()).toEqual({ type: 'response', result: 'local-result' });
      expect((await fetch(mcp.url)).status).toBe(404);
      mcp = undefined;

      const cleanupOrder: string[] = [];
      session.registerCleanup('project', async () => {
        cleanupOrder.push('project');
      });
      session.registerCleanup('scene', async () => {
        cleanupOrder.push('scene');
      });
      session.registerCleanup('runtime', async () => {
        cleanupOrder.push('runtime');
      });
      await Promise.all([session.close(), session.close()]);

      expect(cleanupOrder).toEqual(['runtime', 'scene', 'project']);
      expect(stopAssetWatcher).toHaveBeenCalledTimes(1);
      expect(stopServer).toHaveBeenCalledTimes(1);
      expect(await canListen(port)).toBe(true);
      session = undefined;
    } finally {
      await client?.close().catch(() => undefined);
      await mcp?.close();
      rpcDispose();
      await session?.close();
      vi.doUnmock('../../../src/core/configuration/script/manager');
      vi.doUnmock('../../../src/core/assets');
      vi.doUnmock('../../../src/core/assets/animation-mask');
      vi.doUnmock('../../../src/core/builder');
      await rm(root, { recursive: true, force: true });
    }
  });
});
