export interface RuntimePreviewExtensionLibraryRoot {
    name: string;
    root: string;
}

export interface RuntimePreviewContextOptions {
    projectRoot: string;
    engineRoot: string;
    scene?: string;
    projectLibraryRoot: string;
    extensionLibraryRoots?: RuntimePreviewExtensionLibraryRoot[];
    internalLibraryRoot?: string;
    projectProgrammingRoot: string;
    cliProgrammingRoot?: string;
    editorLibraryRef?: string;
    editorProgrammingRef?: string;
}

export interface RuntimePreviewContext extends RuntimePreviewContextOptions {
    extensionLibraryRoots: RuntimePreviewExtensionLibraryRoot[];
    startupStrategy: 'lazy';
    preloadedLibraryFileCount: 0;
    preloadedProgrammingFileCount: 0;
}

export function createRuntimePreviewContext(options: RuntimePreviewContextOptions): RuntimePreviewContext {
    return {
        ...options,
        extensionLibraryRoots: options.extensionLibraryRoots ?? [],
        startupStrategy: 'lazy',
        preloadedLibraryFileCount: 0,
        preloadedProgrammingFileCount: 0,
    };
}
