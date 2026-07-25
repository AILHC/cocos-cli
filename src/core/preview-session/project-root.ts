/**
 * project root 解析:从 cwd 逐级向上取最近的、同时含
 * package.json + assets/ + settings/ 的目录;跳过 node_modules;
 * 上界为文件系统根;结果经 realpath 归一为 canonical project root。
 * 本模块是 `cocos session` discovery 的唯一 project resolver(issues/18 m6)。
 * 已知边界:嵌套于 node_modules 的项目不可达;assets/ 下恰好三标志齐全的
 * 子目录可能截胡(取最近者优先)。
 */
import { dirname, join, resolve } from 'path';
import { resolvePreviewSessionDeps, type PreviewSessionFileSystem } from './deps';

export async function isCocosProjectRoot(
    dir: string,
    fs: PreviewSessionFileSystem = resolvePreviewSessionDeps().fs,
): Promise<boolean> {
    const packageJson = await fs.stat(join(dir, 'package.json'));
    if (!packageJson || packageJson.isDirectory()) {
        return false;
    }
    const assets = await fs.stat(join(dir, 'assets'));
    const settings = await fs.stat(join(dir, 'settings'));
    return Boolean(assets && assets.isDirectory() && settings && settings.isDirectory());
}

// realpath 归一:消除符号链接、8.3 短名与大小写差异;realpath 失败时退化为 resolve。
export async function canonicalizeProjectRoot(
    root: string,
    fs: PreviewSessionFileSystem = resolvePreviewSessionDeps().fs,
): Promise<string> {
    const absolute = resolve(root);
    try {
        return resolve(await fs.realpath(absolute));
    } catch {
        return absolute;
    }
}

export async function resolveProjectRootFromCwd(
    cwd: string,
    fs: PreviewSessionFileSystem = resolvePreviewSessionDeps().fs,
): Promise<string> {
    let current = resolve(cwd);
    for (;;) {
        // 跳过 node_modules:嵌套于 node_modules 的项目不可达(已知边界)。
        if (!isInsideNodeModules(current) && await isCocosProjectRoot(current, fs)) {
            return canonicalizeProjectRoot(current, fs);
        }
        const parent = dirname(current);
        if (parent === current) {
            throw new Error(
                `No Cocos project root found from cwd: ${resolve(cwd)}. ` +
                'Run inside a Cocos project, or pass --project <path> / --url <endpoint>.',
            );
        }
        current = parent;
    }
}

function isInsideNodeModules(dir: string): boolean {
    return dir.split(/[\\/]/).includes('node_modules');
}
