import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { chromium, type Browser } from 'playwright-core';
import {
  canListen,
  startRuntimePreviewCliProcess,
  type StartedRuntimePreviewCliProcess,
} from '../shared/runtime-preview-cli-process';

interface Arguments {
  repoRoot: string;
  projectRoot: string;
  evidenceFile: string;
  screenshotDirectory: string;
}

interface Check {
  name: string;
  passed: boolean;
  detail?: unknown;
}

interface ToolResult {
  isError?: boolean;
  structuredContent?: unknown;
  content?: unknown;
}

function parseArguments(argv: string[]): Arguments {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith('--') || !value) {
      throw new Error(`Expected --name value arguments, got: ${argv.join(' ')}`);
    }
    values.set(key.slice(2), value);
  }
  const required = (name: string): string => {
    const value = values.get(name);
    if (!value) {
      throw new Error(`Missing required argument: --${name}`);
    }
    return resolve(value);
  };
  return {
    repoRoot: required('repo'),
    projectRoot: required('project'),
    evidenceFile: required('evidence'),
    screenshotDirectory: required('screenshots'),
  };
}

function errorText(error: unknown): string {
  return error instanceof Error
    ? error.stack || error.message || error.name || String(error)
    : String(error);
}

async function findAvailablePort(startPort: number): Promise<number> {
  for (let offset = 0; offset < 50; offset += 1) {
    const port = startPort + offset;
    if (await canListen(port)) {
      return port;
    }
  }
  throw new Error(`No available port from ${startPort}.`);
}

async function findBrowserExecutable(): Promise<string> {
  const candidates = [
    process.env.COCOS_CLI_TEST_BROWSER,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files/Google/Chrome Dev/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  ].filter((value): value is string => Boolean(value));
  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Try the next installed Chromium browser.
    }
  }
  throw new Error('No Chrome/Edge executable found. Set COCOS_CLI_TEST_BROWSER.');
}

async function readEngineRoot(projectRoot: string): Promise<string> {
  const packageJson = JSON.parse(
    await readFile(join(projectRoot, 'package.json'), 'utf8'),
  ) as { 'cocos-cli'?: { enginePath?: string } };
  const enginePath = packageJson['cocos-cli']?.enginePath;
  if (!enginePath) {
    throw new Error(`Project has no cocos-cli.enginePath: ${projectRoot}`);
  }
  return resolve(projectRoot, enginePath);
}

function sceneProcessPids(stdout: string): number[] {
  return Array.from(
    stdout.matchAll(/\[Scene\] startup worker pid: (\d+)/g),
    (match) => Number(match[1]),
  );
}

function count(source: string, pattern: RegExp): number {
  return source.match(pattern)?.length ?? 0;
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitForPidExit(pid: number, timeoutMs = 10_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isPidAlive(pid)) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return !isPidAlive(pid);
}

