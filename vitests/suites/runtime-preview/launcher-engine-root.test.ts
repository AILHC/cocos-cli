import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveLauncherEngineRoot } from '../../../src/core/launcher-engine-root';

const originalTestProjectRoot = process.env.COCOS_CLI_TEST_PROJECT_ROOT;
const originalTestEngineRoot = process.env.COCOS_CLI_TEST_ENGINE_ROOT;

async function createProjectWithEnginePath(enginePath: string): Promise<string> {
  const projectRoot = await mkdtemp(join(tmpdir(), 'runtime-preview-engine-root-'));
  await writeFile(join(projectRoot, 'package.json'), JSON.stringify({
    name: 'engine-root-fixture',
    type: '3d',
    version: '3.8.6',
    uuid: '00000000-0000-4000-8000-000000000001',
    creator: {
      version: '3.8.6',
    },
    'cocos-cli': {
      enginePath,
    },
  }, null, 2));
  return projectRoot;
}

describe('Launcher engine root resolution', () => {
  afterEach(() => {
    if (originalTestProjectRoot === undefined) {
      delete process.env.COCOS_CLI_TEST_PROJECT_ROOT;
    } else {
      process.env.COCOS_CLI_TEST_PROJECT_ROOT = originalTestProjectRoot;
    }
    if (originalTestEngineRoot === undefined) {
      delete process.env.COCOS_CLI_TEST_ENGINE_ROOT;
    } else {
      process.env.COCOS_CLI_TEST_ENGINE_ROOT = originalTestEngineRoot;
    }
  });

  it('uses package.json cocos-cli.enginePath for production no-env startup', async () => {
    delete process.env.COCOS_CLI_TEST_PROJECT_ROOT;
    delete process.env.COCOS_CLI_TEST_ENGINE_ROOT;
    const configuredEngineRoot = 'D:/workspace/engines/cocos/3.8.6';
    const projectRoot = await createProjectWithEnginePath(configuredEngineRoot);

    const result = await resolveLauncherEngineRoot(projectRoot);

    expect(result).toEqual({
      engineRoot: resolve(configuredEngineRoot),
      source: 'project-config',
    });
  });

  it('uses test env only when the test project root matches', async () => {
    const configuredEngineRoot = 'D:/workspace/engines/cocos/3.8.6';
    const projectRoot = await createProjectWithEnginePath(configuredEngineRoot);
    process.env.COCOS_CLI_TEST_PROJECT_ROOT = projectRoot;
    process.env.COCOS_CLI_TEST_ENGINE_ROOT = 'E:/test/engine';

    await expect(resolveLauncherEngineRoot(projectRoot)).resolves.toEqual({
      engineRoot: resolve('E:/test/engine'),
      source: 'test-env',
    });

    process.env.COCOS_CLI_TEST_PROJECT_ROOT = join(projectRoot, 'other');

    await expect(resolveLauncherEngineRoot(projectRoot)).resolves.toEqual({
      engineRoot: resolve(configuredEngineRoot),
      source: 'project-config',
    });
  });

  it('uses the CLI initialized engine root when project package config is absent', async () => {
    delete process.env.COCOS_CLI_TEST_PROJECT_ROOT;
    delete process.env.COCOS_CLI_TEST_ENGINE_ROOT;
    const projectRoot = await mkdtemp(join(tmpdir(), 'runtime-preview-engine-root-no-package-'));

    await expect(resolveLauncherEngineRoot(projectRoot, {
      cliInitializedEngineRoot: 'E:/cli/initialized/engine',
    })).resolves.toEqual({
      engineRoot: resolve('E:/cli/initialized/engine'),
      source: 'cli-initialized',
    });
  });
});
