import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);

const childSource = String.raw`
const { cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } = require('fs/promises');
const { existsSync, writeSync } = require('fs');
const os = require('os');
const path = require('path');

const repoRoot = process.env.RUNTIME_REFRESH_LIVE_REPO_ROOT;
const fixtureRoot = path.join(repoRoot, 'tests/fixtures/projects/asset-operation');
const resourceUrl = 'db://assets/resources/rp-live-refresh.json';
const resourceRelativePath = path.join('assets', 'resources', 'rp-live-refresh.json');
const scriptRelativePath = path.join('assets', 'rp-live-refresh-script.ts');

function toPosixPath(value) {
  return value.replace(/\\/g, '/');
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(value, null, 2) + '\n', 'utf8');
}

async function copyFixtureProject(projectRoot) {
  await cp(fixtureRoot, projectRoot, {
    recursive: true,
    filter: (source) => {
      const relativeSource = toPosixPath(path.relative(fixtureRoot, source));
      if (!relativeSource) {
        return true;
      }
      return !['build', 'library', 'temp'].includes(relativeSource.split('/')[0]);
    },
  });
}

async function prepareProject(engineRoot) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'runtime-refresh-live-integration-'));
  const projectRoot = path.join(root, 'project');
  await copyFixtureProject(projectRoot);

  const packagePath = path.join(projectRoot, 'package.json');
  const packageJson = await readJson(packagePath);
  packageJson['cocos-cli'] = {
    ...(packageJson['cocos-cli'] || {}),
    enginePath: toPosixPath(engineRoot),
  };
  await writeJson(packagePath, packageJson);

  await writeJson(path.join(projectRoot, resourceRelativePath), {
    marker: 'RP_LIVE_RESOURCE_BEFORE_20260627',
  });
  await writeFile(
    path.join(projectRoot, scriptRelativePath),
    'export const RP_LIVE_SCRIPT_MARKER = "RP_LIVE_SCRIPT_BEFORE_20260627";\n',
    'utf8',
  );
  return { root, projectRoot };
}

function getJsonLibraryFile(assetQuery) {
  const assetInfo = assetQuery.queryAssetInfo(resourceUrl);
  const libraryFile = assetInfo && assetInfo.library && (assetInfo.library['.json'] || assetInfo.library.json);
  if (!assetInfo || assetInfo.imported !== true || assetInfo.invalid === true || typeof libraryFile !== 'string') {
    throw new Error('JSON resource was not imported into a library JSON artifact.');
  }
  return libraryFile;
}

function toLibraryRequestPath(projectLibraryRoot, libraryFile) {
  const tail = toPosixPath(path.relative(projectLibraryRoot, libraryFile));
  if (!tail || tail.startsWith('..')) {
    throw new Error('Library file is outside project library root.');
  }
  return '/assets/resources/import/' + tail;
}

async function fetchText(url) {
  const response = await fetch(url);
  const text = await response.text();
  if (response.status !== 200) {
    throw new Error('Unexpected HTTP ' + response.status + ' for ' + url + ': ' + text.slice(0, 200));
  }
  return text;
}

async function requestRootReload(server) {
  const html = await fetchText(server.url + '/');
  if (!html.includes('__RUNTIME_PREVIEW_REFRESH_STATE__')) {
    throw new Error('Root HTML did not include runtime refresh state injection.');
  }
  return html;
}

async function readLastRefreshLog(logFilePath) {
  const logText = await readFile(logFilePath, 'utf8');
  const line = logText
    .split(/\r?\n/)
    .filter((entry) => entry.startsWith('runtime-refresh '))
    .at(-1);
  if (!line) {
    throw new Error('runtime-refresh JSON log line was not written.');
  }
  return JSON.parse(line.slice('runtime-refresh '.length));
}

async function findPreviewScriptChunk(programmingRoot, marker) {
  const previewRoot = path.join(programmingRoot, 'packer-driver', 'targets', 'preview');
  const matches = [];
  async function walk(dir) {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const filePath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(filePath);
      } else if (entry.isFile() && entry.name.endsWith('.js')) {
        const source = await readFile(filePath, 'utf8');
        if (source.includes(marker)) {
          matches.push(filePath);
        }
      }
    }
  }
  await walk(previewRoot);
  if (matches.length !== 1) {
    throw new Error('Expected exactly one preview script chunk for ' + marker + ', got ' + matches.length);
  }
  return matches[0];
}

function toProgrammingRequestPath(programmingRoot, scriptChunkPath) {
  const tail = toPosixPath(path.relative(programmingRoot, scriptChunkPath));
  if (!tail.includes('packer-driver/targets/preview/chunks/') || tail.startsWith('..')) {
    throw new Error('Script chunk is outside preview programming output.');
  }
  return '/scripting/x/' + tail;
}

async function main() {
  const originalConsole = {
    log: console.log,
    warn: console.warn,
    error: console.error,
  };
  console.log = (...args) => writeSync(2, args.join(' ') + '\n');
  console.warn = (...args) => writeSync(2, args.join(' ') + '\n');
  console.error = (...args) => writeSync(2, args.join(' ') + '\n');

  const engineRoot = process.env.COCOS_CLI_TEST_ENGINE_ROOT;
  if (!engineRoot || !existsSync(engineRoot)) {
    throw new Error('Missing existing COCOS_CLI_TEST_ENGINE_ROOT.');
  }
  delete process.env.COCOS_CLI_TEST_PROJECT_ROOT;
  delete process.env.COCOS_CLI_TEST_EDITOR_LIBRARY_REF;
  delete process.env.COCOS_CLI_TEST_EDITOR_PROGRAMMING_REF;
  delete process.env.COCOS_CLI_SHARED_LIBRARY_OUTPUT;

  process.chdir(repoRoot);
  require('ts-node/register/transpile-only');
  const Launcher = require(path.join(repoRoot, 'src/core/launcher.ts')).default;
  const assetQuery = require(path.join(repoRoot, 'src/core/assets/manager/query.ts')).default;
  const { stopAssetDB } = require(path.join(repoRoot, 'src/core/assets/index.ts'));
  const scripting = require(path.join(repoRoot, 'src/core/scripting/index.ts')).default;

  const prepared = await prepareProject(engineRoot);
  const launcher = new Launcher(prepared.projectRoot);
  let server = null;
  const result = {
    projectKind: 'temporary-runtime-preview-fixture',
    fixtureSource: toPosixPath(fixtureRoot),
    projectRoot: toPosixPath(prepared.projectRoot),
    engineRootInput: {
      env: 'COCOS_CLI_TEST_ENGINE_ROOT',
      value: toPosixPath(engineRoot),
      role: 'Vitest child-process harness input, not production default behavior evidence',
    },
    distBuilt: false,
    levelBoundary: 'HTTP reads of library/programming outputs after real root reload refresh; not full browser Cocos runtime resource API.',
    resource: {},
    script: {},
  };

  try {
    server = await launcher.startRuntimePreview({
      host: '127.0.0.1',
      port: 0,
      refreshOnReload: true,
    });
    result.serverUrl = server.url;
    result.logFilePath = toPosixPath(server.logFilePath);
    result.projectLibraryRoot = toPosixPath(server.context.projectLibraryRoot);
    result.projectProgrammingRoot = toPosixPath(server.context.projectProgrammingRoot);

    const beforeResourcePath = toLibraryRequestPath(server.context.projectLibraryRoot, getJsonLibraryFile(assetQuery));
    const beforeResourceText = await fetchText(server.url + beforeResourcePath);
    await writeJson(path.join(prepared.projectRoot, resourceRelativePath), {
      marker: 'RP_LIVE_RESOURCE_AFTER_20260627',
    });
    await requestRootReload(server);
    const resourceRefreshLog = await readLastRefreshLog(server.logFilePath);
    const afterResourcePath = toLibraryRequestPath(server.context.projectLibraryRoot, getJsonLibraryFile(assetQuery));
    const afterResourceText = await fetchText(server.url + afterResourcePath);
    result.resource = {
      beforeRequestPath: beforeResourcePath,
      afterRequestPath: afterResourcePath,
      beforeContainsOld: beforeResourceText.includes('RP_LIVE_RESOURCE_BEFORE_20260627'),
      afterContainsNew: afterResourceText.includes('RP_LIVE_RESOURCE_AFTER_20260627'),
      afterContainsOld: afterResourceText.includes('RP_LIVE_RESOURCE_BEFORE_20260627'),
      refreshLog: resourceRefreshLog,
    };

    const beforeChunk = await findPreviewScriptChunk(server.context.projectProgrammingRoot, 'RP_LIVE_SCRIPT_BEFORE_20260627');
    const beforeChunkPath = toProgrammingRequestPath(server.context.projectProgrammingRoot, beforeChunk);
    const beforeChunkText = await fetchText(server.url + beforeChunkPath);
    await writeFile(
      path.join(prepared.projectRoot, scriptRelativePath),
      'export const RP_LIVE_SCRIPT_MARKER = "RP_LIVE_SCRIPT_AFTER_20260627";\n',
      'utf8',
    );
    await requestRootReload(server);
    const scriptRefreshLog = await readLastRefreshLog(server.logFilePath);
    const afterChunk = await findPreviewScriptChunk(server.context.projectProgrammingRoot, 'RP_LIVE_SCRIPT_AFTER_20260627');
    const afterChunkPath = toProgrammingRequestPath(server.context.projectProgrammingRoot, afterChunk);
    const afterChunkText = await fetchText(server.url + afterChunkPath);
    result.script = {
      beforeRequestPath: beforeChunkPath,
      afterRequestPath: afterChunkPath,
      beforeContainsOld: beforeChunkText.includes('RP_LIVE_SCRIPT_BEFORE_20260627'),
      afterContainsNew: afterChunkText.includes('RP_LIVE_SCRIPT_AFTER_20260627'),
      afterContainsOld: afterChunkText.includes('RP_LIVE_SCRIPT_BEFORE_20260627'),
      refreshLog: scriptRefreshLog,
    };
  } finally {
    await server?.close().catch(() => {});
    await stopAssetDB?.().catch(() => {});
    await scripting?.close?.().catch(() => {});
    if (process.env.COCOS_CLI_REFRESH_LIVE_KEEP_TEMP !== '1') {
      await rm(prepared.root, { recursive: true, force: true }).catch(() => {});
    }
    console.log = originalConsole.log;
    console.warn = originalConsole.warn;
    console.error = originalConsole.error;
  }

  writeSync(1, JSON.stringify(result, null, 2) + '\n');
}

main().catch((error) => {
  writeSync(2, (error && error.stack) || String(error));
  process.exitCode = 1;
});
`;

