import { createHash } from 'node:crypto';
import { cp, opendir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { basename, extname, join, relative, resolve } from 'node:path';
import {
  canListen,
  startRuntimePreviewCliProcess,
  type StartedRuntimePreviewCliProcess,
} from '../shared/runtime-preview-cli-process';

interface Arguments {
  baselineRepo: string;
  currentRepo: string;
  sourceProject: string;
  parityProject: string;
  evidence: string;
}

interface FileRecord {
  path: string;
  bytes: number;
  hash: string;
  mode: 'binary' | 'text';
}

interface RunEvidence {
  repoRoot: string;
  projectRoot: string;
  command: string;
  url: string;
  elapsedStartupMs: number;
  portReleased: boolean;
  output: FileRecord[];
}

const OUTPUT_ROOTS = [
  'library',
  'temp/cli/asset-db',
  'temp/cli/programming',
];

const IGNORED_OUTPUT_FILES = new Set([
  'temp/cli/programming/packer-driver/logs/debug.log',
]);

const NON_SEMANTIC_JSON_KEYS = new Set([
  'mTimestamp',
  'outputTimeStamps',
  'sourceTimeStamp',
]);

const TEXT_EXTENSIONS = new Set([
  '.cjs',
  '.css',
  '.html',
  '.js',
  '.json',
  '.map',
  '.mjs',
  '.txt',
  '.ts',
  '.yaml',
  '.yml',
]);

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
    baselineRepo: required('baseline-repo'),
    currentRepo: required('current-repo'),
    sourceProject: required('source-project'),
    parityProject: required('parity-project'),
    evidence: required('evidence'),
  };
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

function replaceAllCaseInsensitive(source: string, target: string, replacement: string): string {
  if (!target) {
    return source;
  }
  return source.replace(new RegExp(target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), replacement);
}

function normalizeText(
  source: string,
  roots: { projectRoot: string; repoRoot: string; engineRoot: string },
): string {
  let normalized = source.replace(/\r\n/g, '\n');
  const replacements = [
    { value: roots.projectRoot, token: '<PROJECT>' },
    { value: roots.repoRoot, token: '<CLI>' },
    { value: roots.engineRoot, token: '<ENGINE>' },
  ];
  for (const { value, token } of replacements) {
    const variants = new Set([
      value,
      value.replace(/\\/g, '/'),
      value.replace(/\\/g, '\\\\'),
    ]);
    for (const variant of variants) {
      normalized = replaceAllCaseInsensitive(normalized, variant, token);
    }
  }
  return normalized.replace(/https?:\/\/127\.0\.0\.1:\d+/g, '<SERVER>');
}

function hash(content: Buffer | string): string {
  return createHash('sha256').update(content).digest('hex');
}

function normalizeJsonValue(
  value: unknown,
  roots: { projectRoot: string; repoRoot: string; engineRoot: string },
  ignoredKeys: ReadonlySet<string>,
): unknown {
  if (typeof value === 'string') {
    return normalizeText(value, roots);
  }
  if (Array.isArray(value)) {
    return value.map((item) => normalizeJsonValue(item, roots, ignoredKeys));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !ignoredKeys.has(key))
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, normalizeJsonValue(item, roots, ignoredKeys)]),
    );
  }
  return value;
}

function getIgnoredJsonKeys(relativePath: string): ReadonlySet<string> {
  const ignoredKeys = new Set(NON_SEMANTIC_JSON_KEYS);
  if (relativePath.endsWith('-info.json')) {
    ignoredKeys.add('time');
  }
  if (relativePath.endsWith('/assembly-record.json')) {
    ignoredKeys.add('timestamp');
  }
  return ignoredKeys;
}

