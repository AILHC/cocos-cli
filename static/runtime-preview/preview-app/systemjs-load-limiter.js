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
    var INSTALL_STATE_KEY, DEFAULT_CONCURRENCY, DEFAULT_RETRY;
    var __moduleName = context_1 && context_1.id;
    function isRuntimePreviewProjectChunkUrl(value) {
        if (!value) {
            return false;
        }
        try {
            var base = typeof window !== 'undefined' ? window.location.href : 'http://127.0.0.1/';
            var parsed = new URL(value, base);
            return /\/scripting\/x\/packer-driver\/targets\/preview\/chunks\/[^/]+\/[^/]+\.js$/.test(parsed.pathname);
        }
        catch (_a) {
            return false;
        }
    }
    exports_1("isRuntimePreviewProjectChunkUrl", isRuntimePreviewProjectChunkUrl);
    function isScriptLoadFailure(error, url) {
        var _a;
        var message = error instanceof Error
            ? "".concat(error.message, "\n").concat((_a = error.stack) !== null && _a !== void 0 ? _a : '')
            : String(error !== null && error !== void 0 ? error : '');
        if (!message.includes(url)) {
            return false;
        }
        return message.includes('ERR_INSUFFICIENT_RESOURCES')
            || message.includes('Error loading')
            || /Get .* failed/.test(message)
            || /Loading script .* failed/.test(message);
    }
    exports_1("isScriptLoadFailure", isScriptLoadFailure);
    function installRuntimePreviewScriptLoadLimiter(system, options) {
        if (system === void 0) { system = globalThis.System; }
        if (options === void 0) { options = {}; }
        if (!system) {
            throw new Error('SystemJS is missing.');
        }
        var existing = system[INSTALL_STATE_KEY];
        if (existing) {
            return existing;
        }
        var hook = typeof system.fetchScript === 'function' ? 'fetchScript' : 'instantiate';
        var original = system[hook];
        if (typeof original !== 'function') {
            throw new Error('SystemJS script load hook is missing.');
        }
        var concurrency = resolveConcurrency(options.concurrency);
        var retry = resolveRetry(options.retry);
        var metrics = {
            active: 0,
            maxActive: 0,
            queuePeak: 0,
            enqueued: 0,
            completed: 0,
            failed: 0,
            retryCount: 0,
            bypassed: 0,
        };
        var state = {
            hook: hook,
            concurrency: concurrency,
            metrics: metrics,
        };
        var queue = [];
        var acquire = function () {
            if (metrics.active < concurrency) {
                metrics.active += 1;
                metrics.maxActive = Math.max(metrics.maxActive, metrics.active);
                return Promise.resolve(release);
            }
            return new Promise(function (resolve) {
                queue.push(resolve);
                metrics.queuePeak = Math.max(metrics.queuePeak, queue.length);
            });
        };
        var release = function () {
            var next = queue.shift();
            if (next) {
                next(release);
                return;
            }
            metrics.active -= 1;
            metrics.active = Math.max(metrics.active, 0);
        };
        system[hook] = function limitedRuntimePreviewScriptLoad() {
            var args = [];
            for (var _i = 0; _i < arguments.length; _i++) {
                args[_i] = arguments[_i];
            }
            return __awaiter(this, void 0, void 0, function () {
                var url, releaseSlot, result, error_1;
                var _a;
                return __generator(this, function (_b) {
                    switch (_b.label) {
                        case 0:
                            url = String((_a = args[0]) !== null && _a !== void 0 ? _a : '');
                            if (!isRuntimePreviewProjectChunkUrl(url)) {
                                metrics.bypassed += 1;
                                return [2 /*return*/, original.apply(this, args)];
                            }
                            metrics.enqueued += 1;
                            return [4 /*yield*/, acquire()];
                        case 1:
                            releaseSlot = _b.sent();
                            _b.label = 2;
                        case 2:
                            _b.trys.push([2, 4, 5, 6]);
                            return [4 /*yield*/, callWithRetry(original, this, args, url, retry, metrics)];
                        case 3:
                            result = _b.sent();
                            metrics.completed += 1;
                            return [2 /*return*/, result];
                        case 4:
                            error_1 = _b.sent();
                            metrics.failed += 1;
                            throw error_1;
                        case 5:
                            releaseSlot();
                            return [7 /*endfinally*/];
                        case 6: return [2 /*return*/];
                    }
                });
            });
        };
        system[INSTALL_STATE_KEY] = state;
        return state;
    }
    exports_1("installRuntimePreviewScriptLoadLimiter", installRuntimePreviewScriptLoadLimiter);
    function callWithRetry(original, receiver, args, url, retry, metrics) {
        return __awaiter(this, void 0, void 0, function () {
            var attempt, error_2;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        attempt = 0;
                        _a.label = 1;
                    case 1:
                        _a.trys.push([1, 3, , 4]);
                        return [4 /*yield*/, original.apply(receiver, args)];
                    case 2: return [2 /*return*/, _a.sent()];
                    case 3:
                        error_2 = _a.sent();
                        if (attempt >= retry || !isScriptLoadFailure(error_2, url)) {
                            throw error_2;
                        }
                        attempt += 1;
                        metrics.retryCount += 1;
                        return [3 /*break*/, 4];
                    case 4: return [3 /*break*/, 1];
                    case 5: return [2 /*return*/];
                }
            });
        });
    }
    function resolveConcurrency(explicit) {
        var candidate = explicit !== null && explicit !== void 0 ? explicit : readConcurrencyFromQuery();
        if (typeof candidate !== 'number' || !Number.isFinite(candidate) || candidate < 1) {
            return DEFAULT_CONCURRENCY;
        }
        return Math.floor(candidate);
    }
    function resolveRetry(explicit) {
        if (typeof explicit !== 'number' || !Number.isFinite(explicit)) {
            return DEFAULT_RETRY;
        }
        return Math.max(0, Math.floor(explicit));
    }
    function readConcurrencyFromQuery() {
        if (typeof window === 'undefined') {
            return undefined;
        }
        var raw = new URLSearchParams(window.location.search).get('runtimePreviewScriptLoadConcurrency');
        if (!raw) {
            return undefined;
        }
        var value = Number(raw);
        return Number.isFinite(value) ? value : undefined;
    }
    return {
        setters: [],
        execute: function () {
            INSTALL_STATE_KEY = '__runtimePreviewScriptLoadLimiterState';
            DEFAULT_CONCURRENCY = 32;
            DEFAULT_RETRY = 1;
        }
    };
});
//# sourceMappingURL=systemjs-load-limiter.js.map