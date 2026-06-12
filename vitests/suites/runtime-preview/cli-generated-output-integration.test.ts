import { join, normalize } from 'node:path';
import { existsSync } from 'node:fs';
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

const mainProjectSceneUuids = [
  'd3fc11bc-05dc-4e60-bc4f-f682fa74e8b6',
  '4437972c-9b71-4af0-aae3-251f640ee42a',
  'ac48432f-ab9a-4c4c-89f6-11053a95abe4',
];

const forbiddenServerLogPatterns = [
  'settings:generation:error',
  'browser:preview-error',
  'UnhandledPromiseRejection',
  'route:error',
  'RuntimePreviewRequestBodyTooLarge',
  'Importer exec failed',
];

async function findAvailablePort(startPort: number, attempts: number): Promise<number> {
  for (let offset = 0; offset < attempts; offset += 1) {
    const port = startPort + offset;
    if (await canListen(port)) {
      return port;
    }
  }

  throw new Error(`No available runtime preview test port in range ${startPort}-${startPort + attempts - 1}.`);
}

function selectRequiredScenes(scenes: PreviewSceneRecord[]): PreviewSceneRecord[] {
  return mainProjectSceneUuids.map((uuid) => {
    const scene = scenes.find((entry) => entry.uuid === uuid);
    if (!scene) {
      throw new Error(`fail-main-test-project-input: required scene is missing from /scene-list: ${uuid}`);
    }
    return scene;
  });
}

function slash(path: string): string {
  return normalize(path).replace(/\\/g, '/');
}

