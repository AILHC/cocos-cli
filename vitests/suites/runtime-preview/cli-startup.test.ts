import { createServer } from 'node:net';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { getFixturePaths } from '@shared/fixture-paths';
import { PreviewSettingsProvider } from '@runtime-preview/settings/preview-settings-provider';
import { startRuntimePreviewServer } from '@runtime-preview/server/runtime-preview-server';

function canListen(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once('error', () => resolve(false));
    server.listen(port, '127.0.0.1', () => {
      server.close(() => resolve(true));
    });
  });
}

describe('runtime preview server startup', () => {
  it('starts, reports health and roots, serves settings, and releases the port', async () => {
    const paths = getFixturePaths();
    const extensionLibraryRoot = join(paths.projectRoot, 'library', 'cli-extensions', 'view-state-group');
    const settingsProvider = new PreviewSettingsProvider({
      loadPreviewSettings: async () => ({
        settings: {
          assets: {
            importBase: 'http://127.0.0.1:19530/assets',
            nativeBase: 'http://127.0.0.1:19530/assets',
            server: 'http://127.0.0.1:19530',
            remoteBundles: ['internal', 'main'],
          },
        },
        script2library: {},
        bundleConfigs: [],
      }),
    });

    const server = await startRuntimePreviewServer({
      projectRoot: paths.projectRoot,
      engineRoot: paths.engineRoot,
      projectLibraryRoot: paths.editorLibraryRef,
      extensionLibraryRoots: [
        { name: 'view-state-group', root: extensionLibraryRoot },
      ],
      projectProgrammingRoot: join(paths.editorProgrammingRef, 'programming'),
      host: '127.0.0.1',
      port: 0,
      settingsProvider,
    });

    try {
      expect(server.context.startupStrategy).toBe('lazy');
      expect(server.context.preloadedLibraryFileCount).toBe(0);
      expect(server.context.preloadedProgrammingFileCount).toBe(0);
      expect(server.context.extensionLibraryRoots).toEqual([
        { name: 'view-state-group', root: extensionLibraryRoot },
      ]);
      expect(server.startupLogLines).toContain(`projectRoot=${paths.projectRoot}`);
      expect(server.startupLogLines).toContain(`engineRoot=${paths.engineRoot}`);
      expect(server.startupLogLines).toContain(`projectLibraryRoot=${paths.editorLibraryRef}`);
      expect(server.startupLogLines).toContain(`extensionLibraryRoots=view-state-group:${extensionLibraryRoot}`);
      expect(server.startupLogLines).toContain(`projectProgrammingRoot=${join(paths.editorProgrammingRef, 'programming')}`);
      expect(server.startupLogLines).toContain(`server:listening=${server.url}`);
      expect(server.logFilePath).toMatch(/runtime-preview-\d{8}-\d{6}\.log$/);
      expect(existsSync(server.logFilePath)).toBe(true);

      const health = await fetch(`${server.url}/__runtime-preview/health`);
      expect(health.status).toBe(200);
      expect(await health.json()).toMatchObject({
        ok: true,
        projectRoot: paths.projectRoot,
        engineRoot: paths.engineRoot,
        extensionLibraryRoots: [
          { name: 'view-state-group', root: extensionLibraryRoot },
        ],
      });

      const settings = await fetch(`${server.url}/settings.js`);
      expect(settings.status).toBe(200);
      expect(await settings.text()).toContain('window._CCSettings = ');

      const logSource = await readFile(server.logFilePath, 'utf8');
      expect(logSource).toContain(`projectRoot=${paths.projectRoot}`);
      expect(logSource).toContain(`engineRoot=${paths.engineRoot}`);
      expect(logSource).toContain(`projectLibraryRoot=${paths.editorLibraryRef}`);
      expect(logSource).toContain(`extensionLibraryRoots=view-state-group:${extensionLibraryRoot}`);
      expect(logSource).toContain(`projectProgrammingRoot=${join(paths.editorProgrammingRef, 'programming')}`);
      expect(logSource).toContain(`server:listening=${server.url}`);
      expect(logSource).toMatch(/settings:generation:done durationMs=\d+/);
    } finally {
      await server.close();
    }

    expect(await canListen(server.port)).toBe(true);
  });

  it('prints a settings generation error summary to the console', async () => {
    const paths = getFixturePaths();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const settingsProvider = new PreviewSettingsProvider({
      loadPreviewSettings: async () => {
        throw new Error('settings-timeout-sample');
      },
    });

    const server = await startRuntimePreviewServer({
      projectRoot: paths.projectRoot,
      engineRoot: paths.engineRoot,
      projectLibraryRoot: paths.editorLibraryRef,
      projectProgrammingRoot: join(paths.editorProgrammingRef, 'programming'),
      host: '127.0.0.1',
      port: 0,
      settingsProvider,
    });

    try {
      const settings = await fetch(`${server.url}/settings.js`);
      expect(settings.status).toBe(500);
      expect(consoleError).toHaveBeenCalledWith(expect.stringContaining('[runtime-preview] settings:generation:error'));
      expect(consoleError).toHaveBeenCalledWith(expect.stringContaining('settings-timeout-sample'));
    } finally {
      consoleError.mockRestore();
      await server.close();
    }
  });
});
