import { join, resolve } from 'path';
import Module from 'module';

export interface IEngineLoader {
    import(id: string): Promise<unknown>;
}

const ModuleInternal = Module as typeof Module & {
    _resolveFilename(this: Module, request: string): void;
    _load(this: Module, request: string): void;
};

export class EngineLoader {
    static isEngineModule(request: string): boolean {
        return request === 'cc' || (request.startsWith('cc/') && !request.startsWith('cc/preload')) || request.startsWith('cce:/internal/');
    }

    private static engineModules: Record<string, any> = {};
    public static getEngineModuleById(id: string): any {
        return EngineLoader.engineModules[id];
    }

    private static loader: IEngineLoader | undefined;
    private static resolveFilenameHook: typeof ModuleInternal._resolveFilename | undefined;
    private static loadHook: typeof ModuleInternal._load | undefined;

    private static createEngineLoader(engineDevPath: string): IEngineLoader {
        const loaderModule = require(resolve(join(engineDevPath, 'editor'), 'loader')) as {
            default: IEngineLoader;
        };

        return loaderModule.default;
    }

    public static async init(engineDevPath: string, modules: string[]) {
        this.engineModules = {};
        this.loader = this.createEngineLoader(engineDevPath);
        await this.requiredModules(modules);
        this.registerModsManager();
        this.installModuleHooks();
    }

    private static registerModsManager(): void {
        const syncImport = (id: string): any => {
            if (!Object.prototype.hasOwnProperty.call(EngineLoader.engineModules, id)) {
                throw new Error(
                    `Can not sync import engine module: ${id}. Module was not preloaded. `
                    + `Valid engine modules are: ${Object.keys(EngineLoader.engineModules).join(',')}`,
                );
            }

            return EngineLoader.engineModules[id];
        };

        EngineLoader.engineModules['cc/mods-mgr'] = { syncImport };
    }

    private static installModuleHooks(): void {
        if (ModuleInternal._resolveFilename === this.resolveFilenameHook && ModuleInternal._load === this.loadHook) {
            return;
        }
        const vendorResolveFilename = ModuleInternal._resolveFilename;
        const resolveFilenameHook = function (request: string) {
            if (EngineLoader.isEngineModule(request)) {
                return request;
            } else {
                // @ts-ignore

                return vendorResolveFilename.apply(this, arguments);
            }
        };
        ModuleInternal._resolveFilename = resolveFilenameHook;

        const vendorLoad = ModuleInternal._load;
        const loadHook = function (request: string) {
            if (EngineLoader.isEngineModule(request)) {
                const module = EngineLoader.getEngineModuleById(request);
                if (module) {
                    return module;
                } else {
                    throw new Error(
                        `Can not load engine module: ${request}. Valid engine modules are: ${Object.keys(EngineLoader.engineModules).join(',')}`,
                    );
                }
            } else {
                // @ts-ignore

                return vendorLoad.apply(this, arguments);
            }
        };
        ModuleInternal._load = loadHook;
        this.resolveFilenameHook = resolveFilenameHook;
        this.loadHook = loadHook;
    }

    public static async requiredModules(modules: string[]) {
        if (!this.loader) {
            throw new Error(`Failed to load engine module ${modules.join(',')}. ` + 'Loader has not been initialized. engineLoader.init.');
        }

        for (const module of modules) {
            try {
                EngineLoader.engineModules[module] = await this.loader!.import(module);
            } catch (e) {
                console.error(`Failed to load engine module: ${module}  e: ${e}`);
            }
        }
    }

    public static async importModule(module: string) {
        if (!this.loader) {
            throw new Error(`Failed to load engine module ${module}. ` + 'Loader has not been initialized. engineLoader.init.');
        }

        return await this.loader.import(module);
    }
}
