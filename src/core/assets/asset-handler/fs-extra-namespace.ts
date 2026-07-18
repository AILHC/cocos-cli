type ExistsSync = typeof import('fs-extra').existsSync;
type StatSync = typeof import('fs-extra').statSync;

export interface FsExtraSync {
    existsSync: ExistsSync;
    statSync: StatSync;
}

export function resolveFsExtraSync(namespace: unknown): FsExtraSync {
    const defaultExport = getProperty(namespace, 'default');
    const namedExistsSync = getProperty(namespace, 'existsSync');
    const namedStatSync = getProperty(namespace, 'statSync');
    const defaultExistsSync = getProperty(defaultExport, 'existsSync');
    const defaultStatSync = getProperty(defaultExport, 'statSync');
    const existsSync = typeof namedExistsSync === 'function' ? namedExistsSync : defaultExistsSync;
    const statSync = typeof namedStatSync === 'function' ? namedStatSync : defaultStatSync;

    const missing = [
        typeof existsSync === 'function' ? null : 'existsSync',
        typeof statSync === 'function' ? null : 'statSync',
    ].filter((name): name is string => name !== null);
    if (missing.length > 0) {
        throw new Error(
            `fs-extra namespace does not provide required sync API(s): ${missing.join(', ')} `
            + 'as named exports or on its default export.',
        );
    }

    return {
        existsSync: existsSync as ExistsSync,
        statSync: statSync as StatSync,
    };
}

function getProperty(value: unknown, property: string): unknown {
    if ((typeof value !== 'object' || value === null) && typeof value !== 'function') {
        return undefined;
    }
    return (value as Record<string, unknown>)[property];
}
