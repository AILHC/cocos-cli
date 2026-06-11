import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  collectBrowserConsoleEvidence,
} from '../shared/playwright-console-listener';
import { classifyRuntimePreviewStrictAcceptanceFailures } from '../shared/runtime-preview-acceptance';
import {
  canListen,
  startRuntimePreviewCliProcess,
} from '../shared/runtime-preview-cli-process';

interface PreviewSceneRecord {
  uuid: string;
  url: string;
  name?: string;
  bundle?: string;
}

async function findAvailablePort(startPort: number, attempts: number): Promise<number> {
  for (let offset = 0; offset < attempts; offset += 1) {
    const port = startPort + offset;
    if (await canListen(port)) {
      return port;
    }
  }

  throw new Error(`No available runtime preview diagnostic port in range ${startPort}-${startPort + attempts - 1}.`);
}

function appendQuery(url: string, query: Record<string, string | undefined>): string {
  const parsed = new URL(url);
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== '') {
      parsed.searchParams.set(key, value);
    }
  }
  return parsed.toString();
}

function summarizeMessages(messages: Array<{ type: string; text: string }>, limit = 20): string[] {
  return messages.slice(0, limit).map((message) => `[${message.type}] ${message.text}`);
}

function parseSettingsJs(source: string): Record<string, any> {
  const prefix = 'window._CCSettings = ';
  const start = source.indexOf(prefix);
  if (start < 0) {
    throw new Error('Unable to find window._CCSettings assignment in settings.js');
  }
  let json = source.slice(start + prefix.length).trim();
  if (json.endsWith(';')) {
    json = json.slice(0, -1);
  }
  return JSON.parse(json);
}

