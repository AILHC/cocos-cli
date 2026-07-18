import { resolveFsExtraSync } from './fs-extra-namespace';

export async function compileEffect(force?: boolean) {
    const { afterImport, autoGenEffectBinInfo } = await import('./assets/effect');
    await afterImport(force);
    const { existsSync, statSync } = resolveFsExtraSync(await import('fs-extra'));
    const binPath = autoGenEffectBinInfo.effectBinPath;
    if (!existsSync(binPath)) {
        throw new Error(`[compileEffect] effect.bin was not generated at: ${binPath}`);
    }
    const size = statSync(binPath).size;
    if (size <= 0) {
        throw new Error(`[compileEffect] effect.bin is empty at: ${binPath}`);
    }
    console.log(`[compileEffect] effect.bin generated: ${binPath} (${size} bytes)`);
}

export async function startAutoGenEffectBin() {
    const { autoGenEffectBinInfo } = await import('./assets/effect');
    autoGenEffectBinInfo.autoGenEffectBin = true;
}

export async function getEffectBinPath() {
    const { autoGenEffectBinInfo, afterImport } = await import('./assets/effect');
    const { existsSync, statSync } = resolveFsExtraSync(await import('fs-extra'));
    const effectBinPath = autoGenEffectBinInfo.effectBinPath;
    if (!existsSync(effectBinPath) || statSync(effectBinPath).size <= 0) {
        await afterImport(true);
    }
    if (!existsSync(effectBinPath) || statSync(effectBinPath).size <= 0) {
        throw new Error(`[getEffectBinPath] effect.bin is missing or empty at: ${effectBinPath}`);
    }
    return effectBinPath;
}
