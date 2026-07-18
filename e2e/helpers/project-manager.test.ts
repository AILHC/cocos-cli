import { mkdtemp } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { outputFile, pathExists, readFile, remove } from 'fs-extra';

import { E2EProjectManager, TestProject } from './project-manager';

type ProjectFactory = (
    manager: E2EProjectManager,
    sourceProject: string,
    projectName: string,
) => Promise<TestProject>;

const PROJECT_FACTORIES: Array<[string, ProjectFactory]> = [
    [
        'createTestProject',
        (manager, sourceProject, projectName) => manager.createTestProject(sourceProject, projectName),
    ],
    [
        'getSharedProject',
        (manager, sourceProject, projectName) => manager.getSharedProject(sourceProject, projectName),
    ],
    [
        'createTempProject',
        (manager, sourceProject) => manager.createTempProject(sourceProject),
    ],
];

describe('E2EProjectManager source isolation', () => {
    test.each(PROJECT_FACTORIES)('%s leaves source files untouched and cleans only the target', async (
        _factoryName,
        createProject,
    ) => {
        const sandbox = await mkdtemp(join(tmpdir(), 'cocos-e2e-project-manager-'));
        const sourceProject = join(sandbox, 'source');
        const workspaceRoot = join(sandbox, 'workspace');
        const manager = new E2EProjectManager({ workspaceRoot });
        let project: TestProject | undefined;

        const sourceSettings = join(sourceProject, 'settings', 'project.json');
        const sourceCocosCache = join(sourceProject, 'library', 'cache.bin');
        const sourceIgnoredCache = join(sourceProject, 'custom-cache', 'ignored.bin');
        const sourceNodeModules = join(sourceProject, 'node_modules', 'fixture-package', 'index.js');
        const sourceAsset = join(sourceProject, 'assets', 'keep.txt');

        try {
            await outputFile(join(sourceProject, '.gitignore'), 'custom-cache/\n');
            await outputFile(sourceSettings, 'tracked settings');
            await outputFile(sourceCocosCache, 'generated library');
            await outputFile(sourceIgnoredCache, 'ignored cache');
            await outputFile(sourceNodeModules, 'generated dependency');
            await outputFile(sourceAsset, 'source asset');

            await manager.initialize();
            project = await createProject(manager, sourceProject, 'isolated-copy');

            await expect(readFile(sourceSettings, 'utf8')).resolves.toBe('tracked settings');
            await expect(readFile(sourceCocosCache, 'utf8')).resolves.toBe('generated library');
            await expect(readFile(sourceIgnoredCache, 'utf8')).resolves.toBe('ignored cache');
            await expect(readFile(sourceNodeModules, 'utf8')).resolves.toBe('generated dependency');

            await expect(readFile(join(project.path, 'assets', 'keep.txt'), 'utf8')).resolves.toBe('source asset');
            await expect(pathExists(join(project.path, 'settings'))).resolves.toBe(false);
            await expect(pathExists(join(project.path, 'library'))).resolves.toBe(false);
            await expect(pathExists(join(project.path, 'custom-cache'))).resolves.toBe(false);
            await expect(pathExists(join(project.path, 'node_modules'))).resolves.toBe(false);
        } finally {
            await project?.cleanup();
            await manager.cleanupAll();
            await remove(sandbox);
        }
    });
});
