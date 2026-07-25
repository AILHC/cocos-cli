/**
 * project root 向上解析与 canonicalization 的单测(临时 fixture + 真实 fs,另含 fake fs 用例)。
 * 覆盖:嵌套 cwd、最近项目优先、node_modules 跳过、找不到时的报错提示、realpath 归一。
 */
import { mkdirSync, realpathSync } from 'fs';
import { join, resolve } from 'path';
import { canonicalizeProjectRoot, isCocosProjectRoot, resolveProjectRootFromCwd } from '../project-root';
import { resolvePreviewSessionDeps, type PreviewSessionFileSystem } from '../deps';
import { cleanupFixtureRoot, createFixtureRoot, createProjectFixture } from './helpers';

const nodeFs = resolvePreviewSessionDeps().fs;

describe('resolveProjectRootFromCwd', () => {
    let fixtureRoot: string;
    let projectRoot: string;

    beforeEach(() => {
        fixtureRoot = createFixtureRoot();
        projectRoot = createProjectFixture(fixtureRoot);
    });

    afterEach(() => {
        cleanupFixtureRoot(fixtureRoot);
    });

    it('resolves the project root from a nested cwd', async () => {
        const nested = join(projectRoot, 'assets', 'scenes', 'main');
        mkdirSync(nested, { recursive: true });

        await expect(resolveProjectRootFromCwd(nested, nodeFs)).resolves.toBe(projectRoot);
    });

    it('picks the nearest directory carrying all three markers', async () => {
        // assets/ 下恰好三标志齐全的子目录会截胡(已知边界,取最近者)。
        const inner = createProjectFixture(join(projectRoot, 'assets'), 'inner-project');
        const nested = join(inner, 'assets', 'deep');
        mkdirSync(nested, { recursive: true });

        await expect(resolveProjectRootFromCwd(nested, nodeFs)).resolves.toBe(inner);
    });

    it('skips projects nested inside node_modules', async () => {
        // 嵌套于 node_modules 的项目不可达(已知边界)。
        const inner = createProjectFixture(join(projectRoot, 'node_modules'), 'pkg-project');
        const nested = join(inner, 'assets', 'deep');
        mkdirSync(nested, { recursive: true });

        await expect(resolveProjectRootFromCwd(nested, nodeFs)).resolves.toBe(projectRoot);
    });

    it('skips a node_modules directory itself even if it carries markers', async () => {
        const nodeModules = join(projectRoot, 'node_modules');
        mkdirSync(join(nodeModules, 'assets'), { recursive: true });
        mkdirSync(join(nodeModules, 'settings'), { recursive: true });

        await expect(resolveProjectRootFromCwd(nodeModules, nodeFs)).resolves.toBe(projectRoot);
    });

    it('throws an actionable error mentioning --project / --url when nothing matches', async () => {
        const outside = join(fixtureRoot, 'nowhere', 'deep');
        mkdirSync(outside, { recursive: true });

        await expect(resolveProjectRootFromCwd(outside, nodeFs)).rejects.toThrow(/--project/);
        await expect(resolveProjectRootFromCwd(outside, nodeFs)).rejects.toThrow(/--url/);
    });
});

describe('isCocosProjectRoot', () => {
    let fixtureRoot: string;

    beforeEach(() => {
        fixtureRoot = createFixtureRoot();
    });

    afterEach(() => {
        cleanupFixtureRoot(fixtureRoot);
    });

    it('requires package.json + assets/ + settings/', async () => {
        const root = createProjectFixture(fixtureRoot);
        await expect(isCocosProjectRoot(root, nodeFs)).resolves.toBe(true);

        const missing = join(fixtureRoot, 'incomplete');
        mkdirSync(join(missing, 'assets'), { recursive: true });
        // 缺 package.json 与 settings/
        await expect(isCocosProjectRoot(missing, nodeFs)).resolves.toBe(false);
    });
});

describe('canonicalizeProjectRoot', () => {
    let fixtureRoot: string;

    beforeEach(() => {
        fixtureRoot = createFixtureRoot();
    });

    afterEach(() => {
        cleanupFixtureRoot(fixtureRoot);
    });

    it('normalizes dot segments to the realpath canonical form', async () => {
        const projectRoot = createProjectFixture(fixtureRoot);
        const messy = join(projectRoot, 'assets', '..');
        await expect(canonicalizeProjectRoot(messy, nodeFs)).resolves.toBe(realpathSync(projectRoot));
    });

    it('uses the fs realpath result', async () => {
        const fs: PreviewSessionFileSystem = {
            ...nodeFs,
            realpath: async () => join(fixtureRoot, 'canonical-root'),
        };
        await expect(canonicalizeProjectRoot(join(fixtureRoot, 'alias'), fs))
            .resolves.toBe(resolve(join(fixtureRoot, 'canonical-root')));
    });

    it('falls back to resolve when realpath fails', async () => {
        const fs: PreviewSessionFileSystem = {
            ...nodeFs,
            realpath: async () => {
                throw new Error('no such file');
            },
        };
        const input = join(fixtureRoot, 'missing');
        await expect(canonicalizeProjectRoot(input, fs)).resolves.toBe(resolve(input));
    });
});
