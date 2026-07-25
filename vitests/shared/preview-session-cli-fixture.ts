/**
 * Preview session ownership / `cocos session` 真实 CLI child process 集成测试的共享 helper。
 *
 * 测试层级:Vitest 集成(真实 dist/cli.js child process)。
 * fixture:tests/fixtures/projects/asset-operation 的系统 temp 隔离副本
 * (排除 library/temp,改写 cocos-cli.enginePath);属于「内置小 fixture 的临时副本」,
 * 不能证明真实业务项目行为。
 *
 * 环境变量边界:child process 默认不注入任何 COCOS_CLI_TEST_* env
 * (与 runtime-preview-cli-process.ts 的 useTestEnvironment:false 先例一致);
 * engine root 只写进副本 package.json 的 cocos-cli.enginePath。
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  cp,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  rmdir,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { canListen } from './runtime-preview-cli-process';

export interface IsolatedProjectCopy {
  tempRoot: string;
  projectRoot: string;
  cleanup: () => Promise<void>;
}

/**
 * 从 tests/fixtures/projects/<fixtureName> 建隔离副本(排除 library/temp),
 * 并把副本 package.json 的 cocos-cli.enginePath 改写为给定 engine root。
 * withSettingsDir:fixture 本身没有 settings/ 目录,而 `cocos session` 的 cwd 向上解析
 * 要求 package.json + assets/ + settings/ 三标志(project-root.ts);需要 cwd 发现的
 * 测试必须显式创建空 settings/(临时副本调整,不改 production 行为)。
 */
