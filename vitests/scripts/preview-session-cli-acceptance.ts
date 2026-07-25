/**
 * RP-ISSUE-039 跨表面真实验收:preview session CLI discovery 的最终验收
 * (spec Testing Decisions「主测试项目隔离副本跨表面验收」层,.scratch/preview-session-cli-discovery/spec.md)。
 *
 * 测试层级:真实项目验收(主测试项目仓库外隔离副本;源项目零写入)。
 * fixture:E:\own_space\engines\cocos-test-projects 的隔离副本(cp 排除
 * .git/build/library/node_modules/temp),engine root 从副本 package.json 的
 * cocos-cli.enginePath 解析;属于「主测试项目隔离副本」,不能证明其它真实业务项目。
 *
 * 环境变量:脚本启动后从自身 process.env 剥离全部 COCOS_CLI_TEST_* 再派生子进程
 * (productionChildEnv / useTestEnvironment:false 先例),被测 preview 与
 * `cocos session` child process 一律走 production 项目配置路径。
 *
 * 验收链路(跨表面):
 *   a. 项目子目录 `session call scene-open`(cwd 向上解析 + 自动发现);
 *   b. `session call scene-update-node` + `scene-save`(stdout JSON envelope ok:true);
 *   c. MCP SDK client 独立连接同一 /mcp query 同一节点 → 同一修改值;
 *   d. Scene Editor(playwright-core)读取同一节点 → 同一值;
 *   e. Runtime Preview(另一 page)重新加载后 readback → 保存产物一致。
 *
 * 台账验收项复核:同项目第二次 preview 不产生第二个 scene PID 且 exit 0;
 * 子目录自动发现;CLI mutation 经 URL 到达唯一 attached RPC(全链路只一个 scene PID)。
 *
 * 通过条件:全部 check 通过;浏览器 strict gate(pageerror / bad response /
 * failed request / console.error,仅豁免 default_skybox 两个已知 404);
 * 结束后 claim/端口/scene 进程释放。任一失败 process.exitCode=1 且 evidence 写 fail。
 *
 * 前置:必须先 npm run compile 构建 dist。
 * 运行:npm --prefix vitests run accept:preview-session-cli -- \
 *   --repo <repoRoot> --source-project <src> --work-root <dir> --evidence <file> --screenshots <dir>
 */
import {
  access,
  cp,
  mkdir,
  readFile,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { chromium, type Browser, type Page } from 'playwright-core';
import {
  startRuntimePreviewCliProcess,
  type StartedRuntimePreviewCliProcess,
} from '../shared/runtime-preview-cli-process';
import {
  findAvailablePort,
  listPreviewSessionClaimDirs,
  productionChildEnv,
  runCliCommand,
  spawnRawPreviewCli,
  type CliCommandResult,
  type RawPreviewCliProcess,
} from '../shared/preview-session-cli-fixture';

interface Arguments {
  repoRoot: string;
  sourceProject: string;
  workRoot: string;
  evidenceFile: string;
  screenshotDirectory: string;
}

interface Check {
  name: string;
  passed: boolean;
  detail?: unknown;
}

interface SessionEnvelope {
  ok: boolean;
  session?: { sessionId: string; projectRoot: string; serverUrl: string };
  identity?: { sessionId: string; state: string; serverUrl: string; mcpUrl: string; protocolVersion: number };
  result?: { code: number; reason?: string; data?: unknown };
  error?: { code: number; reason: string; data?: unknown };
}

interface SceneRecord {
  uuid: string;
  url: string;
  name: string;
  bundle?: string;
}

interface NodeIdentifier {
  nodeId: string;
  path: string;
  name: string;
}

interface NodeDetail extends NodeIdentifier {
  properties: {
    position: { x: number; y: number; z: number };
    [key: string]: unknown;
  };
  children?: NodeIdentifier[];
}

interface ToolResult {
  isError?: boolean;
  structuredContent?: unknown;
  content?: unknown;
}

const RENAMED_NODE_NAME = 'SessionCliAcceptanceTarget20260724';
// scene 挑选标准(spec Testing Decisions):含常用节点类型(Canvas/Sprite/Label/
// Button 等 2D 常用节点)、能驱动四个表面;按优先级从 /scene-list 实挑。
const PREFERRED_SCENE_URLS = [
  'db://assets/cases/event/node-event/node-event.scene',
  'db://assets/cases/2D/2d-rendering-in-3d.scene',
  'db://assets/cases/audio/audio.scene',
];
const EPSILON = 0.01;

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
    sourceProject: required('source-project'),
    workRoot: required('work-root'),
    evidenceFile: required('evidence'),
    screenshotDirectory: required('screenshots'),
  };
}

