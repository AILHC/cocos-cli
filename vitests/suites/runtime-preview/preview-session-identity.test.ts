/**
 * identity endpoint(GET /__cocos-cli/session)route contract。
 * 测试层级:Vitest route contract;fixture 为系统 temp 下的临时目录(非真实项目);
 * 不设置 COCOS_CLI_TEST_* 项目级 env,vitest harness 的 engine root 仅满足启动要求。
 * 能证明:endpoint 各态响应形状、每次请求实时读 descriptor、404 JSON、无 claim 时不挂载。
 * 不能证明:真实 CLI preview 进程端到端 discovery(属集成层)。
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PreviewSettingsProvider } from '@runtime-preview/settings/preview-settings-provider';
import {
  startRuntimePreviewServer,
  type RuntimePreviewServerOptions,
} from '@runtime-preview/server/runtime-preview-server';
import {
  PREVIEW_SESSION_DESCRIPTOR_NAME,
  PREVIEW_SESSION_IDENTITY_PATH,
  PREVIEW_SESSION_PROTOCOL_VERSION,
} from '../../../src/core/preview-session';
import type { PreviewSessionDescriptor } from '../../../src/core/preview-session';

const TEST_SESSION_ID = '11111111-2222-4333-8444-555555555555';
const TEST_STARTED_AT = '2026-07-24T00:00:00.000Z';

interface IdentityFixture {
  root: string;
  projectRoot: string;
  claimDir: string;
  options: RuntimePreviewServerOptions;
}

async function createIdentityFixture(includeClaimDir = true): Promise<IdentityFixture> {
  const root = await mkdtemp(join(tmpdir(), 'preview-session-identity-'));
  const projectRoot = join(root, 'project');
  const engineRoot = join(root, 'engine');
  const projectLibraryRoot = join(projectRoot, 'library', 'cli');
  const projectProgrammingRoot = join(projectRoot, 'temp', 'cli', 'programming');
  const claimDir = join(root, 'claim');

  await mkdir(join(projectLibraryRoot, 'ab'), { recursive: true });
  await mkdir(join(engineRoot, 'bin', '.cache', 'dev-cli', 'web'), { recursive: true });
  await mkdir(projectProgrammingRoot, { recursive: true });
  await mkdir(claimDir, { recursive: true });
  await writeFile(join(projectLibraryRoot, 'ab', 'abcdef.json'), '{"ok":true}', 'utf8');
  await writeFile(join(engineRoot, 'bin', '.cache', 'dev-cli', 'web', 'import-map.json'), '{"imports":{}}', 'utf8');

  const options: RuntimePreviewServerOptions = {
    projectRoot,
    engineRoot,
    projectLibraryRoot,
    projectProgrammingRoot,
    host: '127.0.0.1',
    port: 0,
    ...(includeClaimDir ? { previewSessionClaimDir: claimDir } : {}),
    settingsProvider: new PreviewSettingsProvider({
      loadPreviewSettings: async () => ({
        settings: {
          assets: {
            server: '',
            importBase: '',
            nativeBase: '',
          },
        },
        script2library: {},
        bundleConfigs: [],
      }),
    }),
  };
  return { root, projectRoot, claimDir, options };
}

function buildDescriptor(
  projectRoot: string,
  state: PreviewSessionDescriptor['state'],
  serverUrl?: string,
): PreviewSessionDescriptor {
  return {
    sessionId: TEST_SESSION_ID,
    projectRoot,
    pid: process.pid,
    state,
    protocolVersion: PREVIEW_SESSION_PROTOCOL_VERSION,
    ...(serverUrl ? { serverUrl } : {}),
    startedAt: TEST_STARTED_AT,
  };
}

async function writeDescriptor(claimDir: string, descriptor: PreviewSessionDescriptor): Promise<void> {
  await writeFile(join(claimDir, PREVIEW_SESSION_DESCRIPTOR_NAME), JSON.stringify(descriptor, null, 2), 'utf8');
}

describe('preview session identity endpoint', () => {
  it('serves the starting state with the live server URL before publishReady', async () => {
    const fixture = await createIdentityFixture();
    try {
      // starting 态 descriptor:serverUrl 缺席,endpoint 回落到当前 server URL。
      await writeDescriptor(fixture.claimDir, buildDescriptor(fixture.projectRoot, 'starting'));
      const server = await startRuntimePreviewServer(fixture.options);
      try {
        const response = await fetch(`${server.url}${PREVIEW_SESSION_IDENTITY_PATH}`);
        expect(response.status).toBe(200);
        expect(response.headers.get('content-type')).toContain('application/json');
        expect(await response.json()).toEqual({
          sessionId: TEST_SESSION_ID,
          projectRoot: fixture.projectRoot,
          state: 'starting',
          protocolVersion: PREVIEW_SESSION_PROTOCOL_VERSION,
          serverUrl: server.url,
          mcpUrl: `${server.url}/mcp`,
          startedAt: TEST_STARTED_AT,
        });
        // 既有 readiness endpoint 行为不变。
        expect((await fetch(`${server.url}/__runtime-preview/health`)).status).toBe(200);
      } finally {
        await server.close();
      }
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it('reflects descriptor updates on every request across ready and draining', async () => {
    const fixture = await createIdentityFixture();
    try {
      const server = await startRuntimePreviewServer(fixture.options);
      try {
        await writeDescriptor(fixture.claimDir, buildDescriptor(fixture.projectRoot, 'ready', server.url));
        const readyResponse = await fetch(`${server.url}${PREVIEW_SESSION_IDENTITY_PATH}`);
        expect(readyResponse.status).toBe(200);
        expect(await readyResponse.json()).toEqual({
          sessionId: TEST_SESSION_ID,
          projectRoot: fixture.projectRoot,
          state: 'ready',
          protocolVersion: PREVIEW_SESSION_PROTOCOL_VERSION,
          serverUrl: server.url,
          mcpUrl: `${server.url}/mcp`,
          startedAt: TEST_STARTED_AT,
        });

        // 每次请求实时读取 descriptor:close 开始切 draining 后下一请求立即可见。
        await writeDescriptor(fixture.claimDir, buildDescriptor(fixture.projectRoot, 'draining', server.url));
        const drainingResponse = await fetch(`${server.url}${PREVIEW_SESSION_IDENTITY_PATH}`);
        expect(drainingResponse.status).toBe(200);
        expect(await drainingResponse.json()).toMatchObject({
          sessionId: TEST_SESSION_ID,
          state: 'draining',
          serverUrl: server.url,
          mcpUrl: `${server.url}/mcp`,
        });
      } finally {
        await server.close();
      }
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it('returns an explicit 404 JSON when the descriptor is missing or unreadable', async () => {
    const fixture = await createIdentityFixture();
    try {
      const server = await startRuntimePreviewServer(fixture.options);
      try {
        // claim 目录存在但 descriptor 未发布(或已释放)。
        const missingResponse = await fetch(`${server.url}${PREVIEW_SESSION_IDENTITY_PATH}`);
        expect(missingResponse.status).toBe(404);
        expect(missingResponse.headers.get('content-type')).toContain('application/json');
        expect(await missingResponse.json()).toEqual({
          error: 'preview-session-not-found',
          reason: 'missing',
        });

        // 崩溃残留的半个 JSON。
        await writeFile(join(fixture.claimDir, PREVIEW_SESSION_DESCRIPTOR_NAME), '{"sessionId":', 'utf8');
        const parseErrorResponse = await fetch(`${server.url}${PREVIEW_SESSION_IDENTITY_PATH}`);
        expect(parseErrorResponse.status).toBe(404);
        expect(await parseErrorResponse.json()).toEqual({
          error: 'preview-session-not-found',
          reason: 'parse-error',
        });

        // schema 非法(缺字段)。
        await writeFile(join(fixture.claimDir, PREVIEW_SESSION_DESCRIPTOR_NAME), '{}', 'utf8');
        const invalidSchemaResponse = await fetch(`${server.url}${PREVIEW_SESSION_IDENTITY_PATH}`);
        expect(invalidSchemaResponse.status).toBe(404);
        expect(await invalidSchemaResponse.json()).toEqual({
          error: 'preview-session-not-found',
          reason: 'invalid-schema',
        });
      } finally {
        await server.close();
      }
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it('does not mount the identity endpoint without an ownership claim', async () => {
    const fixture = await createIdentityFixture(false);
    try {
      const server = await startRuntimePreviewServer(fixture.options);
      try {
        // 无 ownership:endpoint 不挂载,落入既有 404 行为。
        const response = await fetch(`${server.url}${PREVIEW_SESSION_IDENTITY_PATH}`);
        expect(response.status).toBe(404);
        expect(await response.text()).toContain('No runtime preview route handled');
        expect((await fetch(`${server.url}/__runtime-preview/health`)).status).toBe(200);
      } finally {
        await server.close();
      }
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });
});
