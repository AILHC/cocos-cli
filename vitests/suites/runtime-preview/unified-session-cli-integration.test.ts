import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { describe, expect, it } from 'vitest';
import {
  canListen,
  startRuntimePreviewCliProcess,
  type StartedRuntimePreviewCliProcess,
} from '@shared/runtime-preview-cli-process';

async function findAvailablePort(startPort: number): Promise<number> {
  for (let offset = 0; offset < 50; offset += 1) {
    const port = startPort + offset;
    if (await canListen(port)) {
      return port;
    }
  }
  throw new Error(`No available Runtime Preview port from ${startPort}.`);
}

function count(source: string, pattern: RegExp): number {
  return source.match(pattern)?.length ?? 0;
}

function sceneLifecycleLog(source: string): string {
  return source
    .split(/\r?\n/)
    .filter((line) => /Scene process|scene worker|startup worker|--inspect=|重启|退出异常/.test(line))
    .join('\n');
}

function toolFailureReason(result: { structuredContent?: unknown }): string {
  const structured = result.structuredContent as {
    result?: {
      code?: number;
      reason?: string;
    };
  } | undefined;
  const code = structured?.result?.code ?? 'unknown';
  const reason = structured?.result?.reason ?? 'unknown MCP tool failure';
  return `code=${code} reason=${reason}`;
}

async function waitForOkResponse(url: string, timeoutMs = 5_000): Promise<Response> {
  const deadline = Date.now() + timeoutMs;
  let response = await fetch(url);
  while (response.status !== 200 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    response = await fetch(url);
  }
  return response;
}

