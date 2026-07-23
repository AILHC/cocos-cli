import { fork, ChildProcess } from 'child_process';
import path from 'path';
import { EventEmitter } from 'events';
import { SceneProcessEventTag, SceneReadyChannel } from '../common';
import { Rpc } from './rpc';
import { getServerUrl } from '../../../server';
import { listenModuleMessages } from './messages';
import { getAvailablePort } from '../../../server/utils';

export interface ISceneWorkerEvents {
    'restart': boolean,
}

export class SceneWorker {

    static ExitWorkerEvent = 'scene-process:exit';

    constructor(private readonly forkProcess: typeof fork = fork) {}

    private _process: ChildProcess | null = null;
    private _startPromise: Promise<boolean> | null = null;
    private _stopPromise: Promise<boolean> | null = null;
    public get isRunning(): boolean {
        return this._process !== null;
    }
    public get process(): ChildProcess {
        if (!this._process) {
            throw new Error('Scene worker 未初始化, 请使用 sceneWorker.start');
        }
        return this._process;
    }

    private eventEmitter = new EventEmitter();

    // 重启相关属性
    private maxRestartAttempts = 3; // 最大重启次数
    private currentRestartCount = 0; // 当前重启次数
    private enginePath: string = ''; // 引擎路径
    private projectPath: string = ''; // 项目路径
    private isRestarting = false; // 是否正在重启中
    private isManualStop = false; // 是否手动停止

    async start(enginePath: string, projectPath: string): Promise<boolean> {
        if (this._process || this._startPromise) {
            console.warn('重复启动场景进程，请 stop 进程在 start');
            return false;
        }

        // 保存启动参数以便重启时使用
        this.enginePath = enginePath;
        this.projectPath = projectPath;

        const startPromise = new Promise<boolean>(async (resolve) => {
            let isResolved = false;
            let startupTimer: NodeJS.Timeout | null = null;
            let child: ChildProcess | null = null;

            const cleanup = () => {
                if (startupTimer) {
                    clearTimeout(startupTimer);
                    startupTimer = null;
                }
            };

            const resolveOnce = (result: boolean) => {
                if (!isResolved) {
                    isResolved = true;
                    cleanup();
                    resolve(result);
                }
            };

            const disposeFailedStart = () => {
                const process = child;
                if (this._process === process) {
                    this._process = null;
                }
                Rpc.dispose();
                try {
                    process?.kill('SIGTERM');
                } catch {
                    // Child may have already exited between its event and cleanup.
                }
            };

            try {
                const args = [
                    `--enginePath=${enginePath}`,
                    `--projectPath=${projectPath}`,
                    `--serverURL=${getServerUrl()}`,
                ];
                const precessPath = path.join(__dirname, '../../../../dist/core/scene/scene-process/main.js');
                const inspectPort = await getAvailablePort(9230);
                if (this.isManualStop) {
                    Rpc.dispose();
                    resolveOnce(false);
                    return;
                }
                console.log('--inspect= ' + inspectPort);
                child = this.forkProcess(precessPath, args, {
                    detached: false,
                    stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
                    execArgv: [`--inspect=${inspectPort}`],
                });
                this._process = child;

                // 监听进程启动错误
                const onError = (error: Error) => {
                    console.error('场景进程启动失败:', error);
                    child?.off('error', onError);
                    child?.off('exit', onEarlyExit);
                    child?.off('message', onReady);
                    if (this.isManualStop) {
                        if (this._process === child) {
                            this._process = null;
                        }
                        resolveOnce(false);
                        return;
                    }
                    disposeFailedStart();
                    resolveOnce(false);
                };

                // 监听进程早期退出（启动失败）
                const onEarlyExit = (code: number, signal: string | null) => {
                    console.error(`场景进程启动时退出 code:${code}, signal:${signal}`);
                    child?.off('error', onError);
                    child?.off('exit', onEarlyExit);
                    child?.off('message', onReady);
                    if (this.isManualStop) {
                        if (this._process === child) {
                            this._process = null;
                        }
                        resolveOnce(false);
                        return;
                    }
                    disposeFailedStart();
                    resolveOnce(false);
                };

                // 监听就绪消息
                const onReady = (msg: any) => {
                    if (msg === SceneReadyChannel) {
                        console.log('Scene process start.');
                        child?.off('message', onReady);
                        child?.off('error', onError);
                        child?.off('exit', onEarlyExit);
                        resolveOnce(true);
                    }
                };

                // 设置启动超时（30秒）
                startupTimer = setTimeout(() => {
                    console.error('场景进程启动超时');
                    child?.off('message', onReady);
                    child?.off('error', onError);
                    child?.off('exit', onEarlyExit);
                    disposeFailedStart();
                    resolveOnce(false);
                }, 30000);

                // 注册事件监听器
                child.on('error', onError);
                child.on('exit', onEarlyExit);
                child.on('message', onReady);

                // 启动RPC和注册监听器
                await Rpc.startup(child);
                await this.registerListener();

            } catch (error) {
                console.error('创建场景进程失败:', error);
                disposeFailedStart();
                resolveOnce(false);
            }
        });
        this._startPromise = startPromise;
        try {
            return await startPromise;
        } finally {
            if (this._startPromise === startPromise) {
                this._startPromise = null;
            }
        }
    }

