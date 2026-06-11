import { join } from 'node:path';
import { mkdir, readFile, writeFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { describe, expect, it, vi } from 'vitest';
import { getFixturePaths } from '@shared/fixture-paths';
import { createRuntimePreviewContext } from '@runtime-preview/context/runtime-preview-context';
import { handleRuntimePreviewRequest } from '@runtime-preview/server/runtime-preview-routes';
import { startRuntimePreviewServer } from '@runtime-preview/server/runtime-preview-server';
import { PreviewSettingsProvider } from '@runtime-preview/settings/preview-settings-provider';
import type { RuntimePreviewHttpResponse } from '@runtime-preview/server/serve-on-demand-file';
import {
  buildEditorLibraryInternalBundle,
  buildEditorLibraryResourcesBundle,
} from '@shared/editor-library-bundle';

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

async function responseBodyText(response: RuntimePreviewHttpResponse): Promise<string> {
  if (response.kind === 'file') {
    return readFile(response.absolutePath, 'utf8');
  }
  return response.body.toString();
}

async function responseBodyBuffer(response: RuntimePreviewHttpResponse): Promise<Buffer> {
  if (response.kind === 'file') {
    return readFile(response.absolutePath);
  }
  return Buffer.isBuffer(response.body) ? response.body : Buffer.from(response.body);
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
      expect(response.kind, route).toBe('file');
      expect(response.statusCode, route).toBe(200);
      expect(response.headers['content-type'], route).toMatch(/application\/(javascript|json)/);
      expect((await responseBodyText(response)).length, route).toBeGreaterThan(0);
    }
  });

  it('renders the production entry with show FPS disabled when debug=false', async () => {
    const routeContext = createRouteContext();
    const response = await handleRuntimePreviewRequest(routeContext, '/?debug=false');

    expect(response.kind).toBe('body');
    expect(response.statusCode).toBe(200);
    expect(await responseBodyText(response)).toContain('id="btn-show-fps" class=""');
  });

  it('serves scene list and serialized scene json from current project metadata facts', async () => {
    const routeContext = createRouteContext();
    const sceneListResponse = await handleRuntimePreviewRequest(routeContext, '/scene-list');

    expect(sceneListResponse.kind).toBe('body');
    expect(sceneListResponse.statusCode).toBe(200);
    expect(sceneListResponse.headers['content-type']).toContain('application/json');

    const sceneList = JSON.parse(await responseBodyText(sceneListResponse)) as {
      scenes: Array<{ uuid: string; url: string; name?: string; bundle?: string }>;
      currentScene?: string;
    };
    expect(sceneList.scenes.length).toBeGreaterThan(0);
    expect(sceneList.scenes[0].uuid).toMatch(/^[0-9a-f-]+$/);
    expect(sceneList.scenes[0].url).toMatch(/^db:\/\/assets\/.*\.scene$/);

    const sceneResponse = await handleRuntimePreviewRequest(routeContext, `/scene/${sceneList.scenes[0].uuid}.json`);
    expect(sceneResponse.kind).toBe('file');
    expect(sceneResponse.statusCode).toBe(200);
    expect(sceneResponse.headers['content-type']).toContain('application/json');
    expect(await responseBodyText(sceneResponse)).toContain('cc.SceneAsset');
  });

  it('uses a non-empty default scene for the production entry and scene selector state', async () => {
    const routeContext = createProductionLibraryRouteContext();
    const sceneListResponse = await handleRuntimePreviewRequest(routeContext, '/scene-list');
    const sceneList = JSON.parse(await responseBodyText(sceneListResponse)) as {
      scenes: Array<{ uuid: string; url: string }>;
      currentScene?: string;
    };

    expect(sceneList.scenes.length).toBeGreaterThan(0);
    expect(sceneList.currentScene).toBe(sceneList.scenes[0].uuid);

    const entryResponse = await handleRuntimePreviewRequest(routeContext, '/?debug=false');
    expect(entryResponse.statusCode).toBe(200);
    expect(await responseBodyText(entryResponse)).toContain(`/settings.js?scene=${sceneList.currentScene}`);
  });

  it('generates settings for the scene requested by settings.js query', async () => {
    const routeContext = createProductionLibraryRouteContext();
    const sceneListResponse = await handleRuntimePreviewRequest(routeContext, '/scene-list');
    const sceneList = JSON.parse(await responseBodyText(sceneListResponse)) as {
      scenes: Array<{ uuid: string; url: string }>;
    };
    const requestedScene = sceneList.scenes[1]?.uuid ?? sceneList.scenes[0].uuid;
    const loadPreviewSettings = vi.fn(async (buildOptions?: Record<string, unknown>) => ({
      settings: {
        launch: {
          launchScene: buildOptions?.startScene,
        },
        assets: {
          server: buildOptions?.server,
        },
      },
      script2library: {},
      bundleConfigs: [],
    }));

    const response = await handleRuntimePreviewRequest({
      ...routeContext,
      settingsProvider: new PreviewSettingsProvider({
        loadPreviewSettings,
        buildOptions: {
          server: 'http://127.0.0.1:19530',
        },
      }),
    }, `/settings.js?scene=${requestedScene}`);

    expect(response.statusCode).toBe(200);
    expect(loadPreviewSettings).toHaveBeenCalledWith({
      server: 'http://127.0.0.1:19530',
      startScene: requestedScene,
    });
    expect(await responseBodyText(response)).toContain(`"launchScene":"${requestedScene}"`);
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
    const sceneList = JSON.parse(await responseBodyText(sceneListResponse)) as {
      scenes: Array<{ uuid: string; url: string }>;
    };

    expect(sceneList.scenes).toContainEqual(expect.objectContaining({
      uuid: sceneUuid,
      url: sceneRecord.url,
    }));

    const sceneResponse = await handleRuntimePreviewRequest(routeContext, `/scene/${sceneUuid}.json`);
    const cliSceneJson = await readFile(join(paths.projectRoot, 'library', 'cli', sceneUuid.slice(0, 2), `${sceneUuid}.json`), 'utf8');

    expect(sceneResponse.statusCode).toBe(200);
    expect(await responseBodyText(sceneResponse)).toBe(cliSceneJson);
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
      expect((await responseBodyText(response)).length, route).toBeGreaterThan(0);
      if (route === '/socket.io/socket.io.js') {
        const body = await responseBodyText(response);
        expect(response.headers['content-type'], route).toContain('application/javascript');
        expect(body, route).toContain('io');
        expect(body, route).toContain('createNoopSocket');
      }
    }
  });

  it('serves engine external emscripten files from the engine native external root', async () => {
    const routeContext = createRouteContext();
    const response = await handleRuntimePreviewRequest(
      routeContext,
      '/engine_external/?url=external%3Aemscripten%2Fmeshopt%2Fmeshopt_decoder.wasm.wasm',
    );

    expect(response.kind).toBe('file');
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('application/wasm');
    expect((await responseBodyBuffer(response)).subarray(0, 4)).toEqual(Buffer.from([0x00, 0x61, 0x73, 0x6d]));
  });

  it('serves builder-declared rendering effect settings from the project AssetDB output', async () => {
    const routeContext = createRouteContext();
    const response = await handleRuntimePreviewRequest(routeContext, '/src/effect.bin');

    expect(response.kind).toBe('file');
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('application/octet-stream');
    expect((await responseBodyBuffer(response)).length).toBeGreaterThan(0);
  });

  it('serves preview-app general import URLs by direct library tail lookup', async () => {
    const paths = getFixturePaths();
    const { config, samples } = await buildEditorLibraryResourcesBundle(paths.editorLibraryRef, { buildFileIndex: false });
    const routeContext = {
      ...createRouteContext(),
      settingsProvider: new PreviewSettingsProvider({
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
              remoteBundles: [],
            },
          },
          script2library: {},
          bundleConfigs: [config],
        }),
      }),
    };

    expect(samples.jsonAsset?.uuid).toBeTruthy();

    const response = await handleRuntimePreviewRequest(
      routeContext,
      `/assets/general/import/${samples.jsonAsset!.uuid.slice(0, 2)}/${samples.jsonAsset!.uuid}.json`,
    );

    expect(response.kind).toBe('file');
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('application/json');
    expect(await responseBodyText(response)).toContain('cc.JsonAsset');
  });

  it('serves preview-app general import URLs for scene dependency library files', async () => {
    const routeContext = createProductionLibraryRouteContext();
    const dependentRoutes = [
      '/assets/general/import/7d/7d8f9b89-4fd1-4c9f-a3ab-38ec7cded7ca@f9941.json',
      '/assets/general/import/75/75bcfad1-6b3e-41db-bbb6-6ff9f0ebd32b.json',
    ];

    for (const route of dependentRoutes) {
      const response = await handleRuntimePreviewRequest(routeContext, route);
      expect(response.kind, route).toBe('file');
      expect(response.statusCode, route).toBe(200);
      expect(response.headers['content-type'], route).toContain('application/json');
      expect((await responseBodyText(response)).length, route).toBeGreaterThan(0);
    }
  });

  it('does not require bundle config proof for the URL namespace when the library tail exists', async () => {
    const paths = getFixturePaths();
    const { config, samples } = await buildEditorLibraryResourcesBundle(paths.editorLibraryRef, { buildFileIndex: false });
    const routeContext = {
      ...createRouteContext(),
      settingsProvider: new PreviewSettingsProvider({
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
              remoteBundles: [],
            },
          },
          script2library: {},
          bundleConfigs: [config],
        }),
      }),
    };

    expect(samples.jsonAsset?.uuid).toBeTruthy();

    const response = await handleRuntimePreviewRequest(
      routeContext,
      `/assets/not-real/import/${samples.jsonAsset!.uuid.slice(0, 2)}/${samples.jsonAsset!.uuid}.json`,
    );

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('application/json');
    expect(await responseBodyText(response)).toContain('cc.JsonAsset');
  });

  it('queries import replacement extensions from explicit extension library roots', async () => {
    const paths = getFixturePaths();
    const uuid = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
    const tempRoot = await mkdtemp(join(tmpdir(), 'runtime-preview-extension-root-'));
    const extensionLibraryRoot = join(tempRoot, 'cli-extensions', 'view-state-group');
    await mkdir(join(extensionLibraryRoot, uuid.slice(0, 2)), { recursive: true });
    await writeFile(join(extensionLibraryRoot, uuid.slice(0, 2), `${uuid}.ccon`), 'extension import payload');

    const routeContext = {
      ...createRouteContext(),
      runtimeContext: createRuntimePreviewContext({
        projectRoot: paths.projectRoot,
        engineRoot: paths.engineRoot,
        projectLibraryRoot: join(tempRoot, 'project-library'),
        internalLibraryRoot: join(tempRoot, 'internal-library'),
        projectProgrammingRoot: join(paths.editorProgrammingRef, 'programming'),
        cliProgrammingRoot: join(paths.projectRoot, 'temp', 'cli', 'programming'),
        extensionLibraryRoots: [{ name: 'view-state-group', root: extensionLibraryRoot }],
      }),
    };

    const response = await handleRuntimePreviewRequest(routeContext, `/query-extname/${uuid}`);

    expect(response.kind).toBe('body');
    expect(response.statusCode).toBe(200);
    expect(await responseBodyText(response)).toBe('.ccon');
  });

  it('serves production library URLs without settings generation', async () => {
    const paths = getFixturePaths();
    const uuid = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    const tempRoot = await mkdtemp(join(tmpdir(), 'runtime-preview-production-library-'));
    const projectLibraryRoot = join(tempRoot, 'project-library');
    await mkdir(join(projectLibraryRoot, uuid.slice(0, 2)), { recursive: true });
    await writeFile(join(projectLibraryRoot, uuid.slice(0, 2), `${uuid}.json`), '{"__type__":"cc.JsonAsset"}', 'utf8');

    const response = await handleRuntimePreviewRequest({
      runtimeContext: createRuntimePreviewContext({
        projectRoot: tempRoot,
        engineRoot: paths.engineRoot,
        projectLibraryRoot,
        internalLibraryRoot: join(tempRoot, 'internal-library'),
        projectProgrammingRoot: join(paths.editorProgrammingRef, 'programming'),
        cliProgrammingRoot: join(paths.projectRoot, 'temp', 'cli', 'programming'),
      }),
      settingsProvider: new PreviewSettingsProvider({
        loadPreviewSettings: async () => {
          throw new Error('settings generation should not run for production library routes');
        },
      }),
    }, `/assets/product/import/${uuid.slice(0, 2)}/${uuid}.json`);

    expect(response.kind).toBe('file');
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('application/json');
    expect(await responseBodyText(response)).toContain('cc.JsonAsset');
  });

  it('serves preview-app general import URLs for internal builtin assets', async () => {
    const paths = getFixturePaths();
    const internalBundle = await buildEditorLibraryInternalBundle(paths.engineRoot);
    const routeContext = {
      ...createRouteContext(),
      settingsProvider: new PreviewSettingsProvider({
        loadPreviewSettings: async () => ({
          settings: {
            launch: {
              launchScene: '',
            },
            engine: {
              builtinAssets: internalBundle.builtinAssets,
            },
            assets: {
              importBase: 'http://127.0.0.1:19530/assets',
              nativeBase: 'http://127.0.0.1:19530/assets',
              server: 'http://127.0.0.1:19530',
              remoteBundles: ['internal'],
            },
          },
          script2library: {},
          bundleConfigs: [internalBundle.config],
        }),
      }),
    };
    const physicsMaterialUuid = 'ba21476f-2866-4f81-9c4d-6e359316e448';

    const response = await handleRuntimePreviewRequest(
      routeContext,
      `/assets/general/import/${physicsMaterialUuid.slice(0, 2)}/${physicsMaterialUuid}.json`,
    );

    expect(response.kind).toBe('file');
    expect(response.statusCode).toBe(200);
    expect(await responseBodyText(response)).toContain('default-physics-material');

    const fontUuid = '0835f102-5471-47a3-9a76-01c07ac9cdb2';
    const fontResponse = await handleRuntimePreviewRequest(
      routeContext,
      `/assets/general/native/${fontUuid.slice(0, 2)}/${fontUuid}/OpenSans-Regular.ttf`,
    );

    expect(fontResponse.kind).toBe('file');
    expect(fontResponse.statusCode).toBe(200);
    expect(fontResponse.headers['content-type']).toContain('font/ttf');
    expect((await responseBodyBuffer(fontResponse)).length).toBeGreaterThan(0);
  });

  it('rejects unsupported engine external requests', async () => {
    const routeContext = createRouteContext();
    const invalidRoutes = [
      '/engine_external/?url=http%3A%2F%2Fexample.com%2Fa.wasm',
      '/engine_external/?url=external%3A..%2Fpackage.json',
    ];

    for (const route of invalidRoutes) {
      const response = await handleRuntimePreviewRequest(routeContext, route);
      expect(response.statusCode, route).toBe(400);
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