describe('unified Runtime Preview production CLI session', () => {
  it('serves runtime, scene editor, and MCP through one default preview process', async () => {
    const repoRoot = join(process.cwd(), '..');
    const sourceProjectRoot = join(repoRoot, 'tests', 'fixtures', 'projects', 'asset-operation');
    const engineRoot = process.env.COCOS_CLI_TEST_ENGINE_ROOT;
    if (!engineRoot) {
      throw new Error('Vitest harness must provide COCOS_CLI_TEST_ENGINE_ROOT.');
    }

    const tempRoot = await mkdtemp(join(tmpdir(), 'runtime-preview-unified-cli-'));
    const projectRoot = join(tempRoot, 'project');
    let cli: StartedRuntimePreviewCliProcess | null = null;
    let client: Client | null = null;
    try {
      await cp(sourceProjectRoot, projectRoot, {
        recursive: true,
        filter: (source) => !['library', 'temp'].includes(basename(source)),
      });
      const packageJsonPath = join(projectRoot, 'package.json');
      const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8')) as Record<string, unknown>;
      packageJson['cocos-cli'] = { enginePath: engineRoot };
      await writeFile(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`, 'utf8');

      const port = await findAvailablePort(19630);
      cli = await startRuntimePreviewCliProcess({
        repoRoot,
        projectRoot,
        engineRoot,
        host: '127.0.0.1',
        port,
        startupTimeoutMs: 180_000,
        useRuntimeFlag: false,
        useTestEnvironment: false,
        noOpen: true,
      });

      expect(cli.args).not.toContain('--runtime');
      expect(cli.args).toContain('--no-open');
      expect(count(cli.stdout, /\[runtime-preview\] server:listening/g)).toBe(1);
      expect(
        count(cli.stdout, /^\[log\] Scene process start\.\r?$/gm),
        sceneLifecycleLog(cli.stdout),
      ).toBe(1);
      expect(cli.stdout).toContain(`[runtime-preview] scene-editor:url ${cli.url}/scene-editor/`);
      expect(cli.stdout).toContain(`[runtime-preview] mcp:url ${cli.url}/mcp`);

      const runtimeResponse = await fetch(`${cli.url}/`);
      expect(runtimeResponse.status).toBe(200);
      const runtimeHtml = await runtimeResponse.text();
      expect(runtimeHtml).toContain('System.import("/preview-app/index.js")');
      expect(runtimeHtml).toContain('/settings.js');
      expect(runtimeHtml).not.toContain('/preview/settings.js');

      const gamePreviewSettingsResponse = await fetch(`${cli.url}/preview/settings.js`);
      expect(gamePreviewSettingsResponse.status).toBe(404);

      const sceneEditorResponse = await fetch(`${cli.url}/scene-editor/`);
      expect(sceneEditorResponse.status).toBe(200);
      expect(await sceneEditorResponse.text()).toContain('scene');

      client = new Client({ name: 'unified-runtime-preview-cli-test', version: '1.0.0' });
      await client.connect(new StreamableHTTPClientTransport(new URL(`${cli.url}/mcp`)));
      const tools = await client.listTools();
      expect(tools.tools.map((tool) => tool.name)).toEqual(expect.arrayContaining([
        'scene-create',
        'scene-open',
        'scene-query-current',
        'scene-save',
        'scene-undo',
        'scene-redo',
      ]));

      const createResult = await client.callTool({
        name: 'scene-create',
        arguments: {
          options: {
            baseName: 'unified-session-test',
            dbURL: 'db://assets',
          templateType: '2d',
          },
        },
      });
      expect(createResult.isError, toolFailureReason(createResult)).toBe(false);
      const createdScene = (
        createResult.structuredContent as {
          result?: {
            data?: {
              assetUrl?: string;
              assetUuid?: string;
            };
          };
        } | undefined
      )?.result?.data;
      expect(createdScene?.assetUrl).toBe('db://assets/unified-session-test.scene');
      expect(createdScene?.assetUuid).toBeTruthy();

      const openResult = await client.callTool({
        name: 'scene-open',
        arguments: {
          options: {
            dbURLOrUUID: createdScene!.assetUrl!,
          },
        },
      });
      expect(
        openResult.isError,
        `${toolFailureReason(openResult)}\nscene stdout tail:\n${cli.stdout.slice(-8_000)}\nscene stderr tail:\n${cli.stderr.slice(-2_000)}`,
      ).toBe(false);

      const queryResult = await client.callTool({
        name: 'scene-query-current',
        arguments: {},
      });
      expect(queryResult.isError).toBe(false);

      // scene-undo / scene-redo:操作 scene worker 的 undo 栈(工具级冒烟;浏览器页面有独立 undo 栈,见 RP-ISSUE-041)。
      const createNodeResult = await client.callTool({
        name: 'scene-create-node-by-type',
        arguments: {
          options: {
            path: '/',
            nodeType: 'Empty',
            name: 'UndoProbe',
          },
        },
      });
      expect(createNodeResult.isError, toolFailureReason(createNodeResult)).toBe(false);

      const undoResult = await client.callTool({
        name: 'scene-undo',
        arguments: {},
      });
      expect(undoResult.isError, toolFailureReason(undoResult)).toBe(false);
      const undoData = (undoResult.structuredContent as {
        result?: { data?: { success?: boolean } };
      } | undefined)?.result?.data;
      expect(undoData?.success).toBe(true);

      const queryAfterUndo = await client.callTool({
        name: 'scene-query-node',
        arguments: { options: { path: 'UndoProbe' } },
      });
      expect(
        (queryAfterUndo.structuredContent as { result?: { code?: number } } | undefined)?.result?.code,
      ).not.toBe(200);

      const redoResult = await client.callTool({
        name: 'scene-redo',
        arguments: {},
      });
      expect(redoResult.isError, toolFailureReason(redoResult)).toBe(false);
      const redoData = (redoResult.structuredContent as {
        result?: { data?: { success?: boolean } };
      } | undefined)?.result?.data;
      expect(redoData?.success).toBe(true);

      const queryAfterRedo = await client.callTool({
        name: 'scene-query-node',
        arguments: { options: { path: 'UndoProbe' } },
      });
      expect(
        (queryAfterRedo.structuredContent as { result?: { code?: number } } | undefined)?.result?.code,
      ).toBe(200);

      const saveResult = await client.callTool({
        name: 'scene-save',
        arguments: {},
      });
      expect(saveResult.isError).toBe(false);

      const sceneResponse = await waitForOkResponse(`${cli.url}/scene/${createdScene!.assetUuid}.json`);
      expect(sceneResponse.status).toBe(200);
      expect(await sceneResponse.json()).toBeInstanceOf(Array);

      expect(cli.logFilePath).toBeTruthy();
      const runtimeLog = await readFile(cli.logFilePath!, 'utf8');
      expect(runtimeLog).toMatch(
        /runtime-asset-save generation=\d+ target=db:\/\/assets\/unified-session-test\.scene ok=true/,
      );
    } finally {
      await client?.close().catch(() => undefined);
      const closeResult = cli ? await cli.close() : null;
      expect(closeResult?.portReleased ?? true).toBe(true);
      await rm(tempRoot, { recursive: true, force: true });
    }
  }, 300_000);
});
