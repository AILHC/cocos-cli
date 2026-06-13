import { Logger } from '@cocos/creator-programming-common/lib/logger';
import { QuickPack } from '@cocos/creator-programming-quick-pack/lib/quick-pack';
import { isBareSpecifier } from '@cocos/creator-programming-common/lib/specifier';
import { createCommonJSBareSpecifierFallbackSource } from '../commonjs-bare-specifier-fallback-source';

interface QuickPackResolutionMessage {
    level: 'warn' | 'error';
    text: string;
}

export interface QuickPackModuleResolution {
    resolved: {
        type: string;
        url?: string | URL;
    } & Record<string, unknown>;
    messages?: QuickPackResolutionMessage[];
}

interface QuickPackResolvableSpecifier {
    value: string;
}

type QuickPackResolveFunction = (
    specifier: QuickPackResolvableSpecifier,
    parentURL: URL,
    type: string | undefined,
) => QuickPackModuleResolution;

interface QuickPackWithPrivateResolve {
    _resolve?: QuickPackResolveFunction;
}

export function createCommonJSBareSpecifierFallbackResolution(
    specifierValue: string,
    parentURL: URL,
    moduleType: string | undefined,
    error: unknown,
    logger: Pick<Logger, 'error'>,
): QuickPackModuleResolution | undefined {
    if (moduleType !== 'commonjs' || !isBareSpecifier(specifierValue)) {
        return undefined;
    }

    const errorText = error instanceof Error ? error.message : String(error);
    const message = [
        `Failed to resolve CommonJS bare specifier "${specifierValue}" from ${parentURL.href}.`,
        'Using a CJS meta URL fallback so preview script compilation can continue.',
        `Original error: ${errorText}`,
    ].join(' ');

    logger.error(message);

    const source = createCommonJSBareSpecifierFallbackSource();

    return {
        resolved: {
            type: 'module',
            url: new URL(`data:text/javascript,${encodeURIComponent(source)}`),
        },
        messages: [{
            level: 'error',
            text: message,
        }],
    };
}

export function installCommonJSBareSpecifierFallback(quickPack: QuickPack, logger: Logger): void {
    const quickPackWithPrivateResolve = quickPack as unknown as QuickPackWithPrivateResolve;
    const originalResolve = quickPackWithPrivateResolve._resolve;
    if (!originalResolve) {
        logger.warn('QuickPack CommonJS bare specifier fallback is not installed because _resolve is unavailable.');
        return;
    }

    quickPackWithPrivateResolve._resolve = function resolveWithCommonJSBareSpecifierFallback(
        this: QuickPack,
        specifier: QuickPackResolvableSpecifier,
        parentURL: URL,
        type: string | undefined,
    ) {
        try {
            return originalResolve.call(this, specifier, parentURL, type);
        } catch (error) {
            const fallbackResolution = createCommonJSBareSpecifierFallbackResolution(
                specifier.value,
                parentURL,
                type,
                error,
                logger,
            );
            if (fallbackResolution) {
                return fallbackResolution;
            }
            throw error;
        }
    };
}
