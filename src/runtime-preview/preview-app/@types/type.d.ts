
export interface ISettings {
    launch: {
        launchScene: string;
    };
    [key: string]: any;
}

export interface ISplashSetting {
    [key: string]: any;
}

declare global {
    interface SystemJS {
        import(id: string): Promise<unknown>;
        instantiate?: (url: string, parent?: string) => Promise<unknown>;
        fetchScript?: (url: string, firstParentUrl?: string) => Promise<unknown>;
        createScript?: (url: string) => HTMLScriptElement;
    }

    interface Window {
        __RUNTIME_PREVIEW_SCRIPT_LOAD_LIMITER__?: unknown;
        __RUNTIME_PREVIEW_PREREQUISITE_TIMINGS__?: unknown[];
    }
}

declare module 'cce:/internal/x/prerequisite-imports' {
    export {};
}
