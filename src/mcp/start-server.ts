import chalk from 'chalk';

export async function startServer(folder: string, port?: number) {
    const { default: Launcher } = await import('../core/launcher');
    const session = await new Launcher(folder).startRuntimePreview({
        host: '127.0.0.1',
        port,
        open: false,
    });
    const mcpUrl = session.mcpUrl;
    console.log(chalk.green('✓ MCP Server started successfully!'));
    console.log(`${chalk.blueBright(`Server is running on: `)}${chalk.underline.cyan(`${mcpUrl}`)}`);
    console.log(chalk.yellow('Press Ctrl+C to stop the server'));
    return session;
}