async function waitForLog(
  filePath: string,
  predicate: (source: string) => boolean,
  timeoutMs = 20_000,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  let source = '';
  while (Date.now() < deadline) {
    try {
      source = await readFile(filePath, 'utf8');
      if (predicate(source)) {
        return source;
      }
    } catch {
      // Runtime log may not have been flushed yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for runtime log condition: ${filePath}\n${source.slice(-8_000)}`);
}

async function callTool(
  client: Client,
  name: string,
  options?: Record<string, unknown>,
): Promise<ToolResult> {
  const result = await client.callTool({
    name,
    arguments: options === undefined ? {} : { options },
  }) as ToolResult;
  if (result.isError) {
    throw new Error(`MCP tool ${name} failed: ${JSON.stringify(result.structuredContent ?? result.content)}`);
  }
  return result;
}

function toolData<T>(result: ToolResult): T {
  const structured = result.structuredContent as {
    result?: { code?: number; reason?: string; data?: T };
  } | undefined;
  if (structured?.result?.code !== 200) {
    throw new Error(
      `MCP structured result failed: code=${structured?.result?.code} reason=${structured?.result?.reason}`,
    );
  }
  return structured.result.data as T;
}

async function checkBrowserSurfaces(options: {
  browser: Browser;
  origin: string;
  sceneUuid: string;
  expectedNodeName: string;
  screenshotDirectory: string;
}) {
  const context = await options.browser.newContext({
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1,
  });
  try {
    const editorErrors: string[] = [];
    const editorConsoleErrors: string[] = [];
    const editorConsole: Array<{ type: string; text: string }> = [];
    const editorBadResponses: Array<{ status: number; url: string }> = [];
    const editorFailedRequests: Array<{ error: string; url: string }> = [];
    const editorPage = await context.newPage();
    editorPage.on('pageerror', (error) => editorErrors.push(errorText(error)));
    editorPage.on('response', (response) => {
      if (response.status() >= 400) {
        editorBadResponses.push({ status: response.status(), url: response.url() });
      }
    });
    editorPage.on('requestfailed', (request) => {
      editorFailedRequests.push({
        error: request.failure()?.errorText ?? 'unknown request failure',
        url: request.url(),
      });
    });
    editorPage.on('console', (message) => {
      editorConsole.push({ type: message.type(), text: message.text() });
      if (message.type() === 'error') {
        editorConsoleErrors.push(message.text());
      }
    });
    const editorResponse = await editorPage.goto(`${options.origin}/scene-editor/`, {
      waitUntil: 'domcontentloaded',
      timeout: 60_000,
    });
    let editorBootError: string | undefined;
    try {
      await editorPage.waitForFunction(
        () => {
          const currentWindow = window as typeof window & {
            __SCENE_EDITOR_READY__?: unknown;
            __SCENE_EDITOR_ERROR__?: string;
          };
          if (currentWindow.__SCENE_EDITOR_ERROR__) {
            throw new Error(currentWindow.__SCENE_EDITOR_ERROR__);
          }
          return Boolean(currentWindow.__SCENE_EDITOR_READY__);
        },
        undefined,
        { timeout: 180_000 },
      );
    } catch (error) {
      editorBootError = errorText(error);
    }
    const editorEngineState = await editorPage.evaluate(() => {
      const engine = (window as typeof window & {
        cc?: {
          game?: { _inited?: boolean };
          director?: {
            root?: {
              pipeline?: { pipelineSceneData?: unknown } | null;
              batcher2D?: unknown;
              mainWindow?: unknown;
            } | null;
          };
        };
      }).cc;
      const root = engine?.director?.root;
      return {
        gameInited: engine?.game?._inited === true,
        hasRoot: Boolean(root),
        hasPipeline: Boolean(root?.pipeline),
        hasPipelineSceneData: Boolean(root?.pipeline?.pipelineSceneData),
        hasBatcher2D: Boolean(root?.batcher2D),
        hasMainWindow: Boolean(root?.mainWindow),
      };
    });
    if (!editorBootError) {
      await editorPage.locator('#sceneInput').fill(options.sceneUuid);
      await editorPage.locator('#btnLoad').click();
      await editorPage.waitForFunction(
        () => {
          const status = document.querySelector('#sceneStatus')?.textContent;
          return status === 'Loaded' || status === 'Failed';
        },
        undefined,
        { timeout: 60_000 },
      );
      await editorPage.evaluate(async () => {
        const currentWindow = window as typeof window & {
          refreshNodeList?: () => Promise<void>;
        };
        await currentWindow.refreshNodeList?.();
      });
    }
    const editorState = await editorPage.evaluate(() => {
      const currentWindow = window as typeof window & {
        cli?: {
          Scene?: {
            Editor?: { getCurrentEditorUuid?: () => string };
          };
        };
      };
      return {
        statusText: document.querySelector('#sceneStatus')?.textContent ?? '',
        currentEditorUuid: currentWindow.cli?.Scene?.Editor?.getCurrentEditorUuid?.() ?? '',
        nodeOptions: Array.from(document.querySelectorAll('#nodeList option'))
          .map((option) => option.textContent ?? ''),
      };
    });
    const editorBody = await editorPage.locator('body').innerText();
    const defaultSkyboxUuid = 'd032ac98-05e1-4090-88bb-eb640dcb5fc1@b47c0';
    const knownDefaultSkyboxMisses = editorBadResponses.filter(({ status, url }) => (
      status === 404
        && (
          url.endsWith(`/query-asset-info/${defaultSkyboxUuid}`)
          || new URL(url).pathname === `/d0/${defaultSkyboxUuid}.json`
        )
    ));
    const unexpectedEditorBadResponses = editorBadResponses.filter(
      (response) => !knownDefaultSkyboxMisses.includes(response),
    );
    const browserResource404Message = 'Failed to load resource: the server responded with a status of 404 (Not Found)';
    const knownDefaultSkyboxConsoleErrors = editorConsoleErrors.filter(
      (message) => message === browserResource404Message,
    );
    const unexpectedEditorConsoleErrors = editorConsoleErrors.filter(
      (message) => message !== browserResource404Message,
    );
    if (knownDefaultSkyboxConsoleErrors.length !== knownDefaultSkyboxMisses.length) {
      unexpectedEditorConsoleErrors.push(...knownDefaultSkyboxConsoleErrors);
    }
    const editorScreenshot = join(options.screenshotDirectory, 'scene-editor.png');
    await editorPage.screenshot({ path: editorScreenshot });
    await editorPage.close();

    const runtimeErrors: string[] = [];
    const runtimeConsoleErrors: string[] = [];
    const runtimeBadResponses: Array<{ status: number; url: string }> = [];
    const runtimeFailedRequests: Array<{ error: string; url: string }> = [];
    const runtimePage = await context.newPage();
    runtimePage.on('pageerror', (error) => runtimeErrors.push(errorText(error)));
    runtimePage.on('response', (response) => {
      if (response.status() >= 400) {
        runtimeBadResponses.push({ status: response.status(), url: response.url() });
      }
    });
    runtimePage.on('requestfailed', (request) => {
      runtimeFailedRequests.push({
        error: request.failure()?.errorText ?? 'unknown request failure',
        url: request.url(),
      });
    });
    runtimePage.on('console', (message) => {
      if (message.type() === 'error') {
        runtimeConsoleErrors.push(message.text());
      }
    });
    const runtimeUrl = `${options.origin}/?scene=${encodeURIComponent(options.sceneUuid)}&debug=false`;
    const runtimeResponse = await runtimePage.goto(runtimeUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 60_000,
    });
    await runtimePage.waitForFunction(
      (sceneUuid) => {
        const signal = (
          window as typeof window & { __RUNTIME_PREVIEW_READY?: { scene?: string } }
        ).__RUNTIME_PREVIEW_READY;
        return signal?.scene === sceneUuid;
      },
      options.sceneUuid,
      { timeout: 60_000 },
    );
    const runtimeReady = await runtimePage.evaluate(() => (
      window as typeof window & { __RUNTIME_PREVIEW_READY?: unknown }
    ).__RUNTIME_PREVIEW_READY);
    const canvas = await runtimePage.evaluate(() => {
      const element = document.querySelector('#GameCanvas');
      if (!(element instanceof HTMLCanvasElement)) {
        return null;
      }
      const rect = element.getBoundingClientRect();
      return {
        width: element.width,
        height: element.height,
        clientWidth: rect.width,
        clientHeight: rect.height,
      };
    });
    const runtimeScreenshot = join(options.screenshotDirectory, 'runtime-created-scene.png');
    await runtimePage.screenshot({ path: runtimeScreenshot });
    await runtimePage.close();
    return {
      editor: {
        status: editorResponse?.status() ?? 0,
        bodyLength: editorBody.length,
        bootReady: !editorBootError,
        bootError: editorBootError,
        engineState: editorEngineState,
        ...editorState,
        expectedNodePresent: editorState.nodeOptions.some(
          (name) => name.includes(options.expectedNodeName),
        ),
        consoleErrors: editorConsoleErrors,
        knownDefaultSkyboxConsoleErrors,
        unexpectedConsoleErrors: unexpectedEditorConsoleErrors,
        consoleCount: editorConsole.length,
        consoleTail: editorConsole.slice(-200),
        pageErrors: editorErrors,
        badResponses: editorBadResponses,
        knownDefaultSkyboxMisses,
        unexpectedBadResponses: unexpectedEditorBadResponses,
        failedRequests: editorFailedRequests,
        screenshot: editorScreenshot,
      },
      runtime: {
        status: runtimeResponse?.status() ?? 0,
        url: runtimeUrl,
        ready: runtimeReady,
        canvas,
        consoleErrors: runtimeConsoleErrors,
        pageErrors: runtimeErrors,
        badResponses: runtimeBadResponses,
        failedRequests: runtimeFailedRequests,
        screenshot: runtimeScreenshot,
      },
    };
  } finally {
    await context.close();
  }
}

async function waitForProcessExit(cli: StartedRuntimePreviewCliProcess, timeoutMs = 10_000) {
  if (cli.child.exitCode !== null || cli.child.signalCode !== null) {
    return { exitCode: cli.child.exitCode, signal: cli.child.signalCode };
  }
  return await Promise.race([
    new Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }>((resolveExit) => {
      cli.child.once('exit', (exitCode, signal) => resolveExit({ exitCode, signal }));
    }),
    new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(`CLI did not exit within ${timeoutMs}ms.`)), timeoutMs);
    }),
  ]);
}

