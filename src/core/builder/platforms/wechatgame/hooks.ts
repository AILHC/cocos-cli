'use strict';

import Ejs from 'ejs';
import { copyFileSync, existsSync, outputFileSync, readJsonSync, readdirSync, statSync } from 'fs-extra';
import { join } from 'path';
import { IBuilder, BuilderCache, InternalBuildResult } from '../../@types/protected';
import { relativeUrl } from '../../worker/builder/utils';
import { IBuildResult, IWechatGameInternalBuildOptions } from './type';

export const throwError = true;

const capturedSubpackageNames = new WeakMap<InternalBuildResult, string[]>();

function getInternalTemplateDir(options: IWechatGameInternalBuildOptions) {
    return join(options.engineInfo.typescript.path, 'templates/wechatgame');
}

function getAdapterDir(options: IWechatGameInternalBuildOptions) {
    return join(options.engineInfo.typescript.path, 'bin/adapter/minigame/wechat');
}

function assertFileExists(file: string) {
    if (!existsSync(file)) {
        throw new Error(`Wechatgame build requires missing file: ${file}`);
    }
}

function readJsonTemplate<T>(file: string): T {
    assertFileExists(file);
    return readJsonSync(file) as T;
}

function writeJson(file: string, data: unknown, pretty = true) {
    outputFileSync(file, JSON.stringify(data, null, pretty ? 4 : 0), 'utf8');
}

function uniqueStringList(values: string[]) {
    return Array.from(new Set(values.filter(Boolean)));
}

function querySubpackageNames(result: InternalBuildResult) {
    const captured = capturedSubpackageNames.get(result) ?? [];
    if (captured.length) {
        return captured;
    }

    const root = result.paths.subpackages;
    if (!existsSync(root)) {
        return [];
    }
    return readdirSync(root)
        .filter((name) => statSync(join(root, name)).isDirectory());
}

function copyWechatAdapters(options: IWechatGameInternalBuildOptions, result: InternalBuildResult) {
    const adapterDir = getAdapterDir(options);
    for (const name of ['web-adapter', 'engine-adapter']) {
        const src = join(adapterDir, `${name}.${options.debug ? '' : 'min.'}js`);
        const dest = join(result.paths.dir, `${name}.js`);
        assertFileExists(src);
        copyFileSync(src, dest);
    }
}

function copyFirstScreenAssets(options: IWechatGameInternalBuildOptions, result: InternalBuildResult) {
    const templateDir = getInternalTemplateDir(options);
    for (const name of ['logo.png', 'slogan.png']) {
        const src = join(templateDir, name);
        assertFileExists(src);
        copyFileSync(src, join(result.paths.dir, name));
    }
}

async function renderGameJs(
    builder: IBuilder,
    options: IWechatGameInternalBuildOptions,
    result: InternalBuildResult,
) {
    const templateDir = getInternalTemplateDir(options);
    const gameTemplate = builder.buildTemplate.initUrl('game.ejs') || join(templateDir, 'game.ejs');
    const cocosTemplate = builder.buildTemplate.initUrl('cocos-script.ejs', 'cocosScript') || join(templateDir, 'cocos-script.ejs');
    assertFileExists(gameTemplate);
    assertFileExists(cocosTemplate);

    const content = await Ejs.renderFile(gameTemplate, {
        polyfillsBundleFile: result.paths.polyfillsJs && relativeUrl(result.paths.dir, result.paths.polyfillsJs) || false,
        systemJsBundleFile: relativeUrl(result.paths.dir, result.paths.systemJs!),
        importMapFile: relativeUrl(result.paths.dir, result.paths.importMap),
        applicationJs: `./${relativeUrl(result.paths.dir, result.paths.applicationJS)}`,
        cocosTemplate,
        alpha: 'default',
        antialias: 'default',
        useWebgl2: String(options.includeModules.includes('gfx-webgl2')),
    });
    outputFileSync(join(result.paths.dir, 'game.js'), content, 'utf8');
    if (!options.md5CacheOptions.replaceOnly.includes('game.js')) {
        options.md5CacheOptions.replaceOnly.push('game.js');
    }
}

async function renderFirstScreen(
    builder: IBuilder,
    options: IWechatGameInternalBuildOptions,
    result: InternalBuildResult,
) {
    const templateDir = getInternalTemplateDir(options);
    const template = builder.buildTemplate.initUrl('first-screen.ejs', 'firstScreen') || join(templateDir, 'first-screen.ejs');
    assertFileExists(template);

    const content = await Ejs.renderFile(template, {
        displayRatio: 1,
        bgColor: '0.01568627450980392,0.03529411764705882,0.0392156862745098,0.00392156862745098',
        useCustomBg: false,
        useLogo: true,
        useDefaultLogo: true,
        logoName: 'logo.png',
        bgName: 'background.png',
        fitWidth: true,
        fitHeight: true,
    });
    outputFileSync(join(result.paths.dir, 'first-screen.js'), content, 'utf8');
}