interface LiveIntegrationResult {
  projectKind: string;
  levelBoundary: string;
  resource: {
    beforeContainsOld: boolean;
    afterContainsNew: boolean;
    afterContainsOld: boolean;
    refreshLog: {
      ok: boolean;
      reason: string;
      target: string;
      scriptCompile: { status: string };
    };
  };
  script: {
    beforeContainsOld: boolean;
    afterContainsNew: boolean;
    afterContainsOld: boolean;
    refreshLog: {
      ok: boolean;
      reason: string;
      target: string;
      scriptCompile: { status: string };
    };
  };
}

describe('runtime preview refresh live integration on a temporary fixture', () => {
  it('refreshes changed JSON resource and TypeScript script on root reload and serves latest HTTP outputs', async () => {
    const engineRoot = process.env.COCOS_CLI_TEST_ENGINE_ROOT;
    expect(engineRoot && existsSync(engineRoot)).toBe(true);

    const repoRoot = join(process.cwd(), '..');
    const { stdout } = await execFileAsync(
      process.execPath,
      ['-e', childSource],
      {
        cwd: repoRoot,
        env: {
          ...process.env,
          COCOS_CLI_TEST_ENGINE_ROOT: engineRoot,
          RUNTIME_REFRESH_LIVE_REPO_ROOT: repoRoot,
        },
        maxBuffer: 64 * 1024 * 1024,
        timeout: 240_000,
      },
    );
    const jsonStart = stdout.lastIndexOf('{\n  "projectKind"');
    expect(jsonStart).toBeGreaterThanOrEqual(0);
    const result = JSON.parse(stdout.slice(jsonStart)) as LiveIntegrationResult;

    expect(result.projectKind).toBe('temporary-runtime-preview-fixture');
    expect(result.levelBoundary).toContain('not full browser Cocos runtime resource API');
    expect(result.resource).toMatchObject({
      beforeContainsOld: true,
      afterContainsNew: true,
      afterContainsOld: false,
      refreshLog: {
        ok: true,
        reason: 'reload',
        target: 'db://assets',
        scriptCompile: { status: 'done' },
      },
    });
    expect(result.script).toMatchObject({
      beforeContainsOld: true,
      afterContainsNew: true,
      afterContainsOld: false,
      refreshLog: {
        ok: true,
        reason: 'reload',
        target: 'db://assets',
        scriptCompile: { status: 'done' },
      },
    });
  }, 260_000);
});