async function collectFiles(
  projectRoot: string,
  repoRoot: string,
  engineRoot: string,
): Promise<FileRecord[]> {
  const output: FileRecord[] = [];
  for (const relativeRoot of OUTPUT_ROOTS) {
    const absoluteRoot = join(projectRoot, ...relativeRoot.split('/'));
    let rootDirectory;
    try {
      rootDirectory = await opendir(absoluteRoot);
    } catch {
      continue;
    }
    await rootDirectory.close();

    const pending = [absoluteRoot];
    while (pending.length) {
      const directory = pending.pop()!;
      const entries = await opendir(directory);
      for await (const entry of entries) {
        const absolutePath = join(directory, entry.name);
        if (entry.isDirectory()) {
          pending.push(absolutePath);
          continue;
        }
        if (!entry.isFile()) {
          continue;
        }

        const content = await readFile(absolutePath);
        const relativePath = relative(projectRoot, absolutePath).replace(/\\/g, '/');
        if (IGNORED_OUTPUT_FILES.has(relativePath)) {
          continue;
        }
        const isText = TEXT_EXTENSIONS.has(extname(entry.name).toLowerCase())
          || entry.name.startsWith('.cli-assets-');
        const roots = { projectRoot, repoRoot, engineRoot };
        let normalized: Buffer | string = content;
        if (isText) {
          const text = content.toString('utf8');
          if (extname(entry.name).toLowerCase() === '.json') {
            try {
              normalized = JSON.stringify(
                normalizeJsonValue(JSON.parse(text), roots, getIgnoredJsonKeys(relativePath)),
              );
            } catch {
              normalized = normalizeText(text, roots);
            }
          } else {
            normalized = normalizeText(text, roots);
          }
        }
        output.push({
          path: relativePath,
          bytes: content.byteLength,
          hash: hash(normalized),
          mode: isText ? 'text' : 'binary',
        });
      }
    }
  }
  return output.sort((left, right) => left.path.localeCompare(right.path));
}

async function collectOutputStabilitySignature(projectRoot: string): Promise<string> {
  let fileCount = 0;
  let totalBytes = 0;
  let latestMtimeMs = 0;
  for (const relativeRoot of OUTPUT_ROOTS) {
    const absoluteRoot = join(projectRoot, ...relativeRoot.split('/'));
    const pending = [absoluteRoot];
    while (pending.length) {
      const directory = pending.pop()!;
      let entries;
      try {
        entries = await opendir(directory);
      } catch {
        continue;
      }
      for await (const entry of entries) {
        const absolutePath = join(directory, entry.name);
        if (entry.isDirectory()) {
          pending.push(absolutePath);
          continue;
        }
        if (!entry.isFile()) {
          continue;
        }
        let fileStat;
        try {
          fileStat = await stat(absolutePath);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            latestMtimeMs = Date.now();
            continue;
          }
          throw error;
        }
        fileCount += 1;
        totalBytes += fileStat.size;
        latestMtimeMs = Math.max(latestMtimeMs, fileStat.mtimeMs);
      }
    }
  }
  return `${fileCount}:${totalBytes}:${latestMtimeMs}`;
}

