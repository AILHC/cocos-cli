import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { getFixturePaths } from '@shared/fixture-paths';
import { createRuntimePreviewContext } from '@runtime-preview/context/runtime-preview-context';
import { handleRuntimePreviewRequest } from '@runtime-preview/server/runtime-preview-routes';
import { PreviewSettingsProvider } from '@runtime-preview/settings/preview-settings-provider';

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
  });

  return { runtimeContext, settingsProvider };
}

describe('runtime preview browser entry contract', () => {
  it('serves the production root page and preview-app entry script', async () => {
    const routeContext = createRouteContext();

    const rootResponse = await handleRuntimePreviewRequest(routeContext, '/');
    expect(rootResponse.statusCode).toBe(200);
    expect(rootResponse.headers['content-type']).toBe('text/html; charset=utf-8');
    expect(String(rootResponse.body)).toContain('/settings.js');
    expect(String(rootResponse.body)).toContain('System.import("/preview-app/index.js")');

    const previewAppResponse = await handleRuntimePreviewRequest(routeContext, '/preview-app/index.js');
    expect(previewAppResponse.statusCode).toBe(200);
    expect(previewAppResponse.headers['content-type']).toBe('application/javascript; charset=utf-8');
  });

  it('keeps settings route active without treating it as a browser entry page', async () => {
    const routeContext = createRouteContext();

    const settingsResponse = await handleRuntimePreviewRequest(routeContext, '/settings.js');
    expect(settingsResponse.statusCode).toBe(200);
    expect(settingsResponse.headers['content-type']).toBe('application/javascript; charset=utf-8');
    expect(String(settingsResponse.body)).toContain('window._CCSettings = ');
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

  it('allows official preview-app bootstrap base while forbidding CLI glue from owning URL/base mapping', async () => {
    const previewAppFiles = await collectTextFiles(join(repoRoot, 'src/runtime-preview/preview-app'));
    const previewAppSource = (await Promise.all(previewAppFiles.map((file) => readFile(file, 'utf8')))).join('\n');
    expect(previewAppSource).toContain('assets/general/import');
    expect(previewAppSource).toContain('assets/general/native');

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
