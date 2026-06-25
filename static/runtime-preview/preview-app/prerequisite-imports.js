System.register(["./systemjs-load-limiter.js"], function (exports_1, context_1) {
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
    var __spreadArray = (this && this.__spreadArray) || function (to, from, pack) {
        if (pack || arguments.length === 2) for (var i = 0, l = from.length, ar; i < l; i++) {
            if (ar || !(i in from)) {
                if (!ar) ar = Array.prototype.slice.call(from, 0, i);
                ar[i] = from[i];
            }
        }
        return to.concat(ar || Array.prototype.slice.call(from));
    };
    var systemjs_load_limiter_js_1;
    var __moduleName = context_1 && context_1.id;
    function loadRuntimePreviewPrerequisiteImports(options) {
        return __awaiter(this, void 0, void 0, function () {
            var system, now, installLimiter, validateImportMap, limiter, importStartedAt, prerequisiteImportMs, validationStartedAt, validationMs, timing, error_1;
            var _a, _b, _c, _d;
            return __generator(this, function (_e) {
                switch (_e.label) {
                    case 0:
                        system = options.system;
                        now = (_a = options.now) !== null && _a !== void 0 ? _a : Date.now;
                        installLimiter = (_b = options.installLimiter) !== null && _b !== void 0 ? _b : systemjs_load_limiter_js_1.installRuntimePreviewScriptLoadLimiter;
                        validateImportMap = (_c = options.validateImportMap) !== null && _c !== void 0 ? _c : validateRuntimePreviewPrerequisiteImportMap;
                        limiter = installLimiter(system);
                        window.__RUNTIME_PREVIEW_SCRIPT_LOAD_LIMITER__ = limiter;
                        _e.label = 1;
                    case 1:
                        _e.trys.push([1, 4, , 5]);
                        importStartedAt = now();
                        return [4 /*yield*/, system.import('cce:/internal/x/prerequisite-imports')];
                    case 2:
                        _e.sent();
                        prerequisiteImportMs = now() - importStartedAt;
                        validationStartedAt = now();
                        return [4 /*yield*/, validateImportMap()];
                    case 3:
                        _e.sent();
                        validationMs = now() - validationStartedAt;
                        timing = collectRuntimePreviewPrerequisiteTiming(limiter, prerequisiteImportMs, validationMs);
                        window.__RUNTIME_PREVIEW_PREREQUISITE_TIMINGS__ = __spreadArray(__spreadArray([], ((_d = window.__RUNTIME_PREVIEW_PREREQUISITE_TIMINGS__) !== null && _d !== void 0 ? _d : []), true), [
                            timing,
                        ], false);
                        console.info("[runtime-preview] prerequisite-imports:done prerequisiteImportMs=".concat(timing.prerequisiteImportMs)
                            + " validationMs=".concat(timing.validationMs)
                            + " hook=".concat(timing.hook)
                            + " concurrency=".concat(timing.concurrency)
                            + " maxActive=".concat(timing.maxActive)
                            + " queuePeak=".concat(timing.queuePeak)
                            + " completed=".concat(timing.completed)
                            + " failed=".concat(timing.failed)
                            + " retry=".concat(timing.retryCount));
                        return [3 /*break*/, 5];
                    case 4:
                        error_1 = _e.sent();
                        console.error('[runtime-preview] prerequisite imports failed', error_1);
                        throw error_1;
                    case 5: return [2 /*return*/];
                }
            });
        });
    }
    exports_1("loadRuntimePreviewPrerequisiteImports", loadRuntimePreviewPrerequisiteImports);
    function validateRuntimePreviewPrerequisiteImportMap() {
        return __awaiter(this, void 0, void 0, function () {
            var importMapUrl, response, importMap, prerequisiteChunk, prerequisiteScope, importMapBase, prerequisiteChunkUrl, chunkResponse, prerequisiteChunkSource, requiredSpecifiers, _i, requiredSpecifiers_1, specifier, chunkImport;
            var _a, _b;
            return __generator(this, function (_c) {
                switch (_c.label) {
                    case 0:
                        importMapUrl = '/scripting/x/packer-driver/targets/preview/import-map.json';
                        return [4 /*yield*/, fetch(importMapUrl)];
                    case 1:
                        response = _c.sent();
                        if (!response.ok) {
                            throw new Error("Failed to load runtime preview import map: ".concat(response.status));
                        }
                        return [4 /*yield*/, response.json()];
                    case 2:
                        importMap = _c.sent();
                        prerequisiteChunk = (_a = importMap.imports) === null || _a === void 0 ? void 0 : _a['cce:/internal/x/prerequisite-imports'];
                        prerequisiteScope = prerequisiteChunk ? (_b = importMap.scopes) === null || _b === void 0 ? void 0 : _b[prerequisiteChunk] : undefined;
                        if (!prerequisiteChunk || !prerequisiteScope) {
                            throw new Error('Runtime preview prerequisite import scope is missing.');
                        }
                        importMapBase = new URL(importMapUrl, window.location.href);
                        prerequisiteChunkUrl = new URL(prerequisiteChunk, importMapBase);
                        return [4 /*yield*/, fetch(prerequisiteChunkUrl.href)];
                    case 3:
                        chunkResponse = _c.sent();
                        if (!chunkResponse.ok) {
                            throw new Error("Failed to load runtime preview prerequisite chunk: ".concat(chunkResponse.status));
                        }
                        return [4 /*yield*/, chunkResponse.text()];
                    case 4:
                        prerequisiteChunkSource = _c.sent();
                        requiredSpecifiers = collectRuntimePreviewUnresolvedSpecifiers(prerequisiteChunkSource);
                        for (_i = 0, requiredSpecifiers_1 = requiredSpecifiers; _i < requiredSpecifiers_1.length; _i++) {
                            specifier = requiredSpecifiers_1[_i];
                            chunkImport = prerequisiteScope[specifier];
                            if (!isRuntimePreviewChunkImport(chunkImport)) {
                                throw new Error("Runtime preview prerequisite scope is missing ".concat(specifier, "."));
                            }
                        }
                        return [2 /*return*/];
                }
            });
        });
    }
    exports_1("validateRuntimePreviewPrerequisiteImportMap", validateRuntimePreviewPrerequisiteImportMap);
    function collectRuntimePreviewPrerequisiteTiming(limiter, prerequisiteImportMs, validationMs) {
        return {
            prerequisiteImportMs: prerequisiteImportMs,
            validationMs: validationMs,
            hook: limiter.hook,
            concurrency: limiter.concurrency,
            maxActive: limiter.metrics.maxActive,
            queuePeak: limiter.metrics.queuePeak,
            completed: limiter.metrics.completed,
            failed: limiter.metrics.failed,
            retryCount: limiter.metrics.retryCount,
        };
    }
    function collectRuntimePreviewUnresolvedSpecifiers(source) {
        var specifiers = new Set();
        var pattern = /__unresolved_\d+/g;
        var match = null;
        while ((match = pattern.exec(source))) {
            specifiers.add(match[0]);
        }
        return Array.from(specifiers)
            .sort(function (left, right) { return Number(left.slice('__unresolved_'.length)) - Number(right.slice('__unresolved_'.length)); });
    }
    function isRuntimePreviewChunkImport(value) {
        return typeof value === 'string' && /^\.\/chunks\/[^/]+\/[^/]+\.js$/.test(value);
    }
    return {
        setters: [
            function (systemjs_load_limiter_js_1_1) {
                systemjs_load_limiter_js_1 = systemjs_load_limiter_js_1_1;
            }
        ],
        execute: function () {
        }
    };
});
//# sourceMappingURL=prerequisite-imports.js.map