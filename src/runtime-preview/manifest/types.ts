export interface RuntimePreviewArtifactManifestOptions {
    projectRoot: string;
    libraryRoot: string;
    programmingRoot: string;
}

export interface RuntimePreviewLibraryManifest {
    root: string;
    layout: 'uuid-hash-bucket' | 'unknown';
    metadataFiles: string[];
    serializedJsonFiles: string[];
    nativeLikeFiles: string[];
}

export interface RuntimePreviewProgrammingManifest {
    root: string;
    previewTargetRoot: string;
    previewImportMap: string;
    previewMainRecord: string;
    previewAssemblyRecord: string;
    previewChunks: string[];
}

export interface RuntimePreviewArtifactManifest {
    projectRoot: string;
    library: RuntimePreviewLibraryManifest;
    programming: RuntimePreviewProgrammingManifest;
}
