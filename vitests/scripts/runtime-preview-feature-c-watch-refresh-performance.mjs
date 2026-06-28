#!/usr/bin/env node

import { spawn, execFile } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '../..');
const defaultProjectRoot = 'D:/ps_copy/p6/trunk/Project/GameClient/feature-c';
const defaultScene = '4c721bfe-0b6e-46c2-97f0-644adfdcba31';
const probeDirRelative = 'assets/__cocos_cli_watch_probe__';
const probeDirMetaRelative = 'assets/__cocos_cli_watch_probe__.meta';
const probeFileRelative = 'assets/__cocos_cli_watch_probe__/runtime-watch-refresh.json';
const probeFileMetaRelative = 'assets/__cocos_cli_watch_probe__/runtime-watch-refresh.json.meta';
const probeTarget = 'db://assets/__cocos_cli_watch_probe__/runtime-watch-refresh.json';

function toPosix(value) {
  return value.replace(/\\/g, '/');
}

function nowStamp() {
  const date = new Date();
  const pad = (value) => String(value).padStart(2, '0');
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    '-',
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join('');
}

function parseArgs(argv) {
  const options = {
    projectRoot: process.env.COCOS_CLI_FEATURE_C_PROJECT_ROOT ?? defaultProjectRoot,
    scene: process.env.COCOS_CLI_FEATURE_C_SCENE ?? defaultScene,
    host: process.env.COCOS_CLI_FEATURE_C_HOST ?? '127.0.0.1',
    portStart: Number(process.env.COCOS_CLI_FEATURE_C_WATCH_REFRESH_PORT_START ?? 19920),
    rounds: Number(process.env.COCOS_CLI_FEATURE_C_WATCH_REFRESH_ROUNDS ?? 5),
    startupTimeoutMs: Number(process.env.COCOS_CLI_FEATURE_C_STARTUP_TIMEOUT_MS ?? 900_000),
    requestTimeoutMs: Number(process.env.COCOS_CLI_FEATURE_C_REFRESH_REQUEST_TIMEOUT_MS ?? 300_000),
    watchTimeoutMs: Number(process.env.COCOS_CLI_FEATURE_C_WATCH_EVENT_TIMEOUT_MS ?? 30_000),
    output: process.env.COCOS_CLI_FEATURE_C_WATCH_REFRESH_OUTPUT,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === '--project') {
      options.projectRoot = next;
      index += 1;
    } else if (arg === '--scene') {
      options.scene = next;
      index += 1;
    } else if (arg === '--rounds') {
      options.rounds = Number(next);
      index += 1;
    } else if (arg === '--port-start') {
      options.portStart = Number(next);
      index += 1;
    } else if (arg === '--output') {
      options.output = next;
      index += 1;
    }
  }
  if (!existsSync(options.projectRoot)) {
    throw new Error(`feature-c project root does not exist: ${options.projectRoot}`);
  }
  if (!Number.isInteger(options.rounds) || options.rounds < 1) {
    throw new Error('--rounds must be a positive integer');
  }
  if (!Number.isInteger(options.portStart) || options.portStart < 1) {
    throw new Error('--port-start must be a positive integer');
  }
  if (!options.output) {
    options.output = path.join(
      options.projectRoot,
      'temp',
      'codex-runtime-preview',
      `feature-c-watch-refresh-performance-${nowStamp()}.json`,
    );
  }
  return options;
}

function canListen(port, host) {
  return new Promise((resolve) => {
    const server = createServer();
    server.once('error', () => resolve(false));
    server.listen(port, host, () => {
      server.close(() => resolve(true));
    });
  });
}

async function findAvailablePort(host, startPort) {
  for (let offset = 0; offset < 100; offset += 1) {
    const port = startPort + offset;
    if (await canListen(port, host)) {
      return port;
    }
  }
  throw new Error(`No available port from ${startPort} to ${startPort + 99}`);
}