async function main(): Promise<void> {
  const scriptDir = dirname(fileURLToPath(import.meta.url));
  const repoRoot = resolve(scriptDir, '../..');
  const projectRoot = process.env.COCOS_CLI_FEATURE_C_PROJECT_ROOT ?? 'D:/ps_copy/p6/trunk/Project/GameClient/feature-c';
  const engineRoot = process.env.COCOS_CLI_FEATURE_C_ENGINE_ROOT ?? 'D:/workspace/engines/cocos/3.8.6';
  const host = process.env.COCOS_CLI_FEATURE_C_HOST ?? '127.0.0.1';
  const port = Number(process.env.COCOS_CLI_FEATURE_C_PORT ?? await findAvailablePort(19650, 50));
  const scene = process.env.COCOS_CLI_FEATURE_C_SCENE;
  const startupTimeoutMs = Number(process.env.COCOS_CLI_FEATURE_C_STARTUP_TIMEOUT_MS ?? 600_000);
  const readyTimeoutMs = Number(process.env.COCOS_CLI_FEATURE_C_READY_TIMEOUT_MS ?? 600_000);
  const stableWindowMs = Number(process.env.COCOS_CLI_FEATURE_C_STABLE_WINDOW_MS ?? 300_000);
  const evidenceFilePath = process.env.COCOS_CLI_FEATURE_C_EVIDENCE
    ?? join(projectRoot, 'temp', 'runtime-preview-feature-c-playwright-console-evidence.json');

  console.log(`[feature-c-diagnose] projectRoot=${projectRoot}`);
  console.log(`[feature-c-diagnose] engineRoot=${engineRoot}`);
  console.log(`[feature-c-diagnose] port=${port}`);
  console.log(`[feature-c-diagnose] startupTimeoutMs=${startupTimeoutMs}`);

  const cli = await startRuntimePreviewCliProcess({
    repoRoot,
    projectRoot,
    engineRoot,
    host,
    port,
    scene,
    startupTimeoutMs,
  });

  try {
    const sceneListResponse = await fetch(`${cli.url}/scene-list`);
    const sceneList = await sceneListResponse.json() as {
      currentScene: string;
      scenes: PreviewSceneRecord[];
    };
    const selectedScene = scene
      ? sceneList.scenes.find((entry) => entry.uuid === scene)
      : sceneList.scenes.find((entry) => entry.uuid === sceneList.currentScene);
    const previewUrl = appendQuery(`${cli.url}/`, {
      scene,
      runtimePreviewRenderType: process.env.COCOS_CLI_FEATURE_C_RENDER_TYPE ?? 'webgl',
      debug: process.env.COCOS_CLI_FEATURE_C_DEBUG ?? 'false',
    });
    const settingsUrl = appendQuery(`${cli.url}/settings.js`, {
      scene: scene ?? sceneList.currentScene,
    });
    const settingsSource = await (await fetch(settingsUrl)).text();
    const settings = parseSettingsJs(settingsSource);
    const builtinAssets = Array.isArray(settings.engine?.builtinAssets)
      ? settings.engine.builtinAssets as string[]
      : [];
    const defaultPhysicsMaterialUuid = 'ba21476f-2866-4f81-9c4d-6e359316e448';
    const hasDefaultPhysicsMaterial = builtinAssets.includes(defaultPhysicsMaterialUuid);

    console.log(`[feature-c-diagnose] serverUrl=${cli.url}`);
    console.log(`[feature-c-diagnose] previewLog=${cli.logFilePath ?? ''}`);
    console.log(`[feature-c-diagnose] currentScene=${sceneList.currentScene}`);
    console.log(`[feature-c-diagnose] selectedScene=${selectedScene ? `${selectedScene.uuid} ${selectedScene.url}` : ''}`);
    console.log(`[feature-c-diagnose] previewUrl=${previewUrl}`);
    console.log(`[feature-c-diagnose] builtinAssets=${builtinAssets.length}`);
    console.log(`[feature-c-diagnose] hasDefaultPhysicsMaterial=${hasDefaultPhysicsMaterial}`);

    const evidence = await collectBrowserConsoleEvidence({
      url: previewUrl,
      runtimeServerOrigin: cli.url,
      readyTimeoutMs,
      stableWindowMs,
      evidenceFilePath,
      evidenceContext: {
        cliPid: cli.pid,
        cliCommand: `${cli.command} ${cli.args.join(' ')}`,
        serverUrl: cli.url,
        previewLogFilePath: cli.logFilePath,
        elapsedStartupMs: cli.elapsedStartupMs,
        sceneListCurrentScene: sceneList.currentScene,
        selectedScene,
        settingsUrl,
        builtinAssetsCount: builtinAssets.length,
        hasDefaultPhysicsMaterial,
      },
    });

    console.log(`[feature-c-diagnose] evidence=${evidenceFilePath}`);
    console.log(`[feature-c-diagnose] readyTimedOut=${evidence.readyTimedOut}`);
    console.log(`[feature-c-diagnose] ready=${JSON.stringify(evidence.ready)}`);
    console.log(`[feature-c-diagnose] consoleMessages=${evidence.consoleMessages.length}`);
    console.log(`[feature-c-diagnose] pageErrors=${evidence.pageErrors.length}`);
    console.log(`[feature-c-diagnose] failedRequests=${evidence.failedRequests.length}`);
    console.log(`[feature-c-diagnose] badResponses=${evidence.badResponses.length}`);
    console.log('[feature-c-diagnose] consoleSample:');
    console.log(summarizeMessages(evidence.consoleMessages).join('\n'));
    const acceptanceFailures = classifyRuntimePreviewStrictAcceptanceFailures(evidence);
    console.log(`[feature-c-diagnose] strictAcceptanceFailures=${acceptanceFailures.length}`);
    for (const failure of acceptanceFailures) {
      console.log(`[feature-c-diagnose] strictAcceptanceFailure=${failure}`);
    }

    if (cli.logFilePath) {
      const previewLog = await readFile(cli.logFilePath, 'utf8').catch(() => '');
      const browserErrorLines = previewLog.split(/\r?\n/).filter((line) => line.includes('browser:preview-error'));
      console.log(`[feature-c-diagnose] previewLogBrowserErrors=${browserErrorLines.length}`);
      console.log(browserErrorLines.slice(-10).join('\n'));
    }

    if (acceptanceFailures.length > 0) {
      throw new Error(`feature-c strict acceptance failed: ${acceptanceFailures.join(', ')}`);
    }
  } finally {
    await cli.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
