import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join, resolve } from 'path';
import { resolveLauncherEngineRoot } from '../launcher-engine-root';

const originalEnv = {
    COCOS_CLI_TEST_ENGINE_ROOT: process.env.COCOS_CLI_TEST_ENGINE_ROOT,
    COCOS_CLI_TEST_PROJECT_ROOT: process.env.COCOS_CLI_TEST_PROJECT_ROOT,
    COCOS_CLI_CREATOR_PROFILE_ROOT: process.env.COCOS_CLI_CREATOR_PROFILE_ROOT,
};

function writeJson(file: string, data: Record<string, unknown>): void {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}

function createDir(path: string): string {
    mkdirSync(path, { recursive: true });
    return path;
}

function writeProjectPackage(projectRoot: string, enginePath?: string): void {
    const packageJson: Record<string, unknown> = {
        name: 'launcher-engine-root-fixture',
        version: '1.0.0',
    };
    if (enginePath !== undefined) {
        packageJson['cocos-cli'] = {
            enginePath,
        };
    }
    writeJson(join(projectRoot, 'package.json'), packageJson);
}

function writeCreatorEngineProfile(
    profileRoot: string,
    data: Record<string, unknown>,
): void {
    writeJson(
        join(profileRoot, '.CocosCreator', 'profiles', 'v2', 'packages', 'engine.json'),
        data,
    );
}

function creatorEngineProfile(
    javascript: Record<string, unknown>,
): Record<string, unknown> {
    return {
        engine: {
            386: {
                javascript,
            },
        },
    };
}

function resetEnv(): void {
    for (const key of Object.keys(originalEnv) as Array<keyof typeof originalEnv>) {
        const originalValue = originalEnv[key];
        if (originalValue === undefined) {
            delete process.env[key];
        } else {
            process.env[key] = originalValue;
        }
    }
}

