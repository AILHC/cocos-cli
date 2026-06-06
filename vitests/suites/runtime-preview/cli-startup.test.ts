import { createServer } from 'node:net';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
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
      projectProgrammingRoot: join(paths.editorProgrammingRef, 'programming'),
      host: '127.0.0.1',
      port: 0,
      settingsProvider,
    });

    try {
      expect(server.context.startupStrategy).toBe('lazy');
      expect(server.context.preloadedLibraryFileCount).toBe(0);
      expect(server.context.preloadedProgrammingFileCount).toBe(0);
      expect(server.startupLogLines).toContain(`projectRoot=${paths.projectRoot}`);
      expect(server.startupLogLines).toContain(`engineRoot=${paths.engineRoot}`);
      expect(server.startupLogLines).toContain(`projectLibraryRoot=${paths.editorLibraryRef}`);
      expect(server.startupLogLines).toContain(`projectProgrammingRoot=${join(paths.editorProgrammingRef, 'programming')}`);

      const health = await fetch(`${server.url}/__runtime-preview/health`);
      expect(health.status).toBe(200);
      expect(await health.json()).toMatchObject({
        ok: true,
        projectRoot: paths.projectRoot,
        engineRoot: paths.engineRoot,
      });

      const settings = await fetch(`${server.url}/settings.js`);
      expect(settings.status).toBe(200);
      expect(await settings.text()).toContain('window._CCSettings = ');
    } finally {
      await server.close();
    }

    expect(await canListen(server.port)).toBe(true);
  });
});
