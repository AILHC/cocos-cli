import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync, statSync, readFileSync } from 'node:fs';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { getCliIntegrationFixturePaths } from '@shared/fixture-paths';

interface StartedPreview {
  child: ChildProcessWithoutNullStreams;
  url: string;
  logFilePath: string;
  close: () => Promise<void>;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolveWait) => setTimeout(resolveWait, ms));
}

function canListen(port: number, host = '127.0.0.1'): Promise<boolean> {
  return new Promise((resolveListen) => {
    const server = createServer();
    server.once('error', () => resolveListen(false));
    server.listen(port, host, () => {
      server.close(() => resolveListen(true));
    });
  });
}

async function findAvailablePort(startPort: number, attempts: number): Promise<number> {
  for (let offset = 0; offset < attempts; offset += 1) {
    const port = startPort + offset;
    if (await canListen(port)) {
      return port;
    }
  }

  throw new Error(`No available runtime preview test port in range ${startPort}-${startPort + attempts - 1}.`);
}

async function closeChild(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }

  child.kill();
  await Promise.race([
    new Promise<void>((resolveClose) => child.once('exit', () => resolveClose())),
    wait(5_000),
  ]);
  if (child.exitCode === null && child.signalCode === null) {
    child.kill('SIGKILL');
  }
}

