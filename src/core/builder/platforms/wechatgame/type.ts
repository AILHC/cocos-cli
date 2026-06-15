import { IInterBuildTaskOption, InternalBuildResult } from '../../@types/protected';

export interface IWechatGameOptions {
    appid: string;
    orientation: 'portrait' | 'landscape';
    highPerformanceMode: boolean;
}

export type IWechatGameInternalBuildOptions = IInterBuildTaskOption<'wechatgame'> & {
    packages: {
        wechatgame: IWechatGameOptions;
    };
};

export type IBuildResult = InternalBuildResult;
