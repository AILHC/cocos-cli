import chalk from 'chalk';
import { BaseCommand } from './base';
import { rebuildEngineCache, resolveCompileEngineTarget } from '../core/engine/rebuild-cache';

export class CompileEngineCommand extends BaseCommand {
    register(): void {
        this.program
            .command('compile-engine')
            .description('Rebuild the dev-cli cache for the current Cocos project engine')
            .option('-j, --project <path>', 'Path to a Cocos project (defaults to current directory)')
            .option('-e, --engine <path>', 'Explicit Cocos engine source path')
            .action(async (options: { project?: string; engine?: string }) => {
                try {
                    const target = await resolveCompileEngineTarget({
                        cwd: process.cwd(),
                        project: options.project,
                        engine: options.engine,
                    });
                    if (target.projectRoot) {
                        console.log(`Project: ${target.projectRoot}`);
                    }
                    console.log(`Engine source: ${target.engineRoot} (${target.source})`);
                    const cacheRoot = await rebuildEngineCache(target.engineRoot);
                    console.log(chalk.green(`Engine cache rebuilt: ${cacheRoot}`));
                } catch (error) {
                    console.error(chalk.red('Failed to rebuild engine cache'));
                    console.error(error);
                    process.exitCode = 1;
                }
            });
    }
}
