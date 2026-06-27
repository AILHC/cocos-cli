#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath, pathToFileURL } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '../..');
const defaultProjectRoot = 'D:/ps_copy/p6/trunk/Project/GameClient/feature-c';
const defaultScene = '4c721bfe-0b6e-46c2-97f0-644adfdcba31';

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
    portStart: Number(process.env.COCOS_CLI_FEATURE_C_REFRESH_PERF_PORT_START ?? 19820),
    rounds: Number(process.env.COCOS_CLI_FEATURE_C_REFRESH_PERF_ROUNDS ?? 5),
    startupTimeoutMs: Number(process.env.COCOS_CLI_FEATURE_C_STARTUP_TIMEOUT_MS ?? 900_000),
    requestTimeoutMs: Number(process.env.COCOS_CLI_FEATURE_C_REFRESH_REQUEST_TIMEOUT_MS ?? 300_000),
    output: process.env.COCOS_CLI_FEATURE_C_REFRESH_PERF_OUTPUT,
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
      `feature-c-refresh-performance-${nowStamp()}.json`,
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

async function startPreview({ options, refreshOnReload, port }) {
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
  ];
  if (refreshOnReload) {
    args.push('--refresh-on-reload');
  }
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
    refreshOk: refresh ? refresh.ok === true : null,
    refreshTotalMs: typeof refresh?.durationMs === 'number' ? refresh.durationMs : null,
    assetDbTarget: refresh?.target ?? null,
    changedAssetCount: refresh?.changedAssetCount ?? null,
    scriptCompileStatus: refresh?.scriptCompile?.status ?? null,
    scriptCompileMs: typeof refresh?.scriptCompile?.durationMs === 'number' ? refresh.scriptCompile.durationMs : null,
    error: refresh?.error ?? null,
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
    refreshOk: body?.ok === true,
    refreshTotalMs: typeof body?.durationMs === 'number' ? body.durationMs : null,
    assetDbTarget: body?.target ?? null,
    changedAssetCount: body?.changedAssetCount ?? null,
    scriptCompileStatus: body?.scriptCompile?.status ?? null,
    scriptCompileMs: typeof body?.scriptCompile?.durationMs === 'number' ? body.scriptCompile.durationMs : null,
    error: body?.error ?? null,
  };
}

function summarize(rounds, key) {
  const numbers = rounds
    .map((round) => round[key])
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

function summarizeGroup(rounds, keys) {
  return Object.fromEntries(keys.map((key) => [key, summarize(rounds, key)]));
}

async function runScenario({ options, refreshOnReload, port }) {
  const server = await startPreview({ options, refreshOnReload, port });
  const rootRounds = [];
  const endpointRounds = [];
  try {
    for (let round = 1; round <= options.rounds; round += 1) {
      rootRounds.push(await measureRootRound(server, round, options.requestTimeoutMs));
    }
    if (!refreshOnReload) {
      for (let round = 1; round <= options.rounds; round += 1) {
        endpointRounds.push(await measureEndpointRound(server, round, options.requestTimeoutMs));
      }
    }
  } finally {
    await server.close();
  }
  return {
    refreshOnReload,
    serverUrl: server.url,
    logFilePath: server.logFilePath ? toPosix(server.logFilePath) : null,
    elapsedStartupMs: server.elapsedStartupMs,
    command: `${process.execPath} ${server.args.join(' ')}`,
    rootRounds,
    endpointRounds,
    summary: {
      root: summarizeGroup(rootRounds, [
        'rootHtmlMs',
        'refreshTotalMs',
        'scriptCompileMs',
      ]),
      endpoint: summarizeGroup(endpointRounds, [
        'endpointMs',
        'refreshTotalMs',
        'scriptCompileMs',
      ]),
    },
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const defaultPort = await findAvailablePort(options.host, options.portStart);
  const reloadPort = await findAvailablePort(options.host, defaultPort + 1);
  const result = {
    projectKind: 'real-project-feature-c',
    projectRoot: toPosix(path.resolve(options.projectRoot)),
    scene: options.scene,
    repoRoot: toPosix(repoRoot),
    distCli: toPosix(path.join(repoRoot, 'dist', 'cli.js')),
    rounds: options.rounds,
    envClearedForChild: [
      'COCOS_CLI_TEST_PROJECT_ROOT',
      'COCOS_CLI_TEST_ENGINE_ROOT',
      'COCOS_CLI_TEST_EDITOR_LIBRARY_REF',
      'COCOS_CLI_TEST_EDITOR_PROGRAMMING_REF',
      'COCOS_CLI_SHARED_LIBRARY_OUTPUT',
    ],
    mutationPolicy: 'No project source/assets files are intentionally modified; only preview library/temp/log outputs may be updated by runtime preview.',
    scenarios: {},
    output: toPosix(path.resolve(options.output)),
  };

  result.scenarios.defaultOff = await runScenario({
    options,
    refreshOnReload: false,
    port: defaultPort,
  });
  result.scenarios.refreshOnReload = await runScenario({
    options,
    refreshOnReload: true,
    port: reloadPort,
  });

  await mkdir(path.dirname(path.resolve(options.output)), { recursive: true });
  await writeFile(options.output, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);

  const failedRoot = [
    ...result.scenarios.defaultOff.rootRounds,
    ...result.scenarios.refreshOnReload.rootRounds,
  ].filter((round) => round.rootStatus !== 200 || round.refreshOk === false);
  const failedEndpoint = result.scenarios.defaultOff.endpointRounds
    .filter((round) => round.endpointStatus !== 200 || round.refreshOk !== true);
  if (failedRoot.length || failedEndpoint.length) {
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack || error.message : String(error));
    process.exitCode = 1;
  });
}
