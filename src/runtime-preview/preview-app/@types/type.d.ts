
export interface ISettings {
    launch: {
        launchScene: string;
    };
    [key: string]: any;
}

export interface ISplashSetting {
    [key: string]: any;
}

declare module 'cce:/internal/x/prerequisite-imports' {
    export {};
}
