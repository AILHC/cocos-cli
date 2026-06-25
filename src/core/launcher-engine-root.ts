import { existsSync } from 'fs';
import { homedir } from 'os';
import { isAbsolute, resolve } from 'path';
import { readJSON } from 'fs-extra';

export type LauncherEngineRootSource = 'test-env' | 'project-config' | 'cli-initialized' | 'creator-profile';

export interface LauncherEngineRootResolution {
    engineRoot: string;
    source: LauncherEngineRootSource;
}

interface ProjectPackageJson {
    'cocos-cli'?: {
        enginePath?: unknown;
    };
}

interface CreatorEngineProfile {
    engine?: unknown;
}

const SUPPORTED_CREATOR_PROFILE_ENGINE_KEY = '386';

export async function resolveLauncherEngineRoot(
    projectPath: string,
    options: { cliInitializedEngineRoot?: string } = {},
): Promise<LauncherEngineRootResolution> {
    const testEngineRoot = process.env.COCOS_CLI_TEST_ENGINE_ROOT;
    const testProjectRoot = process.env.COCOS_CLI_TEST_PROJECT_ROOT;
    if (testEngineRoot && testProjectRoot && resolve(projectPath) === resolve(testProjectRoot)) {
        return {
            engineRoot: resolve(testEngineRoot),
            source: 'test-env',
        };
    }

    const projectConfigEngineRoot = await readProjectConfigEngineRoot(projectPath);
    if (projectConfigEngineRoot) {
        return {
            engineRoot: projectConfigEngineRoot,
            source: 'project-config',
        };
    }

    if (options.cliInitializedEngineRoot) {
        return {
            engineRoot: resolve(options.cliInitializedEngineRoot),
            source: 'cli-initialized',
        };
    }

    return {
        engineRoot: await readCreatorProfileEngineRoot(),
        source: 'creator-profile',
    };
}

async function readProjectConfigEngineRoot(projectPath: string): Promise<string | null> {
    const packageJsonPath = resolve(projectPath, 'package.json');
    let packageJson: ProjectPackageJson;
    try {
        packageJson = await readJSON(packageJsonPath) as ProjectPackageJson;
    } catch (error) {
        if (isNodeError(error) && error.code === 'ENOENT') {
            return null;
        }
        throw error;
    }
    const configuredEnginePath = packageJson['cocos-cli']?.enginePath;
    if (typeof configuredEnginePath !== 'string' || configuredEnginePath.trim() === '') {
        return null;
    }
    const trimmedEnginePath = configuredEnginePath.trim();
    const engineRoot = isAbsolute(trimmedEnginePath)
        ? resolve(trimmedEnginePath)
        : resolve(projectPath, trimmedEnginePath);
    if (!existsSync(engineRoot)) {
        throw new Error(`Configured project enginePath does not exist: ${engineRoot}`);
    }
    return engineRoot;
}

async function readCreatorProfileEngineRoot(): Promise<string> {
    const profileRoot = process.env.COCOS_CLI_CREATOR_PROFILE_ROOT || homedir();
    const engineProfilePath = resolve(
        profileRoot,
        '.CocosCreator',
        'profiles',
        'v2',
        'packages',
        'engine.json',
    );
    let profile: CreatorEngineProfile;
    try {
        profile = await readJSON(engineProfilePath) as CreatorEngineProfile;
    } catch (error) {
        if (isNodeError(error) && error.code === 'ENOENT') {
            throw new Error(`Creator profile engine config not found: ${engineProfilePath}`);
        }
        throw error;
    }

    if (!isRecord(profile.engine)) {
        throw new Error('Creator profile engine config is missing engine section.');
    }
    const versionProfile = profile.engine[SUPPORTED_CREATOR_PROFILE_ENGINE_KEY];
    if (!isRecord(versionProfile)) {
        throw new Error(`Creator profile engine config is missing supported version ${SUPPORTED_CREATOR_PROFILE_ENGINE_KEY}.`);
    }
    const javascriptProfile = versionProfile.javascript;
    if (!isRecord(javascriptProfile)) {
        throw new Error(`Creator profile engine ${SUPPORTED_CREATOR_PROFILE_ENGINE_KEY} javascript config is missing.`);
    }
    if (javascriptProfile.builtin === true) {
        throw new Error(`Creator profile engine ${SUPPORTED_CREATOR_PROFILE_ENGINE_KEY} is configured as builtin.`);
    }
    if (javascriptProfile.builtin !== false) {
        throw new Error(`Creator profile engine ${SUPPORTED_CREATOR_PROFILE_ENGINE_KEY} javascript.builtin must be false.`);
    }
    const customEnginePath = javascriptProfile.custom;
    if (typeof customEnginePath !== 'string' || customEnginePath.trim() === '') {
        throw new Error(`Creator profile engine ${SUPPORTED_CREATOR_PROFILE_ENGINE_KEY} javascript.custom must be a non-empty string.`);
    }
    const engineRoot = resolve(customEnginePath.trim());
    if (!existsSync(engineRoot)) {
        throw new Error(`Creator profile engine ${SUPPORTED_CREATOR_PROFILE_ENGINE_KEY} javascript.custom does not exist: ${engineRoot}`);
    }
    return engineRoot;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
    return typeof error === 'object' && error !== null && 'code' in error;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