async function waitForOutputStability(projectRoot: string): Promise<void> {
  const deadline = Date.now() + 60_000;
  let previous = '';
  let stablePolls = 0;
  while (Date.now() < deadline) {
    const current = await collectOutputStabilitySignature(projectRoot);
    if (current === previous) {
      stablePolls += 1;
      if (stablePolls >= 5) {
        return;
      }
    } else {
      previous = current;
      stablePolls = 0;
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error(`Runtime Preview output did not stabilize within 60 seconds: ${projectRoot}`);
}

async function readEngineRoot(projectRoot: string): Promise<string> {
  const packageJson = JSON.parse(await readFile(join(projectRoot, 'package.json'), 'utf8')) as {
    'cocos-cli'?: { enginePath?: string };
  };
  const configured = packageJson['cocos-cli']?.enginePath;
  if (!configured) {
    throw new Error(`Project has no cocos-cli.enginePath: ${projectRoot}`);
  }
  return resolve(projectRoot, configured);
}

async function resetProject(sourceProject: string, parityProject: string): Promise<void> {
  await rm(parityProject, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  await cp(sourceProject, parityProject, {
    recursive: true,
    preserveTimestamps: true,
    filter: (source) => !['.git', 'build', 'library', 'node_modules', 'temp'].includes(basename(source)),
  });
}

async function runPreview(options: {
  repoRoot: string;
  projectRoot: string;
  useRuntimeFlag: boolean;
  port: number;
}): Promise<RunEvidence> {
  const engineRoot = await readEngineRoot(options.projectRoot);
  let cli: StartedRuntimePreviewCliProcess | null = null;
  try {
    cli = await startRuntimePreviewCliProcess({
      repoRoot: options.repoRoot,
      projectRoot: options.projectRoot,
      engineRoot,
      host: '127.0.0.1',
      port: options.port,
      startupTimeoutMs: 300_000,
      useRuntimeFlag: options.useRuntimeFlag,
      useTestEnvironment: false,
      noOpen: !options.useRuntimeFlag,
    });
    if (!cli.stdout.includes(`[runtime-preview]   libraryRoot: ${join(options.projectRoot, 'library')}`)) {
      throw new Error(`Unexpected library root.\n${cli.stdout}`);
    }
    if (!cli.stdout.includes(`[runtime-preview]   programmingRoot: ${join(options.projectRoot, 'temp', 'cli', 'programming')}`)) {
      throw new Error(`Unexpected programming root.\n${cli.stdout}`);
    }
    await waitForOutputStability(options.projectRoot);
  } finally {
    if (cli) {
      const closeResult = await cli.close();
      if (!closeResult.portReleased) {
        throw new Error(`Preview port was not released: ${cli.port}`);
      }
    }
  }

  const output = await collectFiles(options.projectRoot, options.repoRoot, engineRoot);
  return {
    repoRoot: options.repoRoot,
    projectRoot: options.projectRoot,
    command: `${cli!.command} ${cli!.args.join(' ')}`,
    url: cli!.url,
    elapsedStartupMs: cli!.elapsedStartupMs,
    portReleased: true,
    output,
  };
}

function compareOutputs(baseline: FileRecord[], current: FileRecord[]) {
  const baselineByPath = new Map(baseline.map((record) => [record.path, record]));
  const currentByPath = new Map(current.map((record) => [record.path, record]));
  const missing = baseline.filter((record) => !currentByPath.has(record.path)).map((record) => record.path);
  const added = current.filter((record) => !baselineByPath.has(record.path)).map((record) => record.path);
  const changed = baseline.flatMap((record) => {
    const candidate = currentByPath.get(record.path);
    return candidate && candidate.hash !== record.hash
      ? [{ path: record.path, baseline: record, current: candidate }]
      : [];
  });
  return { missing, added, changed };
}

async function main(): Promise<void> {
  const args = parseArguments(process.argv.slice(2));
  const port = await findAvailablePort(19680);
  await resetProject(args.sourceProject, args.parityProject);
  const baseline = await runPreview({
    repoRoot: args.baselineRepo,
    projectRoot: args.parityProject,
    useRuntimeFlag: true,
    port,
  });
  await resetProject(args.sourceProject, args.parityProject);
  const current = await runPreview({
    repoRoot: args.currentRepo,
    projectRoot: args.parityProject,
    useRuntimeFlag: false,
    port,
  });
  const comparison = compareOutputs(baseline.output, current.output);
  const passed = comparison.missing.length === 0
    && comparison.added.length === 0
    && comparison.changed.length === 0;
  const evidence = {
    status: passed ? 'pass' : 'fail',
    generatedAt: new Date().toISOString(),
    outputRoots: OUTPUT_ROOTS,
    ignoredOutputFiles: [...IGNORED_OUTPUT_FILES],
    ignoredJsonKeys: {
      global: [...NON_SEMANTIC_JSON_KEYS],
      assetDbInfo: ['time'],
      assemblyRecord: ['timestamp'],
    },
    baseline,
    current,
    comparison,
  };
  await writeFile(args.evidence, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');

  console.log(JSON.stringify({
    status: evidence.status,
    evidence: args.evidence,
    baselineFiles: baseline.output.length,
    currentFiles: current.output.length,
    missing: comparison.missing.length,
    added: comparison.added.length,
    changed: comparison.changed.length,
    missingSample: comparison.missing.slice(0, 10),
    addedSample: comparison.added.slice(0, 10),
    changedSample: comparison.changed.slice(0, 10).map((entry) => entry.path),
  }, null, 2));

  if (!passed) {
    process.exitCode = 1;
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
});
