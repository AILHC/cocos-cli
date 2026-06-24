import { join } from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { getCliIntegrationFixturePaths } from '@shared/fixture-paths';
import { runBrowserRuntimeSmoke } from '@shared/browser-runtime-smoke';
import {
  canListen,
  startRuntimePreviewCliProcess,
} from '@shared/runtime-preview-cli-process';

interface PreviewSceneRecord {
  uuid: string;
  url: string;
}

const testBundleZipSceneUuid = 'ea53723b-fbb6-46f9-bf18-eaf73a330fae';

const serverLogFailurePatterns = [
  'settings:generation:error',
  'browser:preview-error',
  'UnhandledPromiseRejection',
  'route:error',
  'RuntimePreviewRequestBodyTooLarge',
];

function selectRequiredScene(scenes: PreviewSceneRecord[], uuid: string): PreviewSceneRecord {
  const scene = scenes.find((entry) => entry.uuid === uuid);
  if (!scene) {
    throw new Error(`fail-main-test-project-input: required scene is missing from /scene-list: ${uuid}`);
  }
  return scene;
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

describe('runtime preview main test-project CLI integration acceptance', () => {
  it('starts the real CLI runtime preview server and loads the TestBundleZip scene without browser or server log errors', async () => {
    const paths = getCliIntegrationFixturePaths();
    const repoRoot = join(process.cwd(), '..');
    const port = await findAvailablePort(19531, 50);
    const normalizedProjectRoot = paths.projectRoot.replace(/\\/g, '/');
    expect(normalizedProjectRoot.endsWith('/cocos-test-projects')).toBe(true);
    expect(normalizedProjectRoot).not.toContain('/cocos_work_lab_38x');
    const evidenceSummaryFilePath = join(paths.projectRoot, 'temp', 'runtime-preview-main-test-project-cli-evidence.json');

    const cli = await startRuntimePreviewCliProcess({
      repoRoot,
      projectRoot: paths.projectRoot,
      engineRoot: paths.engineRoot,
      editorLibraryRef: paths.editorLibraryRef,
      editorProgrammingRef: paths.editorProgrammingRef,
      host: '127.0.0.1',
      port,
      scene: testBundleZipSceneUuid,
      startupTimeoutMs: 120_000,
    });

    let closeResult: Awaited<ReturnType<typeof cli.close>> | null = null;
    try {
      expect(cli.pid).toBeGreaterThan(0);
      expect(cli.url).toBe(`http://127.0.0.1:${port}`);
      expect(cli.port).toBe(port);
      const cliCommand = `${cli.command} ${cli.args.join(' ')}`;
      const normalizedCliCommand = cliCommand.replace(/\\/g, '/');
      expect(normalizedCliCommand).toContain('/dist/cli.js');
      expect(normalizedCliCommand).not.toContain('/tsx/');
      expect(cli.stdout).toContain('[runtime-preview] projectRoot=');
      expect(cli.stdout).toContain('[runtime-preview] engineRoot=');
      expect(cli.stdout).toContain('[runtime-preview] server:listening');
      expect(cli.stdout).toContain('[runtime-preview] preview:preparing');
      expect(cli.stdout).toContain('[runtime-preview] engine:init:start');
      expect(cli.stdout).toContain('[runtime-preview] engine:init:done');
      expect(cli.stdout).toContain('[runtime-preview] builder:init:done');
      expect(cli.stdout).toContain('[runtime-preview] preview:ready');
      expect(cli.logFilePath).toBeTruthy();

      const sceneListResponse = await fetch(`${cli.url}/scene-list`);
      expect(sceneListResponse.status).toBe(200);
      const sceneList = await sceneListResponse.json() as {
        scenes: PreviewSceneRecord[];
        currentScene: string;
      };
      const targetScene = selectRequiredScene(sceneList.scenes, testBundleZipSceneUuid);
      expect(sceneList.currentScene).toBeTruthy();

      const defaultEntryResponse = await fetch(`${cli.url}/?scene=${encodeURIComponent(targetScene.uuid)}&debug=false`);
      expect(defaultEntryResponse.status).toBe(200);
      expect(await defaultEntryResponse.text()).toContain(`/settings.js?scene=${targetScene.uuid}`);

      const sceneSmoke = await runBrowserRuntimeSmoke({
        url: `${cli.url}/?scene=${encodeURIComponent(targetScene.uuid)}&debug=false`,
        runtimeServerOrigin: cli.url,
        readyTimeoutMs: 120_000,
        stableWindowMs: 10_000,
        evidenceFilePath: join(paths.projectRoot, 'temp', 'runtime-preview-main-test-project-cli-test-bundle-zip-scene.json'),
        evidenceContext: {
          cliPid: cli.pid,
          cliCommand: `${cli.command} ${cli.args.join(' ')}`,
          serverUrl: cli.url,
          logFilePath: cli.logFilePath,
          elapsedStartupMs: cli.elapsedStartupMs,
          expectedScene: targetScene,
        },
      });
      expect(sceneSmoke.ready).toMatchObject({
        scene: targetScene.uuid,
      });
      expect(sceneSmoke.consoleErrors).toEqual([]);
      expect(sceneSmoke.pageErrors).toEqual([]);
      expect(sceneSmoke.failedRequests).toEqual([]);
      expect(sceneSmoke.badResponses).toEqual([]);

      const runtimeLog = await readFile(cli.logFilePath!, 'utf8');
      const forbiddenLogHits = serverLogFailurePatterns.filter((pattern) => runtimeLog.includes(pattern));
      expect(forbiddenLogHits).toEqual([]);

      await writeFile(evidenceSummaryFilePath, `${JSON.stringify({
        status: 'pass',
        cliPid: cli.pid,
        cliCommand: `${cli.command} ${cli.args.join(' ')}`,
        serverUrl: cli.url,
        logFilePath: cli.logFilePath,
        elapsedStartupMs: cli.elapsedStartupMs,
        currentScene: sceneList.currentScene,
        targetScene,
        sceneResult: {
          elapsedReadyMs: sceneSmoke.elapsedReadyMs,
          elapsedTotalMs: sceneSmoke.elapsedTotalMs,
          networkRequestCount: sceneSmoke.networkRequestCount,
        },
      }, null, 2)}\n`, 'utf8');

      const evidence = JSON.parse(await readFile(evidenceSummaryFilePath, 'utf8')) as Record<string, unknown>;
      expect(evidence).toMatchObject({
        status: 'pass',
        cliPid: cli.pid,
        serverUrl: cli.url,
        logFilePath: cli.logFilePath,
        elapsedStartupMs: cli.elapsedStartupMs,
      });
      expect(evidence.targetScene).toMatchObject({
        uuid: testBundleZipSceneUuid,
      });
      expect(sceneSmoke.networkRequestCount).toBeGreaterThan(0);
    } finally {
      closeResult = await cli.close();
    }

    expect(closeResult.portReleased).toBe(true);
  }, 480_000);
});
