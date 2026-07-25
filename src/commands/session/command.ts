/**
 * `cocos session` 命令组(commander 接线层):agent 入口,作为标准 MCP client
 * 直连运行中 Preview 的 /mcp。全部业务逻辑在 ./runner,本层只负责参数声明、
 * stdout envelope 打印与 exit code 设置(process.exitCode,沿用 compile-engine 先例)。
 */
import { CommanderError, type Command } from 'commander';
import { BaseCommand } from '../base';
import {
    createDefaultSessionRunnerDeps,
    runSessionCommand,
    type SessionAction,
    type SessionTargetOptions,
} from './runner';

const TARGET_OPTIONS_HELP =
    'session 定位:默认从 cwd 向上解析项目(package.json + assets/ + settings/)并发现其运行中的 Preview;' +
    '--project 显式指定项目走同一发现流程;--url 直连 endpoint(仍经 identity endpoint 验证 protocolVersion 与 cocos-cli 身份)。' +
    '--project 与 --url 互斥。';

const ENVELOPE_HELP =
    '输出契约:stdout 只输出单个 JSON 对象——成功 {ok:true, session, result|commands|command|identity};' +
    '失败 {ok:false, session?, error:{code, reason, data?}},exit code 非零(usage 错误为 2,其余为 1)。诊断写 stderr。';

interface TargetFlags {
    project?: string;
    url?: string;
}

export class SessionCommand extends BaseCommand {
    register(): void {
        const session = this.program
            .command('session')
            .description(
                'Connect to the running Preview session of a Cocos project (agent entry, standard MCP client over /mcp). ' +
                TARGET_OPTIONS_HELP + ' ' + ENVELOPE_HELP,
            );

        this.withTargetOptions(
            session.command('info').description(
                'Print the session identity (sessionId, canonical projectRoot, state, URLs, protocolVersion).',
            ),
        ).action((options: TargetFlags) => this.execute({ kind: 'info' }, options));

        this.withTargetOptions(
            session.command('list').description(
                'List all commands (MCP tools) exposed by the session: name + one-line description.',
            ),
        ).action((options: TargetFlags) => this.execute({ kind: 'list' }, options));

        this.withTargetOptions(
            session.command('describe')
                .argument('<name>', 'Command name (see `cocos session list`)')
                .description(
                    'Print the input/output schema of a single command. ' +
                    'Note: MCP has no single-tool describe; this performs a full tools/list and filters client-side.',
                ),
        ).action((name: string, options: TargetFlags) => this.execute({ kind: 'describe', name }, options));

        this.withTargetOptions(
            session.command('call')
                .argument('<name>', 'Command name (see `cocos session list`)')
                .option(
                    '--input <json>',
                    'Arguments as a JSON object; `@<file>` reads from a file, `-` reads from stdin; omitted means {}.',
                )
                .description(
                    'Call a command with JSON arguments. The tool result (CommonResult) is unwrapped from ' +
                    'structuredContent.result; code >= 400 is a failure even when MCP isError is not set. ' +
                    'Each invocation performs an independent MCP initialize handshake (default 60s request timeout).',
                ),
        ).action((name: string, options: TargetFlags & { input?: string }) =>
            this.execute({ kind: 'call', name, input: options.input }, options));

        // usage error 的 JSON envelope 契约(issues/F8):缺 <name>、缺 option value、
        // 未知参数/子命令等 Commander usage 错误同样要在 stdout 输出
        // {ok:false,error:{code:400,...}} 并 exit 2,不依赖 cli.ts 全局 catch。
        this.adoptUsageErrorEnvelope(session);
        for (const subcommand of session.commands) {
            this.adoptUsageErrorEnvelope(subcommand);
        }
    }

    // 专用 Commander 错误适配:usage 错误归一为 stdout envelope + exit 2;
    // help/version 语义不变(rethrow 给全局 catch 走 exit 0)。
    private adoptUsageErrorEnvelope(command: Command): void {
        command.exitOverride((error: CommanderError) => {
            if (
                error.code === 'commander.helpDisplayed'
                || error.code === 'commander.help'
                || error.code === 'commander.version'
            ) {
                throw error;
            }
            process.stdout.write(`${JSON.stringify({
                ok: false,
                error: {
                    code: 400,
                    reason: `usage error: ${error.message}`,
                },
            }, null, 2)}\n`);
            process.exit(2);
        });
    }

    private withTargetOptions(command: Command): Command {
        return command
            .option('-p, --project <path>', 'Path to a Cocos project (defaults to resolving upward from cwd)')
            .option('-u, --url <url>', 'Explicit server URL of a running Preview (mutually exclusive with --project)');
    }

    private async execute(action: SessionAction, target: SessionTargetOptions): Promise<void> {
        try {
            const { envelope, exitCode } = await runSessionCommand(
                action,
                target,
                createDefaultSessionRunnerDeps(),
            );
            process.stdout.write(`${JSON.stringify(envelope, null, 2)}\n`);
            if (exitCode !== 0) {
                process.exitCode = exitCode;
            }
        } catch (error) {
            // 兜底:runner 之外的意外错误也保持 envelope 契约。
            process.stdout.write(`${JSON.stringify({
                ok: false,
                error: {
                    code: 500,
                    reason: `session 命令内部错误:${error instanceof Error ? error.message : String(error)}`,
                },
            }, null, 2)}\n`);
            process.exitCode = 1;
        }
    }
}
