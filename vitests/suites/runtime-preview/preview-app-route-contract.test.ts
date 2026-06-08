import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { getFixturePaths } from '@shared/fixture-paths';
import { createRuntimePreviewContext } from '@runtime-preview/context/runtime-preview-context';
import { handleRuntimePreviewRequest } from '@runtime-preview/server/runtime-preview-routes';
import { startRuntimePreviewServer } from '@runtime-preview/server/runtime-preview-server';
import { PreviewSettingsProvider } from '@runtime-preview/settings/preview-settings-provider';

function createRouteContext() {
  const paths = getFixturePaths();
  const runtimeContext = createRuntimePreviewContext({
    projectRoot: paths.projectRoot,
    engineRoot: paths.engineRoot,
    projectLibraryRoot: paths.editorLibraryRef,
    internalLibraryRoot: join(paths.engineRoot, 'editor', 'library'),
    projectProgrammingRoot: join(paths.editorProgrammingRef, 'programming'),
    cliProgrammingRoot: join(paths.projectRoot, 'temp', 'cli', 'programming'),
  });
  const settingsProvider = new PreviewSettingsProvider({
    loadPreviewSettings: async () => ({
      settings: {
        launch: {
          launchScene: '',
        },
        assets: {
          importBase: 'http://127.0.0.1:19530/assets',
          nativeBase: 'http://127.0.0.1:19530/assets',
          server: 'http://127.0.0.1:19530',
          projectBundles: ['resources'],
          remoteBundles: ['resources'],
        },
      },
      script2library: {},
      bundleConfigs: [
        {
          name: 'resources',
          importBase: 'import',
          nativeBase: 'native',
          paths: {},
        },
      ],
    }),
  });

  return { runtimeContext, settingsProvider };
}

function createProductionLibraryRouteContext() {
  const paths = getFixturePaths();
  const routeContext = createRouteContext();
  return {
    ...routeContext,
    runtimeContext: {
      ...routeContext.runtimeContext,
      projectLibraryRoot: join(paths.projectRoot, 'library'),
    },
  };
}

