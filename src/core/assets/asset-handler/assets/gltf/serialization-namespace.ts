import type { CCON } from 'cc/editor/serialization';

export type DecodeCCONBinary = (bytes: Uint8Array) => CCON;

export function resolveDecodeCCONBinary(serialization: unknown): DecodeCCONBinary {
    const namedExport = getProperty(serialization, 'decodeCCONBinary');
    if (typeof namedExport === 'function') {
        return namedExport as DecodeCCONBinary;
    }

    const defaultExport = getProperty(serialization, 'default');
    const defaultDecode = getProperty(defaultExport, 'decodeCCONBinary');
    if (typeof defaultDecode === 'function') {
        return defaultDecode as DecodeCCONBinary;
    }

    throw new Error(
        'cc/editor/serialization does not provide decodeCCONBinary as a named export or on its default export.',
    );
}

export function resolveEngineModuleFunction<T extends (...args: any[]) => any>(
    moduleNamespace: unknown,
    exportName: string,
    moduleName: string,
    initializedRealmFallback?: unknown,
): T {
    const namedExport = getProperty(moduleNamespace, exportName);
    if (typeof namedExport === 'function') {
        return namedExport as T;
    }

    const defaultExport = getProperty(moduleNamespace, 'default');
    const defaultFunction = getProperty(defaultExport, exportName);
    if (typeof defaultFunction === 'function') {
        return defaultFunction as T;
    }

    if (typeof initializedRealmFallback === 'function') {
        return initializedRealmFallback as T;
    }

    throw new Error(
        `${moduleName} does not provide ${exportName} as a named export, on its default export, or on the initialized engine realm.`,
    );
}

function getProperty(value: unknown, property: string): unknown {
    if ((typeof value !== 'object' || value === null) && typeof value !== 'function') {
        return undefined;
    }
    return (value as Record<string, unknown>)[property];
}