async function main(): Promise<void> {
  const options = parseArguments(process.argv.slice(2));
  const startedAt = Date.now();
  const engineRoot = await readEngineRoot(options.projectRoot);
  const browserExecutable = await findBrowserExecutable();
  const port = await findAvailablePort(19790);
  const checks: Check[] = [];
  const evidence: Record<string, unknown> = {
    status: 'in-progress',
    generatedAt: new Date().toISOString(),
    repoRoot: options.repoRoot,
    projectRoot: options.projectRoot,
    engineRoot,
    checks,
  };
  const requireCheck = (name: string, condition: boolean, detail?: unknown): void => {
    checks.push({ name, passed: condition, detail });
    if (!condition) {
      throw new Error(`Acceptance check failed: ${name}\n${JSON.stringify(detail, null, 2)}`);
    }
  };

  await mkdir(options.screenshotDirectory, { recursive: true });
  await mkdir(dirname(options.evidenceFile), { recursive: true });
  let cli: StartedRuntimePreviewCliProcess | null = null;
  let restartCli: StartedRuntimePreviewCliProcess | null = null;
  let client: Client | null = null;
  let browser: Browser | null = null;
  try {
    cli = await startRuntimePreviewCliProcess({
      repoRoot: options.repoRoot,
      projectRoot: options.projectRoot,
      engineRoot,
      host: '127.0.0.1',
      port,
      startupTimeoutMs: 300_000,
      useRuntimeFlag: false,
      useTestEnvironment: false,
      noOpen: true,
      watchAssets: true,
    });
    evidence.command = `${cli.command} ${cli.args.join(' ')}`;
    evidence.previewUrl = cli.url;
    evidence.startupMs = cli.elapsedStartupMs;
    requireCheck('default preview has no --runtime', !cli.args.includes('--runtime'), cli.args);
    requireCheck('watch-assets enabled', cli.args.includes('--watch-assets'), cli.args);
    requireCheck(
      'one runtime server',
      count(cli.stdout, /\[runtime-preview\] server:listening/g) === 1,
      cli.stdout,
    );
    requireCheck(
      'one scene process startup',
      count(cli.stdout, /^(?:\[log\] )?Scene process start\.\r?$/gm) === 1,
      cli.stdout,
    );
    const initialScenePids = sceneProcessPids(cli.stdout);
    requireCheck(
      'one scene process pid',
      initialScenePids.length === 1 && isPidAlive(initialScenePids[0]),
      initialScenePids,
    );

    const [healthResponse, rootResponse, editorResponse] = await Promise.all([
      fetch(`${cli.url}/__runtime-preview/health`),
      fetch(`${cli.url}/`),
      fetch(`${cli.url}/scene-editor/`),
    ]);
    const health = await healthResponse.json();
    requireCheck('runtime route is live', rootResponse.status === 200, rootResponse.status);
    requireCheck('scene editor route is live', editorResponse.status === 200, editorResponse.status);
    requireCheck(
      'health roots use isolated project',
      (health as { projectRoot?: string }).projectRoot === options.projectRoot,
      health,
    );

    const rpcResponse = await fetch(`${cli.url}/rpc/i18n/translate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '["scene.ready"]',
    });
    const rpcPayload = await rpcResponse.json();
    requireCheck(
      'attached scene RPC is live on the same origin',
      rpcResponse.status === 200
        && (rpcPayload as { type?: string }).type === 'response',
      rpcPayload,
    );

    client = new Client({ name: 'unified-session-edit-acceptance', version: '1.0.0' });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${cli.url}/mcp`)));
    const tools = await client.listTools();
    const toolNames = tools.tools.map((tool) => tool.name);
    requireCheck(
      'MCP tools are live on the same origin',
      [
        'scene-create',
        'scene-open',
        'scene-create-node-by-type',
        'scene-update-node',
        'scene-query-node',
        'scene-save',
      ].every((name) => toolNames.includes(name)),
      toolNames,
    );

    const sceneBaseName = 'unified-session-acceptance-20260723';
    const sceneFile = join(options.projectRoot, 'assets', `${sceneBaseName}.scene`);
    try {
      await access(sceneFile);
      throw new Error(`Acceptance scene already exists: ${sceneFile}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }
    const createResult = await callTool(client, 'scene-create', {
      baseName: sceneBaseName,
      dbURL: 'db://assets',
      templateType: '2d',
    });
    const createdScene = toolData<{ assetUrl: string; assetUuid: string }>(createResult);
    requireCheck(
      'MCP created isolated scene',
      createdScene.assetUrl === `db://assets/${sceneBaseName}.scene`
        && Boolean(createdScene.assetUuid),
      createdScene,
    );
    await callTool(client, 'scene-open', {
      dbURLOrUUID: createdScene.assetUrl,
      includeChildren: true,
      includeComponents: true,
    });
    await callTool(client, 'scene-create-node-by-type', {
      path: '/',
      name: 'UnifiedAcceptanceNode',
      nodeType: 'Empty',
      workMode: '2d',
      position: { x: 11, y: 22, z: 0 },
    });
    const createdNode = toolData<{ path: string }>(
      await callTool(client, 'scene-query-node', {
        path: 'UnifiedAcceptanceNode',
        includeChildren: false,
        includeComponents: false,
      }),
    );
    requireCheck('MCP created node in shared scene', Boolean(createdNode.path), createdNode);

    if (!cli.logFilePath) {
      throw new Error('Runtime preview did not expose a log file path.');
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 1_500));
    await fetch(`${cli.url}/__runtime-preview/refresh`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    const logBeforeSave = await readFile(cli.logFilePath, 'utf8');

    await callTool(client, 'scene-update-node', {
      path: 'UnifiedAcceptanceNode',
      name: 'UnifiedAcceptanceNodeSaved',
      properties: {
        active: false,
        position: { x: 12, y: 34, z: 0 },
      },
    });
    const updatedNode = toolData<{
      path: string;
      properties?: { active?: boolean; position?: { x?: number; y?: number; z?: number } };
    }>(await callTool(client, 'scene-query-node', {
      path: 'UnifiedAcceptanceNodeSaved',
      includeChildren: false,
      includeComponents: false,
    }));
    requireCheck(
      'MCP updated node in shared scene',
      updatedNode.properties?.active === false
        && updatedNode.properties.position?.x === 12
        && updatedNode.properties.position?.y === 34,
      updatedNode,
    );
    await callTool(client, 'scene-save');

    const target = createdScene.assetUrl;
    const logAfterSave = await waitForLog(
      cli.logFilePath,
      (source) => source.slice(logBeforeSave.length).includes(
        `runtime-asset-save generation=1 target=${target} ok=true`,
      ) || new RegExp(
        `runtime-asset-save generation=\\d+ target=${target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} ok=true`,
      ).test(source.slice(logBeforeSave.length)),
    );
    await new Promise((resolveWait) => setTimeout(resolveWait, 1_500));
    const postSaveLog = (await readFile(cli.logFilePath, 'utf8')).slice(logBeforeSave.length);
    const saveLines = postSaveLog
      .split(/\r?\n/)
      .filter((line) => line.startsWith('runtime-asset-save ') && line.includes(`target=${target}`));
    const watchLines = postSaveLog
      .split(/\r?\n/)
      .filter((line) => line.startsWith('runtime-asset-watch events '));
    const refreshResponse = await fetch(`${cli.url}/__runtime-preview/refresh`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    const refreshResult = await refreshResponse.json() as {
      targets?: string[];
      ok?: boolean;
      dirtyEventCount?: number;
    };
    requireCheck(
      'scene save refresh executed exactly once',
      saveLines.length === 1,
      { saveLines, postSaveLog: postSaveLog.slice(-8_000) },
    );
    requireCheck(
      'AssetDB success settled watcher observations from the same save',
      watchLines.length > 0
        && !(refreshResult.targets ?? []).includes(target)
        && (refreshResult.dirtyEventCount ?? 0) === 0,
      { watchLines, refreshResult },
    );
    evidence.saveWatch = {
      saveLines,
      watchLines,
      refreshResult,
      logTail: logAfterSave.slice(-8_000),
    };

    const logBeforeExternalChange = await readFile(cli.logFilePath, 'utf8');
    const savedSceneSource = await readFile(sceneFile, 'utf8');
    await writeFile(sceneFile, `${savedSceneSource}\n`, 'utf8');
    await waitForLog(
      cli.logFilePath,
      (source) => source.slice(logBeforeExternalChange.length)
        .split(/\r?\n/)
        .some((line) => line.startsWith('runtime-asset-watch events ')
          && line.includes(`sample=${target}`)),
    );
    const externalRefreshResponse = await fetch(`${cli.url}/__runtime-preview/refresh`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    const externalRefreshResult = await externalRefreshResponse.json() as {
      targets?: string[];
      ok?: boolean;
    };
    requireCheck(
      'external file change still refreshes through watcher',
      externalRefreshResult.ok === true
        && (externalRefreshResult.targets ?? []).includes(target),
      externalRefreshResult,
    );
    evidence.externalWatch = externalRefreshResult;

    const sceneResponse = await fetch(`${cli.url}/scene/${createdScene.assetUuid}.json`);
    const serializedScene = await sceneResponse.json() as Array<Record<string, unknown>>;
    requireCheck(
      'runtime route reads MCP-saved node',
      sceneResponse.status === 200
        && serializedScene.some((entry) => entry._name === 'UnifiedAcceptanceNodeSaved'),
      { status: sceneResponse.status, records: serializedScene.length },
    );

    const editorBootModuleResponse = await fetch(`${cli.url}/static/web/scene-editor-boot.js`);
    const editorBootModuleBody = await editorBootModuleResponse.text();
    requireCheck(
      'scene editor boot module route is live',
      editorBootModuleResponse.status === 200,
      {
        status: editorBootModuleResponse.status,
        contentType: editorBootModuleResponse.headers.get('content-type'),
        body: editorBootModuleBody.slice(0, 4_000),
      },
    );

    browser = await chromium.launch({
      executablePath: browserExecutable,
      headless: true,
    });
    const browserSurfaces = await checkBrowserSurfaces({
      browser,
      origin: cli.url,
      sceneUuid: createdScene.assetUuid,
      expectedNodeName: 'UnifiedAcceptanceNodeSaved',
      screenshotDirectory: options.screenshotDirectory,
    });
    evidence.browserSurfaces = browserSurfaces;
    requireCheck(
      'scene editor opens in browser',
      browserSurfaces.editor.status === 200
        && browserSurfaces.editor.bodyLength > 0
        && browserSurfaces.editor.bootReady
        && browserSurfaces.editor.statusText === 'Loaded'
        && browserSurfaces.editor.currentEditorUuid === createdScene.assetUuid
        && browserSurfaces.editor.expectedNodePresent
        && browserSurfaces.editor.unexpectedConsoleErrors.length === 0
        && browserSurfaces.editor.pageErrors.length === 0
        && browserSurfaces.editor.unexpectedBadResponses.length === 0
        && browserSurfaces.editor.failedRequests.length === 0,
      browserSurfaces.editor,
    );
    requireCheck(
      'runtime browser opens MCP-saved scene',
      browserSurfaces.runtime.status === 200
        && (browserSurfaces.runtime.ready as { scene?: string })?.scene === createdScene.assetUuid
        && Boolean(browserSurfaces.runtime.canvas)
        && browserSurfaces.runtime.consoleErrors.length === 0
        && browserSurfaces.runtime.pageErrors.length === 0
        && browserSurfaces.runtime.badResponses.length === 0
        && browserSurfaces.runtime.failedRequests.length === 0,
      browserSurfaces.runtime,
    );

    const finalScenePids = sceneProcessPids(cli.stdout);
    requireCheck(
      'MCP and browser work did not start another scene process',
      finalScenePids.length === 1 && finalScenePids[0] === initialScenePids[0],
      {
        initialScenePids,
        finalScenePids,
        sceneProcessStarts: count(cli.stdout, /^(?:\[log\] )?Scene process start\.\r?$/gm),
      },
    );
    evidence.firstSession = {
      scenePid: initialScenePids[0],
      createdScene,
      stdoutTail: cli.stdout.slice(-12_000),
      stderrTail: cli.stderr.slice(-4_000),
    };

    await client.close();
    client = null;
    await browser.close();
    browser = null;
    const firstScenePid = initialScenePids[0];
    const termResult = await cli.close();
    cli = null;
    const termSceneReleased = await waitForPidExit(firstScenePid);
    requireCheck(
      'SIGTERM releases server and scene process',
      termResult.portReleased && termSceneReleased,
      { termResult, firstScenePid, termSceneReleased },
    );
    evidence.sigterm = { ...termResult, scenePid: firstScenePid, sceneReleased: termSceneReleased };

    restartCli = await startRuntimePreviewCliProcess({
      repoRoot: options.repoRoot,
      projectRoot: options.projectRoot,
      engineRoot,
      host: '127.0.0.1',
      port,
      startupTimeoutMs: 300_000,
      useRuntimeFlag: false,
      useTestEnvironment: false,
      noOpen: true,
      watchAssets: true,
    });
    const restartPids = sceneProcessPids(restartCli.stdout);
    requireCheck(
      'same port restarts with one fresh scene process',
      restartPids.length === 1
        && restartPids[0] !== firstScenePid
        && count(restartCli.stdout, /\[runtime-preview\] server:listening/g) === 1,
      { restartPids, firstScenePid, stdout: restartCli.stdout },
    );
    const sigintSent = restartCli.child.kill('SIGINT');
    const sigintExit = await waitForProcessExit(restartCli);
    const sigintClose = await restartCli.close();
    const sigintSceneReleased = await waitForPidExit(restartPids[0]);
    restartCli = null;
    requireCheck(
      'SIGINT releases server and scene process',
      sigintSent && sigintClose.portReleased && sigintSceneReleased,
      {
        sigintSent,
        sigintExit,
        sigintClose,
        scenePid: restartPids[0],
        sigintSceneReleased,
      },
    );
    evidence.sigint = {
      sent: sigintSent,
      exit: sigintExit,
      close: sigintClose,
      scenePid: restartPids[0],
      sceneReleased: sigintSceneReleased,
    };

    evidence.status = 'pass';
  } catch (error) {
    evidence.status = 'fail';
    evidence.error = errorText(error);
    if (cli) {
      evidence.failureCliOutput = {
        stdoutTail: cli.stdout.slice(-16_000),
        stderrTail: cli.stderr.slice(-8_000),
      };
    }
    process.exitCode = 1;
  } finally {
    await client?.close().catch(() => undefined);
    await browser?.close().catch(() => undefined);
    if (cli) {
      evidence.unplannedFirstClose = await cli.close().catch((error) => ({
        error: errorText(error),
      }));
    }
    if (restartCli) {
      evidence.unplannedRestartClose = await restartCli.close().catch((error) => ({
        error: errorText(error),
      }));
    }
    evidence.elapsedMs = Date.now() - startedAt;
    evidence.completedAt = new Date().toISOString();
    await writeFile(options.evidenceFile, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
    console.log(JSON.stringify({
      status: evidence.status,
      evidence: options.evidenceFile,
      passedChecks: checks.filter((check) => check.passed).length,
      failedChecks: checks.filter((check) => !check.passed).length,
      error: evidence.error,
    }, null, 2));
  }
}

void main().catch((error) => {
  console.error(errorText(error));
  process.exitCode = 1;
});
