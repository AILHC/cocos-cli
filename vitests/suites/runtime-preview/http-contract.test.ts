import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { getFixturePaths } from '@shared/fixture-paths';
import { captureJsonAssetHttpRuntimeUrls } from '@shared/http-url-capture';
import { createRuntimePreviewContext } from '@runtime-preview/context/runtime-preview-context';
import { PreviewSettingsProvider } from '@runtime-preview/settings/preview-settings-provider';
import { handleRuntimePreviewRequest } from '@runtime-preview/server/runtime-preview-routes';
import type { RuntimePreviewHttpResponse } from '@runtime-preview/server/serve-on-demand-file';

async function responseBodyText(response: RuntimePreviewHttpResponse): Promise<string> {
  if (response.kind === 'file') {
    return readFile(response.absolutePath, 'utf8');
  }
  return String(response.body);
}

async function responseBodyJson<T = any>(response: RuntimePreviewHttpResponse): Promise<T> {
  return JSON.parse(await responseBodyText(response)) as T;
}

describe('runtime preview HTTP route contract', () => {
  it('serves settings, bundle config, captured import URL, query-extname, and scripts on demand', async () => {
    const paths = getFixturePaths();
    const runtimeContext = createRuntimePreviewContext({
      projectRoot: paths.projectRoot,
      engineRoot: paths.engineRoot,
      projectLibraryRoot: paths.editorLibraryRef,
      projectProgrammingRoot: join(paths.editorProgrammingRef, 'programming'),
      cliProgrammingRoot: join(paths.projectRoot, 'temp', 'cli', 'programming'),
    });
    const scriptLibraryPath = join(
      paths.projectRoot,
      'temp',
      'cli',
      'programming',
      'packer-driver',
      'targets',
      'editor',
      'chunks',
      '6c',
      '6cfa67594146f0e4f3017b0b9475bd63ad05873b.js',
    );
    const settingsProvider = new PreviewSettingsProvider({
      loadPreviewSettings: async () => ({
        settings: {
          assets: {
            importBase: 'http://127.0.0.1:19530/assets',
            nativeBase: 'http://127.0.0.1:19530/assets',
            server: 'http://127.0.0.1:19530',
            remoteBundles: ['internal', 'main', 'resources'],
          },
        },
        script2library: {
          'test_cases/test_active_event_proccer/test_active_event_proccer.js': scriptLibraryPath,
        },
        bundleConfigs: [
          {
            name: 'resources',
            importBase: 'import',
            nativeBase: 'native',
            paths: {
              'e62d10c9-29b9-4d53-833b-5769b524b759': ['test_area_edge_graphic/Season_1', 'cc.JsonAsset'],
            },
          },
        ],
      }),
    });
    const capturedUrls = await captureJsonAssetHttpRuntimeUrls();
    const routeContext = { runtimeContext, settingsProvider, capturedRuntimeUrls: capturedUrls };
    const capturedImport = capturedUrls.find((entry) => entry.routeCategory === 'import');
    const capturedQueryExtname = capturedUrls.find((entry) => entry.routeCategory === 'query-extname');
    expect(capturedImport?.probe).toBe('http-base');
    expect(capturedQueryExtname?.probe).toBe('http-base');

    const settingsResponse = await handleRuntimePreviewRequest(routeContext, '/settings.js');
    expect(settingsResponse.kind).toBe('body');
    expect(settingsResponse.statusCode).toBe(200);
    expect(settingsResponse.headers['content-type']).toBe('application/javascript; charset=utf-8');
    expect(await responseBodyText(settingsResponse)).toContain('window._CCSettings = ');

    const configResponse = await handleRuntimePreviewRequest(routeContext, '/assets/resources/config.json');
    expect(configResponse.kind).toBe('body');
    expect(configResponse.statusCode).toBe(200);
    expect((await responseBodyJson(configResponse)).name).toBe('resources');

    const indexResponse = await handleRuntimePreviewRequest(routeContext, '/assets/resources/index.js');
    expect(indexResponse.kind).toBe('body');
    expect(indexResponse.statusCode).toBe(200);
    expect(indexResponse.headers['content-type']).toBe('application/javascript; charset=utf-8');
    expect(await responseBodyText(indexResponse)).toContain('Runtime preview dummy bundle index for resources');

    const importResponse = await handleRuntimePreviewRequest(routeContext, capturedImport!.url);
    expect(importResponse.kind).toBe('file');
    expect(importResponse.statusCode).toBe(200);
    expect((await responseBodyJson(importResponse)).__type__).toBe('cc.JsonAsset');

    const uncapturedNativeResponse = await handleRuntimePreviewRequest(
      routeContext,
      capturedImport!.url.replace('/import/', '/native/'),
    );
    expect(uncapturedNativeResponse.statusCode).toBe(404);

    const uncapturedRemoteImportResponse = await handleRuntimePreviewRequest(
      routeContext,
      capturedImport!.url.replace('/assets/', '/remote/'),
    );
    expect(uncapturedRemoteImportResponse.statusCode).toBe(404);

    const queryExtnameResponse = await handleRuntimePreviewRequest(routeContext, capturedQueryExtname!.url);
    expect(queryExtnameResponse.kind).toBe('body');
    expect(queryExtnameResponse.statusCode).toBe(200);
    expect(await responseBodyText(queryExtnameResponse)).toBe('');

    const cconbExtnameResponse = await handleRuntimePreviewRequest(
      routeContext,
      '/query-extname/8c76e1e2-a206-4662-aa79-42c0c858d647',
    );
    expect(cconbExtnameResponse.statusCode).toBe(200);
    expect(await responseBodyText(cconbExtnameResponse)).toBe('.cconb');

    const scriptResponse = await handleRuntimePreviewRequest(
      routeContext,
      '/scripting/x/packer-driver/targets/preview/import-map.json',
    );
    expect(scriptResponse.kind).toBe('file');
    expect(scriptResponse.statusCode).toBe(200);
    expect((await responseBodyJson(scriptResponse)).imports).toBeTruthy();

    const systemJsResponse = await handleRuntimePreviewRequest(routeContext, '/scripting/systemjs/system.js');
    expect(systemJsResponse.kind).toBe('file');
    expect(systemJsResponse.statusCode).toBe(200);
    expect(systemJsResponse.headers['content-type']).toBe('application/javascript; charset=utf-8');
    expect(await responseBodyText(systemJsResponse)).toContain('System');

    const macroResponse = await handleRuntimePreviewRequest(routeContext, '/scripting/userland/macro');
    expect(macroResponse.statusCode).toBe(200);
    expect(macroResponse.headers['content-type']).toBe('application/javascript; charset=utf-8');

    const importMapGlobalResponse = await handleRuntimePreviewRequest(routeContext, '/scripting/import-map-global');
    expect(importMapGlobalResponse.kind).toBe('body');
    expect(importMapGlobalResponse.statusCode).toBe(200);
    expect(importMapGlobalResponse.headers['content-type']).toBe('application/json; charset=utf-8');
    const globalImportMap = await responseBodyJson(importMapGlobalResponse);
    expect(globalImportMap.imports.cc).toBe('q-bundled:///virtual/cc.js');
    expect(globalImportMap.imports['cc/env']).toBe('cc/editor/populate-internal-constants');
    expect(globalImportMap.imports['cc/userland/macro']).toBe('./userland/macro');

    const pluginResponse = await handleRuntimePreviewRequest(
      routeContext,
      '/plugins/test_cases/test_active_event_proccer/test_active_event_proccer.js',
    );
    expect(pluginResponse.kind).toBe('file');
    expect(pluginResponse.statusCode).toBe(200);
    expect(pluginResponse.headers['content-type']).toBe('application/javascript; charset=utf-8');
    expect(await responseBodyText(pluginResponse)).toContain('System.register');

    const relativePluginSettingsProvider = new PreviewSettingsProvider({
      loadPreviewSettings: async () => ({
        settings: { assets: {} },
        script2library: {
          'test_cases/test_active_event_proccer/test_active_event_proccer.js': '6c/6cfa67594146f0e4f3017b0b9475bd63ad05873b.js',
        },
        bundleConfigs: [],
      }),
    });
    const relativePluginResponse = await handleRuntimePreviewRequest(
      { runtimeContext, settingsProvider: relativePluginSettingsProvider },
      '/plugins/test_cases/test_active_event_proccer/test_active_event_proccer.js',
    );
    expect(relativePluginResponse.statusCode).toBe(200);
    expect(await responseBodyText(relativePluginResponse)).toContain('System.register');

    const nonJavaScriptPluginSettingsProvider = new PreviewSettingsProvider({
      loadPreviewSettings: async () => ({
        settings: { assets: {} },
        script2library: {
          'bad-script.js': join(
            paths.projectRoot,
            'temp',
            'cli',
            'programming',
            'packer-driver',
            'targets',
            'preview',
            'import-map.json',
          ),
        },
        bundleConfigs: [],
      }),
    });
    const nonJavaScriptPluginResponse = await handleRuntimePreviewRequest(
      { runtimeContext, settingsProvider: nonJavaScriptPluginSettingsProvider },
      '/plugins/bad-script.js',
    );
    expect(nonJavaScriptPluginResponse.statusCode).toBe(404);

    const missingPluginResponse = await handleRuntimePreviewRequest(routeContext, '/plugins/missing-script.js');
    expect(missingPluginResponse.statusCode).toBe(404);

    const missingResponse = await handleRuntimePreviewRequest(routeContext, '/not-a-runtime-route');
    expect(missingResponse.statusCode).toBe(404);
    expect(await responseBodyText(missingResponse)).toContain('No runtime preview route handled');
    expect(runtimeContext.preloadedLibraryFileCount).toBe(0);
    expect(runtimeContext.preloadedProgrammingFileCount).toBe(0);
  }, 120_000);

  it('serves captured asset URLs without requiring settings generation', async () => {
    const paths = getFixturePaths();
    const runtimeContext = createRuntimePreviewContext({
      projectRoot: paths.projectRoot,
      engineRoot: paths.engineRoot,
      projectLibraryRoot: paths.editorLibraryRef,
      projectProgrammingRoot: join(paths.editorProgrammingRef, 'programming'),
    });
    const capturedUrls = await captureJsonAssetHttpRuntimeUrls();
    const capturedImport = capturedUrls.find((entry) => entry.routeCategory === 'import');
    expect(capturedImport?.probe).toBe('http-base');

    const routeContext = {
      runtimeContext,
      settingsProvider: new PreviewSettingsProvider({
        loadPreviewSettings: async () => {
          throw new Error('settings generation should not run for captured asset routes');
        },
      }),
      capturedRuntimeUrls: capturedUrls,
    };

    const response = await handleRuntimePreviewRequest(routeContext, capturedImport!.url);
    expect(response.kind).toBe('file');
    expect(response.statusCode).toBe(200);
    expect((await responseBodyJson(response)).__type__).toBe('cc.JsonAsset');
  }, 120_000);
});
