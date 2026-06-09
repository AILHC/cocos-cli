import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createServer } from 'node:net';
import { join } from 'node:path';

export interface RuntimePreviewCliProcessOptions {
  repoRoot: string;
  projectRoot: string;
  engineRoot: string;
  editorLibraryRef: string;
  editorProgrammingRef: string;
  host?: string;
  port?: number;
  scene?: string;
  startupTimeoutMs?: number;
}

export interface StartedRuntimePreviewCliProcess {
  child: ChildProcessWithoutNullStreams;
  pid: number;
  command: string;
  args: string[];
  host: string;
  port: number;
  url: string;
  stdout: string;
  stderr: string;
  logFilePath: string | null;
  elapsedStartupMs: number;
  close: () => Promise<{ exitCode: number | null; signal: NodeJS.Signals | null; portReleased: boolean }>;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function canListen(port: number, host = '127.0.0.1'): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once('error', () => resolve(false));
    server.listen(port, host, () => {
      server.close(() => resolve(true));
    });
  });
}

async function waitForPortRelease(port: number, host: string, timeoutMs: number): Promise<boolean> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await canListen(port, host)) {
      return true;
    }
    await wait(100);
  }
  return false;
}

function waitForExit(child: ChildProcessWithoutNullStreams): Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }> {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve({ exitCode: child.exitCode, signal: child.signalCode });
      return;
    }
    child.once('exit', (exitCode, signal) => resolve({ exitCode, signal }));
  });
}

async function closeChild(child: ChildProcessWithoutNullStreams): Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return { exitCode: child.exitCode, signal: child.signalCode };
  }

  child.kill();
  const exit = await Promise.race([
    waitForExit(child),
    wait(5_000).then(() => null),
  ]);
  if (exit) {
    return exit;
  }

  child.kill('SIGKILL');
  return await waitForExit(child);
}

export async function startRuntimePreviewCliProcess(
  options: RuntimePreviewCliProcessOptions,
): Promise<StartedRuntimePreviewCliProcess> {
  const host = options.host ?? '127.0.0.1';
  const port = options.port ?? 19530;
  const startupTimeoutMs = options.startupTimeoutMs ?? 120_000;
  const command = process.execPath;
  const args = [
    join(options.repoRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs'),
    join(options.repoRoot, 'src', 'cli.ts'),
    'preview',
    '--project',
    options.projectRoot,
    '--runtime',
    '--host',
    host,
    '--port',
    String(port),
    '--settings-timeout-ms',
    '120000',
  ];
  if (options.scene) {
    args.push('--scene', options.scene);
  }

  const child = spawn(command, args, {
    cwd: options.repoRoot,
    env: {
      ...process.env,
      COCOS_CLI_TEST_ENGINE_ROOT: options.engineRoot,
      COCOS_CLI_TEST_EDITOR_LIBRARY_REF: options.editorLibraryRef,
      COCOS_CLI_TEST_EDITOR_PROGRAMMING_REF: options.editorProgrammingRef,
    },
    stdio: 'pipe',
  });
  child.stdin.end();

  let stdout = '';
  let stderr = '';
  let url = '';
  let resolvedPort = port;
  let logFilePath: string | null = null;
  const startedAt = Date.now();

  return await new Promise((resolve, reject) => {
    let settled = false;
    let resolving = false;
    const timer = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      void closeChild(child).finally(() => reject(new Error(
        `Timed out waiting for runtime preview CLI server:listening after ${startupTimeoutMs}ms.\nstdout:\n${stdout}\nstderr:\n${stderr}`,
      )));
    }, startupTimeoutMs);

    const tryResolve = async () => {
      if (settled || resolving || !url) {
        return;
      }
      resolving = true;
      try {
        resolvedPort = Number(new URL(url).port);
        const healthResponse = await fetch(`${url}/__runtime-preview/health`);
        if (healthResponse.status === 200) {
          const health = await healthResponse.json() as { logFilePath?: string };
          logFilePath = health.logFilePath ?? null;
        }
      } catch {
        resolving = false;
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve({
        child,
        pid: child.pid ?? -1,
        command,
        args,
        host,
        port: resolvedPort,
        url,
        get stdout() {
          return stdout;
        },
        get stderr() {
          return stderr;
        },
        logFilePath,
        elapsedStartupMs: Date.now() - startedAt,
        close: async () => {
          const exit = await closeChild(child);
          const portReleased = await waitForPortRelease(resolvedPort, host, 5_000);
          return { ...exit, portReleased };
        },
      });
    };

    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
      const listeningMatch = /\[runtime-preview\] server:listening (http:\/\/[^\s]+)/.exec(stdout);
      if (listeningMatch) {
        url = listeningMatch[1];
      }
      void tryResolve();
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.once('exit', (exitCode, signal) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      reject(new Error(
        `Runtime preview CLI exited before server:listening. exitCode=${exitCode} signal=${signal}\nstdout:\n${stdout}\nstderr:\n${stderr}`,
      ));
    });
    child.once('error', (error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
  });
}
