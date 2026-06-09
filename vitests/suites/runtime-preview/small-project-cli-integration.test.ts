import { join } from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { getFixturePaths } from '@shared/fixture-paths';
import { runBrowserRuntimeSmoke } from '@shared/browser-runtime-smoke';
import {
  canListen,
  startRuntimePreviewCliProcess,
} from '@shared/runtime-preview-cli-process';

interface PreviewSceneRecord {
  uuid: string;
  url: string;
}

const complexSceneUuids = [
  '668efa31-4841-4cbc-bbae-33255599d478',
  '465d8fb0-d260-4256-a785-651bf2ebf7d1',
  'ec470553-bc56-4c2c-91aa-c7016f677e3e',
];

const serverLogFailurePatterns = [
  'settings:generation:error',
  'browser:preview-error',
  'UnhandledPromiseRejection',
  'route:error',
  'RuntimePreviewRequestBodyTooLarge',
];

function selectRequiredScenes(scenes: PreviewSceneRecord[]): PreviewSceneRecord[] {
  return complexSceneUuids.map((uuid) => {
    const scene = scenes.find((entry) => entry.uuid === uuid);
    if (!scene) {
      throw new Error(`fail-small-project-input: required scene is missing from /scene-list: ${uuid}`);
    }
    return scene;
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

describe('runtime preview small-project CLI integration acceptance', () => {
  it('starts the real CLI runtime preview server and loads three complex scenes without browser or server log errors', async () => {
    const paths = getFixturePaths();
    const repoRoot = join(process.cwd(), '..');
    const port = await findAvailablePort(19531, 50);
    const evidenceSummaryFilePath = join(paths.projectRoot, 'temp', 'runtime-preview-small-project-cli-evidence.json');

    const cli = await startRuntimePreviewCliProcess({
      repoRoot,
      projectRoot: paths.projectRoot,
      engineRoot: paths.engineRoot,
      editorLibraryRef: paths.editorLibraryRef,
      editorProgrammingRef: paths.editorProgrammingRef,
      host: '127.0.0.1',
      port,
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
      const selectedScenes = selectRequiredScenes(sceneList.scenes);
      expect(sceneList.currentScene).toBeTruthy();

      const defaultEntryResponse = await fetch(`${cli.url}/?debug=false`);
      expect(defaultEntryResponse.status).toBe(200);
      expect(await defaultEntryResponse.text()).toContain(`/settings.js?scene=${sceneList.currentScene}`);

      const defaultSmoke = await runBrowserRuntimeSmoke({
        url: `${cli.url}/?debug=false`,
        runtimeServerOrigin: cli.url,
        readyTimeoutMs: 120_000,
        stableWindowMs: 10_000,
        evidenceFilePath: join(paths.projectRoot, 'temp', 'runtime-preview-small-project-cli-default-scene.json'),
        evidenceContext: {
          cliPid: cli.pid,
          cliCommand: `${cli.command} ${cli.args.join(' ')}`,
          serverUrl: cli.url,
          logFilePath: cli.logFilePath,
          elapsedStartupMs: cli.elapsedStartupMs,
          expectedScene: sceneList.currentScene,
        },
      });
      expect(defaultSmoke.ready).toMatchObject({
        scene: sceneList.currentScene,
      });
      expect(defaultSmoke.consoleErrors).toEqual([]);
      expect(defaultSmoke.pageErrors).toEqual([]);
      expect(defaultSmoke.failedRequests).toEqual([]);
      expect(defaultSmoke.badResponses).toEqual([]);

      const selectTargetScene = selectedScenes[1] ?? selectedScenes[0];
      const sceneSelectSmoke = await runBrowserRuntimeSmoke({
        url: `${cli.url}/?debug=false`,
        runtimeServerOrigin: cli.url,
        sceneSelectTarget: selectTargetScene.uuid,
        readyTimeoutMs: 120_000,
        stableWindowMs: 10_000,
        evidenceFilePath: join(paths.projectRoot, 'temp', 'runtime-preview-small-project-cli-scene-select.json'),
        evidenceContext: {
          cliPid: cli.pid,
          cliCommand: `${cli.command} ${cli.args.join(' ')}`,
          serverUrl: cli.url,
          logFilePath: cli.logFilePath,
          elapsedStartupMs: cli.elapsedStartupMs,
          initialScene: sceneList.currentScene,
          selectedScene: selectTargetScene,
        },
      });
      expect(sceneSelectSmoke.initialReady).toMatchObject({
        scene: sceneList.currentScene,
      });
      expect(sceneSelectSmoke.ready).toMatchObject({
        scene: selectTargetScene.uuid,
      });
      expect(sceneSelectSmoke.consoleErrors).toEqual([]);
      expect(sceneSelectSmoke.pageErrors).toEqual([]);
      expect(sceneSelectSmoke.failedRequests).toEqual([]);
      expect(sceneSelectSmoke.badResponses).toEqual([]);

      const sceneResults = [];
      for (const scene of selectedScenes) {
        const url = [
          `${cli.url}/?scene=${encodeURIComponent(scene.uuid)}`,
          'runtimePreviewRenderType=webgl',
          'debug=false',
        ].join('&');
        const evidenceFilePath = join(
          paths.projectRoot,
          'temp',
          `runtime-preview-small-project-cli-scene-${scene.uuid}.json`,
        );
        const smoke = await runBrowserRuntimeSmoke({
          url,
          runtimeServerOrigin: cli.url,
          readyTimeoutMs: 120_000,
          stableWindowMs: 10_000,
          evidenceFilePath,
          evidenceContext: {
            cliPid: cli.pid,
            cliCommand: `${cli.command} ${cli.args.join(' ')}`,
            serverUrl: cli.url,
            logFilePath: cli.logFilePath,
            elapsedStartupMs: cli.elapsedStartupMs,
            scene,
          },
        });

        expect(smoke.ready).toMatchObject({
          scene: scene.uuid,
        });
        expect(smoke.consoleErrors).toEqual([]);
        expect(smoke.pageErrors).toEqual([]);
        expect(smoke.failedRequests).toEqual([]);
        expect(smoke.badResponses).toEqual([]);
        sceneResults.push({
          scene,
          elapsedReadyMs: smoke.elapsedReadyMs,
          elapsedTotalMs: smoke.elapsedTotalMs,
          networkRequestCount: smoke.networkRequestCount,
          evidenceFilePath,
        });
      }

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
        sceneResults,
        defaultSceneResult: {
          elapsedReadyMs: defaultSmoke.elapsedReadyMs,
          elapsedTotalMs: defaultSmoke.elapsedTotalMs,
          networkRequestCount: defaultSmoke.networkRequestCount,
        },
        sceneSelectResult: {
          initialReady: sceneSelectSmoke.initialReady,
          ready: sceneSelectSmoke.ready,
          elapsedReadyMs: sceneSelectSmoke.elapsedReadyMs,
          elapsedTotalMs: sceneSelectSmoke.elapsedTotalMs,
          networkRequestCount: sceneSelectSmoke.networkRequestCount,
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
      expect(sceneResults).toHaveLength(3);
      expect(sceneResults.every((result) => result.networkRequestCount > 0)).toBe(true);
    } finally {
      closeResult = await cli.close();
    }

    expect(closeResult.portReleased).toBe(true);
  }, 480_000);
});
