import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  collectTopLevelPartitionCounts,
  extractGameJsLocalReferences,
  normalizeJson,
  pathExistsAsDirectory,
  readJsonFile,
  resolveWechatgameLocalReference,
  sha256File,
} from '@shared/wechatgame-baseline-parity';

interface WechatGameBuildConfig {
  platform: string;
  debug: boolean;
  md5Cache: boolean;
  sourceMaps: boolean;
  name: string;
  startScene: string;
  scenes: Array<{ uuid: string; url: string }>;
  packages: {
    wechatgame: {
      orientation: 'portrait' | 'landscape';
      appid: string;
      separateEngine: boolean;
      highPerformanceMode: boolean;
    };
  };
}

interface GameJson {
  deviceOrientation: string;
  iOSHighPerformance?: boolean;
  subpackages?: Array<{ name: string; root: string }>;
}

interface ProjectConfigJson {
  appid: string;
  compileType: string;
  miniprogramRoot: string;
  projectname: string;
}

interface SettingsJson {
  engine: {
    platform: string;
    debug: boolean;
  };
  assets: {
    remoteBundles: string[];
    subpackages: unknown[];
    preloadBundles: Array<{ bundle: string }>;
    bundleVers: Record<string, string>;
  };
  plugins: {
    jsList: string[];
  };
  scripting: {
    scriptPackages: string[];
  };
  launch: {
    launchScene: string;
  };
}

interface BundleConfigJson {
  extensionMap?: Record<string, number[]>;
}

const baselineDir = process.env.COCOS_CLI_WECHATGAME_BASELINE_DIR;
const baselineConfig = process.env.COCOS_CLI_WECHATGAME_BASELINE_CONFIG;
const outputDir = process.env.COCOS_CLI_WECHATGAME_OUTPUT_DIR;
const engineRoot = process.env.COCOS_CLI_TEST_ENGINE_ROOT;

function requireEnv(name: string, value: string | undefined): string {
  expect(value, `${name} is required`).toBeTruthy();
  return value!;
}

async function findSingleFile(root: string, matcher: RegExp): Promise<string> {
  const matches = (await readdir(root)).filter((name) => matcher.test(name));
  expect(matches, `expected exactly one file matching ${matcher} in ${root}`).toHaveLength(1);
  return join(root, matches[0]);
}

async function findFilesByExtension(root: string, extension: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const file = join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...await findFilesByExtension(file, extension));
    } else if (entry.isFile() && file.endsWith(extension)) {
      files.push(file);
    }
  }
  return files;
}

function expectExistingFile(root: string, relativePath: string) {
  const file = join(root, relativePath);
  expect(existsSync(file), `missing ${relativePath}`).toBe(true);
  return file;
}

