#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, stat, utimes, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath, pathToFileURL } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '../..');
const defaultProjectRoot = 'D:/ps_copy/p7/trunk/GameClient/Client-fight-roguelike-migration';
const originalDirtyFileNames = [
  'effect_damage.ts',
  'rogue_fight_define.ts',
  'buff_add_condition_registry.ts',
  'damage_system.ts',
  'battle_interface.d.ts',
  'control_state_buff.ts',
];

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

function toPosix(value) {
  return value.replace(/\\/g, '/');
}

function parseArgs(argv) {
  const options = {
    projectRoot: defaultProjectRoot,
    host: '127.0.0.1',
    port: 20031,
    startupTimeoutMs: 900_000,
    requestTimeoutMs: 300_000,
    settleMs: 2_000,
    dirtyFiles: [],
    output: undefined,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === '--project') {
      options.projectRoot = next;
      index += 1;
    } else if (arg === '--host') {
      options.host = next;
      index += 1;
    } else if (arg === '--port') {
      options.port = Number(next);
      index += 1;
    } else if (arg === '--startup-timeout-ms') {
      options.startupTimeoutMs = Number(next);
      index += 1;
    } else if (arg === '--request-timeout-ms') {
      options.requestTimeoutMs = Number(next);
      index += 1;
    } else if (arg === '--settle-ms') {
      options.settleMs = Number(next);
      index += 1;
    } else if (arg === '--dirty-file') {
      options.dirtyFiles.push(next);
      index += 1;
    } else if (arg === '--output') {
      options.output = next;
      index += 1;
    }
  }
  options.projectRoot = path.resolve(options.projectRoot);
  if (!existsSync(options.projectRoot)) {
    throw new Error(`P7 project root does not exist: ${options.projectRoot}`);
  }
  if (!Number.isInteger(options.port) || options.port < 1) {
    throw new Error('--port must be a positive integer');
  }
  if (!Number.isInteger(options.startupTimeoutMs) || options.startupTimeoutMs < 1) {
    throw new Error('--startup-timeout-ms must be a positive integer');
  }
  if (!Number.isInteger(options.requestTimeoutMs) || options.requestTimeoutMs < 1) {
    throw new Error('--request-timeout-ms must be a positive integer');
  }
  if (!Number.isInteger(options.settleMs) || options.settleMs < 0) {
    throw new Error('--settle-ms must be a non-negative integer');
  }
  if (!options.output) {
    options.output = path.join(
      options.projectRoot,
      'temp',
      'codex-runtime-preview',
      `p7-watch-refresh-diagnostics-${nowStamp()}.json`,
    );
  }
  return options;
}

function createPreviewEnv() {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith('COCOS_CLI_TEST_')) {
      delete env[key];
    }
  }
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

async function startPreview(options) {
  const args = [
    path.join(repoRoot, 'dist', 'cli.js'),
    'preview',
    '--runtime',
    '--project',
    options.projectRoot,
    '--host',
    options.host,
    '--port',
    String(options.port),
    '--watch-assets',
    '--refresh-on-reload',
  ];
  const child = spawn(process.execPath, args, {
    cwd: repoRoot,
    env: createPreviewEnv(),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  let url = '';
  const startedAt = performance.now();

  const startup = await new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      void closeChild(child).finally(() => reject(new Error(
        `Timed out waiting for P7 runtime preview after ${options.startupTimeoutMs}ms.`,
      )));
    }, options.startupTimeoutMs);

    const tryResolve = () => {
      if (settled || !url || !stdout.includes('[runtime-preview] preview:ready')) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve({
        url,
        elapsedStartupMs: Math.round(performance.now() - startedAt),
      });
    };

    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
      const match = /\[runtime-preview\] server:listening (http:\/\/[^\s]+)/.exec(stdout);
      if (match) {
        url = match[1];
      }
      tryResolve();
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
      reject(new Error(`Runtime preview exited before ready. exitCode=${exitCode} signal=${signal}`));
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
    ...startup,
    get stdout() {
      return stdout;
    },
    get stderr() {
      return stderr;
    },
    close: () => closeChild(child),
  };
}

async function fetchJson(url, timeoutMs) {
  const response = await fetchText(url, timeoutMs);
  let json = null;
  try {
    json = JSON.parse(response.text);
  } catch {
    json = null;
  }
  return { ...response, json };
}

async function fetchJsonBestEffort(url, timeoutMs) {
  try {
    return await fetchJson(url, timeoutMs);
  } catch (error) {
    return {
      error: error instanceof Error ? error.stack || error.message : String(error),
    };
  }
}

async function fetchText(url, timeoutMs) {
  const controller = new AbortController();
  const startedAt = performance.now();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    const text = await response.text();
    return {
      status: response.status,
      statusText: response.statusText,
      elapsedMs: Math.round((performance.now() - startedAt) * 1000) / 1000,
      text,
    };
  } finally {
    clearTimeout(timer);
  }
}