function cleanRuntimePreviewEnv() {
  const env = { ...process.env };
  delete env.COCOS_CLI_TEST_PROJECT_ROOT;
  delete env.COCOS_CLI_TEST_ENGINE_ROOT;
  delete env.COCOS_CLI_TEST_EDITOR_LIBRARY_REF;
  delete env.COCOS_CLI_TEST_EDITOR_PROGRAMMING_REF;
  delete env.COCOS_CLI_SHARED_LIBRARY_OUTPUT;
  return env;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function waitForExit(child) {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve({ exitCode: child.exitCode, signal: child.signalCode });
      return;
    }
    child.once('exit', (exitCode, signal) => resolve({ exitCode, signal }));
  });
}

async function closeChild(child) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return { exitCode: child.exitCode, signal: child.signalCode };
  }
  child.kill();
  const exit = await Promise.race([
    waitForExit(child),
    wait(10_000).then(() => null),
  ]);
  if (exit) {
    return exit;
  }
  child.kill('SIGKILL');
  return waitForExit(child);
}

async function startPreview({ options, mode, port }) {
  const args = [
    path.join(repoRoot, 'dist', 'cli.js'),
    'preview',
    '--runtime',
    '--project',
    options.projectRoot,
    '--host',
    options.host,
    '--port',
    String(port),
    '--scene',
    options.scene,
    ...mode.args,
  ];
  const child = spawn(process.execPath, args, {
    cwd: repoRoot,
    env: cleanRuntimePreviewEnv(),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  let url = '';
  let logFilePath = null;
  const startedAt = performance.now();

  const startup = await new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      void closeChild(child).finally(() => reject(new Error(
        `Timed out waiting for feature-c runtime preview after ${options.startupTimeoutMs}ms.\nstdout:\n${stdout}\nstderr:\n${stderr}`,
      )));
    }, options.startupTimeoutMs);

    const tryResolve = async () => {
      if (settled || !url || !stdout.includes('[runtime-preview] preview:ready')) {
        return;
      }
      try {
        const response = await fetch(`${url}/__runtime-preview/health`);
        if (response.status === 200) {
          const health = await response.json();
          logFilePath = health.logFilePath ?? null;
        }
      } catch {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve({
        elapsedStartupMs: Math.round(performance.now() - startedAt),
        url,
        logFilePath,
      });
    };

    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
      const match = /\[runtime-preview\] server:listening (http:\/\/[^\s]+)/.exec(stdout);
      if (match) {
        url = match[1];
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
      reject(new Error(`Runtime preview exited before ready. exitCode=${exitCode} signal=${signal}\nstdout:\n${stdout}\nstderr:\n${stderr}`));
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

  return {
    child,
    args,
    get stdout() {
      return stdout;
    },
    get stderr() {
      return stderr;
    },
    ...startup,
    close: () => closeChild(child),
  };
}

function parseRefreshState(html) {
  const match = /window\.__RUNTIME_PREVIEW_REFRESH_STATE__ = (\{[\s\S]*?\});/.exec(html);
  if (!match) {
    return null;
  }
  return JSON.parse(match[1]);
}

async function fetchWithTimeout(url, init, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

async function readRuntimeRefreshLogs(logFilePath) {
  if (!logFilePath || !existsSync(logFilePath)) {
    return [];
  }
  const logText = await readFile(logFilePath, 'utf8');
  return logText
    .split(/\r?\n/)
    .filter((line) => line.startsWith('runtime-refresh '))
    .map((line) => JSON.parse(line.slice('runtime-refresh '.length)));
}

async function readLastRuntimeRefreshLog(logFilePath) {
  const logs = await readRuntimeRefreshLogs(logFilePath);
  return logs.at(-1) ?? null;
}

async function waitForWatchTarget(logFilePath, target, timeoutMs) {
  const startedAt = Date.now();
  let lastLine = '';
  while (Date.now() - startedAt < timeoutMs) {
    if (logFilePath && existsSync(logFilePath)) {
      const logText = await readFile(logFilePath, 'utf8');
      const lines = logText
        .split(/\r?\n/)
        .filter((line) => line.startsWith('runtime-asset-watch '));
      lastLine = lines.at(-1) ?? lastLine;
      const found = lines.find((line) => line.includes(target));
      if (found) {
        return found;
      }
    }
    await wait(250);
  }
  throw new Error(`Timed out waiting for watcher target ${target}. Last watcher line: ${lastLine}`);
}

async function measureRootRound(server, round, timeoutMs) {
  const startedAt = performance.now();
  const response = await fetchWithTimeout(`${server.url}/`, undefined, timeoutMs);
  const html = await response.text();
  const rootHtmlMs = Math.round((performance.now() - startedAt) * 1000) / 1000;
  const state = parseRefreshState(html);
  const refresh = state?.lastRefresh ?? state?.refreshOnReloadFailure ?? null;
  return {
    round,
    rootStatus: response.status,
    rootHtmlMs,
    refreshResult: normalizeRefreshResult(refresh),
    refreshResults: await readRuntimeRefreshLogs(server.logFilePath),
  };
}

async function measureEndpointRound(server, round, timeoutMs) {
  const startedAt = performance.now();
  const response = await fetchWithTimeout(`${server.url}/__runtime-preview/refresh`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  }, timeoutMs);
  const text = await response.text();
  const endpointMs = Math.round((performance.now() - startedAt) * 1000) / 1000;
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = { parseError: text.slice(0, 500) };
  }
  return {
    round,
    endpointStatus: response.status,
    endpointMs,
    refreshResult: normalizeRefreshResult(body),
  };
}

function normalizeRefreshResult(refresh) {
  if (!refresh) {
    return null;
  }
  const targets = Array.isArray(refresh.targets) ? refresh.targets : undefined;
  return {
    ok: refresh.ok === true,
    target: refresh.target ?? null,
    targets,
    reason: refresh.reason ?? null,
    changedAssetCount: refresh.changedAssetCount ?? null,
    scriptCompileStatus: refresh.scriptCompile?.status ?? null,
    scriptCompileMs: typeof refresh.scriptCompile?.durationMs === 'number' ? refresh.scriptCompile.durationMs : null,
    dirtyTargetCount: refresh.watcher?.dirtyTargetCount ?? null,
    dirtyEventCount: refresh.dirtyEventCount ?? null,
    pendingDirtyTargetCount: refresh.pendingDirtyTargetCount ?? null,
    pendingSampleTargets: refresh.pendingSampleTargets ?? null,
    durationMs: typeof refresh.durationMs === 'number' ? refresh.durationMs : null,
    rootRefresh: refresh.target === 'db://assets' || targets?.includes('db://assets') === true,
    error: refresh.error ?? null,
  };
}

async function gitStatusProbe(projectRoot) {
  const { stdout } = await execFileAsync('git', [
    '-C',
    projectRoot,
    'status',
    '--short',
    '--',
    probeDirRelative,
    probeDirMetaRelative,
  ], {
    maxBuffer: 1024 * 1024,
  });
  return stdout.trim();
}

async function cleanupProbe(projectRoot) {
  await rm(path.join(projectRoot, probeDirRelative), { recursive: true, force: true });
  await rm(path.join(projectRoot, probeDirMetaRelative), { recursive: true, force: true });
  const probeDirExistsAfterCleanup = existsSync(path.join(projectRoot, probeDirRelative));
  const probeDirMetaExistsAfterCleanup = existsSync(path.join(projectRoot, probeDirMetaRelative));
  const metaExistsAfterCleanup = existsSync(path.join(projectRoot, probeFileMetaRelative));
  const gitStatusAfterCleanup = await gitStatusProbe(projectRoot);
  if (probeDirExistsAfterCleanup || probeDirMetaExistsAfterCleanup || metaExistsAfterCleanup || gitStatusAfterCleanup) {
    throw new Error([
      'feature-c probe cleanup failed.',
      `probeDirExistsAfterCleanup=${probeDirExistsAfterCleanup}`,
      `probeDirMetaExistsAfterCleanup=${probeDirMetaExistsAfterCleanup}`,
      `metaExistsAfterCleanup=${metaExistsAfterCleanup}`,
      `gitStatusAfterCleanup=${gitStatusAfterCleanup}`,
    ].join(' '));
  }
  return {
    gitStatusAfterCleanup,
    probeDirExistsAfterCleanup,
    probeDirMetaExistsAfterCleanup,
    metaExistsAfterCleanup,
  };
}

async function mutateProbe(projectRoot, round) {
  const filePath = path.join(projectRoot, probeFileRelative);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify({
    marker: `RP_FEATURE_C_WATCH_REFRESH_${round}_${Date.now()}`,
  }, null, 2)}\n`, 'utf8');
}

function summarize(rounds, selector) {
  const numbers = rounds
    .map(selector)
    .filter((value) => typeof value === 'number' && Number.isFinite(value))
    .sort((left, right) => left - right);
  if (!numbers.length) {
    return { min: null, p50: null, p95: null, max: null };
  }
  const percentile = (p) => {
    const index = Math.min(numbers.length - 1, Math.max(0, Math.ceil((p / 100) * numbers.length) - 1));
    return numbers[index];
  };
  return {
    min: numbers[0],
    p50: percentile(50),
    p95: percentile(95),
    max: numbers[numbers.length - 1],
  };
}

function createSummary(modeRounds) {
  return Object.fromEntries(Object.entries(modeRounds).map(([name, mode]) => {
    const rounds = mode.rounds ?? [];
    return [name, {
      rootHtmlMs: summarize(rounds, (round) => round.rootHtmlMs),
      endpointMs: summarize(rounds, (round) => round.endpointMs),
      refreshMs: summarize(rounds, (round) => round.refreshResult?.durationMs),
    }];
  }));
}

async function runMode({ options, mode, port }) {
  const server = await startPreview({ options, mode, port });
  const rounds = [];
  try {
    for (let round = 1; round <= options.rounds; round += 1) {
      if (mode.mutate) {
        const gitStatusBeforeMutation = await gitStatusProbe(options.projectRoot);
        let gitStatusAfterMutationBeforeCleanup = '';
        let cleanup = null;
        try {
          await mutateProbe(options.projectRoot, round);
          gitStatusAfterMutationBeforeCleanup = await gitStatusProbe(options.projectRoot);
          const watcherLog = await waitForWatchTarget(server.logFilePath, probeTarget, options.watchTimeoutMs);
          const rootRound = await measureRootRound(server, round, options.requestTimeoutMs);
          const refreshResult = normalizeRefreshResult(await readLastRuntimeRefreshLog(server.logFilePath));
          cleanup = await cleanupProbe(options.projectRoot);
          rounds.push({
            ...rootRound,
            refreshResult,
            watcherLog,
            gitStatusBeforeMutation,
            gitStatusAfterMutationBeforeCleanup,
            ...cleanup,
          });
        } catch (error) {
          cleanup = await cleanupProbe(options.projectRoot);
          rounds.push({
            round,
            error: error instanceof Error ? error.stack || error.message : String(error),
            gitStatusBeforeMutation,
            gitStatusAfterMutationBeforeCleanup,
            ...cleanup,
          });
          throw error;
        }
      } else if (mode.endpoint) {
        rounds.push(await measureEndpointRound(server, round, options.requestTimeoutMs));
      } else {
        rounds.push(await measureRootRound(server, round, options.requestTimeoutMs));
      }
    }
  } finally {
    await server.close();
  }
  return {
    args: mode.args,
    serverUrl: server.url,
    logFilePath: server.logFilePath ? toPosix(server.logFilePath) : null,
    elapsedStartupMs: server.elapsedStartupMs,
    command: `${process.execPath} ${server.args.join(' ')}`,
    rounds,
  };
}

function assertWatchNoChange(rounds) {
  for (const round of rounds) {
    const refresh = round.refreshResult;
    if (round.rootStatus !== 200 || !refresh || refresh.ok !== true || refresh.target !== 'dirty-set') {
      throw new Error(`watchReloadNoChange round ${round.round} did not return ok dirty-set refresh.`);
    }
    if (!Array.isArray(refresh.targets) || refresh.targets.length !== 0) {
      throw new Error(`watchReloadNoChange round ${round.round} targets were not empty.`);
    }
    if (refresh.scriptCompileStatus !== 'skipped' || refresh.changedAssetCount !== null || refresh.rootRefresh) {
      throw new Error(`watchReloadNoChange round ${round.round} unexpectedly refreshed root or compiled scripts.`);
    }
  }
}

function assertWatchChanged(rounds) {
  for (const round of rounds) {
    const refresh = round.refreshResult;
    if (round.rootStatus !== 200 || !refresh || refresh.ok !== true || refresh.target !== 'dirty-set') {
      throw new Error(`watchReloadChanged round ${round.round} did not return ok dirty-set refresh.`);
    }
    if (!Array.isArray(refresh.targets) || !refresh.targets.includes(probeTarget)) {
      throw new Error(`watchReloadChanged round ${round.round} did not include ${probeTarget}.`);
    }
    if (refresh.rootRefresh) {
      throw new Error(`watchReloadChanged round ${round.round} fell back to db://assets root refresh.`);
    }
    if (!['done', 'skipped'].includes(refresh.scriptCompileStatus)) {
      throw new Error(`watchReloadChanged round ${round.round} had unexpected script status ${refresh.scriptCompileStatus}.`);
    }
    if (round.gitStatusBeforeMutation !== '' || round.gitStatusAfterCleanup !== '') {
      throw new Error(`watchReloadChanged round ${round.round} probe git status was not clean before/after cleanup.`);
    }
    if (round.probeDirExistsAfterCleanup || round.probeDirMetaExistsAfterCleanup || round.metaExistsAfterCleanup) {
      throw new Error(`watchReloadChanged round ${round.round} left probe files behind.`);
    }
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  await cleanupProbe(options.projectRoot);
  const modes = [
    { name: 'defaultOff', args: [] },
    { name: 'watchNoReload', args: ['--watch-assets'], endpoint: true },
    { name: 'watchReloadNoChange', args: ['--watch-assets', '--refresh-on-reload'] },
    { name: 'watchReloadChanged', args: ['--watch-assets', '--refresh-on-reload'], mutate: true },
  ];
  let nextPort = await findAvailablePort(options.host, options.portStart);
  const result = {
    projectKind: 'real-project-feature-c',
    projectRoot: toPosix(path.resolve(options.projectRoot)),
    scene: options.scene,
    repoRoot: toPosix(repoRoot),
    distCli: toPosix(path.join(repoRoot, 'dist', 'cli.js')),
    sourceMutationPolicy: 'temporary assets/__cocos_cli_watch_probe__ directory, removed before success',
    rounds: options.rounds,
    envClearedForChild: [
      'COCOS_CLI_TEST_PROJECT_ROOT',
      'COCOS_CLI_TEST_ENGINE_ROOT',
      'COCOS_CLI_TEST_EDITOR_LIBRARY_REF',
      'COCOS_CLI_TEST_EDITOR_PROGRAMMING_REF',
      'COCOS_CLI_SHARED_LIBRARY_OUTPUT',
    ],
    probe: {
      directory: probeDirRelative,
      directoryMeta: probeDirMetaRelative,
      file: probeFileRelative,
      fileMeta: probeFileMetaRelative,
      target: probeTarget,
    },
    modes: {},
    summary: {},
    cleanup: {},
    output: toPosix(path.resolve(options.output)),
  };

  try {
    for (const mode of modes) {
      const port = await findAvailablePort(options.host, nextPort);
      nextPort = port + 1;
      result.modes[mode.name] = await runMode({ options, mode, port });
    }
    assertWatchNoChange(result.modes.watchReloadNoChange.rounds);
    assertWatchChanged(result.modes.watchReloadChanged.rounds);
  } finally {
    result.cleanup = await cleanupProbe(options.projectRoot);
  }
  result.summary = createSummary(result.modes);

  await mkdir(path.dirname(path.resolve(options.output)), { recursive: true });
  await writeFile(options.output, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack || error.message : String(error));
    process.exitCode = 1;
  });
}