describe('wechatgame Editor baseline parity', () => {
  it('matches Editor 3.8.6 baseline runtime shape', async () => {
    const editorRoot = requireEnv('COCOS_CLI_WECHATGAME_BASELINE_DIR', baselineDir);
    const cliRoot = requireEnv('COCOS_CLI_WECHATGAME_OUTPUT_DIR', outputDir);
    const configPath = requireEnv('COCOS_CLI_WECHATGAME_BASELINE_CONFIG', baselineConfig);
    const engineSourceRoot = requireEnv('COCOS_CLI_TEST_ENGINE_ROOT', engineRoot);

    expect(existsSync(editorRoot), `missing Editor baseline ${editorRoot}`).toBe(true);
    expect(existsSync(cliRoot), `missing CLI output ${cliRoot}`).toBe(true);
    expect(existsSync(configPath), `missing baseline config ${configPath}`).toBe(true);

    const config = await readJsonFile<WechatGameBuildConfig>(configPath);
    expect(config.platform).toBe('wechatgame');
    expect(config.debug).toBe(false);
    expect(config.md5Cache).toBe(true);
    expect(config.sourceMaps).toBe(true);
    expect(config.packages.wechatgame).toEqual(expect.objectContaining({
      orientation: 'portrait',
      appid: 'wx6ac3f5090a6b99c5',
      separateEngine: false,
      highPerformanceMode: true,
    }));

    for (const relativePath of [
      'game.js',
      'game.json',
      'project.config.json',
      'web-adapter.js',
      'engine-adapter.js',
      'first-screen.js',
      'logo.png',
      'slogan.png',
    ]) {
      expectExistingFile(cliRoot, relativePath);
    }

    await expect(findSingleFile(cliRoot, /^application\.[^.]+\.js$/)).resolves.toBeTruthy();

    const cliGameJson = await readJsonFile<GameJson>(join(cliRoot, 'game.json'));
    const editorGameJson = await readJsonFile<GameJson>(join(editorRoot, 'game.json'));
    expect(normalizeJson(cliGameJson)).toEqual(normalizeJson(editorGameJson));
    expect(cliGameJson.deviceOrientation).toBe('portrait');
    expect(cliGameJson.iOSHighPerformance).toBe(true);
    expect(cliGameJson.subpackages?.map((item) => item.name).sort()).toEqual(['TestBundle', 'sub-pack-01', 'sub-pack-02', 'subPackage']);
    for (const item of cliGameJson.subpackages ?? []) {
      await expect(pathExistsAsDirectory(join(cliRoot, item.root)), `missing subpackage root ${item.root}`).resolves.toBe(true);
      expectExistingFile(cliRoot, join(item.root, 'game.js'));
    }

    const cliProjectConfig = await readJsonFile<ProjectConfigJson>(join(cliRoot, 'project.config.json'));
    const editorProjectConfig = await readJsonFile<ProjectConfigJson>(join(editorRoot, 'project.config.json'));
    expect(normalizeJson(cliProjectConfig)).toEqual(normalizeJson(editorProjectConfig));
    expect(cliProjectConfig).toEqual(expect.objectContaining({
      appid: 'wx6ac3f5090a6b99c5',
      compileType: 'game',
      miniprogramRoot: './',
      projectname: 'test-cases',
    }));

    await expect(sha256File(join(cliRoot, 'web-adapter.js'))).resolves.toBe(
      await sha256File(join(engineSourceRoot, 'bin/adapter/minigame/wechat/web-adapter.min.js')),
    );
    await expect(sha256File(join(cliRoot, 'engine-adapter.js'))).resolves.toBe(
      await sha256File(join(engineSourceRoot, 'bin/adapter/minigame/wechat/engine-adapter.min.js')),
    );

    const gameJsPath = join(cliRoot, 'game.js');
    const gameJs = await readFile(gameJsPath, 'utf8');
    expect(gameJs).toContain("require('./web-adapter')");
    expect(gameJs).toContain("require('./first-screen')");
    expect(gameJs).toContain("require('./engine-adapter')");
    expect(gameJs).toContain('GameGlobal.requestAnimationFrame');
    expect(gameJs.indexOf("require('./engine-adapter')")).toBeLessThan(gameJs.indexOf('application.init(cc)'));

    for (const request of extractGameJsLocalReferences(gameJs)) {
      const resolved = resolveWechatgameLocalReference(cliRoot, gameJsPath, request);
      expect(resolved, `missing game.js reference ${request}`).toBeTruthy();
    }

    const settingsPath = await findSingleFile(join(cliRoot, 'src'), /^settings\.[^.]+\.json$/);
    const settings = await readJsonFile<SettingsJson>(settingsPath);
    expect(settings.engine.platform).toBe('wechatgame');
    expect(settings.engine.debug).toBe(false);
    expect(settings.assets.remoteBundles).toEqual(['resources']);
    expect(settings.assets.subpackages).toEqual([]);
    expect(settings.assets.preloadBundles.map((item) => item.bundle).sort()).toEqual(['main', 'resources', 'start-scene']);

    const subpackageNames = new Set((cliGameJson.subpackages ?? []).map((subpackage) => subpackage.name));
    for (const [bundleName, version] of Object.entries(settings.assets.bundleVers)) {
      const configRoot = bundleName === 'resources'
        ? join(cliRoot, 'remote', bundleName)
        : subpackageNames.has(bundleName)
          ? join(cliRoot, 'subpackages', bundleName)
          : join(cliRoot, 'assets', bundleName);
      const configFile = join(configRoot, `config.${version}.json`);
      expect(existsSync(configFile), `missing bundle config ${configFile}`).toBe(true);
      if (bundleName === 'resources' || bundleName === 'start-scene') {
        const bundleConfig = await readJsonFile<BundleConfigJson>(configFile);
        expect(bundleConfig.extensionMap?.['.ccon']?.length, `${bundleName} should use CCON json/chunk format`).toBeGreaterThan(0);
        expect(bundleConfig.extensionMap?.['.cconb'], `${bundleName} should not use CCONB format`).toBeUndefined();
      }
    }
    expect(await findFilesByExtension(cliRoot, '.cconb')).toEqual([]);
    for (const url of settings.plugins.jsList) {
      expectExistingFile(join(cliRoot, 'src'), url);
    }
    for (const url of settings.scripting.scriptPackages) {
      const normalized = url.replace(/^project:\/\//, '');
      expectExistingFile(cliRoot, normalized);
    }
    expect(config.scenes.some((scene) => scene.uuid === config.startScene && scene.url === settings.launch.launchScene)).toBe(true);

    const counts = await collectTopLevelPartitionCounts(cliRoot);
    expect(counts).toEqual(await collectTopLevelPartitionCounts(editorRoot));

    const applicationJs = await findSingleFile(cliRoot, /^application\.[^.]+\.js$/);
    expect(basename(applicationJs)).toMatch(/^application\.[^.]+\.js$/);
  });
});