    async stop() {
        if (this._stopPromise) {
            return this._stopPromise;
        }
        const process = this._process;
        if (!process) {
            if (this._startPromise) {
                this.isManualStop = true;
                const starting = this._startPromise;
                const stopPromise = starting.then(
                    () => true,
                    () => true,
                );
                this._stopPromise = stopPromise;
                try {
                    const result = await stopPromise;
                    this.clear();
                    return result;
                } finally {
                    if (this._stopPromise === stopPromise) {
                        this._stopPromise = null;
                    }
                }
            }
            Rpc.dispose();
            return true;
        }
        this.isManualStop = true;
        const stopPromise = new Promise<boolean>((resolve) => {
            let settled = false;
            const cleanup = () => {
                clearTimeout(timeout);
                process.off('exit', onExit);
                process.off('error', onError);
            };
            const resolveOnce = (result: boolean) => {
                if (settled) {
                    return;
                }
                settled = true;
                cleanup();
                resolve(result);
            };
            Rpc.dispose();
            const timeout = setTimeout(() => {
                console.warn('Scene process stop timed out, force killing...');
                try { process.kill('SIGTERM'); } catch (e) { /* ignore */ }
                this.clear();
                resolveOnce(true);
            }, 10000);

            const onExit = () => {
                console.log('Scene process stopped.');
                this.clear();
                resolveOnce(true);
            };
            const onError = (error: NodeJS.ErrnoException) => {
                if (error.code === 'EPIPE' || error.message.includes('write EPIPE')) {
                    return;
                }
                try { process.kill('SIGTERM'); } catch { /* ignore */ }
                this.clear();
                resolveOnce(false);
            };

            process.once('exit', onExit);
            process.on('error', onError);

            try {
                process.send(SceneWorker.ExitWorkerEvent);
            } catch (e) {
                try { process.kill('SIGTERM'); } catch (_) { /* ignore */ }
                this.clear();
                resolveOnce(true);
            }
        });
        this._stopPromise = stopPromise;
        try {
            return await stopPromise;
        } finally {
            if (this._stopPromise === stopPromise) {
                this._stopPromise = null;
            }
        }
    }

    /**
     * 判断是否崩溃
     * @private
     */
    private isCrashExit(code: number): boolean {
        // 如果是手动停止，不算崩溃
        if (this.isManualStop) {
            return false;
        }
        
        // 其他非零退出码且非手动终止信号的情况，认为是崩溃
        return code !== 0;
    }

    /**
     * 重启场景进程
     * @private
     */
    private async restart(): Promise<void> {
        if (this.isRestarting) {
            console.log('场景进程正在重启中，跳过重复重启');
            return;
        }

        if (this.currentRestartCount >= this.maxRestartAttempts) {
            console.error(`场景进程重启次数已达上限 (${this.maxRestartAttempts})，停止重启`);
            this.emit<ISceneWorkerEvents>('restart', false);
            return;
        }

        this.isRestarting = true;
        this.currentRestartCount++;

        console.log(`开始重启场景进程 (第 ${this.currentRestartCount}/${this.maxRestartAttempts} 次)`);

        try {
            // 清理当前进程
            this._process = null;

            // 固定重启间隔，确保上一次 start 的收尾完成后再创建新进程。
            const delay = 2000;
            console.log(`等待 ${delay}ms 后重启...`);
            await new Promise(resolve => setTimeout(resolve, delay));

            // 重新启动进程
            const success = await this.start(this.enginePath, this.projectPath);

            if (success) {
                console.log('场景进程重启成功');
                
                // 重启成功后重置重启计数
                this.currentRestartCount = 0;
                this.emit<ISceneWorkerEvents>('restart', true);
            } else {
                console.error(`场景进程重启失败 (第 ${this.currentRestartCount}/${this.maxRestartAttempts} 次)`);

                // 如果达到最大重试次数，发出事件通知
                if (this.currentRestartCount >= this.maxRestartAttempts) {
                    console.error('已达到最大重启次数，场景进程无法恢复');
                    this.emit<ISceneWorkerEvents>('restart', false);
                }
            }
        } catch (error) {
            console.error('场景进程重启过程中发生错误:', error);

            // 发出重启错误事件
            this.emit<ISceneWorkerEvents>('restart', false);

            // 如果达到最大重试次数，停止重启
            if (this.currentRestartCount >= this.maxRestartAttempts) {
                console.error('重启过程中发生错误且已达到最大重试次数，停止重启');
            }
        } finally {
            this.isRestarting = false;
        }
    }

