System.register([], function (exports_1, context_1) {
    "use strict";
    var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
        function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
        return new (P || (P = Promise))(function (resolve, reject) {
            function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
            function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
            function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
            step((generator = generator.apply(thisArg, _arguments || [])).next());
        });
    };
    var __generator = (this && this.__generator) || function (thisArg, body) {
        var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
        return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
        function verb(n) { return function (v) { return step([n, v]); }; }
        function step(op) {
            if (f) throw new TypeError("Generator is already executing.");
            while (g && (g = 0, op[0] && (_ = 0)), _) try {
                if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
                if (y = 0, t) op = [op[0] & 2, t.value];
                switch (op[0]) {
                    case 0: case 1: t = op; break;
                    case 4: _.label++; return { value: op[1], done: false };
                    case 5: _.label++; y = op[1]; op = [0]; continue;
                    case 7: op = _.ops.pop(); _.trys.pop(); continue;
                    default:
                        if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                        if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                        if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                        if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                        if (t[2]) _.ops.pop();
                        _.trys.pop(); continue;
                }
                op = body.call(thisArg, _);
            } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
            if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
        }
    };
    var __moduleName = context_1 && context_1.id;
    function main(ui, options) {
        return __awaiter(this, void 0, void 0, function () {
            var cc, debugMode, option, launchScene;
            var _this = this;
            var _a;
            return __generator(this, function (_b) {
                switch (_b.label) {
                    case 0: return [4 /*yield*/, System.import('cc')];
                    case 1:
                        cc = _b.sent();
                        debugMode = (_a = cc.DebugMode[ui.debugMode]) !== null && _a !== void 0 ? _a : cc.DebugMode.INFO;
                        option = {
                            debugMode: debugMode,
                            overrideSettings: {},
                        };
                        launchScene = options.settings.launch.launchScene;
                        Object.assign(option.overrideSettings, options.settings);
                        option.overrideSettings.profiling = option.overrideSettings.profiling || {};
                        option.overrideSettings.profiling.showFPS = ui.showFps;
                        option.overrideSettings.screen = option.overrideSettings.screen || {};
                        option.overrideSettings.screen.frameRate = ui.frameRate;
                        option.overrideSettings.screen.exactFitScreen = ui.isFullscreen() ? true : false;
                        option.overrideSettings.assets = option.overrideSettings.assets || {};
                        option.overrideSettings.assets.importBase = 'assets/general/import';
                        option.overrideSettings.assets.nativeBase = 'assets/general/native';
                        option.overrideSettings.assets.remoteBundles = [];
                        option.overrideSettings.assets.subpackages = [];
                        option.overrideSettings.launch = option.overrideSettings.launch || {};
                        option.overrideSettings.launch.launchScene = '';
                        // 等待引擎启动
                        return [4 /*yield*/, cc.game.init(option)];
                    case 2:
                        // 等待引擎启动
                        _b.sent();
                        cc.assetManager.onAssetMissing(function (parentAsset, owner, propName, uuid) { return __awaiter(_this, void 0, void 0, function () {
                            var assetPathOrUuid, errorInfo, info, error_1;
                            return __generator(this, function (_a) {
                                switch (_a.label) {
                                    case 0:
                                        assetPathOrUuid = uuid;
                                        errorInfo = "The asset ".concat(uuid, " used by ").concat(parentAsset.name, "{").concat(cc.js.getClassName(parentAsset), "(").concat(parentAsset.uuid, ")} is missing! \n");
                                        _a.label = 1;
                                    case 1:
                                        _a.trys.push([1, 3, , 4]);
                                        return [4 /*yield*/, getData("/missing-asset/".concat(uuid))];
                                    case 2:
                                        info = _a.sent();
                                        if (info) {
                                            errorInfo = "The asset ".concat(info.path, " used by ").concat(parentAsset.name, "{").concat(cc.js.getClassName(parentAsset), "(").concat(parentAsset.uuid, ")} is missing! \n");
                                        }
                                        assetPathOrUuid = info.path;
                                        info && (errorInfo += "asset ".concat(info.path, "(").concat(uuid, ") has been deleted at ").concat(new Date(info.removeTime).toLocaleString(), ". \n"));
                                        return [3 /*break*/, 4];
                                    case 3:
                                        error_1 = _a.sent();
                                        console.debug("query missing asset ".concat(uuid, " failed"));
                                        return [3 /*break*/, 4];
                                    case 4:
                                        if (owner && owner.node instanceof cc.Node) {
                                            errorInfo += "Node path: ".concat(owner.node.getPathInHierarchy(), "\n");
                                        }
                                        propName && (errorInfo += "PropName: ".concat(propName));
                                        console.error(errorInfo);
                                        return [2 /*return*/];
                                }
                            });
                        }); });
                        return [4 /*yield*/, cc.game.run(function () { return __awaiter(_this, void 0, void 0, function () {
                                var json;
                                return __generator(this, function (_a) {
                                    switch (_a.label) {
                                        case 0:
                                            cc.director.once(cc.Director.EVENT_AFTER_SCENE_LAUNCH, function () {
                                                ui.hideSplash();
                                                if (isCurrentSceneEmpty(cc)) {
                                                    ui.hintEmptyScene();
                                                }
                                            });
                                            ui.showLoading();
                                            cc.game.pause();
                                            if (!launchScene) {
                                                ui.hideSplash();
                                                ui.hintEmptyScene();
                                                return [2 /*return*/];
                                            }
                                            return [4 /*yield*/, getCurrentScene(launchScene)];
                                        case 1:
                                            json = _a.sent();
                                            try {
                                                launchScene = json[1]._id;
                                            }
                                            catch (error) {
                                                console.debug(error);
                                            }
                                            // load scene
                                            // Load scene progress reports the first 60% of the splash progress.
                                            cc.assetManager.loadWithJson(json, { assetId: launchScene }, function (completedCount, totalCount) {
                                                var progress = ((100 * completedCount) / totalCount) * 0.6; // 划分加载进度，场景加载 60%
                                                ui.reportLoadProgress(progress);
                                            }, function (error, sceneAsset) {
                                                if (error) {
                                                    ui.showError(error);
                                                    cc.error(error);
                                                    return;
                                                }
                                                var scene = sceneAsset.scene;
                                                scene._name = sceneAsset._name;
                                                cc.director.runSceneImmediate(scene, function () {
                                                    cc.game.resume();
                                                });
                                            });
                                            return [2 /*return*/];
                                    }
                                });
                            }); })];
                    case 3:
                        _b.sent();
                        return [4 /*yield*/, new Promise(function (resolve) {
                                setTimeout(resolve, 100);
                            })];
                    case 4:
                        _b.sent();
                        return [2 /*return*/];
                }
            });
        });
    }
    exports_1("main", main);
    /**
     * Check if current scene is empty.
     */
    function isCurrentSceneEmpty(cc) {
        var scene = cc.director.getScene();
        if (!scene || scene.children.length === 0) {
            return true;
        }
        else if (scene.children.length > 1) {
            return false;
        }
        else {
            var child0 = scene.children[0];
            if (child0.children.length > 0 ||
                child0._components.length > 1 ||
                (child0._components.length > 0 && !(child0._components[0] instanceof cc.Canvas))) {
                return false;
            }
            else {
                return true;
            }
        }
    }
    /**
     * 读取当前场景 json 数据
     */
    function getCurrentScene(launchScene) {
        return getData("scene/".concat(launchScene, ".json"));
    }
    /**
     * 根据 url 获取数据
     * @param url
     * @returns
     */
    function getData(url) {
        return new Promise(function (resolve, reject) {
            var request = new XMLHttpRequest();
            request.responseType = 'text';
            request.addEventListener('load', function () {
                if (request.status === 200) {
                    resolve(JSON.parse(request.response));
                }
            });
            request.open('GET', url, true);
            request.send();
        });
    }
    return {
        setters: [],
        execute: function () {
        }
    };
});
//# sourceMappingURL=main.js.map