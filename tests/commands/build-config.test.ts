import { mergeBuildConfigData, normalizeBuildConfigData } from '../../src/commands/build-config';

describe('normalizeBuildConfigData', () => {
    it('flattens a Creator build profile into CLI build options', () => {
        const config = {
            __version__: '1.0.1',
            builder: {
                common: {
                    platform: 'web-mobile',
                    outputName: 'web-mobile',
                    buildPath: 'project://build',
                    scenes: [
                        { url: 'db://assets/main.scene', uuid: 'scene-uuid' },
                    ],
                    startScene: 'scene-uuid',
                    sourceMaps: true,
                    md5Cache: true,
                    useSplashScreen: false,
                    bundleConfigs: [
                        { name: 'main', root: '', output: true },
                    ],
                },
                taskOptionsMap: {
                    '1781256410326': {
                        useWebGPU: false,
                        orientation: 'auto',
                        embedWebDebugger: false,
                        __version__: '1.0.1',
                    },
                },
            },
        };

        expect(normalizeBuildConfigData(config, { platform: 'web-mobile' })).toEqual({
            platform: 'web-mobile',
            outputName: 'web-mobile',
            buildPath: 'project://build',
            scenes: [
                { url: 'db://assets/main.scene', uuid: 'scene-uuid' },
            ],
            startScene: 'scene-uuid',
            sourceMaps: true,
            md5Cache: true,
            useSplashScreen: false,
            bundleConfigs: [
                { name: 'main', root: '', output: true },
            ],
            packages: {
                'web-mobile': {
                    useWebGPU: false,
                    orientation: 'auto',
                    embedWebDebugger: false,
                },
            },
        });
    });

    it('keeps flat CLI build config unchanged', () => {
        const config = {
            platform: 'web-mobile',
            outputName: 'custom',
            packages: {
                'web-mobile': {
                    orientation: 'portrait',
                },
            },
        };

        expect(normalizeBuildConfigData(config, { platform: 'web-mobile' })).toEqual(config);
    });

    it('uses taskId to select from multiple Creator profile tasks', () => {
        const config = {
            builder: {
                common: {
                    platform: 'web-mobile',
                },
                taskOptionsMap: {
                    taskA: {
                        orientation: 'portrait',
                    },
                    taskB: {
                        orientation: 'landscape',
                    },
                },
            },
        };

        expect(normalizeBuildConfigData(config, { platform: 'web-mobile', taskId: 'taskB' })).toEqual({
            platform: 'web-mobile',
            packages: {
                'web-mobile': {
                    orientation: 'landscape',
                },
            },
        });
    });

    it('requires taskId when a Creator profile contains multiple tasks', () => {
        const config = {
            builder: {
                common: {
                    platform: 'web-mobile',
                },
                taskOptionsMap: {
                    taskA: {
                        orientation: 'portrait',
                    },
                    taskB: {
                        orientation: 'landscape',
                    },
                },
            },
        };

        expect(() => normalizeBuildConfigData(config, { platform: 'web-mobile' })).toThrow(
            'Multiple build task options found in Creator profile',
        );
    });

    it('lets command options override Creator profile buildPath and outputName', () => {
        const config = {
            builder: {
                common: {
                    platform: 'web-mobile',
                    buildPath: 'project://build',
                    outputName: 'web-mobile',
                },
                taskOptionsMap: {
                    onlyTask: {
                        orientation: 'auto',
                    },
                },
            },
        };

        expect(mergeBuildConfigData(config, {
            platform: 'web-mobile',
            buildPath: 'project://build/codex-output-root',
            outputName: 'profile-override-folder',
        })).toEqual(expect.objectContaining({
            platform: 'web-mobile',
            buildPath: 'project://build/codex-output-root',
            outputName: 'profile-override-folder',
            packages: {
                'web-mobile': {
                    orientation: 'auto',
                },
            },
        }));
    });
});
