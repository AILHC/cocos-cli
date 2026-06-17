import { spawn } from 'child_process';
import { join, resolve } from 'path';
import { outputJSON, remove } from 'fs-extra';
import { build, executeBuildStageTask, queryDefaultBuildConfigByPlatform } from '../../core/builder';
import { HttpStatusCode, COMMON_STATUS, CommonResultType } from '../base/schema-base';
import { BuildExitCode, IBuildCommandOption } from '../../core/builder/@types/protected';
import { description, param, result, title, tool } from '../decorator/decorator';
import { SchemaBuildConfigResult, SchemaBuildOption, SchemaBuildResult, SchemaPlatform, SchemaBuildDest, SchemaRunResult, TBuildConfigResult, TBuildOption, TBuildResultData, TPlatform, TBuildDest, TRunResult, SchemaPlatformCanMake, TPlatformCanMake, IMakeResultData, IRunResultData, SchemaMakeResult } from './schema';

export class BuilderApi {
    constructor(private readonly getProjectPath?: () => string | undefined) {}

    @tool('builder-build')
    @title('Build Project') // 构建项目
    @description('Compile and package the project for the specified platform (e.g. web-mobile, android, ios). This is a BUILD step only — it does NOT launch or run the game. To launch the built game afterward, use builder-run separately.') // 将项目编译并打包为指定平台的游戏包（例如 web-mobile、android、ios），这是构建步骤，不会启动或运行游戏。如需启动游戏请单独使用 builder-run
    @result(SchemaBuildResult)
    async build(@param(SchemaPlatform) platform: TPlatform, @param(SchemaBuildOption) options?: TBuildOption) {
        const code: HttpStatusCode = COMMON_STATUS.SUCCESS;
        const ret: CommonResultType<TBuildResultData> = {
            code: code,
            data: null,
        };
        try {
            const projectPath = this.getProjectPath?.();
            const res = projectPath
                ? await this.buildInIsolatedProcess(projectPath, platform, options)
                : await build(platform, options);
            ret.data = res as TBuildResultData;
            if (!res || res.code !== BuildExitCode.BUILD_SUCCESS) {
                ret.code = COMMON_STATUS.FAIL;
                ret.reason = (res && 'reason' in res ? res.reason : undefined) || 'Build failed!';
            }
        } catch (e) {
            ret.code = COMMON_STATUS.FAIL;
            console.error('build project failed:', e instanceof Error ? e.message : String(e));
            ret.reason = e instanceof Error ? e.message : String(e);
        }
        return ret;
    }

    private async buildInIsolatedProcess(projectPath: string, platform: TPlatform, options?: TBuildOption): Promise<TBuildResultData> {
        const optionsPath = join(projectPath, 'temp', 'cli', `builder-api-build-options-${process.pid}-${Date.now()}.json`);
        await outputJSON(optionsPath, options ?? { platform });

        const apiEntry = resolve(__dirname, '..', 'index.js');
        const script = `
            (async () => {
                const [projectPath, platform, optionsPath, apiEntry] = process.argv.slice(1);
                const { readFileSync } = require('fs');
                const { CocosAPI } = require(apiEntry);
                const options = JSON.parse(readFileSync(optionsPath, 'utf8'));
                const result = await CocosAPI.buildProject(projectPath, platform, options);
                console.log('__COCOS_CLI_BUILD_RESULT__' + JSON.stringify(result));
                process.exit(typeof result.code === 'number' ? result.code : 0);
            })().catch((error) => {
                console.error(error);
                process.exit(1);
            });
        `;

        try {
            return await new Promise<TBuildResultData>((resolvePromise) => {
                const child = spawn(process.execPath, ['-e', script, projectPath, platform, optionsPath, apiEntry], {
                    cwd: process.cwd(),
                    env: process.env,
                    windowsHide: true,
                });
                let result: TBuildResultData | null = null;
                let stderr = '';
                let stdoutBuffer = '';
                const marker = '__COCOS_CLI_BUILD_RESULT__';

                child.stdout?.on('data', (chunk) => {
                    const text = chunk.toString();
                    process.stdout.write(text);
                    stdoutBuffer += text;
                    const lines = stdoutBuffer.split(/\r?\n/);
                    stdoutBuffer = lines.pop() ?? '';
                    for (const line of lines) {
                        if (!line.startsWith(marker)) {
                            continue;
                        }
                        try {
                            result = JSON.parse(line.slice(marker.length));
                        } catch (error) {
                            stderr += `\nFailed to parse isolated build result: ${error instanceof Error ? error.message : String(error)}`;
                        }
                    }
                });
                child.stderr?.on('data', (chunk) => {
                    const text = chunk.toString();
                    stderr += text;
                    process.stderr.write(text);
                });
                child.on('error', (error) => {
                    stderr += error.message;
                });
                child.on('close', (code) => {
                    if (!result && stdoutBuffer.startsWith(marker)) {
                        try {
                            result = JSON.parse(stdoutBuffer.slice(marker.length));
                        } catch (error) {
                            stderr += `\nFailed to parse isolated build result: ${error instanceof Error ? error.message : String(error)}`;
                        }
                    }
                    if (result) {
                        resolvePromise(result);
                        return;
                    }
                    resolvePromise({
                        code: typeof code === 'number' && code !== 0 ? code : BuildExitCode.BUILD_FAILED,
                        reason: stderr || `Isolated build process exited with code ${code}`,
                    } as TBuildResultData);
                });
            });
        } finally {
            await remove(optionsPath).catch(() => undefined);
        }
    }

