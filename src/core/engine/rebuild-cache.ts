import { existsSync } from 'fs';
import { join, resolve } from 'path';
import { GlobalPaths } from '../../global';

interface EngineCompilerModule {
    compileEngine(engineRoot: string, isWeb?: boolean): Promise<void>;
}

interface RebuildEngineCacheDependencies {
    compilerEntry?: string;
    loadCompiler?: (entry: string) => EngineCompilerModule;
}

export async function rebuildEngineCache(
    engineRoot: string,
    dependencies: RebuildEngineCacheDependencies = {},
): Promise<string> {
    const resolvedEngineRoot = resolve(engineRoot);
    if (!existsSync(join(resolvedEngineRoot, 'cc.config.json'))) {
        throw new Error(`Invalid Cocos engine root: ${resolvedEngineRoot}`);
    }

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