describe('runtime preview preview-app required route contract', () => {
  it('serves production-entry-required scripting prerequisite routes', async () => {
    const routeContext = createRouteContext();
    const requiredRoutes = [
      '/scripting/polyfills/bundle.js',
      '/scripting/engine/bin/.cache/dev-cli/web/import-map.json',
      '/scripting/engine/bin/.cache/dev-cli/web/bundled/index.js',
    ];

    for (const route of requiredRoutes) {
      const response = await handleRuntimePreviewRequest(routeContext, route);
      expect(response.statusCode, route).toBe(200);
      expect(response.headers['content-type'], route).toMatch(/application\/(javascript|json)/);
      expect(response.body.toString().length, route).toBeGreaterThan(0);
    }
  });

  it('serves scene list and serialized scene json from current project metadata facts', async () => {
    const routeContext = createRouteContext();
    const sceneListResponse = await handleRuntimePreviewRequest(routeContext, '/scene-list');

    expect(sceneListResponse.statusCode).toBe(200);
    expect(sceneListResponse.headers['content-type']).toContain('application/json');

    const sceneList = JSON.parse(sceneListResponse.body.toString()) as {
      scenes: Array<{ uuid: string; url: string; name?: string; bundle?: string }>;
      currentScene?: string;
    };
    expect(sceneList.scenes.length).toBeGreaterThan(0);
    expect(sceneList.scenes[0].uuid).toMatch(/^[0-9a-f-]+$/);
    expect(sceneList.scenes[0].url).toMatch(/^db:\/\/assets\/.*\.scene$/);

    const sceneResponse = await handleRuntimePreviewRequest(routeContext, `/scene/${sceneList.scenes[0].uuid}.json`);
    expect(sceneResponse.statusCode).toBe(200);
    expect(sceneResponse.headers['content-type']).toContain('application/json');
    expect(sceneResponse.body.toString()).toContain('cc.SceneAsset');
  });

  it('prefers current CLI AssetDB scene output when production root is project library', async () => {
    const paths = getFixturePaths();
    const routeContext = createProductionLibraryRouteContext();
    const cliAssetData = JSON.parse(
      await readFile(join(paths.projectRoot, 'library', 'cli', '.assets-data.json'), 'utf8'),
    ) as Record<string, { url?: string }>;
    const sceneEntry = Object.entries(cliAssetData)
      .find((entry): entry is [string, { url: string }] => typeof entry[1].url === 'string' && entry[1].url.endsWith('.scene'));
    if (!sceneEntry) {
      throw new Error('Current CLI AssetDB output has no .scene entry.');
    }
    const [sceneUuid, sceneRecord] = sceneEntry;

    expect(sceneRecord.url).toMatch(/^db:\/\/assets\/.*\.scene$/);

    const sceneListResponse = await handleRuntimePreviewRequest(routeContext, '/scene-list');
    const sceneList = JSON.parse(sceneListResponse.body.toString()) as {
      scenes: Array<{ uuid: string; url: string }>;
    };

    expect(sceneList.scenes).toContainEqual(expect.objectContaining({
      uuid: sceneUuid,
      url: sceneRecord.url,
    }));

    const sceneResponse = await handleRuntimePreviewRequest(routeContext, `/scene/${sceneUuid}.json`);
    const cliSceneJson = await readFile(join(paths.projectRoot, 'library', 'cli', sceneUuid.slice(0, 2), `${sceneUuid}.json`), 'utf8');

    expect(sceneResponse.statusCode).toBe(200);
    expect(sceneResponse.body.toString()).toBe(cliSceneJson);
  });

  it('serves preview-app browser support and diagnostic routes', async () => {
    const routeContext = createRouteContext();
    const requiredRoutes = [
      '/missing-asset/00000000-0000-4000-8000-000000000000',
      '/preview-error',
      '/socket.io/socket.io.js',
    ];

    for (const route of requiredRoutes) {
      const response = await handleRuntimePreviewRequest(routeContext, route);
      expect(response.statusCode, route).toBe(200);
      expect(response.body.toString().length, route).toBeGreaterThan(0);
      if (route === '/socket.io/socket.io.js') {
        expect(response.headers['content-type'], route).toContain('application/javascript');
        expect(response.body.toString(), route).toContain('io');
      }
    }
  });

  it('logs posted preview errors through the route context logger', async () => {
    const writes: string[] = [];
    const routeContext = {
      ...createRouteContext(),
      method: 'POST',
      body: JSON.stringify({ message: 'preview boot failed' }),
      logger: {
        logFilePath: 'memory',
        write: async (line: string) => {
          writes.push(line);
        },
      },
    };

    const response = await handleRuntimePreviewRequest(routeContext, '/preview-error');

    expect(response.statusCode).toBe(200);
    expect(writes).toContain('browser:preview-error {"message":"preview boot failed"}');
  });

  it('returns 413 for oversized preview-error payloads on the real HTTP server', async () => {
    const paths = getFixturePaths();
    const server = await startRuntimePreviewServer({
      projectRoot: paths.projectRoot,
      engineRoot: paths.engineRoot,
      projectLibraryRoot: paths.editorLibraryRef,
      projectProgrammingRoot: join(paths.editorProgrammingRef, 'programming'),
      host: '127.0.0.1',
      port: 0,
      settingsProvider: createRouteContext().settingsProvider,
    });

    try {
      const response = await fetch(`${server.url}/preview-error`, {
        method: 'POST',
        body: 'x'.repeat((64 * 1024) + 1),
      });

      expect(response.status).toBe(413);
      expect(await response.text()).toContain('Runtime preview request body is too large.');
    } finally {
      await server.close();
    }
  });

  it('rejects traversal attempts for preview-app required file routes', async () => {
    const routeContext = createRouteContext();
    const invalidRoutes = [
      '/scripting/engine/%2e%2e/package.json',
      '/scripting/polyfills/%2e%2e/package.json',
    ];

    for (const route of invalidRoutes) {
      const response = await handleRuntimePreviewRequest(routeContext, route);
      expect(response.statusCode, route).toBe(400);
    }
  });

  it('does not expose arbitrary engine root files through the scripting engine route', async () => {
    const routeContext = createRouteContext();

    const response = await handleRuntimePreviewRequest(routeContext, '/scripting/engine/package.json');

    expect(response.statusCode).toBe(404);
  });
});