function renderGameJson(
    builder: IBuilder,
    options: IWechatGameInternalBuildOptions,
    result: InternalBuildResult,
) {
    const templateDir = getInternalTemplateDir(options);
    const template = builder.buildTemplate.initUrl('game.json') || join(templateDir, 'game.json');
    const gameJson = readJsonTemplate<Record<string, unknown>>(template);
    const packageOptions = options.packages.wechatgame;
    const subpackageNames = querySubpackageNames(result);

    gameJson.deviceOrientation = packageOptions.orientation;
    delete gameJson.openDataContext;
    if (packageOptions.highPerformanceMode) {
        gameJson.iOSHighPerformance = true;
    } else {
        delete gameJson.iOSHighPerformance;
    }
    if (subpackageNames.length) {
        gameJson.subpackages = subpackageNames.map((name) => ({
            name,
            root: `subpackages/${name}/`,
        }));
    } else {
        delete gameJson.subpackages;
    }

    writeJson(join(result.paths.dir, 'game.json'), gameJson);
}

function renderProjectConfig(
    builder: IBuilder,
    options: IWechatGameInternalBuildOptions,
    result: InternalBuildResult,
) {
    const templateDir = getInternalTemplateDir(options);
    const template = builder.buildTemplate.initUrl('project.config.json') || join(templateDir, 'project.config.json');
    const projectConfig = readJsonTemplate<Record<string, unknown>>(template);
    const packageOptions = options.packages.wechatgame;

    projectConfig.appid = packageOptions.appid;
    projectConfig.projectname = options.name;
    writeJson(join(result.paths.dir, 'project.config.json'), projectConfig, false);
}

function ensureSubpackageEntries(result: InternalBuildResult) {
    const subpackageNames = querySubpackageNames(result);
    for (const name of subpackageNames) {
        outputFileSync(
            join(result.paths.subpackages, name, 'game.js'),
            "console.log('ejs: no script in subPackage.')",
            'utf8',
        );
    }
}

function normalizeScriptPackageUrl(url: string) {
    const normalized = url.replace(/\\/g, '/');
    if (normalized.startsWith('../src/')) {
        return `project://src/${normalized.slice('../src/'.length)}`;
    }
    return normalized;
}

export async function onAfterInit(options: IWechatGameInternalBuildOptions) {
    options.buildEngineParam.split = false;
    options.buildEngineParam.assetURLFormat = 'runtime-resolved';
    if (options.server && !options.server.endsWith('/')) {
        options.server += '/';
    }
}

export function onBeforeBundleInit(options: IWechatGameInternalBuildOptions) {
    options.moveRemoteBundleScript = true;
    options.assetSerializeOptions.exportCCON = true;
    options.assetSerializeOptions.useCCONB = false;
    if (options.polyfills) {
        options.polyfills.asyncFunctions = false;
    }
    options.buildScriptParam.platform = 'WECHAT';
    options.buildScriptParam.system = { preset: 'commonjs-like' };
    options.buildScriptParam.importMapFormat = 'commonjs';
}

export async function onBeforeCompressSettings(
    this: IBuilder,
    options: IWechatGameInternalBuildOptions,
    result: InternalBuildResult,
    _cache: BuilderCache,
) {
    const subpackageNames = uniqueStringList([
        ...result.settings.assets.subpackages,
        ...this.bundleManager.bundles.filter((bundle) => bundle.isSubpackage).map((bundle) => bundle.name),
    ]);
    capturedSubpackageNames.set(result, subpackageNames);
    result.settings.assets.subpackages = [];
    result.settings.scripting.scriptPackages = (result.settings.scripting.scriptPackages ?? []).map(normalizeScriptPackageUrl);
    result.settings.screen.orientation = options.packages.wechatgame.orientation;
}

export async function onBeforeCopyBuildTemplate(
    this: IBuilder,
    options: IWechatGameInternalBuildOptions,
    result: IBuildResult,
) {
    copyWechatAdapters(options, result);
    copyFirstScreenAssets(options, result);
    await renderGameJs(this, options, result);
    await renderFirstScreen(this, options, result);
    renderGameJson(this, options, result);
    renderProjectConfig(this, options, result);
    ensureSubpackageEntries(result);
}
