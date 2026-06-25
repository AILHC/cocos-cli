import { RuntimePreviewScriptLoadLimiterState } from './systemjs-load-limiter.js';
export interface RuntimePreviewPrerequisiteImportOptions {
    system: SystemJS;
    installLimiter?: (system: SystemJS) => RuntimePreviewScriptLoadLimiterState;
    validateImportMap?: () => Promise<void>;
    now?: () => number;
}
export declare function loadRuntimePreviewPrerequisiteImports(options: RuntimePreviewPrerequisiteImportOptions): Promise<void>;
export declare function validateRuntimePreviewPrerequisiteImportMap(): Promise<void>;
