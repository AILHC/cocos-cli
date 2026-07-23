import { existsSync } from 'fs';
import { join, resolve } from 'path';
import { GlobalPaths } from '../../global';
import { resolveLauncherEngineRoot, type LauncherEngineRootSource } from '../launcher-engine-root';

interface EngineCompilerModule {
    compileEngine(engineRoot: string, isWeb?: boolean): Promise<void>;
}

interface RebuildEngineCacheDependencies {
    compilerEntry?: string;
    loadCompiler?: (entry: string) => EngineCompilerModule;
}

export type CompileEngineTargetSource = LauncherEngineRootSource | 'explicit-engine';

export interface CompileEngineTarget {
    engineRoot: string;
    source: CompileEngineTargetSource;
    projectRoot?: string;
}

export interface CompileEngineTargetOptions {
    cwd: string;
    project?: string;
    engine?: string;
}

export async function resolveCompileEngineTarget(options: CompileEngineTargetOptions): Promise<CompileEngineTarget> {
    if (options.project && options.engine) {
        throw new Error('--project and --engine are mutually exclusive.');
    }

    if (options.engine) {
        const engineRoot = resolve(options.engine);
        assertEngineRoot(engineRoot);
        return {
            engineRoot,
            source: 'explicit-engine',
        };
    }

    const projectRoot = resolve(options.project ?? options.cwd);
    if (!existsSync(join(projectRoot, 'package.json'))) {
        throw new Error(`Not a valid Cocos project: ${projectRoot}`);
    }
    const resolution = await resolveLauncherEngineRoot(projectRoot);
    return {
        ...resolution,
        projectRoot,
    };
}

export async function rebuildEngineCache(
    engineRoot: string,
    dependencies: RebuildEngineCacheDependencies = {},
): Promise<string> {
    const resolvedEngineRoot = resolve(engineRoot);
    assertEngineRoot(resolvedEngineRoot);

    const compilerEntry = dependencies.compilerEntry
        ?? join(GlobalPaths.workspace, 'packages', 'engine-compiler', 'dist', 'index.js');
    if (!existsSync(compilerEntry)) {
        throw new Error(`Engine compiler is missing: ${compilerEntry}`);
    }

    const compiler = (dependencies.loadCompiler ?? ((entry) => require(entry)))(compilerEntry);
    if (typeof compiler.compileEngine !== 'function') {
        throw new Error(`Invalid engine compiler entry: ${compilerEntry}`);
    }

    await compiler.compileEngine(resolvedEngineRoot);
    await compiler.compileEngine(resolvedEngineRoot, true);
    return join(resolvedEngineRoot, 'bin', '.cache', 'dev-cli');
}

function assertEngineRoot(engineRoot: string): void {
    if (!existsSync(join(engineRoot, 'cc.config.json'))) {
        throw new Error(`Invalid Cocos engine root: ${engineRoot}`);
    }
}