function parseRefreshState(html) {
  const match = /window\.__RUNTIME_PREVIEW_REFRESH_STATE__ = (\{[\s\S]*?\});/.exec(html);
  if (!match) {
    return null;
  }
  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}

function isPathInside(parentPath, childPath) {
  const relativePath = path.relative(parentPath, childPath);
  return relativePath === '' || (!!relativePath && !relativePath.startsWith('..') && !path.isAbsolute(relativePath));
}

function isMetaFile(filePath) {
  return filePath.replace(/\\/g, '/').endsWith('.meta');
}

async function findDirtyFiles(projectRoot, explicitDirtyFiles) {
  if (explicitDirtyFiles.length > 0) {
    const assetsRoot = path.resolve(projectRoot, 'assets');
    const files = [];
    const missing = [];
    const invalid = [];
    for (const dirtyFile of explicitDirtyFiles) {
      const absolutePath = path.isAbsolute(dirtyFile)
        ? path.resolve(dirtyFile)
        : path.resolve(projectRoot, dirtyFile);
      if (!isPathInside(assetsRoot, absolutePath) || isMetaFile(absolutePath)) {
        invalid.push(dirtyFile);
      } else if (existsSync(absolutePath)) {
        files.push(absolutePath);
      } else {
        missing.push(dirtyFile);
      }
    }
    return {
      files,
      missing,
      ambiguous: [],
      invalid,
    };
  }

  const assetsRoot = path.join(projectRoot, 'assets');
  const matchesByName = new Map(originalDirtyFileNames.map((fileName) => [fileName, []]));

  async function walk(directory) {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile() && matchesByName.has(entry.name)) {
        matchesByName.get(entry.name).push(fullPath);
      }
    }
  }

  await walk(assetsRoot);
  const files = [];
  const missing = [];
  const ambiguous = [];
  for (const fileName of originalDirtyFileNames) {
    const matches = matchesByName.get(fileName) ?? [];
    if (matches.length === 0) {
      missing.push(fileName);
    } else if (matches.length === 1) {
      files.push(matches[0]);
    } else {
      ambiguous.push({
        fileName,
        matches: matches.map(toPosix),
      });
    }
  }
  return {
    files,
    missing,
    ambiguous,
    invalid: [],
  };
}

async function touchFiles(files) {
  const touched = [];
  const now = new Date();
  for (const file of files) {
    const before = await stat(file);
    await utimes(file, now, now);
    const after = await stat(file);
    touched.push({
      path: toPosix(file),
      beforeMtimeMs: before.mtimeMs,
      afterMtimeMs: after.mtimeMs,
    });
  }
  return touched;
}

async function readTextIfExists(filePath) {
  if (!filePath || !existsSync(filePath)) {
    return '';
  }
  return readFile(filePath, 'utf8');
}

function tailLines(text, count) {
  return text.split(/\r?\n/).filter(Boolean).slice(-count);
}

function analyzePackerDebugLog(text) {
  const targetStarts = [];
  const targetFinishes = [];
  const quickPackLines = [];
  const lines = text.split(/\r?\n/);
  for (const [lineIndex, line] of lines.entries()) {
    const started = /Target\(([^)]+)\) build started\./.exec(line);
    if (started) {
      targetStarts.push({ target: started[1], line, lineIndex });
    }
    const finished = /Target\(([^)]+)\) (?:ends|build failed)/.exec(line);
    if (finished) {
      targetFinishes.push({ target: finished[1], line, lineIndex });
    }
    if (line.includes('QuickPack(')) {
      quickPackLines.push(line);
    }
  }
  const lastStart = targetStarts.at(-1) ?? null;
  const hasFinishAfterLastStart = lastStart
    ? targetFinishes.some((finish) => finish.target === lastStart.target && finish.lineIndex > lastStart.lineIndex)
    : false;
  return {
    targetStartCount: targetStarts.length,
    targetFinishCount: targetFinishes.length,
    lastTargetStart: lastStart,
    hasFinishAfterLastTargetStart: hasFinishAfterLastStart,
    lastQuickPackLines: quickPackLines.slice(-20),
    unresolvedTargetBuild: !!lastStart && !hasFinishAfterLastStart,
  };
}

