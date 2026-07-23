import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.restoreAllMocks();
  vi.doUnmock('../../../src/core/launcher');
  vi.doUnmock('../../../src/core/project');
  vi.doUnmock('../../../src/mcp/mount-mcp');
  vi.doUnmock('../../../src/server/server');
  vi.doUnmock('../../../src/lib/server/server');
  vi.resetModules();
});

describe('start-mcp-server compatibility entry', () => {
  it('starts the unified runtime preview session instead of a second launcher startup chain', async () => {
    const projectRoot = 'D:/workspace/cocos-project';
    const close = vi.fn(async () => undefined);
    const unifiedSession = {
      url: 'http://127.0.0.1:19530',
      mcpUrl: 'http://127.0.0.1:19530/mcp',
      close,
    };
    const startRuntimePreview = vi.fn(async () => unifiedSession);
    const constructLauncher = vi.fn();

    vi.doMock('../../../src/core/launcher', () => ({
      default: class MockLauncher {
        constructor(path: string) {
          constructLauncher(path);
        }

        startRuntimePreview = startRuntimePreview;
      },
    }));
    vi.spyOn(console, 'log').mockImplementation(() => undefined);

    const { startServer } = await import('../../../src/mcp/start-server');
    const session = await startServer(projectRoot, 19530);

    expect(constructLauncher).toHaveBeenCalledTimes(1);
    expect(constructLauncher).toHaveBeenCalledWith(projectRoot);
    expect(startRuntimePreview).toHaveBeenCalledTimes(1);
    expect(startRuntimePreview).toHaveBeenCalledWith({
      host: '127.0.0.1',
      port: 19530,
      open: false,
    });
    expect(session).toBe(unifiedSession);

    constructLauncher.mockClear();
    startRuntimePreview.mockClear();
    const { CocosAPI } = await import('../../../src/api');
    const api = Object.create(CocosAPI.prototype) as CocosAPI;
    const apiSession = await api.startupMcpServer(projectRoot, 19530);

    expect(constructLauncher).toHaveBeenCalledTimes(1);
    expect(constructLauncher).toHaveBeenCalledWith(projectRoot);
    expect(startRuntimePreview).toHaveBeenCalledTimes(1);
    expect(startRuntimePreview).toHaveBeenCalledWith({
      host: '127.0.0.1',
      port: 19530,
      open: false,
    });
    expect(apiSession).toBe(unifiedSession);
  });

  it('reuses the MCP mount handle from the public library facade', async () => {
    const projectRoot = 'D:/workspace/cocos-project';
    const sharedRouter = { shared: true };
    const close = vi.fn(async () => undefined);
    const mountMcp = vi.fn(async () => ({
      url: 'http://127.0.0.1:19530/mcp',
      close,
    }));

    vi.doMock('../../../src/core/project', () => ({
      default: {
        path: projectRoot,
      },
    }));
    vi.doMock('../../../src/mcp/mount-mcp', () => ({
      mountMcp,
    }));
    vi.doMock('../../../src/server/server', () => ({
      serverService: {
        router: sharedRouter,
      },
    }));
    vi.doMock('../../../src/lib/server/server', () => ({
      getUrl: () => 'http://127.0.0.1:19530',
    }));
    vi.spyOn(console, 'log').mockImplementation(() => undefined);

    const mcp = await import('../../../src/lib/mcp/mcp');
    await expect(mcp.register()).resolves.toBe('http://127.0.0.1:19530/mcp');
    await expect(mcp.register()).resolves.toBe('http://127.0.0.1:19530/mcp');
    expect(mountMcp).toHaveBeenCalledTimes(1);
    expect(mountMcp).toHaveBeenCalledWith({
      router: sharedRouter,
      serverUrl: 'http://127.0.0.1:19530',
      projectPath: projectRoot,
    });

    await mcp.unregister();
    await mcp.unregister();
    expect(close).toHaveBeenCalledTimes(1);
  });
});
