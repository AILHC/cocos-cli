import { isAbsolute, resolve } from 'path';
import { readJSON } from 'fs-extra';
import { GlobalPaths } from '../global';

export type LauncherEngineRootSource = 'test-env' | 'project-config' | 'cli-initialized' | 'global-fallback';

export interface LauncherEngineRootResolution {
    engineRoot: string;
    source: LauncherEngineRootSource;
}

interface ProjectPackageJson {
    'cocos-cli'?: {
        enginePath?: unknown;
    };
}

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
        engineRoot: resolve(GlobalPaths.enginePath),
        source: 'global-fallback',
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
    return isAbsolute(trimmedEnginePath)
        ? resolve(trimmedEnginePath)
        : resolve(projectPath, trimmedEnginePath);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
    return error instanceof Error && 'code' in error;
}
