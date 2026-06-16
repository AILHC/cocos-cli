import Utils from '../../../../base/utils';
import { withEditorFacade } from '../../../../extensions/editor-facade';
import type { IBuildHookInfo } from '../../../@types/protected';

export async function loadAndRunBuildHook({
    pkgName,
    funcName,
    info,
    invoke,
}: {
    pkgName: string;
    funcName: string;
    info: IBuildHookInfo;
    invoke: (hook: Function, hooks: Record<string, any>) => Promise<void>;
}): Promise<Record<string, any> | undefined> {
    void pkgName;
    let hooks: Record<string, any> | undefined;
    const run = async () => {
        hooks = Utils.File.requireFile(info.path);
        if (hooks && hooks[funcName]) {
            await invoke(hooks[funcName], hooks);
        }
    };

    if (info.editorFacade && info.projectRoot) {
        await withEditorFacade({ projectRoot: info.projectRoot }, run);
    } else {
        await run();
    }

    return hooks;
}

export function shouldFailBuildForHook(hooks: Record<string, any> | undefined, info: IBuildHookInfo): boolean {
    return Boolean((hooks && hooks.throwError) || info.internal || info.fatal);
}

export function wrapBuildHookError(pkgName: string, funcName: string, error: unknown): Error {
    const originalMessage = error instanceof Error ? error.message : String(error);
    const wrappedError = new Error(`Build plugin "${pkgName}" hook "${funcName}" failed: ${originalMessage}`);
    (wrappedError as Error & { cause?: unknown }).cause = error;
    return wrappedError;
}