    async registerListener() {
        const process = this.process;

        process.on('message', (msg: { type: string, event: string, args: any[] }) => {
            if (msg && msg.type === SceneProcessEventTag) {
                this.emit(msg.event, ...msg.args);
            }
        });

        process.stdout?.on('data', (chunk) => {
            console.log(chunk.toString());
        });

        process.stderr?.on('data', (chunk) => {
            const str = chunk.toString();
            if (str.startsWith('[Scene]')) {
                console.log(chunk.toString());
            } else {
                console.log('[Scene]', chunk.toString());
            }
        });

        process.on('error', (err) => {
            if (err.message.startsWith('[Scene]')) {
                console.error(err);
            } else {
                console.error(`[Scene] `, err);
            }
        });

        process.on('exit', (code: number, signal) => {
            if (this._process !== process) {
                return;
            }
            this._process = null;
            if (code !== 0) {
                console.error(`场景进程退出异常 code:${code}, signal:${signal}`);
                
                // 判断是否为真正的崩溃（排除手动 kill 的情况）
                const isCrash = this.isCrashExit(code);
                
                if (isCrash && !this.isManualStop && !this.isRestarting && this.enginePath && this.projectPath) {
                    console.log('检测到场景进程崩溃，准备重启...');
                    this.restart().catch(error => {
                        console.error('重启场景进程失败:', error);
                    });
                } else if (this.isManualStop) {
                    console.log('场景进程手动停止，不进行重启');
                } else if (!isCrash) {
                    console.log('场景进程被外部终止，不进行重启');
                }
            } else {
                console.log('场景进程正常退出');
            }

            // 重置手动停止标志
            this.isManualStop = false;
        });
        // 监听主进程模块的事件
        await listenModuleMessages();
    }

    /**
     * 监听指定类型的事件（类型安全版本）
     * @param event 事件名称
     * @param listener 事件监听器
     */
    on<TEvents extends Record<string, any>>(
        event: keyof TEvents,
        listener: TEvents[keyof TEvents] extends void
            ? () => void
            : (payload: TEvents[keyof TEvents]) => void
    ): void;
    /**
     * 监听指定类型的事件（通用版本）
     * @param event 事件名称
     * @param listener 事件监听器
     */
    on(event: string, listener: (...args: any[]) => void): void;
    on(event: any, listener: any): void {
        this.eventEmitter.on(event as string, listener);
    }

    /**
     * 监听指定类型的事件（一次性，类型安全版本）
     * @param event 事件名称
     * @param listener 事件监听器
     */
    once<TEvents extends Record<string, any>>(
        event: keyof TEvents,
        listener: TEvents[keyof TEvents] extends void
            ? () => void
            : (payload: TEvents[keyof TEvents]) => void
    ): void;
    /**
     * 监听指定类型的事件（一次性，通用版本）
     * @param event 事件名称
     * @param listener 事件监听器
     */
    once(event: string, listener: (...args: any[]) => void): void;
    once(event: any, listener: any): void {
        this.eventEmitter.once(event as string, listener);
    }

    /**
     * 移除指定类型的事件监听器（类型安全版本）
     * @param event 事件名称
     * @param listener 事件监听器
     */
    off<TEvents extends Record<string, any>>(
        event: keyof TEvents,
        listener: TEvents[keyof TEvents] extends void
            ? () => void
            : (payload: TEvents[keyof TEvents]) => void
    ): void;
    off(event: string, listener: (...args: any[]) => void): void;
    off(event: any, listener: any): void {
        this.eventEmitter.off(event as string, listener);
    }

    /**
     * 发射指定类型的事件（类型安全版本）
     * @param event 事件名称
     * @param args 事件参数
     */
    emit<TEvents extends Record<string, any>>(
        event: keyof TEvents,
        ...args: TEvents[keyof TEvents] extends void ? [] : [TEvents[keyof TEvents]]
    ): void;
    /**
     * 触发事件（通用版本）
     * @param event 事件名称
     * @param args 事件参数
     */
    emit(event: string, ...args: any[]): void;
    emit(event: any, ...args: any[]): void {
        this.eventEmitter.emit(event, ...args);
    }

    /**
     * 清除事件监听器
     * @param event 事件名称，如果不提供则清除所有
     */
    clear(event?: string): void {
        if (event) {
            this.eventEmitter.removeAllListeners(event);
        } else {
            this.eventEmitter.removeAllListeners();
            // 重置重启相关状态
            this.currentRestartCount = 0;
            this.isRestarting = false;
            this.isManualStop = false;
            this.enginePath = '';
            this.projectPath = '';
            this._process = null;
        }
    }
}

export const sceneWorker = new SceneWorker();
