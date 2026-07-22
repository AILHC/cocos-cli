import chalk from 'chalk';
import { resolve } from 'path';
import { BaseCommand } from './base';
import { rebuildEngineCache } from '../core/engine/rebuild-cache';

export class CompileEngineCommand extends BaseCommand {
    register(): void {
        this.program
            .command('compile-engine')
            .description('Rebuild the dev-cli cache for a Cocos engine source tree')
            .requiredOption('-e, --engine <path>', 'Path to the Cocos engine source tree')
            .action(async (options: { engine: string }) => {
                const engineRoot = resolve(options.engine);
                try {
                    console.log(`Rebuilding engine cache: ${engineRoot}`);
                    const cacheRoot = await rebuildEngineCache(engineRoot);
                    console.log(chalk.green(`Engine cache rebuilt: ${cacheRoot}`));
                } catch (error) {
                    console.error(chalk.red('Failed to rebuild engine cache'));
                    console.error(error);
                    process.exitCode = 1;
                }
            });
    }
}