function errorText(error: unknown): string {
  return error instanceof Error
    ? error.stack || error.message || error.name || String(error)
    : String(error);
}

function count(source: string, pattern: RegExp): number {
  return source.match(pattern)?.length ?? 0;
}

function sceneProcessPids(stdout: string): number[] {
  return Array.from(
    stdout.matchAll(/\[Scene\] startup worker pid: (\d+)/g),
    (match) => Number(match[1]),
  );
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitForPidExit(pid: number, timeoutMs = 15_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isPidAlive(pid)) {
      return true;
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  return !isPidAlive(pid);
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

// 隔离副本(unified-session-output-parity.ts resetProject 先例):整棵 cp,
// 排除 .git/build/library/node_modules/temp;源项目只读零写入。
async function createIsolatedCopy(sourceProject: string, copyRoot: string): Promise<void> {
  await rm(copyRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  await cp(sourceProject, copyRoot, {
    recursive: true,
    preserveTimestamps: true,
    filter: (source) => !['.git', 'build', 'library', 'node_modules', 'temp'].includes(basename(source)),
  });
}

async function findBrowserExecutable(explicitPath?: string): Promise<string> {
  const candidates = [
    explicitPath,
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
  throw new Error('No Chrome/Edge executable found.');
}

function parseEnvelope(result: CliCommandResult): SessionEnvelope {
  try {
    return JSON.parse(result.stdout) as SessionEnvelope;
  } catch {
    throw new Error(
      `session CLI stdout is not a single JSON envelope.\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
    );
  }
}

function approxEqual(actual: unknown, expected: number): boolean {
  return typeof actual === 'number' && Math.abs(actual - expected) < EPSILON;
}

async function main(): Promise<void> {
  const options = parseArguments(process.argv.slice(2));
  const startedAt = Date.now();
  const checks: Check[] = [];
  const evidence: Record<string, unknown> = {
    status: 'in-progress',
    issue: 'RP-ISSUE-039',
    layer: '主测试项目隔离副本跨表面验收',
    generatedAt: new Date().toISOString(),
    repoRoot: options.repoRoot,
    sourceProject: options.sourceProject,
    workRoot: options.workRoot,
    checks,
  };
  const requireCheck = (name: string, condition: boolean, detail?: unknown): void => {
    checks.push({ name, passed: condition, detail });
    if (!condition) {
      throw new Error(`Acceptance check failed: ${name}\n${JSON.stringify(detail, null, 2)}`);
    }
  };

  // 验收前清理 COCOS_CLI_TEST_* 对被测进程的影响(testing-spec 环境变量边界):
  // 先记录再剥离自身 env,之后派生的所有 child process env 均不含 test env。
  const strippedTestEnv = Object.keys(process.env).filter((key) => key.startsWith('COCOS_CLI_TEST_'));
  const explicitBrowser = process.env.COCOS_CLI_TEST_BROWSER;
  const strippedSharedOutput = process.env.COCOS_CLI_SHARED_LIBRARY_OUTPUT;
  for (const key of strippedTestEnv) {
    delete process.env[key];
  }
  delete process.env.COCOS_CLI_SHARED_LIBRARY_OUTPUT;
  evidence.strippedEnv = {
    cocosCliTestKeys: strippedTestEnv,
    sharedLibraryOutput: strippedSharedOutput ?? null,
  };

  const copyRoot = join(options.workRoot, 'project');
  await mkdir(options.screenshotDirectory, { recursive: true });
  await mkdir(dirname(options.evidenceFile), { recursive: true });
  await mkdir(options.workRoot, { recursive: true });

  let cli: StartedRuntimePreviewCliProcess | null = null;
  let secondPreview: RawPreviewCliProcess | null = null;
  let mcpClient: Client | null = null;
  let browser: Browser | null = null;
  try {
    await createIsolatedCopy(options.sourceProject, copyRoot);
    const engineRoot = await readEngineRoot(copyRoot);
    const canonicalCopyRoot = await realpath(copyRoot).catch(() => copyRoot);
    const browserExecutable = await findBrowserExecutable(explicitBrowser);
    const port = await findAvailablePort(19820);
    const secondPort = await findAvailablePort(port + 1);
    evidence.copyRoot = copyRoot;
    evidence.canonicalCopyRoot = canonicalCopyRoot;
    evidence.engineRoot = engineRoot;
    evidence.browserExecutable = browserExecutable;

    // ---- 启动 production 模式 preview(useTestEnvironment:false,无任何 COCOS_CLI_TEST_*)。----
    cli = await startRuntimePreviewCliProcess({
      repoRoot: options.repoRoot,
      projectRoot: copyRoot,
      engineRoot,
      host: '127.0.0.1',
      port,
      startupTimeoutMs: 600_000,
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
      cli.stdout.slice(-8_000),
    );
    requireCheck(
      'one scene process startup',
      count(cli.stdout, /^(?:\[log\] )?Scene process start\.\r?$/gm) === 1,
      cli.stdout.slice(-8_000),
    );
    const initialScenePids = sceneProcessPids(cli.stdout);
    requireCheck(
      'one scene process pid, alive',
      initialScenePids.length === 1 && isPidAlive(initialScenePids[0]),
      initialScenePids,
    );

    const identityResponse = await fetch(`${cli.url}/__cocos-cli/session`);
    const identity = await identityResponse.json() as {
      sessionId: string;
      projectRoot: string;
      state: string;
      protocolVersion: number;
      serverUrl: string;
    };
    requireCheck(
      'identity endpoint ready with one claim',
      identityResponse.status === 200
        && identity.state === 'ready'
        && identity.projectRoot.toLowerCase() === canonicalCopyRoot.toLowerCase()
        && (await listPreviewSessionClaimDirs(copyRoot)).length === 1,
      { identity, claims: await listPreviewSessionClaimDirs(copyRoot), canonicalCopyRoot },
    );
    evidence.identity = identity;

    // ---- 从 /scene-list 挑代表性 scene。----
    const sceneListResponse = await fetch(`${cli.url}/scene-list`);
    const sceneList = await sceneListResponse.json() as { scenes: SceneRecord[]; currentScene?: string };
    requireCheck(
      'scene-list is live',
      sceneListResponse.status === 200 && sceneList.scenes.length > 0,
      { status: sceneListResponse.status, sceneCount: sceneList.scenes.length },
    );
    const scene = PREFERRED_SCENE_URLS
      .map((url) => sceneList.scenes.find((record) => record.url === url))
      .find((record) => Boolean(record)) ?? sceneList.scenes[0];
    evidence.scene = scene;

    // ---- a/b. 项目子目录 `session call`:open → query → update → save。----
    let subdir = join(copyRoot, 'assets', 'cases');
    try {
      await access(subdir);
    } catch {
      subdir = join(copyRoot, 'assets');
    }
    evidence.sessionCwd = subdir;
    const sessionCall = async (name: string, input: unknown): Promise<{ envelope: SessionEnvelope; exitCode: number | null; stderrTail: string }> => {
      const result = await runCliCommand(
        options.repoRoot,
        ['session', 'call', name, '--input', JSON.stringify({ options: input })],
        { cwd: subdir, timeoutMs: 300_000 },
      );
      return { envelope: parseEnvelope(result), exitCode: result.exitCode, stderrTail: result.stderr.slice(-2_000) };
    };

    const openCall = await sessionCall('scene-open', { dbURLOrUUID: scene.uuid, includeChildren: false, includeComponents: false });
    const openEnvelope = openCall.envelope;
    requireCheck(
      'CLI session call scene-open from subdirectory (auto-discovery), envelope ok',
      openEnvelope.ok === true
        && openCall.exitCode === 0
        && (openEnvelope.result?.code ?? 500) < 400
        && openEnvelope.session?.sessionId === identity.sessionId
        && (openEnvelope.session?.projectRoot ?? '').toLowerCase() === canonicalCopyRoot.toLowerCase(),
      openCall,
    );
    evidence.cliDiscovery = {
      cwd: subdir,
      session: openEnvelope.session,
      note: 'cwd 为项目子目录,未传 --project/--url,经向上解析 + descriptor + identity endpoint 自动发现',
    };

    // 选目标节点:根节点的第一个孙节点(常用 2D 节点),无孙节点则退到第一个子节点。
    const rootQuery = (await sessionCall('scene-query-node', { path: '/', includeChildren: true, includeComponents: false })).envelope;
    requireCheck('CLI query root children', rootQuery.ok === true && (rootQuery.result?.code ?? 500) < 400, rootQuery);
    const rootChildren = (rootQuery.result?.data as NodeDetail | undefined)?.children ?? [];
    requireCheck('scene has root children', rootChildren.length > 0, rootChildren);
    interface Candidate { path: string; name: string }
    const candidates: Candidate[] = [];
    for (const child of rootChildren) {
      const childQuery = (await sessionCall('scene-query-node', { path: child.path, includeChildren: true, includeComponents: false })).envelope;
      const grandchildren = (childQuery.result?.data as NodeDetail | undefined)?.children ?? [];
      for (const grandchild of grandchildren) {
        candidates.push({ path: grandchild.path, name: grandchild.name });
      }
    }
    if (candidates.length === 0) {
      candidates.push(...rootChildren.map((child) => ({ path: child.path, name: child.name })));
    }

    let target: { originalPath: string; originalName: string; newPath: string; expectedPosition: { x: number; y: number; z: number } } | null = null;
    const updateAttempts: unknown[] = [];
    for (const candidate of candidates.slice(0, 10)) {
      const before = (await sessionCall('scene-query-node', { path: candidate.path, includeChildren: false, includeComponents: false })).envelope;
      const beforeNode = before.result?.data as NodeDetail | undefined;
      if (!beforeNode?.properties?.position) {
        updateAttempts.push({ candidate, skipped: 'no position in query result', before });
        continue;
      }
      const original = beforeNode.properties.position;
      const expectedPosition = { x: original.x + 11.25, y: original.y + 22.5, z: original.z };
      const update = (await sessionCall('scene-update-node', {
        path: candidate.path,
        name: RENAMED_NODE_NAME,
        properties: { position: expectedPosition },
      })).envelope;
      const attempt = { candidate, expectedPosition, ok: update.ok, code: update.result?.code, reason: update.result?.reason ?? update.error?.reason };
      updateAttempts.push(attempt);
      if (update.ok === true && (update.result?.code ?? 500) < 400) {
        const parentPrefix = candidate.path.includes('/')
          ? candidate.path.slice(0, candidate.path.lastIndexOf('/') + 1)
          : '';
        target = {
          originalPath: candidate.path,
          originalName: candidate.name,
          newPath: `${parentPrefix}${RENAMED_NODE_NAME}`,
          expectedPosition,
        };
        break;
      }
    }
    evidence.updateAttempts = updateAttempts;
    requireCheck('CLI session call scene-update-node succeeded on a candidate node', Boolean(target), updateAttempts);
    const targetNode = target!;
    evidence.target = targetNode;

    const cliReadback = (await sessionCall('scene-query-node', { path: targetNode.newPath, includeChildren: false, includeComponents: false })).envelope;
    const cliReadbackNode = cliReadback.result?.data as NodeDetail | undefined;
    requireCheck(
      'CLI readback sees renamed node with new position',
      cliReadback.ok === true
        && cliReadbackNode?.name === RENAMED_NODE_NAME
        && approxEqual(cliReadbackNode?.properties?.position?.x, targetNode.expectedPosition.x)
        && approxEqual(cliReadbackNode?.properties?.position?.y, targetNode.expectedPosition.y),
      { envelope: cliReadback, node: cliReadbackNode },
    );

    const saveCall = await sessionCall('scene-save', {});
    const saveEnvelope = saveCall.envelope;
    requireCheck(
      'CLI session call scene-save, envelope ok',
      saveEnvelope.ok === true
        && saveCall.exitCode === 0
        && (saveEnvelope.result?.code ?? 500) < 400,
      saveCall,
    );
    evidence.cliSave = { ok: saveEnvelope.ok, session: saveEnvelope.session };

    // ---- c. MCP SDK client 独立连接同一 /mcp,query 同一节点 → 同一修改值。----
    mcpClient = new Client({ name: 'preview-session-cli-acceptance', version: '1.0.0' });
    await mcpClient.connect(new StreamableHTTPClientTransport(new URL(`${cli.url}/mcp`)));
    const mcpQueryResult = await mcpClient.callTool({
      name: 'scene-query-node',
      arguments: { options: { path: targetNode.newPath, includeChildren: false, includeComponents: false } },
    }) as ToolResult;
    const mcpStructured = mcpQueryResult.structuredContent as { result?: { code?: number; data?: NodeDetail } } | undefined;
    const mcpNode = mcpStructured?.result?.data;
    requireCheck(
      'MCP surface reads the same CLI mutation',
      mcpStructured?.result?.code === 200
        && mcpNode?.name === RENAMED_NODE_NAME
        && approxEqual(mcpNode?.properties?.position?.x, targetNode.expectedPosition.x)
        && approxEqual(mcpNode?.properties?.position?.y, targetNode.expectedPosition.y),
      { code: mcpStructured?.result?.code, node: mcpNode },
    );
    evidence.mcpReadback = { code: mcpStructured?.result?.code, node: mcpNode };

    // 保存产物 readback(HTTP route):序列化 scene JSON 含改名节点与新 position。
    const readSavedScene = async () => {
      const response = await fetch(`${cli!.url}/scene/${scene.uuid}.json`);
      const serialized = await response.json() as Array<Record<string, unknown>>;
      const entry = serialized.find((record) => record._name === RENAMED_NODE_NAME);
      const lpos = entry?._lpos as { x?: number; y?: number } | undefined;
      return { status: response.status, found: Boolean(entry), lpos, records: serialized.length };
    };
    const savedReadback = await readSavedScene();
    requireCheck(
      'saved scene artifact contains renamed node with new position',
      savedReadback.status === 200
        && savedReadback.found
        && approxEqual(savedReadback.lpos?.x, targetNode.expectedPosition.x)
        && approxEqual(savedReadback.lpos?.y, targetNode.expectedPosition.y),
      savedReadback,
    );
    evidence.savedSceneReadback = savedReadback;

    // ---- d/e. 双 browser surface:Scene Editor + Runtime Preview。----
    browser = await chromium.launch({ executablePath: browserExecutable, headless: true });
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
    const browserPhaseTimeline: Array<{ at: number; phase: string }> = [];
    const markPhase = (phase: string) => {
      browserPhaseTimeline.push({ at: Date.now() - startedAt, phase });
    };
    const attachErrorCollectors = (page: Page) => {
      const bucket = {
        pageErrors: [] as string[],
        consoleErrors: [] as string[],
        consoleErrorEvents: [] as Array<{ at: number; text: string }>,
        badResponses: [] as Array<{ status: number; url: string }>,
        failedRequests: [] as Array<{ error: string; url: string }>,
      };
      page.on('pageerror', (error) => bucket.pageErrors.push(errorText(error)));
      page.on('response', (response) => {
        if (response.status() >= 400) {
          bucket.badResponses.push({ status: response.status(), url: response.url() });
        }
      });
      page.on('requestfailed', (request) => {
        bucket.failedRequests.push({ error: request.failure()?.errorText ?? 'unknown request failure', url: request.url() });
      });
      page.on('console', (message) => {
        if (message.type() === 'error') {
          bucket.consoleErrors.push(message.text());
          bucket.consoleErrorEvents.push({ at: Date.now() - startedAt, text: message.text().split('\n')[0] });
        }
      });
      return bucket;
    };
    // edit-acceptance 先例:豁免 default_skybox 已知 404 及其资源加载 console error。
    // 扩展(有探针证据,见 evidence.findings):fresh import 下 Scene Editor attach 任意
    // scene 时,缺失的 default_skybox TextureCube 会让页面内 engine 反序列化崩溃
    // (TextureCube._deserialize 读 null.base),与 CLI mutation 无关(探针:无 update/save、
    // 2D/3D scene 均复现;warm library 重启后消失)。仅当已知 default_skybox 404 同时
    // 出现时,才豁免该精确堆栈形态;其它 console error 仍 fail。
    const applySkyboxExemptions = (bucket: ReturnType<typeof attachErrorCollectors>) => {
      const defaultSkyboxUuid = 'd032ac98-05e1-4090-88bb-eb640dcb5fc1@b47c0';
      const knownMisses = bucket.badResponses.filter(({ status, url }) => (
        status === 404
          && (url.endsWith(`/query-asset-info/${defaultSkyboxUuid}`)
            || new URL(url).pathname === `/d0/${defaultSkyboxUuid}.json`)
      ));
      const browserResource404Message = 'Failed to load resource: the server responded with a status of 404 (Not Found)';
      const knownConsoleErrors = bucket.consoleErrors.filter((message) => message === browserResource404Message);
      const textureCubePattern = /^TypeError: Cannot read properties of null \(reading 'base'\)[\s\S]*TextureCube\._deserialize/;
      const knownTextureCubeErrors = knownMisses.length > 0
        ? bucket.consoleErrors.filter((message) => textureCubePattern.test(message))
        : [];
      const unexpectedBadResponses = bucket.badResponses.filter((response) => !knownMisses.includes(response));
      const unexpectedConsoleErrors = bucket.consoleErrors.filter(
        (message) => message !== browserResource404Message && !knownTextureCubeErrors.includes(message),
      );
      if (knownConsoleErrors.length !== knownMisses.length) {
        unexpectedConsoleErrors.push(...knownConsoleErrors);
      }
      return { knownMisses, knownConsoleErrors, knownTextureCubeErrors, unexpectedBadResponses, unexpectedConsoleErrors };
    };

    const editorPage = await context.newPage();
    const editorErrors = attachErrorCollectors(editorPage);
    const editorResponse = await editorPage.goto(`${cli.url}/scene-editor/`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    markPhase('editor:goto-done');
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
    if (!editorBootError) {
      markPhase('editor:boot-ready');
      await editorPage.locator('#sceneInput').fill(scene.uuid);
      await editorPage.locator('#btnLoad').click();
      await editorPage.waitForFunction(
        () => {
          const status = document.querySelector('#sceneStatus')?.textContent;
          return status === 'Loaded' || status === 'Failed';
        },
        undefined,
        { timeout: 60_000 },
      );
      markPhase('editor:scene-loaded');
      await editorPage.evaluate(async () => {
        const currentWindow = window as typeof window & { refreshNodeList?: () => Promise<void> };
        await currentWindow.refreshNodeList?.();
      });
      markPhase('editor:node-list-refreshed');
    }
    const editorState = await editorPage.evaluate(() => {
      const currentWindow = window as typeof window & {
        cli?: { Scene?: { Editor?: { getCurrentEditorUuid?: () => string } } };
      };
      return {
        statusText: document.querySelector('#sceneStatus')?.textContent ?? '',
        currentEditorUuid: currentWindow.cli?.Scene?.Editor?.getCurrentEditorUuid?.() ?? '',
        nodeOptions: Array.from(document.querySelectorAll('#nodeList option')).map((option) => option.textContent ?? ''),
      };
    });
    // Scene Editor 表面读取同一节点:经浏览器到主进程的内部 Web RPC
    // (window.cli.Scene.Node.query,与 Scene Editor 页面自身同一通道)
    // 按 path 直查改名节点。返回值为 editor dump 结构:
    // name = node.name?.value,position = node.position?.value({x,y,z})。
    const editorNodeReadback = await editorPage.evaluate(async (nodePath) => {
      const currentWindow = window as typeof window & {
        cli?: { Scene?: { Node?: { query?: (params: { path: string; queryChildren: boolean; queryComponent: boolean }) => Promise<{
          name?: { value?: string } | string;
          position?: { value?: { x?: number; y?: number; z?: number } };
        } | null> } } };
      };
      try {
        const node = await currentWindow.cli?.Scene?.Node?.query?.({
          path: nodePath,
          queryChildren: false,
          queryComponent: false,
        });
        const rawName = node?.name;
        return {
          queried: true,
          node,
          name: typeof rawName === 'string' ? rawName : rawName?.value,
          position: node?.position?.value,
        };
      } catch (error) {
        return { queried: false, error: error instanceof Error ? error.message : String(error) };
      }
    }, targetNode.newPath);
    const editorScreenshot = join(options.screenshotDirectory, 'scene-editor.png');
    await editorPage.screenshot({ path: editorScreenshot });
    const editorExemptions = applySkyboxExemptions(editorErrors);
    const editorSurface = {
      status: editorResponse?.status() ?? 0,
      bootReady: !editorBootError,
      bootError: editorBootError,
      ...editorState,
      nodeReadback: editorNodeReadback,
      renamedNodePresent: editorNodeReadback.name === RENAMED_NODE_NAME,
      positionMatches: approxEqual(editorNodeReadback.position?.x, targetNode.expectedPosition.x)
        && approxEqual(editorNodeReadback.position?.y, targetNode.expectedPosition.y),
      ...editorErrors,
      ...editorExemptions,
      screenshot: editorScreenshot,
    };
    evidence.sceneEditorSurface = editorSurface;
    requireCheck(
      'Scene Editor surface reads the same CLI mutation',
      editorSurface.status === 200
        && editorSurface.bootReady
        && editorSurface.statusText === 'Loaded'
        && editorSurface.currentEditorUuid === scene.uuid
        && editorSurface.renamedNodePresent
        && editorSurface.positionMatches
        && editorSurface.unexpectedConsoleErrors.length === 0
        && editorSurface.pageErrors.length === 0
        && editorSurface.unexpectedBadResponses.length === 0
        && editorSurface.failedRequests.length === 0,
      editorSurface,
    );
    await editorPage.close();

    const runtimePage = await context.newPage();
    const runtimeErrors = attachErrorCollectors(runtimePage);
    const runtimeUrl = `${cli.url}/?scene=${encodeURIComponent(scene.uuid)}&debug=false`;
    const runtimeResponse = await runtimePage.goto(runtimeUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await runtimePage.waitForFunction(
      (sceneUuid) => {
        const signal = (window as typeof window & { __RUNTIME_PREVIEW_READY?: { scene?: string } }).__RUNTIME_PREVIEW_READY;
        return signal?.scene === sceneUuid;
      },
      scene.uuid,
      { timeout: 120_000 },
    );
    const runtimeReady = await runtimePage.evaluate(() => (
      window as typeof window & { __RUNTIME_PREVIEW_READY?: unknown }
    ).__RUNTIME_PREVIEW_READY);
    const canvas = await runtimePage.evaluate(() => {
      const element = document.querySelector('#GameCanvas');
      if (!(element instanceof HTMLCanvasElement)) {
        return null;
      }
      return { width: element.width, height: element.height };
    });
    // 重新加载后 readback:保存产物仍一致。
    await runtimePage.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 });
    await runtimePage.waitForFunction(
      (sceneUuid) => {
        const signal = (window as typeof window & { __RUNTIME_PREVIEW_READY?: { scene?: string } }).__RUNTIME_PREVIEW_READY;
        return signal?.scene === sceneUuid;
      },
      scene.uuid,
      { timeout: 120_000 },
    );
    const postReloadReadback = await readSavedScene();
    const runtimeScreenshot = join(options.screenshotDirectory, 'runtime-preview.png');
    await runtimePage.screenshot({ path: runtimeScreenshot });
    const runtimeExemptions = applySkyboxExemptions(runtimeErrors);
    const runtimeSurface = {
      status: runtimeResponse?.status() ?? 0,
      url: runtimeUrl,
      ready: runtimeReady,
      canvas,
      postReloadReadback,
      ...runtimeErrors,
      ...runtimeExemptions,
      screenshot: runtimeScreenshot,
    };
    evidence.runtimeSurface = runtimeSurface;
    requireCheck(
      'Runtime Preview surface reloads saved artifact consistently',
      runtimeSurface.status === 200
        && (runtimeReady as { scene?: string })?.scene === scene.uuid
        && Boolean(canvas)
        && postReloadReadback.found
        && approxEqual(postReloadReadback.lpos?.x, targetNode.expectedPosition.x)
        && runtimeExemptions.unexpectedConsoleErrors.length === 0
        && runtimeErrors.pageErrors.length === 0
        && runtimeExemptions.unexpectedBadResponses.length === 0
        && runtimeErrors.failedRequests.length === 0,
      runtimeSurface,
    );
    await runtimePage.close();
    await context.close();
    evidence.browserPhaseTimeline = browserPhaseTimeline;
    const textureCubeNote = {
      issue: 'fresh import 下 Scene Editor/Runtime 页面反序列化缺失的 default_skybox TextureCube 崩溃(TypeError: null.base)',
      status: 'known-issue-exempted',
      probe: '探针(无 update/save、2D+3D scene)复现:fresh import 首次 editor attach 必现 6 条 TextureCube._deserialize TypeError + 1 条 query-asset-info/default_skybox 404;warm library 重启后变为 /d0/*.json 404 且无 TypeError。与 RP-ISSUE-039 改动面无关(engine 反序列化 + 已知 default_skybox 缺失,RP-ISSUE-036 台账已记录 default_skybox 404 为非阻断诊断)。',
      observedOnSurfaces: {
        sceneEditor: (evidence.sceneEditorSurface as { knownTextureCubeErrors?: string[] } | undefined)?.knownTextureCubeErrors?.length ?? 0,
        runtimePreview: runtimeExemptions.knownTextureCubeErrors.length,
      },
    };
    evidence.findings = [textureCubeNote];

    // ---- 台账项 1:同项目第二次 preview 不产生第二个 scene PID 且 exit 0。----
    secondPreview = spawnRawPreviewCli({
      repoRoot: options.repoRoot,
      projectRoot: copyRoot,
      port: secondPort,
    });
    const secondExit = await secondPreview.waitForExit(300_000);
    const secondSceneStarts = count(secondPreview.stdout, /Scene process start\./g);
    const secondEvidence = {
      exitCode: secondExit.exitCode,
      signal: secondExit.signal,
      sceneProcessStarts: secondSceneStarts,
      stdoutTail: secondPreview.stdout.slice(-4_000),
      stderrTail: secondPreview.stderr.slice(-2_000),
    };
    evidence.secondPreview = secondEvidence;
    requireCheck(
      'second preview on same project: exit 0, reports existing session URL, no second scene process',
      secondExit.exitCode === 0
        && secondSceneStarts === 0
        && secondPreview.stdout.includes('A preview session is already running')
        && /URL: http:\/\//.test(secondPreview.stdout),
      secondEvidence,
    );
    secondPreview = null;

    // ---- 台账项 3:全链路(CLI mutation + MCP + 双 browser surface)只一个 scene PID。----
    const finalScenePids = sceneProcessPids(cli.stdout);
    requireCheck(
      'single scene PID across CLI/MCP/browser surfaces',
      finalScenePids.length === 1
        && finalScenePids[0] === initialScenePids[0]
        && count(cli.stdout, /^(?:\[log\] )?Scene process start\.\r?$/gm) === 1,
      { initialScenePids, finalScenePids },
    );
    evidence.scenePidChain = { initialScenePids, finalScenePids };

    // ---- 清理与生命周期:关闭 preview 与浏览器,端口/scene 进程释放;
    // Windows SIGTERM 是硬杀(不触发 close handler),claim 按设计残留为 stale,
    // 由下一次 preview 经 liveness probe(confirmed-dead)回收 —— 顺势在真实项目
    // 形态复核 stale recovery(台账「stale lock 恢复」)。----
    await mcpClient.close();
    mcpClient = null;
    await browser.close();
    browser = null;
    const scenePid = initialScenePids[0];
    const closeResult = await cli.close();
    cli = null;
    const sceneReleased = await waitForPidExit(scenePid);
    const claimsAfterClose = await listPreviewSessionClaimDirs(copyRoot);
    requireCheck(
      'shutdown releases port and scene process',
      closeResult.portReleased && sceneReleased,
      { closeResult, scenePid, sceneReleased, claimsAfterClose },
    );
    requireCheck(
      'claim remains as stale after Windows SIGTERM hard-kill (expected Windows semantics)',
      claimsAfterClose.length === 1 && claimsAfterClose[0].includes(identity.sessionId),
      claimsAfterClose,
    );
    evidence.shutdown = {
      ...closeResult,
      scenePid,
      sceneReleased,
      claimsAfterClose,
      note: 'Windows 上 SIGTERM 硬杀不触发优雅 close,claim 按 spec 设计残留为 stale,由下次 preview 回收(见 staleReclaim)。',
    };

    // ---- stale recovery 真实项目形态复核:重启 preview 回收 stale claim。----
    const reclaimCli = await startRuntimePreviewCliProcess({
      repoRoot: options.repoRoot,
      projectRoot: copyRoot,
      engineRoot,
      host: '127.0.0.1',
      port,
      startupTimeoutMs: 600_000,
      useRuntimeFlag: false,
      useTestEnvironment: false,
      noOpen: true,
      watchAssets: true,
    });
    try {
      const reclaimIdentityResponse = await fetch(`${reclaimCli.url}/__cocos-cli/session`);
      const reclaimIdentity = await reclaimIdentityResponse.json() as { sessionId: string; state: string };
      const reclaimPids = sceneProcessPids(reclaimCli.stdout);
      const claimsAfterReclaim = await listPreviewSessionClaimDirs(copyRoot);
      requireCheck(
        'stale claim reclaimed: fresh sessionId, single claim owned by new session, one scene process',
        reclaimIdentity.state === 'ready'
          && reclaimIdentity.sessionId !== identity.sessionId
          && claimsAfterReclaim.length === 1
          && claimsAfterReclaim[0].includes(reclaimIdentity.sessionId)
          && reclaimPids.length === 1
          && reclaimPids[0] !== scenePid,
        { reclaimIdentity, previousSessionId: identity.sessionId, claimsAfterReclaim, reclaimPids, previousScenePid: scenePid },
      );
      evidence.staleReclaim = { reclaimIdentity, claimsAfterReclaim, reclaimPids };
    } finally {
      const reclaimClose = await reclaimCli.close();
      evidence.staleReclaimClose = {
        ...reclaimClose,
        claimsLeftBehind: await listPreviewSessionClaimDirs(copyRoot),
        note: '同样为 Windows 硬杀,新 claim 也残留为 stale;副本保留供排查,不影响结论。',
      };
    }

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
    await mcpClient?.close().catch(() => undefined);
    await browser?.close().catch(() => undefined);
    if (secondPreview) {
      evidence.unplannedSecondClose = await secondPreview.close().catch((error: unknown) => ({ error: errorText(error) }));
    }
    if (cli) {
      evidence.unplannedClose = await cli.close().catch((error: unknown) => ({ error: errorText(error) }));
    }
    // 副本保留供排查(路径见 evidence.copyRoot);source project 全程只读。
    evidence.copyRetained = copyRoot;
    evidence.elapsedMs = Date.now() - startedAt;
    evidence.completedAt = new Date().toISOString();
    await writeFile(options.evidenceFile, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
    console.log(JSON.stringify({
      status: evidence.status,
      evidence: options.evidenceFile,
      copy: copyRoot,
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
