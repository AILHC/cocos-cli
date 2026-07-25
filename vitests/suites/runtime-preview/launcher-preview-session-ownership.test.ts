/**
 * Launcher.startRuntimePreview / startPreview 的 preview session 状态发布接线测试。
 * 测试层级:Vitest 集成(mock 接缝);fixture 为系统 temp 临时目录(非真实项目),
 * server/scene/MCP/builder 全部 mock,只验证 ownership 接线行为:
 * publishReady 时机与有界重试(F4)、发布失败回滚顺序、--build blocking owner 的
 * identity endpoint 挂载与 ready 发布(issues/19)、close/回滚释放顺序、无 ownership 兼容。
 * 参照 launcher-runtime-preview.test.ts 的 mock harness 组织。
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { writePreviewOutputIntegritySeal } from '../../../src/core/scripting/packer-driver/script-registration-integrity';
import type { PreviewSessionOwnership } from '../../../src/core/preview-session';

const isolatedEnvKeys = [
  'COCOS_CLI_TEST_PROJECT_ROOT',
  'COCOS_CLI_TEST_EDITOR_LIBRARY_REF',
  'COCOS_CLI_TEST_EDITOR_PROGRAMMING_REF',
] as const;

async function writeMinimalProgrammingArtifacts(projectRoot: string): Promise<void> {
  const previewRoot = join(projectRoot, 'temp', 'cli', 'programming', 'packer-driver', 'targets', 'preview');
  await mkdir(join(previewRoot, 'chunks', 'runtime'), { recursive: true });
  await writeFile(join(previewRoot, 'import-map.json'), JSON.stringify({
    imports: {
      'cce:/internal/x/prerequisite-imports': './chunks/runtime/prerequisite.js',
    },
    scopes: {
      './chunks/runtime/prerequisite.js': {},
    },
  }), 'utf8');
  await writeFile(join(previewRoot, 'main-record.json'), JSON.stringify({ modules: {} }), 'utf8');
  await writeFile(
    join(previewRoot, 'chunks', 'runtime', 'prerequisite.js'),
    'System.register([], function(){ return { execute: function(){} }; });',
    'utf8',
  );
  await writeFile(join(previewRoot, 'assembly-record.json'), JSON.stringify({ chunks: {}, entries: {} }), 'utf8');
  await writeFile(join(previewRoot, 'resolution-detail-map.json'), JSON.stringify({}), 'utf8');
  writePreviewOutputIntegritySeal(previewRoot);
}

function createFakeOwnership(projectRoot: string) {
  const publishReady = vi.fn(async (_serverUrl: string) => undefined);
  const markDraining = vi.fn(async () => undefined);
  const release = vi.fn(async () => undefined);
  const ownership: PreviewSessionOwnership = {
    sessionId: '11111111-2222-4333-8444-555555555555',
    pid: process.pid,
    projectRoot,
    claimDir: join(projectRoot, 'temp', 'cli', 'preview-session-fake'),
    publishReady,
    markDraining,
    release,
  };
  return { ownership, publishReady, markDraining, release };
}

async function createHarness(harnessOptions: { failAt?: 'startupScene' } = {}) {
  vi.resetModules();
  const previousEnv = new Map<string, string | undefined>();
  for (const key of isolatedEnvKeys) {
    previousEnv.set(key, process.env[key]);
    delete process.env[key];
  }
  const projectRoot = await mkdtemp(join(tmpdir(), 'launcher-preview-session-ownership-'));
  await writeMinimalProgrammingArtifacts(projectRoot);
  const finalServerUrl = 'http://127.0.0.1:19999';
  const getPreviewSettings = vi.fn(async (buildOptions?: Record<string, unknown>) => ({
    settings: {
      assets: {
        server: buildOptions?.server,
      },
      launch: {
        launchScene: buildOptions?.startScene,
      },
    },
    script2library: {},
    bundleConfigs: [],
  }));
  const initBuilder = vi.fn(async () => undefined);
  const startAssetWatcher = vi.fn(async () => undefined);
  const capturedServerOptions: any[] = [];
  const stopSceneWorker = vi.fn(async () => true);
  const startupScene = vi.fn(async () => {
    if (harnessOptions.failAt === 'startupScene') {
      throw new Error('synthetic scene startup failure');
    }
    return { stop: stopSceneWorker };
  });
  const closeMcp = vi.fn(async () => undefined);
  const sharedRouter = { shared: true };
  const mountMcp = vi.fn(async () => ({
    url: `${finalServerUrl}/mcp`,
    close: closeMcp,
  }));
  const closeSession = vi.fn(async () => undefined);
  const sessionCleanupSteps = {
    runtime: [] as Array<() => Promise<void>>,
    scene: [] as Array<() => Promise<void>>,
    project: [] as Array<() => Promise<void>>,
  };

  vi.doMock('../../../src/core/base/console', () => ({
    newConsole: {
      init: vi.fn(),
      record: vi.fn(),
    },
  }));
  vi.doMock('../../../src/server', () => ({
    startServer: vi.fn(),
    getServerUrl: vi.fn(() => finalServerUrl),
  }));
  vi.doMock('../../../src/server/server', () => ({
    serverService: {
      router: sharedRouter,
    },
  }));
  vi.doMock('../../../src/mcp/mount-mcp', () => ({
    mountMcp,
  }));
  vi.doMock('../../../src/core/scripting', () => ({
    default: {
      close: vi.fn(),
    },
  }));
  vi.doMock('../../../src/core/scene', () => ({
    startupScene,
  }));
  vi.doMock('../../../src/core/assets/extension-asset-db-mounts', () => ({
    resolveProjectExtensionAssetDbMounts: vi.fn(() => []),
  }));
  vi.doMock('../../../src/core/assets', () => ({
    assetManager: {
      onAssetSaved: vi.fn(() => vi.fn()),
      destroyed: vi.fn(),
    },
    stopAssetDB: vi.fn(async () => undefined),
  }));
  vi.doMock('../../../src/core/project', () => ({
    default: { close: vi.fn(async () => true) },
  }));
  vi.doMock('../../../src/core/launcher-engine-root', () => ({
    resolveLauncherEngineRoot: vi.fn(async () => ({
      engineRoot: 'D:/workspace/engines/cocos/3.8.6',
      source: 'test-env',
    })),
  }));
  vi.doMock('../../../src/core/builder', () => ({
    init: initBuilder,
    getPreviewSettings,
  }));
  vi.doMock('../../../src/runtime-preview/watch/runtime-asset-change-watcher', () => ({
    createRuntimeAssetStartupSnapshot: vi.fn(async () => undefined),
  }));
  vi.doMock('../../../src/runtime-preview', async () => {
    const settings = await vi.importActual<typeof import('../../../src/runtime-preview/settings/preview-settings-provider')>(
      '../../../src/runtime-preview/settings/preview-settings-provider',
    );
    return {
      getDefaultProjectProgrammingRoot: (root: string) => join(root, 'temp', 'cli', 'programming'),
      PreviewSettingsProvider: settings.PreviewSettingsProvider,
      startRuntimePreviewSession: vi.fn(async (sessionOptions: any) => {
        capturedServerOptions.push(sessionOptions);
        return {
          router: {} as never,
          host: '127.0.0.1',
          port: 19999,
          url: finalServerUrl,
          context: {} as never,
          settingsProvider: sessionOptions.settingsProvider,
          startupLogLines: [`server:listening ${finalServerUrl}`],
          logFilePath: join(projectRoot, 'temp', 'preview.log'),
          logger: { logFilePath: join(projectRoot, 'temp', 'preview.log'), write: async () => undefined },
          startAssetWatcher,
          registerCleanup: (phase: keyof typeof sessionCleanupSteps, close: () => Promise<void>) => {
            sessionCleanupSteps[phase].push(close);
          },
          close: closeSession,
        };
      }),
    };
  });

  const { default: Launcher } = await import('../../../src/core/launcher');
  vi.spyOn(Launcher.prototype, 'import').mockResolvedValue(undefined);

  const cleanup = async () => {
    vi.restoreAllMocks();
    vi.doUnmock('../../../src/core/base/console');
    vi.doUnmock('../../../src/server');
    vi.doUnmock('../../../src/server/server');
    vi.doUnmock('../../../src/mcp/mount-mcp');
    vi.doUnmock('../../../src/core/scripting');
    vi.doUnmock('../../../src/core/scene');
    vi.doUnmock('../../../src/core/assets/extension-asset-db-mounts');
    vi.doUnmock('../../../src/core/assets');
    vi.doUnmock('../../../src/core/project');
    vi.doUnmock('../../../src/core/launcher-engine-root');
    vi.doUnmock('../../../src/core/builder');
    vi.doUnmock('../../../src/runtime-preview/watch/runtime-asset-change-watcher');
    vi.doUnmock('../../../src/runtime-preview');
    vi.resetModules();
    for (const key of isolatedEnvKeys) {
      const value = previousEnv.get(key);
      if (typeof value === 'string') {
        process.env[key] = value;
      } else {
        delete process.env[key];
      }
    }
    await rm(projectRoot, { recursive: true, force: true });
  };

  return {
    projectRoot,
    finalServerUrl,
    capturedServerOptions,
    startupScene,
    mountMcp,
    closeSession,
    Launcher,
    cleanup,
  };
}

describe('launcher preview session ownership wiring', () => {
  it('passes ownership through and publishes ready after all capabilities are ready', async () => {
    const harness = await createHarness();
    try {
      const { ownership, publishReady, release } = createFakeOwnership(harness.projectRoot);
      const launcher = new harness.Launcher(harness.projectRoot);
      const session = await launcher.startRuntimePreview({
        host: '127.0.0.1',
        port: 0,
        ownership,
      });

      // ownership 与 claimDir 透传给统一 session(identity endpoint 数据源)。
      expect(harness.capturedServerOptions).toHaveLength(1);
      expect(harness.capturedServerOptions[0].ownership).toBe(ownership);
      expect(harness.capturedServerOptions[0].previewSessionClaimDir).toBe(ownership.claimDir);

      // publishReady 只在全部能力 ready(scene worker + MCP)之后发布一次。
      expect(publishReady).toHaveBeenCalledTimes(1);
      expect(publishReady).toHaveBeenCalledWith(harness.finalServerUrl);
      expect(publishReady.mock.invocationCallOrder[0])
        .toBeGreaterThan(harness.startupScene.mock.invocationCallOrder[0]);
      expect(publishReady.mock.invocationCallOrder[0])
        .toBeGreaterThan(harness.mountMcp.mock.invocationCallOrder[0]);

      await session.close();
      expect(harness.closeSession).toHaveBeenCalledTimes(1);
      // 正常 close 的 markDraining/release 由 session 内部负责(此处为 mock),
      // launcher 自身不在成功路径释放。
      expect(release).not.toHaveBeenCalled();
    } finally {
      await harness.cleanup();
    }
  });

  it('releases the claim before cleaning up initialized resources on startup failure', async () => {
    const harness = await createHarness({ failAt: 'startupScene' });
    try {
      const { ownership, publishReady, markDraining, release } = createFakeOwnership(harness.projectRoot);
      const launcher = new harness.Launcher(harness.projectRoot);
      await expect(launcher.startRuntimePreview({
        host: '127.0.0.1',
        port: 0,
        ownership,
      })).rejects.toThrow('synthetic scene startup failure');

      // 启动失败回滚:不发布 ready,先 release 再清理已初始化资源(session.close)。
      expect(publishReady).not.toHaveBeenCalled();
      expect(markDraining).not.toHaveBeenCalled();
      expect(release).toHaveBeenCalledTimes(1);
      expect(harness.closeSession).toHaveBeenCalledTimes(1);
      expect(release.mock.invocationCallOrder[0])
        .toBeLessThan(harness.closeSession.mock.invocationCallOrder[0]);
    } finally {
      await harness.cleanup();
    }
  });

  it('keeps the existing startup path unchanged without an ownership handle', async () => {
    const harness = await createHarness();
    try {
      const launcher = new harness.Launcher(harness.projectRoot);
      const session = await launcher.startRuntimePreview({
        host: '127.0.0.1',
        port: 0,
      });

      expect(harness.capturedServerOptions).toHaveLength(1);
      expect(harness.capturedServerOptions[0].ownership).toBeUndefined();
      expect(harness.capturedServerOptions[0].previewSessionClaimDir).toBeUndefined();
      expect(session.url).toBe(harness.finalServerUrl);

      await session.close();
      expect(harness.closeSession).toHaveBeenCalledTimes(1);
    } finally {
      await harness.cleanup();
    }
  });

  it('publishReady transient failure is retried and the session still starts (F4)', async () => {
    const harness = await createHarness();
    try {
      const { ownership, publishReady } = createFakeOwnership(harness.projectRoot);
      publishReady.mockRejectedValueOnce(new Error('transient io'));
      const launcher = new harness.Launcher(harness.projectRoot);
      const session = await launcher.startRuntimePreview({
        host: '127.0.0.1',
        port: 0,
        ownership,
      });

      // 有界重试:第一次失败后重试成功,session 正常 ready。
      expect(publishReady).toHaveBeenCalledTimes(2);
      expect(publishReady).toHaveBeenLastCalledWith(harness.finalServerUrl);
      expect(session.url).toBe(harness.finalServerUrl);
      await session.close();
    } finally {
      await harness.cleanup();
    }
  });

  it('publishReady persistent failure rolls back: release before session close, no ready backend left (F4)', async () => {
    const harness = await createHarness();
    try {
      const { ownership, publishReady, release } = createFakeOwnership(harness.projectRoot);
      publishReady.mockRejectedValue(new Error('claim dir readonly'));
      const launcher = new harness.Launcher(harness.projectRoot);
      await expect(launcher.startRuntimePreview({
        host: '127.0.0.1',
        port: 0,
        ownership,
      })).rejects.toThrow('ready descriptor');

      // 有界重试 3 次后 fail closed:先 release claim 再 close session,
      // 不留「ready backend + starting descriptor」。
      expect(publishReady).toHaveBeenCalledTimes(3);
      expect(release).toHaveBeenCalledTimes(1);
      expect(harness.closeSession).toHaveBeenCalledTimes(1);
      expect(release.mock.invocationCallOrder[0])
        .toBeLessThan(harness.closeSession.mock.invocationCallOrder[0]);
    } finally {
      await harness.cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// legacy startPreview(--build)的 blocking owner 接线(issues/19、F4/F5)
// ---------------------------------------------------------------------------

async function createLegacyBuildHarness(harnessOptions: { buildSucceeds?: boolean } = {}) {
  vi.resetModules();
  const projectRoot = await mkdtemp(join(tmpdir(), 'launcher-legacy-build-ownership-'));
  const finalServerUrl = 'http://127.0.0.1:18888';
  const previewPageUrl = `${finalServerUrl}/web-desktop/preview/index.html`;
  const routerGet = vi.fn();
  const buildMock = vi.fn(async () => {
    if (harnessOptions.buildSucceeds === false) {
      return { code: 1, reason: 'synthetic build failure' };
    }
    return { code: 0, custom: { previewUrl: previewPageUrl } };
  });

  vi.doMock('../../../src/core/base/console', () => ({
    newConsole: {
      init: vi.fn(),
      record: vi.fn(),
    },
  }));
  vi.doMock('../../../src/server', () => ({
    startServer: vi.fn(async () => undefined),
    getServerUrl: vi.fn(() => finalServerUrl),
  }));
  vi.doMock('../../../src/server/server', () => ({
    serverService: {
      router: { get: routerGet },
    },
  }));
  vi.doMock('../../../src/core/scripting', () => ({
    default: {
      close: vi.fn(),
    },
  }));
  vi.doMock('../../../src/core/builder', () => ({
    init: vi.fn(async () => undefined),
    build: buildMock,
  }));
  // 与 createHarness 同理:截断 engine root / scene / assets 解析的真实依赖链
  // (configuration 等),本测试只验证 ownership 接线。
  vi.doMock('../../../src/core/launcher-engine-root', () => ({
    resolveLauncherEngineRoot: vi.fn(async () => ({
      engineRoot: 'D:/workspace/engines/cocos/3.8.6',
      source: 'test-env',
    })),
  }));
  vi.doMock('../../../src/core/scene', () => ({
    startupScene: vi.fn(async () => ({ stop: vi.fn(async () => true) })),
  }));
  vi.doMock('../../../src/core/assets/extension-asset-db-mounts', () => ({
    resolveProjectExtensionAssetDbMounts: vi.fn(() => []),
  }));
  vi.doMock('../../../src/core/assets', () => ({
    assetManager: {
      onAssetSaved: vi.fn(() => vi.fn()),
      destroyed: vi.fn(),
    },
    stopAssetDB: vi.fn(async () => undefined),
  }));
  vi.doMock('../../../src/core/project', () => ({
    default: { close: vi.fn(async () => true) },
  }));

  const { default: Launcher } = await import('../../../src/core/launcher');
  vi.spyOn(Launcher.prototype, 'import').mockResolvedValue(undefined);

  const cleanup = async () => {
    vi.restoreAllMocks();
    vi.doUnmock('../../../src/core/base/console');
    vi.doUnmock('../../../src/server');
    vi.doUnmock('../../../src/server/server');
    vi.doUnmock('../../../src/core/scripting');
    vi.doUnmock('../../../src/core/builder');
    vi.doUnmock('../../../src/core/launcher-engine-root');
    vi.doUnmock('../../../src/core/scene');
    vi.doUnmock('../../../src/core/assets/extension-asset-db-mounts');
    vi.doUnmock('../../../src/core/assets');
    vi.doUnmock('../../../src/core/project');
    vi.resetModules();
    await rm(projectRoot, { recursive: true, force: true });
  };

  return { projectRoot, finalServerUrl, previewPageUrl, routerGet, buildMock, Launcher, cleanup };
}

describe('legacy startPreview (--build) blocking owner wiring (issues/19)', () => {
  it('mounts the identity endpoint after server start and publishes ready after build (F5)', async () => {
    const harness = await createLegacyBuildHarness();
    try {
      const { ownership, publishReady } = createFakeOwnership(harness.projectRoot);
      const launcher = new harness.Launcher(harness.projectRoot);
      await launcher.startPreview({
        ownership,
        port: 0,
        platform: 'web-desktop',
        open: false,
      });

      // server ready 后挂只读 identity endpoint(验活闭环的前提)。
      expect(harness.routerGet).toHaveBeenCalledTimes(1);
      expect(harness.routerGet.mock.calls[0][0]).toBe('/__cocos-cli/session');
      expect(typeof harness.routerGet.mock.calls[0][1]).toBe('function');
      // build 完成、server 已在 serve 后发布 ready(server 根 URL)。
      expect(publishReady).toHaveBeenCalledTimes(1);
      expect(publishReady).toHaveBeenCalledWith(harness.finalServerUrl);
      expect(publishReady.mock.invocationCallOrder[0])
        .toBeGreaterThan(harness.buildMock.mock.invocationCallOrder[0]);
    } finally {
      await harness.cleanup();
    }
  });

  it('without ownership keeps the legacy path: no identity endpoint, no publish (F5)', async () => {
    const harness = await createLegacyBuildHarness();
    try {
      const launcher = new harness.Launcher(harness.projectRoot);
      const result = await launcher.startPreview({ port: 0, platform: 'web-desktop', open: false });

      expect(harness.routerGet).not.toHaveBeenCalled();
      expect((result as any).custom.previewUrl).toBe(harness.previewPageUrl);
    } finally {
      await harness.cleanup();
    }
  });

  it('build failure releases the claim before throwing (F5 rollback)', async () => {
    const harness = await createLegacyBuildHarness({ buildSucceeds: false });
    try {
      const { ownership, publishReady, release } = createFakeOwnership(harness.projectRoot);
      const launcher = new harness.Launcher(harness.projectRoot);
      await expect(launcher.startPreview({
        ownership,
        port: 0,
        platform: 'web-desktop',
        open: false,
      })).rejects.toThrow('synthetic build failure');

      expect(publishReady).not.toHaveBeenCalled();
      expect(release).toHaveBeenCalledTimes(1);
    } finally {
      await harness.cleanup();
    }
  });

  it('publishReady persistent failure rolls back instead of leaving a starting descriptor (F4/F5)', async () => {
    const harness = await createLegacyBuildHarness();
    try {
      const { ownership, publishReady, release } = createFakeOwnership(harness.projectRoot);
      publishReady.mockRejectedValue(new Error('claim dir readonly'));
      const launcher = new harness.Launcher(harness.projectRoot);
      await expect(launcher.startPreview({
        ownership,
        port: 0,
        platform: 'web-desktop',
        open: false,
      })).rejects.toThrow('ready descriptor');

      expect(publishReady).toHaveBeenCalledTimes(3);
      expect(release).toHaveBeenCalledTimes(1);
    } finally {
      await harness.cleanup();
    }
  });
});