async function startWatchAssetsRuntimePreview(options: {
  repoRoot: string;
  projectRoot: string;
  engineRoot: string;
  port: number;
  startupTimeoutMs: number;
}): Promise<StartedPreview> {
  const command = process.execPath;
  const args = [
    join(options.repoRoot, 'dist', 'cli.js'),
    'preview',
    '--project',
    options.projectRoot,
    '--runtime',
    '--host',
    '127.0.0.1',
    '--port',
    String(options.port),
    '--watch-assets',
    '--refresh-on-reload',
  ];
  const child = spawn(command, args, {
    cwd: options.repoRoot,
    env: {
      ...process.env,
      COCOS_CLI_TEST_PROJECT_ROOT: options.projectRoot,
      COCOS_CLI_TEST_ENGINE_ROOT: options.engineRoot,
      COCOS_CLI_TEST_EDITOR_LIBRARY_REF: undefined,
      COCOS_CLI_TEST_EDITOR_PROGRAMMING_REF: undefined,
    },
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

  const startedAt = Date.now();
  try {
    while (Date.now() - startedAt < options.startupTimeoutMs) {
      const urlMatch = /\[runtime-preview\] server:listening (http:\/\/[^\s]+)/.exec(stdout);
      if (urlMatch && stdout.includes('[runtime-preview] preview:ready')) {
        const url = urlMatch[1]!;
        const healthResponse = await fetch(`${url}/__runtime-preview/health`);
        if (healthResponse.status === 200) {
          const health = await healthResponse.json() as { logFilePath?: string };
          if (health.logFilePath) {
            return {
              child,
              url,
              logFilePath: health.logFilePath,
              close: async () => closeChild(child),
            };
          }
        }
      }

      if (child.exitCode !== null || child.signalCode !== null) {
        throw new Error(
          `Runtime preview exited before ready. exitCode=${child.exitCode} signal=${child.signalCode}\n`
          + `stdout:\n${stdout}\nstderr:\n${stderr}`,
        );
      }
      await wait(500);
    }

    throw new Error(
      `Timed out waiting for runtime preview ready after ${options.startupTimeoutMs}ms.\n`
      + `stdout:\n${stdout}\nstderr:\n${stderr}`,
    );
  } catch (error) {
    await closeChild(child);
    throw error;
  }
}

async function waitForLogContains(logFilePath: string, expected: string, offset: number, timeoutMs: number): Promise<string> {
  const startedAt = Date.now();
  let lastRuntimeAssetWatchLine = '';
  while (Date.now() - startedAt < timeoutMs) {
    if (existsSync(logFilePath)) {
      const logText = (await readFile(logFilePath, 'utf8')).slice(offset);
      const lines = logText.split(/\r?\n/);
      const match = lines.find((line) => line.includes(expected));
      if (match) {
        return match;
      }
      lastRuntimeAssetWatchLine = lines.filter((line) => line.startsWith('runtime-asset-watch ')).at(-1) ?? lastRuntimeAssetWatchLine;
    }
    await wait(300);
  }

  throw new Error(`Timed out waiting for log entry containing "${expected}". Last watcher line: ${lastRuntimeAssetWatchLine}`);
}

async function readLastRefreshAfter(logFilePath: string, offset: number): Promise<Record<string, unknown>> {
  const logText = (await readFile(logFilePath, 'utf8')).slice(offset);
  const line = logText
    .split(/\r?\n/)
    .filter((entry) => entry.startsWith('runtime-refresh '))
    .at(-1);
  if (!line) {
    throw new Error('runtime-refresh JSON log line was not written.');
  }

  return JSON.parse(line.slice('runtime-refresh '.length)) as Record<string, unknown>;
}

function countFixed(filePath: string, needle: string): number {
  if (!existsSync(filePath)) {
    return -1;
  }

  return readFileSync(filePath, 'utf8').split(needle).length - 1;
}

function assertSafeProbePath(assetsRoot: string, probeRoot: string): void {
  const resolved = resolve(probeRoot);
  const resolvedAssets = resolve(assetsRoot);
  if (!resolved.startsWith(`${resolvedAssets}\\`) || !resolved.includes('__runtime_preview_move_probe_')) {
    throw new Error(`unsafe probe path: ${resolved}`);
  }
}

describe('runtime preview main test-project script move integration', () => {
  it('refreshes a running script move plus importer update without old prerequisite compile errors', async () => {
    const paths = getCliIntegrationFixturePaths();
    const repoRoot = join(process.cwd(), '..');
    const normalizedProjectRoot = paths.projectRoot.replace(/\\/g, '/');
    expect(normalizedProjectRoot.endsWith('/cocos-test-projects')).toBe(true);
    expect(normalizedProjectRoot).not.toContain('/cocos_work_lab_38x');
    expect(paths.editorLibraryRef).toBeUndefined();
    expect(paths.editorProgrammingRef).toBeUndefined();

    const assetsRoot = join(paths.projectRoot, 'assets');
    const probeName = `__runtime_preview_move_probe_${Date.now()}`;
    const probeRoot = join(assetsRoot, probeName);
    const oldDir = join(probeRoot, 'old');
    const newDir = join(probeRoot, 'new');
    const oldScriptPath = join(oldDir, 'a.ts');
    const newScriptPath = join(newDir, 'a.ts');
    const importerPath = join(probeRoot, 'b.ts');
    const oldMetaPath = `${oldScriptPath}.meta`;
    const newMetaPath = `${newScriptPath}.meta`;
    const dbRoot = `db://assets/${probeName}`;
    const oldDbUrl = `${dbRoot}/old/a.ts`;
    const newDbUrl = `${dbRoot}/new/a.ts`;
    const importerDbUrl = `${dbRoot}/b.ts`;
    const port = await findAvailablePort(19631, 80);
    let preview: StartedPreview | null = null;

    assertSafeProbePath(assetsRoot, probeRoot);
    await rm(probeRoot, { recursive: true, force: true });
    await mkdir(oldDir, { recursive: true });
    await writeFile(
      oldScriptPath,
      `export const RUNTIME_PREVIEW_MOVE_PROBE_VALUE = 'before-${probeName}';\n`,
      'utf8',
    );
    await writeFile(
      importerPath,
      "import { RUNTIME_PREVIEW_MOVE_PROBE_VALUE } from './old/a';\n"
      + "export const RUNTIME_PREVIEW_MOVE_PROBE_B = 'b-before:' + RUNTIME_PREVIEW_MOVE_PROBE_VALUE;\n",
      'utf8',
    );

    try {
      preview = await startWatchAssetsRuntimePreview({
        repoRoot,
        projectRoot: paths.projectRoot,
        engineRoot: paths.engineRoot,
        port,
        startupTimeoutMs: 360_000,
      });
      const logOffset = existsSync(preview.logFilePath) ? statSync(preview.logFilePath).size : 0;

      await mkdir(newDir, { recursive: true });
      await rename(oldScriptPath, newScriptPath);
      if (existsSync(oldMetaPath)) {
        await rename(oldMetaPath, newMetaPath);
      }
      await writeFile(
        importerPath,
        "import { RUNTIME_PREVIEW_MOVE_PROBE_VALUE } from './new/a';\n"
        + "export const RUNTIME_PREVIEW_MOVE_PROBE_B = 'b-after:' + RUNTIME_PREVIEW_MOVE_PROBE_VALUE;\n",
        'utf8',
      );

      await waitForLogContains(preview.logFilePath, oldDbUrl, logOffset, 20_000);
      await waitForLogContains(preview.logFilePath, newDbUrl, logOffset, 20_000);
      await waitForLogContains(preview.logFilePath, importerDbUrl, logOffset, 20_000);

      const rootResponse = await fetch(`${preview.url}/`);
      expect(rootResponse.status).toBe(200);
      const rootText = await rootResponse.text();
      expect(rootText).toContain('__RUNTIME_PREVIEW_REFRESH_STATE__');
      await wait(1_000);

      const refresh = await readLastRefreshAfter(preview.logFilePath, logOffset);
      expect(refresh).toMatchObject({
        ok: true,
        target: 'dirty-set',
        reason: 'reload',
        scriptCompile: { status: 'done' },
      });
      expect(refresh.targets).toEqual(expect.arrayContaining([oldDbUrl, newDbUrl, importerDbUrl]));

      const logAfterMove = (await readFile(preview.logFilePath, 'utf8')).slice(logOffset);
      const oldScriptUrl = `file:///${normalizedProjectRoot}/assets/${probeName}/old/a.ts`;
      const newScriptUrl = `file:///${normalizedProjectRoot}/assets/${probeName}/new/a.ts`;
      const staleCompileErrors = logAfterMove
        .split(/\r?\n/)
        .filter((line) => line.includes('resolve_error_module_not_found') && line.includes(oldScriptUrl));
      expect(staleCompileErrors).toEqual([]);

      const programmingRoot = join(paths.projectRoot, 'temp', 'cli', 'programming', 'packer-driver', 'targets');
      expect(countFixed(join(programmingRoot, 'editor', 'import-map.json'), oldScriptUrl)).toBe(0);
      expect(countFixed(join(programmingRoot, 'preview', 'import-map.json'), oldScriptUrl)).toBe(0);
      expect(countFixed(join(programmingRoot, 'editor', 'import-map.json'), newScriptUrl)).toBe(1);
      expect(countFixed(join(programmingRoot, 'preview', 'import-map.json'), newScriptUrl)).toBe(1);
    } finally {
      if (preview) {
        await preview.close();
      }
      assertSafeProbePath(assetsRoot, probeRoot);
      await rm(probeRoot, { recursive: true, force: true });
      await rm(`${probeRoot}.meta`, { force: true });
    }
  }, 480_000);
});