describe('resolveLauncherEngineRoot', () => {
    let fixtureRoot: string;
    let projectRoot: string;
    let profileRoot: string;
    let projectEngineRoot: string;
    let creatorEngineRoot: string;

    beforeEach(() => {
        fixtureRoot = mkdtempSync(join(tmpdir(), 'cocos-cli-launcher-engine-root-'));
        projectRoot = createDir(join(fixtureRoot, 'project'));
        profileRoot = createDir(join(fixtureRoot, 'profile'));
        projectEngineRoot = createDir(join(fixtureRoot, 'project-engine'));
        creatorEngineRoot = createDir(join(fixtureRoot, 'creator-engine'));
        delete process.env.COCOS_CLI_TEST_ENGINE_ROOT;
        delete process.env.COCOS_CLI_TEST_PROJECT_ROOT;
        process.env.COCOS_CLI_CREATOR_PROFILE_ROOT = profileRoot;
    });

    afterEach(() => {
        rmSync(fixtureRoot, { recursive: true, force: true });
        resetEnv();
    });

    it('uses project config before creator profile', async () => {
        writeProjectPackage(projectRoot, projectEngineRoot);
        writeCreatorEngineProfile(profileRoot, creatorEngineProfile({
            builtin: false,
            custom: creatorEngineRoot,
        }));

        await expect(resolveLauncherEngineRoot(projectRoot)).resolves.toEqual({
            engineRoot: resolve(projectEngineRoot),
            source: 'project-config',
        });
    });

    it('resolves relative project enginePath from project root', async () => {
        const relativeEnginePath = 'engines/custom-cocos';
        const relativeEngineRoot = createDir(join(projectRoot, relativeEnginePath));
        writeProjectPackage(projectRoot, relativeEnginePath);

        await expect(resolveLauncherEngineRoot(projectRoot)).resolves.toEqual({
            engineRoot: resolve(relativeEngineRoot),
            source: 'project-config',
        });
    });

    it('rejects missing absolute project enginePath instead of falling back', async () => {
        writeProjectPackage(projectRoot, join(fixtureRoot, 'missing-absolute-engine'));
        writeCreatorEngineProfile(profileRoot, creatorEngineProfile({
            builtin: false,
            custom: creatorEngineRoot,
        }));

        await expect(resolveLauncherEngineRoot(projectRoot)).rejects.toThrow('Configured project enginePath does not exist');
    });

    it('rejects missing relative project enginePath instead of falling back', async () => {
        writeProjectPackage(projectRoot, 'missing-engine');
        writeCreatorEngineProfile(profileRoot, creatorEngineProfile({
            builtin: false,
            custom: creatorEngineRoot,
        }));

        await expect(resolveLauncherEngineRoot(projectRoot)).rejects.toThrow('Configured project enginePath does not exist');
    });

    it('uses project config before cliInitializedEngineRoot', async () => {
        const cliInitializedEngineRoot = createDir(join(fixtureRoot, 'cli-initialized-engine'));
        writeProjectPackage(projectRoot, projectEngineRoot);

        await expect(resolveLauncherEngineRoot(projectRoot, {
            cliInitializedEngineRoot,
        })).resolves.toEqual({
            engineRoot: resolve(projectEngineRoot),
            source: 'project-config',
        });
    });

    it('keeps cliInitializedEngineRoot source when project config is absent', async () => {
        writeCreatorEngineProfile(profileRoot, creatorEngineProfile({
            builtin: false,
            custom: creatorEngineRoot,
        }));

        await expect(resolveLauncherEngineRoot(projectRoot, {
            cliInitializedEngineRoot: projectEngineRoot,
        })).resolves.toEqual({
            engineRoot: resolve(projectEngineRoot),
            source: 'cli-initialized',
        });
    });

    it('uses creator profile custom engine when project config is absent', async () => {
        writeCreatorEngineProfile(profileRoot, creatorEngineProfile({
            builtin: false,
            custom: creatorEngineRoot,
        }));

        await expect(resolveLauncherEngineRoot(projectRoot)).resolves.toEqual({
            engineRoot: resolve(creatorEngineRoot),
            source: 'creator-profile',
        });
    });

    it('rejects missing creator profile engine file', async () => {
        expect(existsSync(join(profileRoot, '.CocosCreator', 'profiles', 'v2', 'packages', 'engine.json'))).toBe(false);

        await expect(resolveLauncherEngineRoot(projectRoot)).rejects.toThrow('Creator profile engine config not found');
    });

    it('rejects creator profile without supported 386 key', async () => {
        writeCreatorEngineProfile(profileRoot, {
            engine: {
                385: {
                    javascript: {
                        builtin: false,
                        custom: creatorEngineRoot,
                    },
                },
            },
        });

        await expect(resolveLauncherEngineRoot(projectRoot)).rejects.toThrow('Creator profile engine config is missing supported version 386');
    });

    it('rejects builtin creator profile engine even when custom path exists', async () => {
        writeCreatorEngineProfile(profileRoot, creatorEngineProfile({
            builtin: true,
            custom: creatorEngineRoot,
        }));

        await expect(resolveLauncherEngineRoot(projectRoot)).rejects.toThrow('Creator profile engine 386 is configured as builtin');
    });

    it('rejects creator profile custom engine path when it does not exist', async () => {
        writeCreatorEngineProfile(profileRoot, creatorEngineProfile({
            builtin: false,
            custom: join(fixtureRoot, 'missing-creator-engine'),
        }));

        await expect(resolveLauncherEngineRoot(projectRoot)).rejects.toThrow('Creator profile engine 386 javascript.custom does not exist');
    });

    it('uses test env only when project root matches, otherwise creator profile', async () => {
        const testEngineRoot = createDir(join(fixtureRoot, 'test-engine'));
        process.env.COCOS_CLI_TEST_ENGINE_ROOT = testEngineRoot;
        process.env.COCOS_CLI_TEST_PROJECT_ROOT = projectRoot;
        writeCreatorEngineProfile(profileRoot, creatorEngineProfile({
            builtin: false,
            custom: creatorEngineRoot,
        }));

        await expect(resolveLauncherEngineRoot(projectRoot)).resolves.toEqual({
            engineRoot: resolve(testEngineRoot),
            source: 'test-env',
        });

        process.env.COCOS_CLI_TEST_PROJECT_ROOT = join(fixtureRoot, 'other-project');

        await expect(resolveLauncherEngineRoot(projectRoot)).resolves.toEqual({
            engineRoot: resolve(creatorEngineRoot),
            source: 'creator-profile',
        });
    });
});
