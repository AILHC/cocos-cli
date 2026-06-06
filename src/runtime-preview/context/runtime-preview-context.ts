export interface RuntimePreviewContextOptions {
    projectRoot: string;
    engineRoot: string;
    projectLibraryRoot: string;
    internalLibraryRoot?: string;
    projectProgrammingRoot: string;
    cliProgrammingRoot?: string;
    editorLibraryRef?: string;
    editorProgrammingRef?: string;
}

export interface RuntimePreviewContext extends RuntimePreviewContextOptions {
    startupStrategy: 'lazy';
    preloadedLibraryFileCount: 0;
    preloadedProgrammingFileCount: 0;
}

export function createRuntimePreviewContext(options: RuntimePreviewContextOptions): RuntimePreviewContext {
    return {
        ...options,
        startupStrategy: 'lazy',
        preloadedLibraryFileCount: 0,
        preloadedProgrammingFileCount: 0,
    };
}
