import { createServer } from 'node:net';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { Command } from 'commander';
import { getFixturePaths } from '@shared/fixture-paths';
import { PreviewSettingsProvider } from '@runtime-preview/settings/preview-settings-provider';
import { startRuntimePreviewServer } from '@runtime-preview/server/runtime-preview-server';
import { PreviewCommand } from '../../../src/commands/preview';

const launcherMockState = vi.hoisted(() => ({
  startRuntimePreview: vi.fn(),
  startPreview: vi.fn(),
  startGamePreview: vi.fn(),
  startSceneEditorPreview: vi.fn(),
  Launcher: vi.fn(),
}));

vi.mock('../../../src/core/launcher', () => ({
  default: launcherMockState.Launcher,
}));

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
  it('dispatches each preview mode to its dedicated launcher entry', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'preview-cli-mode-matrix-'));
    const resume = vi.spyOn(process.stdin, 'resume').mockImplementation(() => process.stdin);
    launcherMockState.Launcher.mockImplementation(() => ({
      startRuntimePreview: launcherMockState.startRuntimePreview,
      startPreview: launcherMockState.startPreview,
      startGamePreview: launcherMockState.startGamePreview,
      startSceneEditorPreview: launcherMockState.startSceneEditorPreview,
    }));

    const run = async (args: string[]) => {
      const program = new Command();
      program.exitOverride();
      new PreviewCommand(program).register();
      await program.parseAsync(['preview', '--project', projectRoot, ...args], { from: 'user' });
    };

    try {
      await writeFile(join(projectRoot, 'package.json'), '{"name":"preview-cli-mode-matrix"}', 'utf8');
      await run([]);
      expect(launcherMockState.startGamePreview).toHaveBeenLastCalledWith({
        port: 9527,
        scene: undefined,
        open: true,
      });

      await run(['--build', '--platform', 'web-mobile', '--no-open']);
      expect(launcherMockState.startPreview).toHaveBeenLastCalledWith(expect.objectContaining({
        port: 9527,
        platform: 'web-mobile',
        open: false,
      }));

      await run(['--scene-editor', '--no-open']);
      expect(launcherMockState.startSceneEditorPreview).toHaveBeenLastCalledWith({
        port: 9527,
        open: false,
      });

      await run(['--runtime', '--scene', 'runtime-scene']);
      expect(launcherMockState.startRuntimePreview).toHaveBeenLastCalledWith(expect.objectContaining({
        port: 9527,
        scene: 'runtime-scene',
      }));

      await run(['--scene', 'db://assets/game.scene']);
      expect(launcherMockState.startGamePreview).toHaveBeenLastCalledWith(expect.objectContaining({
        scene: 'db://assets/game.scene',
      }));
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
      resume.mockRestore();
      launcherMockState.startRuntimePreview.mockReset();
      launcherMockState.startPreview.mockReset();
      launcherMockState.startGamePreview.mockReset();
      launcherMockState.startSceneEditorPreview.mockReset();
      launcherMockState.Launcher.mockReset();
    }
  });

  it('rejects incompatible modes and companion options before constructing Launcher', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'preview-cli-invalid-matrix-'));
    const resume = vi.spyOn(process.stdin, 'resume').mockImplementation(() => process.stdin);
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const run = async (args: string[]) => {
      const program = new Command();
      program.exitOverride();
      new PreviewCommand(program).register();
      await program.parseAsync(['preview', '--project', projectRoot, ...args], { from: 'user' });
    };

    try {
      await writeFile(join(projectRoot, 'package.json'), '{"name":"preview-cli-invalid-matrix"}', 'utf8');
      for (const args of [
        ['--runtime', '--build'],
        ['--runtime', '--no-open'],
        ['--scene-editor', '--scene', 'scene'],
        ['--platform', 'web-mobile'],
        ['--watch-assets'],
      ]) {
        launcherMockState.Launcher.mockClear();
        exit.mockClear();
        await run(args);
        expect(exit).toHaveBeenCalledWith(1);
        expect(launcherMockState.Launcher).not.toHaveBeenCalled();
      }
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
      resume.mockRestore();
      exit.mockRestore();
      consoleError.mockRestore();
      launcherMockState.Launcher.mockReset();
    }
  });

  it('passes refresh-on-reload from the preview CLI action to Launcher', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'runtime-preview-cli-refresh-project-'));
    const resume = vi.spyOn(process.stdin, 'resume').mockImplementation(() => process.stdin);
    launcherMockState.startRuntimePreview.mockResolvedValue(undefined);
    launcherMockState.Launcher.mockImplementation(() => ({
      startRuntimePreview: launcherMockState.startRuntimePreview,
      startPreview: launcherMockState.startPreview,
    }));

    try {
      await writeFile(join(projectRoot, 'package.json'), '{"name":"runtime-preview-cli-refresh-project"}', 'utf8');

      const program = new Command();
      program.exitOverride();
      new PreviewCommand(program).register();

      await program.parseAsync([
        'preview',
        '--project',
        projectRoot,
        '--runtime',
        '--refresh-on-reload',
      ], { from: 'user' });

      expect(launcherMockState.startRuntimePreview).toHaveBeenCalledWith(expect.objectContaining({
        refreshOnReload: true,
      }));
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
      resume.mockRestore();
      launcherMockState.startRuntimePreview.mockReset();
      launcherMockState.startPreview.mockReset();
      launcherMockState.Launcher.mockReset();
    }
  });

  it('does not enable refresh-on-reload by default', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'runtime-preview-cli-refresh-default-'));
    const resume = vi.spyOn(process.stdin, 'resume').mockImplementation(() => process.stdin);
    launcherMockState.startRuntimePreview.mockResolvedValue(undefined);
    launcherMockState.Launcher.mockImplementation(() => ({
      startRuntimePreview: launcherMockState.startRuntimePreview,
      startPreview: launcherMockState.startPreview,
    }));

    try {
      await writeFile(join(projectRoot, 'package.json'), '{"name":"runtime-preview-cli-refresh-default"}', 'utf8');

      const program = new Command();
      program.exitOverride();
      new PreviewCommand(program).register();

      await program.parseAsync([
        'preview',
        '--project',
        projectRoot,
        '--runtime',
      ], { from: 'user' });

      const runtimeOptions = launcherMockState.startRuntimePreview.mock.calls[0]?.[0];
      expect(runtimeOptions?.refreshOnReload).not.toBe(true);
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
      resume.mockRestore();
      launcherMockState.startRuntimePreview.mockReset();
      launcherMockState.startPreview.mockReset();
      launcherMockState.Launcher.mockReset();
    }
  });

  it('passes watch-assets from the preview CLI action to Launcher', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'runtime-preview-cli-watch-assets-'));
    const resume = vi.spyOn(process.stdin, 'resume').mockImplementation(() => process.stdin);
    launcherMockState.startRuntimePreview.mockResolvedValue(undefined);
    launcherMockState.Launcher.mockImplementation(() => ({
      startRuntimePreview: launcherMockState.startRuntimePreview,
      startPreview: launcherMockState.startPreview,
    }));

    try {
      await writeFile(join(projectRoot, 'package.json'), '{"name":"runtime-preview-cli-watch-assets"}', 'utf8');

      const program = new Command();
      program.exitOverride();
      new PreviewCommand(program).register();

      await program.parseAsync([
        'preview',
        '--project',
        projectRoot,
        '--runtime',
        '--watch-assets',
      ], { from: 'user' });

      expect(launcherMockState.startRuntimePreview).toHaveBeenCalledWith(expect.objectContaining({
        watchAssets: true,
      }));
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
      resume.mockRestore();
      launcherMockState.startRuntimePreview.mockReset();
      launcherMockState.startPreview.mockReset();
      launcherMockState.Launcher.mockReset();
    }
  });

  it('does not enable watch-assets by default', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'runtime-preview-cli-watch-assets-default-'));
    const resume = vi.spyOn(process.stdin, 'resume').mockImplementation(() => process.stdin);
    launcherMockState.startRuntimePreview.mockResolvedValue(undefined);
    launcherMockState.Launcher.mockImplementation(() => ({
      startRuntimePreview: launcherMockState.startRuntimePreview,
      startPreview: launcherMockState.startPreview,
    }));

    try {
      await writeFile(join(projectRoot, 'package.json'), '{"name":"runtime-preview-cli-watch-assets-default"}', 'utf8');

      const program = new Command();
      program.exitOverride();
      new PreviewCommand(program).register();

      await program.parseAsync([
        'preview',
        '--project',
        projectRoot,
        '--runtime',
      ], { from: 'user' });

      const runtimeOptions = launcherMockState.startRuntimePreview.mock.calls[0]?.[0];
      expect(runtimeOptions?.watchAssets).not.toBe(true);
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
      resume.mockRestore();
      launcherMockState.startRuntimePreview.mockReset();
      launcherMockState.startPreview.mockReset();
      launcherMockState.Launcher.mockReset();
    }
  });

  it('lists refresh-on-reload in preview command help', () => {
    const program = new Command();
    new PreviewCommand(program).register();
    const previewCommand = program.commands.find((command) => command.name() === 'preview');

    expect(previewCommand).toBeTruthy();
    expect(previewCommand!.helpInformation()).toContain('--refresh-on-reload');
    expect(previewCommand!.helpInformation()).toContain('--watch-assets');
  });

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
      engineRootSource: 'test-env',
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
      expect(server.startupLogLines).toContain('engineRootSource=test-env');
      expect(server.startupLogLines).toContain(`projectLibraryRoot=${paths.editorLibraryRef}`);
      expect(server.startupLogLines).toContain(`extensionLibraryRoots=view-state-group:${extensionLibraryRoot}`);
      expect(server.startupLogLines).toContain(`projectProgrammingRoot=${join(paths.editorProgrammingRef, 'programming')}`);
      expect(server.startupLogLines).toContain(`server:listening ${server.url}`);
      expect(server.logFilePath).toMatch(/runtime-preview-\d{8}-\d{6}\.log$/);
      expect(existsSync(server.logFilePath)).toBe(true);

      const health = await fetch(`${server.url}/__runtime-preview/health`);
      expect(health.status).toBe(200);
      expect(await health.json()).toMatchObject({
        ok: true,
        projectRoot: paths.projectRoot,
        engineRoot: paths.engineRoot,
        engineRootSource: 'test-env',
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
      expect(logSource).toContain('engineRootSource=test-env');
      expect(logSource).toContain(`projectLibraryRoot=${paths.editorLibraryRef}`);
      expect(logSource).toContain(`extensionLibraryRoots=view-state-group:${extensionLibraryRoot}`);
      expect(logSource).toContain(`projectProgrammingRoot=${join(paths.editorProgrammingRef, 'programming')}`);
      expect(logSource).toContain(`server:listening ${server.url}`);
      expect(logSource.match(/server:listening/g) ?? []).toHaveLength(1);
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
