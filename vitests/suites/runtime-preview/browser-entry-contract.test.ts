import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { getFixturePaths } from '@shared/fixture-paths';
import { createRuntimePreviewContext } from '@runtime-preview/context/runtime-preview-context';
import { handleRuntimePreviewRequest } from '@runtime-preview/server/runtime-preview-routes';
import { PreviewSettingsProvider, type LoadPreviewSettings } from '@runtime-preview/settings/preview-settings-provider';
import type { RuntimePreviewHttpResponse } from '@runtime-preview/server/serve-on-demand-file';
import { createRuntimePreviewDeviceMap } from '@runtime-preview/server/preview-entry-template';
import { tmpdir } from 'node:os';

const testDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(testDir, '../../..');
const defaultBackupRoot = 'E:/own_space/tmp-repos/runtime-preview-reference/cocos-cli-backup-runtime-preview-bad-20260606';

async function readText(relativePath: string): Promise<string> {
  return readFile(join(repoRoot, relativePath), 'utf8');
}

function getBackupReferenceRoot(): string {
  const backupRoot = process.env.COCOS_CLI_TEST_RUNTIME_PREVIEW_REFERENCE_ROOT ?? defaultBackupRoot;
  if (!existsSync(backupRoot)) {
    throw new Error(
      `Missing historical runtime preview reference root: ${backupRoot}. `
      + 'Set COCOS_CLI_TEST_RUNTIME_PREVIEW_REFERENCE_ROOT to the backup worktree root.',
    );
  }
  return backupRoot;
}

async function collectTextFiles(root: string): Promise<string[]> {
  if (!existsSync(root)) {
    return [];
  }

  const entries = await readdir(root, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const absolutePath = join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectTextFiles(absolutePath));
    } else if (/\.(?:ts|tsx|js|jsx|html|ejs)$/.test(entry.name)) {
      files.push(absolutePath);
    }
  }
  return files;
}