describe('runtime preview real CLI generated output acceptance', () => {
  it('uses CLI generated library/programming outputs and loads three main test-project scenes without browser or server errors', async () => {
    const paths = getCliIntegrationFixturePaths();
    const repoRoot = join(process.cwd(), '..');
    const port = await findAvailablePort(19601, 50);
    const normalizedProjectRoot = paths.projectRoot.replace(/\\/g, '/');
    expect(normalizedProjectRoot.endsWith('/cocos-test-projects')).toBe(true);
    expect(normalizedProjectRoot).not.toContain('/cocos_work_lab_38x');
    const expectedProjectLibraryRoot = join(paths.projectRoot, 'library', 'cli');
    const expectedProjectProgrammingRoot = join(paths.projectRoot, 'temp', 'cli', 'programming');
    const expectedInternalLibraryRoot = join(paths.projectRoot, 'library');
    const expectedExtensionLibraryRootPrefix = join(paths.projectRoot, 'library', 'cli-extensions');
    const evidenceSummaryFilePath = join(paths.projectRoot, 'temp', 'runtime-preview-cli-generated-output-evidence.json');

    const cli = await startRuntimePreviewCliProcess({
      repoRoot,
      projectRoot: paths.projectRoot,
      engineRoot: paths.engineRoot,
      host: '127.0.0.1',
      port,
      startupTimeoutMs: 120_000,
    });

    let closeResult: Awaited<ReturnType<typeof cli.close>> | null = null;
    try {
      const healthResponse = await fetch(`${cli.url}/__runtime-preview/health`);
      expect(healthResponse.status).toBe(200);
      const health = await healthResponse.json() as {
        projectLibraryRoot: string;
        extensionLibraryRoots: Array<{ name: string; root: string }>;
        projectProgrammingRoot: string;
        cliProgrammingRoot?: string;
      };

      expect(slash(health.projectLibraryRoot)).toBe(slash(expectedProjectLibraryRoot));
      const extensionLibraryRoots = health.extensionLibraryRoots.map((entry) => ({
        name: entry.name,
        root: slash(entry.root),
      }));
      expect(extensionLibraryRoots.every((entry) => entry.root.startsWith(slash(expectedExtensionLibraryRootPrefix)))).toBe(true);
      expect(slash(health.projectProgrammingRoot)).toBe(slash(expectedProjectProgrammingRoot));
      expect(slash(health.cliProgrammingRoot ?? '')).toBe(slash(expectedProjectProgrammingRoot));

      const normalizedStdout = cli.stdout.replace(/\\/g, '/');
      expect(normalizedStdout).toContain('[runtime-preview] active-output:');
      const activeOutputBlock = normalizedStdout.slice(normalizedStdout.indexOf('[runtime-preview] active-output:'));
      expect(normalizedStdout).toContain(`[runtime-preview]   url: ${cli.url}`);
      expect(normalizedStdout).toContain(`[runtime-preview] projectLibraryRoot=${slash(expectedProjectLibraryRoot)}`);
      expect(normalizedStdout).toContain(`[runtime-preview]   libraryRoot: ${slash(expectedProjectLibraryRoot)}`);
      expect(normalizedStdout).toContain('[runtime-preview] extensionLibraryRoots=');
      expect(normalizedStdout).toContain('[runtime-preview]   extensionLibraryRoots: ');
      expect(normalizedStdout).toContain(`[runtime-preview] projectProgrammingRoot=${slash(expectedProjectProgrammingRoot)}`);
      expect(normalizedStdout).toContain(`[runtime-preview]   programmingRoot: ${slash(expectedProjectProgrammingRoot)}`);
      expect(normalizedStdout).toContain(`[runtime-preview] cliProgrammingRoot=${slash(expectedProjectProgrammingRoot)}`);
      expect(normalizedStdout).toContain(`[runtime-preview]   internalLibraryRoot: ${slash(expectedInternalLibraryRoot)}`);
      expect(normalizedStdout).toContain('[runtime-preview]   logFilePath: ');
      expect(normalizedStdout).toMatch(/\[runtime-preview\] engine:init:done durationMs=\d+/);
      expect(normalizedStdout).toMatch(/\[runtime-preview\] asset-db:done durationMs=\d+/);
      expect(normalizedStdout).toMatch(/\[runtime-preview\] builder:init:done durationMs=\d+/);
      expect(normalizedStdout).toMatch(/\[runtime-preview\] settings:build:done durationMs=\d+ scene=/);
      expect(normalizedStdout).toMatch(/\[runtime-preview\] preview:ready durationMs=\d+/);
      expect(activeOutputBlock).not.toContain('[runtime-preview]   projectProgrammingRoot:');
      expect(activeOutputBlock).not.toContain('[runtime-preview]   cliProgrammingRoot:');
      expect(normalizedStdout).not.toContain('.codex-tmp/reference-library');
      expect(normalizedStdout).not.toContain('.codex-tmp/reference-temp');
      const normalizedCliCommand = `${cli.command} ${cli.args.join(' ')}`.replace(/\\/g, '/');
      expect(normalizedCliCommand).toContain('/dist/cli.js');
      expect(normalizedCliCommand).not.toContain('/tsx/');
      expect(normalizedCliCommand).not.toContain('--settings-timeout-ms');
      expect(cli.stdout).toContain('[runtime-preview] preview:ready');

      const resolutionDetailMapPath = join(
        expectedProjectProgrammingRoot,
        'packer-driver',
        'targets',
        'preview',
        'resolution-detail-map.json',
      );
      expect(existsSync(resolutionDetailMapPath), 'real CLI programming output should include resolution-detail-map.json').toBe(true);
      const resolutionDetailMapText = await readFile(resolutionDetailMapPath, 'utf8');
      expect(resolutionDetailMapText).toContain('@tbmp/mp-cloud-sdk');
      expect(resolutionDetailMapText).toContain('Failed to resolve CommonJS bare specifier');
      expect(resolutionDetailMapText).not.toContain('runtime-preview-stubs');

      const sceneListResponse = await fetch(`${cli.url}/scene-list`);
      expect(sceneListResponse.status).toBe(200);
      const sceneList = await sceneListResponse.json() as {
        scenes: PreviewSceneRecord[];
        currentScene: string;
      };
      const selectedScenes = selectRequiredScenes(sceneList.scenes);

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
          `runtime-preview-cli-generated-output-scene-${scene.uuid}.json`,
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
            projectLibraryRoot: expectedProjectLibraryRoot,
            projectProgrammingRoot: expectedProjectProgrammingRoot,
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
        expect(smoke.networkRequestCount).toBeGreaterThan(0);
        sceneResults.push({
          scene,
          elapsedReadyMs: smoke.elapsedReadyMs,
          elapsedTotalMs: smoke.elapsedTotalMs,
          networkRequestCount: smoke.networkRequestCount,
          evidenceFilePath,
        });
      }

      const runtimeLog = await readFile(cli.logFilePath!, 'utf8');
      expect(runtimeLog).toContain('active-output:');
      expect(runtimeLog).toContain(`  url: ${cli.url}`);
      expect(runtimeLog).toContain(`  libraryRoot: ${expectedProjectLibraryRoot}`);
      expect(runtimeLog).toContain('  extensionLibraryRoots: ');
      expect(runtimeLog).toContain(`  programmingRoot: ${expectedProjectProgrammingRoot}`);
      expect(runtimeLog).toMatch(/engine:init:done durationMs=\d+/);
      expect(runtimeLog).toMatch(/asset-db:done durationMs=\d+/);
      expect(runtimeLog).toMatch(/builder:init:done durationMs=\d+/);
      expect(runtimeLog).toMatch(/settings:build:done durationMs=\d+ scene=/);
      expect(runtimeLog).toMatch(/preview:ready durationMs=\d+/);
      const forbiddenLogHits = forbiddenServerLogPatterns.filter((pattern) => runtimeLog.includes(pattern));
      expect(forbiddenLogHits).toEqual([]);

      await writeFile(evidenceSummaryFilePath, `${JSON.stringify({
        status: 'pass',
        cliPid: cli.pid,
        cliCommand: `${cli.command} ${cli.args.join(' ')}`,
        serverUrl: cli.url,
        logFilePath: cli.logFilePath,
        elapsedStartupMs: cli.elapsedStartupMs,
        projectLibraryRoot: expectedProjectLibraryRoot,
        extensionLibraryRoots,
        projectProgrammingRoot: expectedProjectProgrammingRoot,
        currentScene: sceneList.currentScene,
        sceneResults,
      }, null, 2)}\n`, 'utf8');
    } finally {
      closeResult = await cli.close();
    }

    expect(closeResult.portReleased).toBe(true);
  }, 480_000);
});