function createRootFailure(rootResult, packerAnalysis) {
  if (!rootResult.error) {
    return null;
  }
  if (packerAnalysis.unresolvedTargetBuild && packerAnalysis.lastQuickPackLines.length === 0) {
    return 'root request failed while a target build has no done/error boundary and no QuickPack stage diagnostics were found.';
  }
  if (packerAnalysis.unresolvedTargetBuild) {
    return 'root request failed while a target build has no done/error boundary; inspect lastQuickPackLines.';
  }
  return `root request failed: ${rootResult.error}`;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const distCli = path.join(repoRoot, 'dist', 'cli.js');
  if (!existsSync(distCli)) {
    throw new Error(`dist CLI does not exist. Run npm run compile first: ${distCli}`);
  }

  const result = {
    projectKind: 'real-project-p7-roguelike',
    projectRoot: toPosix(options.projectRoot),
    repoRoot: toPosix(repoRoot),
    distCli: toPosix(distCli),
    command: null,
    envClearedForChild: ['COCOS_CLI_TEST_*', 'COCOS_CLI_SHARED_LIBRARY_OUTPUT'],
    sourceMutationPolicy: 'utimes only on original dirty source files; no content write and no .meta write',
    originalDirtyFileNames,
    startup: null,
    dirtyFiles: null,
    healthBeforeTouch: null,
    statusBeforeTouch: null,
    root: null,
    healthAfterRoot: null,
    statusAfterRoot: null,
    logs: null,
    failure: null,
    output: toPosix(path.resolve(options.output)),
  };

  let server = null;
  try {
    server = await startPreview(options);
    result.command = `${process.execPath} ${server.args.join(' ')}`;
    result.startup = {
      url: server.url,
      elapsedStartupMs: server.elapsedStartupMs,
    };

    result.healthBeforeTouch = await fetchJsonBestEffort(`${server.url}/__runtime-preview/health`, options.requestTimeoutMs);
    result.statusBeforeTouch = await fetchJsonBestEffort(`${server.url}/__runtime-preview/status`, options.requestTimeoutMs);

    const dirtyFiles = await findDirtyFiles(options.projectRoot, options.dirtyFiles);
    if (dirtyFiles.ambiguous.length > 0) {
      throw new Error(`Ambiguous original dirty file names. Use --dirty-file with relative paths. ${JSON.stringify(dirtyFiles.ambiguous)}`);
    }
    if (dirtyFiles.invalid.length > 0) {
      throw new Error(`Invalid dirty files. Each --dirty-file must resolve under assets and must not be a .meta file. ${dirtyFiles.invalid.join(', ')}`);
    }
    const touched = await touchFiles(dirtyFiles.files);
    result.dirtyFiles = {
      resolved: dirtyFiles.files.map(toPosix),
      missing: dirtyFiles.missing,
      ambiguous: dirtyFiles.ambiguous,
      invalid: dirtyFiles.invalid,
      touched,
    };
    if (dirtyFiles.files.length === 0) {
      throw new Error(`No original dirty files were resolved under assets. Missing: ${dirtyFiles.missing.join(', ')}`);
    }
    await wait(options.settleMs);

    try {
      const rootResponse = await fetchText(`${server.url}/`, options.requestTimeoutMs);
      result.root = {
        status: rootResponse.status,
        statusText: rootResponse.statusText,
        elapsedMs: rootResponse.elapsedMs,
        refreshState: parseRefreshState(rootResponse.text),
        bodySample: rootResponse.text.slice(0, 500),
      };
    } catch (error) {
      result.root = {
        error: error instanceof Error ? error.stack || error.message : String(error),
      };
    }

    result.healthAfterRoot = await fetchJsonBestEffort(`${server.url}/__runtime-preview/health`, options.requestTimeoutMs);
    result.statusAfterRoot = await fetchJsonBestEffort(`${server.url}/__runtime-preview/status`, options.requestTimeoutMs);

    const runtimeLogFilePath = result.healthAfterRoot?.json?.logFilePath ?? result.healthBeforeTouch?.json?.logFilePath ?? null;
    const packerDebugLogFilePath = path.join(options.projectRoot, 'temp', 'cli', 'programming', 'packer-driver', 'logs', 'debug.log');
    const runtimeLog = await readTextIfExists(runtimeLogFilePath);
    const packerDebugLog = await readTextIfExists(packerDebugLogFilePath);
    const packerAnalysis = analyzePackerDebugLog(packerDebugLog);
    result.logs = {
      runtimeLogFilePath: runtimeLogFilePath ? toPosix(runtimeLogFilePath) : null,
      packerDebugLogFilePath: toPosix(packerDebugLogFilePath),
      runtimeTail: tailLines(runtimeLog, 80),
      packerDebugTail: tailLines(packerDebugLog, 120),
      packerAnalysis,
      stdoutTail: tailLines(server.stdout, 80),
      stderrTail: tailLines(server.stderr, 80),
    };

    const rootStatus = result.root?.status;
    const allowedRootStatus = rootStatus === 200
      || rootStatus === 304
      || (rootStatus === 503 && result.root?.bodySample?.includes('Runtime preview is preparing'));
    result.failure = createRootFailure(result.root, packerAnalysis);
    if (!result.failure && !allowedRootStatus) {
      result.failure = `root returned unexpected status: ${rootStatus}`;
    }
    if (!result.failure && dirtyFiles.missing.length > 0) {
      result.failure = `some original dirty files were not found: ${dirtyFiles.missing.join(', ')}`;
    }
  } finally {
    if (server) {
      const childExit = await server.close();
      result.childExit = childExit;
    }
    await mkdir(path.dirname(path.resolve(options.output)), { recursive: true });
    await writeFile(options.output, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  }

  if (result.failure) {
    throw new Error(result.failure);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack || error.message : String(error));
    process.exitCode = 1;
  });
}