function createRouteContextForProject(
  projectRoot: string,
  loadPreviewSettings: LoadPreviewSettings = async () => ({
    settings: {
      assets: {
        importBase: 'http://127.0.0.1:19530/assets',
        nativeBase: 'http://127.0.0.1:19530/assets',
        server: 'http://127.0.0.1:19530',
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
) {
  const paths = getFixturePaths();
  const runtimeContext = createRuntimePreviewContext({
    projectRoot,
    engineRoot: paths.engineRoot,
    projectLibraryRoot: paths.editorLibraryRef,
    internalLibraryRoot: join(paths.engineRoot, 'editor', 'library'),
    projectProgrammingRoot: join(paths.editorProgrammingRef, 'programming'),
    cliProgrammingRoot: join(projectRoot, 'temp', 'cli', 'programming'),
  });
  const settingsProvider = new PreviewSettingsProvider({ loadPreviewSettings });

  return { runtimeContext, settingsProvider };
}

function createRouteContext() {
  const paths = getFixturePaths();
  return createRouteContextForProject(paths.projectRoot);
}

async function responseBodyText(response: RuntimePreviewHttpResponse): Promise<string> {
  if (response.kind === 'file') {
    return readFile(response.absolutePath, 'utf8');
  }
  return String(response.body);
}

describe('runtime preview browser entry contract', () => {
  it('serves the production root page and preview-app entry script', async () => {
    const routeContext = createRouteContext();

    const rootResponse = await handleRuntimePreviewRequest(routeContext, '/');
    expect(rootResponse.kind).toBe('body');
    expect(rootResponse.statusCode).toBe(200);
    expect(rootResponse.headers['content-type']).toBe('text/html; charset=utf-8');
    expect(await responseBodyText(rootResponse)).toContain('/settings.js');
    expect(await responseBodyText(rootResponse)).toContain('System.import("/preview-app/index.js")');

    const previewAppResponse = await handleRuntimePreviewRequest(routeContext, '/preview-app/index.js');
    expect(previewAppResponse.kind).toBe('file');
    expect(previewAppResponse.statusCode).toBe(200);
    expect(previewAppResponse.headers['content-type']).toBe('application/javascript; charset=utf-8');
  });

  it('keeps settings route active without treating it as a browser entry page', async () => {
    const routeContext = createRouteContext();

    const settingsResponse = await handleRuntimePreviewRequest(routeContext, '/settings.js');
    expect(settingsResponse.kind).toBe('body');
    expect(settingsResponse.statusCode).toBe(200);
    expect(settingsResponse.headers['content-type']).toBe('application/javascript; charset=utf-8');
    expect(await responseBodyText(settingsResponse)).toContain('window._CCSettings = ');
  });

  it('rejects encoded backslash traversal from runtime preview static subdirectories', async () => {
    const routeContext = createRouteContext();

    const previewAppTraversal = await handleRuntimePreviewRequest(routeContext, '/preview-app/%2e%2e%5cindex.ejs');
    expect(previewAppTraversal.statusCode).toBe(400);

    const resourceTraversal = await handleRuntimePreviewRequest(
      routeContext,
      '/static/runtime-preview/resources/%2e%2e%5cindex.ejs',
    );
    expect(resourceTraversal.statusCode).toBe(400);
  });

  it('anchors browser entry facts to old editor and backup sources without making them URL authorities', async () => {
    const backupRoot = getBackupReferenceRoot();
    const oldEditorServer = await readFile(
      join(backupRoot, 'docs/dev/reference/old_editor_preview_server/server.js'),
      'utf8',
    );
    expect(oldEditorServer).toContain("url: '/'");
    expect(oldEditorServer).toContain("url: '/preview-app/*'");
    expect(oldEditorServer).toContain('settingsJs:');
    expect(oldEditorServer).toContain('packImportMapURL');
    expect(oldEditorServer).toContain('packResolutionDetailMapURL');

    const backupTemplate = await readFile(
      join(backupRoot, 'src/runtime-preview/runtime-preview-template.ts'),
      'utf8',
    );
    expect(backupTemplate).toContain('preview-template');
    expect(backupTemplate).toContain('/settings.js');

    const backupTemplateTest = await readFile(
      join(backupRoot, 'src/runtime-preview/test/runtime-preview-template.test.ts'),
      'utf8',
    );
    expect(backupTemplateTest).toContain('System.import("/preview-app/index.js")');
  });

  it('uses project preview-template/index.ejs and keeps CLI builtin script include source', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'runtime-preview-project-template-'));
    const templateRoot = join(projectRoot, 'preview-template');
    await mkdir(templateRoot, { recursive: true });
    await writeFile(
      join(templateRoot, 'index.ejs'),
      [
        '<div id="project-preview-template">project preview-template loaded</div>',
        '<%- include(cocosTemplate, {}) %>',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(templateRoot, 'script.ejs'),
      '__PROJECT_SCRIPT_TEMPLATE_SHOULD_NOT_LOAD__',
      'utf8',
    );

    const routeContext = createRouteContextForProject(projectRoot);
    const rootResponse = await handleRuntimePreviewRequest(routeContext, '/');
    const html = await responseBodyText(rootResponse);

    expect(rootResponse.statusCode).toBe(200);
    expect(html).toContain('id="project-preview-template"');
    expect(html).toContain('System.import("/preview-app/index.js")');
    expect(html).toContain('assets.projectBundles');
    expect(html).not.toContain('__PROJECT_SCRIPT_TEMPLATE_SHOULD_NOT_LOAD__');
  });

  it('serves root preview-template test.js while not exposing .ejs scripts directly', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'runtime-preview-project-template-root-js-'));
    const templateRoot = join(projectRoot, 'preview-template');
    await mkdir(templateRoot, { recursive: true });
    await writeFile(
      join(templateRoot, 'index.ejs'),
      [
        '<%- include(cocosTemplate, {}) %>',
      ].join('\n'),
      'utf8',
    );
    const testJsContent = 'console.log("runtime-preview test script");';
    await writeFile(join(templateRoot, 'test.js'), testJsContent, 'utf8');

    const routeContext = createRouteContextForProject(projectRoot);

    const testJsResponse = await handleRuntimePreviewRequest(routeContext, '/test.js');
    expect(testJsResponse.statusCode).toBe(200);
    expect(testJsResponse.kind).toBe('file');
    expect(testJsResponse.headers['content-type']).toBe('application/javascript; charset=utf-8');
    expect(await responseBodyText(testJsResponse)).toBe(testJsContent);

    const scriptEjsResponse = await handleRuntimePreviewRequest(routeContext, '/script.ejs');
    expect(scriptEjsResponse.statusCode).not.toBe(200);

    const indexEjsResponse = await handleRuntimePreviewRequest(routeContext, '/index.ejs');
    expect(indexEjsResponse.statusCode).not.toBe(200);
  });

  it('falls back to builtin preview index when project preview-template/index.ejs is missing', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'runtime-preview-project-template-missing-'));
    const routeContext = createRouteContextForProject(projectRoot);
    const rootResponse = await handleRuntimePreviewRequest(routeContext, '/');
    const html = await responseBodyText(rootResponse);

    expect(rootResponse.statusCode).toBe(200);
    expect(html).toContain('System.import("/preview-app/index.js")');
    expect(html).toContain('id="GameCanvas"');
  });

  it('returns 500 with runtime-preview-template-error when project preview-template render fails', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'runtime-preview-project-template-error-'));
    const templateRoot = join(projectRoot, 'preview-template');
    await mkdir(templateRoot, { recursive: true });
    await writeFile(join(templateRoot, 'index.ejs'), '<% throw new Error("boom") %>', 'utf8');

    const routeContext = createRouteContextForProject(projectRoot, async () => ({
      settings: {
        launch: {
          launchScene: '',
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
    }));
    const rootResponse = await handleRuntimePreviewRequest(routeContext, '/');
    const message = await responseBodyText(rootResponse);

    expect(rootResponse.statusCode).toBe(500);
    expect(message).toContain('runtime-preview-template-error');
    expect(message).toContain('preview-template');
    expect(message).toContain('index.ejs');
  });

  it('writes template render error line for project template failures', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'runtime-preview-project-template-error-log-'));
    const templateRoot = join(projectRoot, 'preview-template');
    await mkdir(templateRoot, { recursive: true });
    await writeFile(join(templateRoot, 'index.ejs'), '<% throw new Error("boom") %>', 'utf8');

    const lines: string[] = [];
    const routeContext = {
      ...createRouteContextForProject(projectRoot, async () => ({
        settings: {
          launch: {
            launchScene: '',
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
      })),
      logger: {
        write: (line: string) => {
          lines.push(line);
          return Promise.resolve();
        },
      },
    };

    const rootResponse = await handleRuntimePreviewRequest(routeContext, '/');
    const message = await responseBodyText(rootResponse);

    expect(rootResponse.statusCode).toBe(500);
    expect(message).toContain('runtime-preview-template-error');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('runtime-preview-template-error');
  });

  it('prefers settings designResolution for runtime preview Default device, then device json default, then hardcoded', () => {
    const defaultBySettings = createRuntimePreviewDeviceMap([], {
      screen: {
        designResolution: '1080x1920',
      },
    });
    expect(defaultBySettings.Default.width).toBe(1080);
    expect(defaultBySettings.Default.height).toBe(1920);

    const defaultByDevicesJson = createRuntimePreviewDeviceMap(
      [{ name: 'Device A', width: 300, height: 500, default: true }],
      {},
    );
    expect(defaultByDevicesJson.Default.width).toBe(300);
    expect(defaultByDevicesJson.Default.height).toBe(500);

    const defaultByFallback = createRuntimePreviewDeviceMap([{ name: 'Device A', width: 300, height: 500 }], {});
    expect(defaultByFallback.Default.width).toBe(960);
    expect(defaultByFallback.Default.height).toBe(640);
  });

  it('allows official preview-app bootstrap base while forbidding CLI glue from owning URL/base mapping', async () => {
    const previewAppFiles = await collectTextFiles(join(repoRoot, 'src/runtime-preview/preview-app'));
    const previewAppSource = (await Promise.all(previewAppFiles.map((file) => readFile(file, 'utf8')))).join('\n');
    expect(previewAppSource).toContain('assets/general/import');
    expect(previewAppSource).toContain('assets/general/native');
    expect(await readFile(join(repoRoot, 'static/runtime-preview/script.ejs'), 'utf8')).toContain('assets.remoteBundles');

    const glueFiles = [
      ...await collectTextFiles(join(repoRoot, 'src/runtime-preview/server')),
      ...await collectTextFiles(join(repoRoot, 'static/runtime-preview')),
    ].filter((file) => !file.replace(/\\/g, '/').includes('/static/runtime-preview/preview-app/'));
    for (const file of glueFiles) {
      const content = await readFile(file, 'utf8');
      expect(content, file).not.toContain('window.__RUNTIME_PREVIEW_READY');
      expect(content, file).not.toMatch(/assets\.(?:importBase|nativeBase|server)\s*=/);
      expect(content, file).not.toMatch(/_CCSettings\.assets\.(?:importBase|nativeBase|server)\s*=/);
      expect(content, file).not.toMatch(/\/(?:assets|remote)\/[^'"]+\/(?:import|native)\//);
    }
  });
});