export async function createIsolatedProjectCopy(
  repoRoot: string,
  engineRoot: string,
  options: { fixtureName?: string; withSettingsDir?: boolean } = {},
): Promise<IsolatedProjectCopy> {
  const fixtureName = options.fixtureName ?? 'asset-operation';
  const sourceProjectRoot = join(repoRoot, 'tests', 'fixtures', 'projects', fixtureName);
  const tempRoot = await mkdtemp(join(tmpdir(), 'preview-session-cli-'));
  const projectRoot = join(tempRoot, 'project');
  await cp(sourceProjectRoot, projectRoot, {
    recursive: true,
    filter: (source) => !['library', 'temp'].includes(basename(source)),
  });
  const packageJsonPath = join(projectRoot, 'package.json');
  const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8')) as Record<string, unknown>;
  packageJson['cocos-cli'] = { enginePath: engineRoot };
  await writeFile(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`, 'utf8');
  if (options.withSettingsDir) {
    await mkdir(join(projectRoot, 'settings'), { recursive: true });
  }
  return {
    tempRoot,
    projectRoot,
    cleanup: () => rm(tempRoot, { recursive: true, force: true }),
  };
}

// child process env:剥离全部 COCOS_CLI_TEST_* 与 shared-library 开关,
// 让被测进程走 production 项目配置路径(enginePath 来自副本 package.json)。
export function productionChildEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith('COCOS_CLI_TEST_')) {
      delete env[key];
    }
  }
  delete env.COCOS_CLI_SHARED_LIBRARY_OUTPUT;
  return env;
}

export interface CliCommandResult {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
}

/**
 * 运行一次短生命周期 CLI 命令(如 `cocos session ...`)并收集 stdout/stderr/exit code。
 * 套路对齐 e2e/helpers/cli-runner.ts,但放在 Vitest 层。
 */
export function runCliCommand(
  repoRoot: string,
  args: string[],
  options: { cwd: string; timeoutMs?: number },
): Promise<CliCommandResult> {
  const timeoutMs = options.timeoutMs ?? 120_000;
  const child = spawn(process.execPath, [join(repoRoot, 'dist', 'cli.js'), ...args], {
    cwd: options.cwd,
    env: productionChildEnv(),
    stdio: 'pipe',
  });
  child.stdin.end();
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => {
    stdout += String(chunk);
  });
  child.stderr.on('data', (chunk) => {
    stderr += String(chunk);
  });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(
        `CLI command timed out after ${timeoutMs}ms: ${args.join(' ')}\nstdout:\n${stdout}\nstderr:\n${stderr}`,
      ));
    }, timeoutMs);
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('exit', (exitCode, signal) => {
      clearTimeout(timer);
      resolve({ exitCode, signal, stdout, stderr });
    });
  });
}

export interface RawPreviewCliProcess {
  child: ChildProcessWithoutNullStreams;
  args: string[];
  readonly stdout: string;
  readonly stderr: string;
  exited: boolean;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  waitForExit: (timeoutMs?: number) => Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }>;
  close: () => Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }>;
}

/**
 * 原样启动 `dist/cli.js preview`(不等 ready、不因退出 reject),
 * 供竞争/失败分支断言使用;成功路径仍优先用 startRuntimePreviewCliProcess。
 */
export function spawnRawPreviewCli(options: {
  repoRoot: string;
  projectRoot: string;
  port: number;
  host?: string;
  extraArgs?: string[];
}): RawPreviewCliProcess {
  const host = options.host ?? '127.0.0.1';
  const args = [
    join(options.repoRoot, 'dist', 'cli.js'),
    'preview',
    '--project',
    options.projectRoot,
    '--host',
    host,
    '--port',
    String(options.port),
    '--no-open',
    ...(options.extraArgs ?? []),
  ];
  const child = spawn(process.execPath, args, {
    cwd: options.repoRoot,
    env: productionChildEnv(),
    stdio: 'pipe',
  });
  child.stdin.end();
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => {
    stdout += String(chunk);
  });
  child.stderr.on('data', (chunk) => {
    stderr += String(chunk);
  });
  const state = {
    exited: false,
    exitCode: null as number | null,
    signal: null as NodeJS.Signals | null,
  };
  const exitPromise = new Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }>((resolve) => {
    child.once('exit', (exitCode, signal) => {
      state.exited = true;
      state.exitCode = exitCode;
      state.signal = signal;
      resolve({ exitCode, signal });
    });
  });
  const handle: RawPreviewCliProcess = {
    child,
    args,
    get stdout() {
      return stdout;
    },
    get stderr() {
      return stderr;
    },
    get exited() {
      return state.exited;
    },
    get exitCode() {
      return state.exitCode;
    },
    get signal() {
      return state.signal;
    },
    waitForExit: async (timeoutMs = 30_000) => {
      const result = await Promise.race([
        exitPromise,
        wait(timeoutMs).then(() => null),
      ]);
      if (!result) {
        throw new Error(
          `preview CLI did not exit within ${timeoutMs}ms.\nstdout:\n${stdout}\nstderr:\n${stderr}`,
        );
      }
      return result;
    },
    close: async () => {
      if (state.exited) {
        return { exitCode: state.exitCode, signal: state.signal };
      }
      child.kill();
      const graceful = await Promise.race([exitPromise, wait(5_000).then(() => null)]);
      if (graceful) {
        return graceful;
      }
      child.kill('SIGKILL');
      return exitPromise;
    },
  };
  return handle;
}

export function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// 轮询条件直至满足或超时;超时返回 false(调用方决定断言形态)。
export async function waitUntil(predicate: () => boolean | Promise<boolean>, timeoutMs: number, intervalMs = 200): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) {
      return true;
    }
    await wait(intervalMs);
  }
  return predicate();
}

export async function findAvailablePort(startPort: number): Promise<number> {
  for (let offset = 0; offset < 50; offset += 1) {
    const port = startPort + offset;
    if (await canListen(port)) {
      return port;
    }
  }
  throw new Error(`No available port from ${startPort}.`);
}

export const PREVIEW_READY_MARKER = '[runtime-preview] preview:ready';
export const SERVER_LISTENING_PATTERN = /\[runtime-preview\] server:listening (http:\/\/[^\s]+)/;
export const SCENE_PROCESS_START_PATTERN = /\[log\] Scene process start\./g;

export function serverUrlOf(stdout: string): string | null {
  return SERVER_LISTENING_PATTERN.exec(stdout)?.[1] ?? null;
}

// 枚举 <project>/temp/cli 下的 preview session claim 目录名。
export async function listPreviewSessionClaimDirs(projectRoot: string): Promise<string[]> {
  const cliTempDir = join(projectRoot, 'temp', 'cli');
  let entries: string[];
  try {
    entries = await readdir(cliTempDir);
  } catch {
    return [];
  }
  return entries.filter((entry) => entry.startsWith('preview-session-')).sort();
}

export interface SeededClaim {
  sessionId: string;
  claimDir: string;
}

/**
 * 手工种下 state=draining 的 claim(owner 为给定存活 PID),模拟 owner close 进行中的瞬态。
 * Windows 上 SIGTERM 是硬杀(不触发 handler),无法用信号驱动优雅 close,
 * 因此 draining 窗口用真实 claim 格式 + 存活 dummy 进程构造。
 */
export async function seedDrainingClaim(
  projectRoot: string,
  ownerPid: number,
  protocolVersion: number,
): Promise<SeededClaim> {
  const sessionId = randomUUID();
  const canonicalRoot = await realpath(projectRoot).catch(() => projectRoot);
  const claimDir = join(projectRoot, 'temp', 'cli', `preview-session-${sessionId}-${ownerPid}`);
  await mkdir(claimDir, { recursive: true });
  await writeFile(join(claimDir, 'descriptor.json'), JSON.stringify({
    sessionId,
    projectRoot: canonicalRoot,
    pid: ownerPid,
    state: 'draining',
    protocolVersion,
    startedAt: new Date().toISOString(),
  }, null, 2), 'utf8');
  return { sessionId, claimDir };
}

/**
 * 手工种下 state=ready 的 claim(owner 为给定存活 PID,serverUrl 指向给定地址),
 * 构造「PID 活但 endpoint 不可达」的 unreachable-owner-alive 形态:
 * serverUrl 传未监听端口即可让 reclaimer 的 identity 探测失败,走 terminateTree
 * + 死亡确认的真实回收路径。
 */
export async function seedReadyClaim(
  projectRoot: string,
  ownerPid: number,
  serverUrl: string,
  protocolVersion: number,
): Promise<SeededClaim> {
  const sessionId = randomUUID();
  const canonicalRoot = await realpath(projectRoot).catch(() => projectRoot);
  const claimDir = join(projectRoot, 'temp', 'cli', `preview-session-${sessionId}-${ownerPid}`);
  await mkdir(claimDir, { recursive: true });
  await writeFile(join(claimDir, 'descriptor.json'), JSON.stringify({
    sessionId,
    projectRoot: canonicalRoot,
    pid: ownerPid,
    state: 'ready',
    protocolVersion,
    serverUrl,
    startedAt: new Date().toISOString(),
  }, null, 2), 'utf8');
  return { sessionId, claimDir };
}

// 模拟 owner 在 close 开始完成的 claim 释放:先删 descriptor 再 rmdir。
export async function removeClaimDirFully(claimDir: string): Promise<void> {
  await unlink(join(claimDir, 'descriptor.json')).catch(() => undefined);
  await rmdir(claimDir).catch(() => undefined);
}