    // @tool('builder-get-preview-settings')
    // @title('Get Preview Settings') // 获取预览设置
    // @description('Get Preview Settings') // 获取预览设置
    // @result(SchemaPreviewSettingsResult)
    // async getPreviewSettings() {
    //     const code: HttpStatusCode = COMMON_STATUS.SUCCESS;
    //     const ret: CommonResultType<TPreviewSettingsResult> = {
    //         code: code,
    //         data: null,
    //     };
    //     try {
    //         ret.data = await getPreviewSettings();
    //     } catch (e) {
    //         ret.code = COMMON_STATUS.FAIL;
    //         console.error('get preview settings fail:', e instanceof Error ? e.message : String(e));
    //         ret.reason = e instanceof Error ? e.message : String(e);
    //     }
    //     return ret;
    // }

    @tool('builder-query-default-build-config')
    @title('Get Default Build Config') // 获取平台默认构建配置
    @description('Get default build configuration for platform') // 获取平台默认构建配置
    @result(SchemaBuildConfigResult)
    async queryDefaultBuildConfig(@param(SchemaPlatform) platform: TPlatform) {
        const code: HttpStatusCode = COMMON_STATUS.SUCCESS;
        const ret: CommonResultType<TBuildConfigResult> = {
            code: code,
            data: null,
        };

        try {
            // Temporarily bypassed // 暂时绕过
            ret.data = await queryDefaultBuildConfigByPlatform(platform) as unknown as TBuildConfigResult;
        } catch (e) {
            ret.code = COMMON_STATUS.FAIL;
            console.error('query default build config by platform fail:', e instanceof Error ? e.message : String(e));
            ret.reason = e instanceof Error ? e.message : String(e);
        }
        return ret;
    }

    @tool('builder-make')
    @title('Make Build Package') // 编译构建包
    @description('Compile the built game package, supported only by some platforms') // 编译构建后的游戏包，仅部分平台支持
    @result(SchemaMakeResult)
    async make(@param(SchemaPlatformCanMake) platform: TPlatformCanMake, @param(SchemaBuildDest) dest: TBuildDest) {
        const code: HttpStatusCode = COMMON_STATUS.SUCCESS;
        const ret: CommonResultType<IMakeResultData> = {
            code: code,
            data: null,
        };
        try {
            const res = await executeBuildStageTask(platform, 'make', {
                dest,
                platform,
            });
            ret.data = res as IMakeResultData;
            if (res.code !== BuildExitCode.BUILD_SUCCESS) {
                ret.code = COMMON_STATUS.FAIL;
                ret.reason = res.reason || `Make ${platform} in ${dest} failed!`;
            }
        } catch (e) {
            ret.code = COMMON_STATUS.FAIL;
            console.error(`make project ${dest} in platform ${platform} failed:`, e instanceof Error ? e.message : String(e));
            ret.reason = e instanceof Error ? e.message : String(e);
        }
        return ret;
    }

    @tool('builder-run')
    @title('Run Build Result') // 运行构建结果
    @description('Launch and run a previously built game package. This is NOT a build step — it requires that builder-build has already completed successfully. Do NOT call this instead of builder-build; the two are separate sequential steps: build first, then run.') // 启动并运行已经构建好的游戏包，这不是构建步骤——需要先成功执行过 builder-build。不要用此命令代替 builder-build，两者是独立的顺序步骤：先构建，再运行
    @result(SchemaBuildResult)
    async run(@param(SchemaPlatform) platform: TPlatform, @param(SchemaBuildDest) dest: TBuildDest): Promise<CommonResultType<IRunResultData>> {
        const code: HttpStatusCode = COMMON_STATUS.SUCCESS;
        const ret: CommonResultType<IRunResultData> = {
            code: code,
            data: null,
        };
        try {
            const res = await executeBuildStageTask(platform, 'run', {
                dest,
                platform,
            });
            ret.data = res;
            if (res.code !== BuildExitCode.BUILD_SUCCESS) {
                ret.code = COMMON_STATUS.FAIL;
                ret.reason = res.reason || `Run ${platform} in ${dest} failed!`;
            }
        } catch (e) {
            ret.code = COMMON_STATUS.FAIL;
            console.error('run build result failed:', e instanceof Error ? e.message : String(e));
            ret.reason = e instanceof Error ? e.message : String(e);
        }
        return ret;
    }
}
