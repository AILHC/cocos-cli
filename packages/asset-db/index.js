"use strict";
'use stirct';
Object.defineProperty(exports, "__esModule", { value: true });
exports.setFileSystemProvider = exports.resetFileSystemProvider = exports.getFileSystemProvider = exports.refresh = exports.reimport = exports.queryUUID = exports.queryPath = exports.queryUrl = exports.queryMissingInfo = exports.queryAsset = exports.get = exports.Utils = exports.AssetDB = exports.VirtualAsset = exports.Asset = exports.Importer = exports.setDefaultUserData = exports.forEach = exports.create = void 0;
const asset_db_1 = require("./libs/asset-db");
const filesystem_1 = require("./libs/filesystem");
Object.defineProperty(exports, "getFileSystemProvider", { enumerable: true, get: function () { return filesystem_1.getFileSystemProvider; } });
Object.defineProperty(exports, "resetFileSystemProvider", { enumerable: true, get: function () { return filesystem_1.resetFileSystemProvider; } });
Object.defineProperty(exports, "setFileSystemProvider", { enumerable: true, get: function () { return filesystem_1.setFileSystemProvider; } });
const utils_1 = require("./libs/utils");
/**
 * 创建一个新的资源数据库
 * @param options
 */
function create(options) {
    const database = new asset_db_1.AssetDB(options);
    return database;
}
exports.create = create;
/**
 * 循环每一个数据库
 * @param handler
 */
function forEach(handler) {
    Object.keys(asset_db_1.map).forEach((name) => {
        handler(asset_db_1.map[name]);
    });
}
exports.forEach = forEach;
var default_meta_1 = require("./libs/default-meta");
Object.defineProperty(exports, "setDefaultUserData", { enumerable: true, get: function () { return default_meta_1.setDefaultUserData; } });
var importer_1 = require("./libs/importer");
Object.defineProperty(exports, "Importer", { enumerable: true, get: function () { return importer_1.Importer; } });
var asset_1 = require("./libs/asset");
Object.defineProperty(exports, "Asset", { enumerable: true, get: function () { return asset_1.Asset; } });
Object.defineProperty(exports, "VirtualAsset", { enumerable: true, get: function () { return asset_1.VirtualAsset; } });
var asset_db_2 = require("./libs/asset-db");
Object.defineProperty(exports, "AssetDB", { enumerable: true, get: function () { return asset_db_2.AssetDB; } });
exports.Utils = {
    nameToId: utils_1.nameToId,
    isSubPath: utils_1.isSubPath,
};
var manager_1 = require("./libs/manager");
Object.defineProperty(exports, "get", { enumerable: true, get: function () { return manager_1.get; } });
Object.defineProperty(exports, "queryAsset", { enumerable: true, get: function () { return manager_1.queryAsset; } });
Object.defineProperty(exports, "queryMissingInfo", { enumerable: true, get: function () { return manager_1.queryMissingInfo; } });
Object.defineProperty(exports, "queryUrl", { enumerable: true, get: function () { return manager_1.queryUrl; } });
Object.defineProperty(exports, "queryPath", { enumerable: true, get: function () { return manager_1.queryPath; } });
Object.defineProperty(exports, "queryUUID", { enumerable: true, get: function () { return manager_1.queryUUID; } });
Object.defineProperty(exports, "reimport", { enumerable: true, get: function () { return manager_1.reimport; } });
Object.defineProperty(exports, "refresh", { enumerable: true, get: function () { return manager_1.refresh; } });
let version = '';
try {
    version = require('./package.json').version;
}
catch (error) {
    version = require('../package.json').version;
}
if (!global.AssetDB) {
    global.AssetDB = module.exports;
    global.AssetDB.version = version;
}
else if (global.AssetDB.version !== version) {
    console.log(`Two different versions of AssetDB have been loaded, please check it.`);
    module.exports = global.AssetDB;
}
else {
    module.exports = global.AssetDB;
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi9zb3VyY2UvaW5kZXgudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IjtBQUFBLFlBQVksQ0FBQzs7O0FBRWIsOENBQStEO0FBQy9ELGtEQUkyQjtBQXdEdkIsc0dBM0RBLGtDQUFxQixPQTJEQTtBQUNyQix3R0EzREEsb0NBQXVCLE9BMkRBO0FBQ3ZCLHNHQTNEQSxrQ0FBcUIsT0EyREE7QUF6RHpCLHdDQUFtRDtBQUVuRDs7O0dBR0c7QUFDSCxTQUFnQixNQUFNLENBQUMsT0FBdUI7SUFDMUMsTUFBTSxRQUFRLEdBQUcsSUFBSSxrQkFBTyxDQUFDLE9BQU8sQ0FBQyxDQUFDO0lBQ3RDLE9BQU8sUUFBUSxDQUFDO0FBQ3BCLENBQUM7QUFIRCx3QkFHQztBQUVEOzs7R0FHRztBQUNILFNBQWdCLE9BQU8sQ0FBQyxPQUFpQjtJQUNyQyxNQUFNLENBQUMsSUFBSSxDQUFDLGNBQUcsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxDQUFDLElBQUksRUFBRSxFQUFFO1FBQzlCLE9BQU8sQ0FBQyxjQUFHLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQztJQUN2QixDQUFDLENBQUMsQ0FBQztBQUNQLENBQUM7QUFKRCwwQkFJQztBQUVELG9EQUU2QjtBQUR6QixrSEFBQSxrQkFBa0IsT0FBQTtBQUd0Qiw0Q0FFeUI7QUFEckIsb0dBQUEsUUFBUSxPQUFBO0FBR1osc0NBR3NCO0FBRmxCLDhGQUFBLEtBQUssT0FBQTtBQUNMLHFHQUFBLFlBQVksT0FBQTtBQUdoQiw0Q0FFeUI7QUFEckIsbUdBQUEsT0FBTyxPQUFBO0FBR0UsUUFBQSxLQUFLLEdBQUc7SUFDakIsUUFBUSxFQUFSLGdCQUFRO0lBQ1IsU0FBUyxFQUFULGlCQUFTO0NBQ1osQ0FBQztBQUVGLDBDQVN3QjtBQVJwQiw4RkFBQSxHQUFHLE9BQUE7QUFDSCxxR0FBQSxVQUFVLE9BQUE7QUFDViwyR0FBQSxnQkFBZ0IsT0FBQTtBQUNoQixtR0FBQSxRQUFRLE9BQUE7QUFDUixvR0FBQSxTQUFTLE9BQUE7QUFDVCxvR0FBQSxTQUFTLE9BQUE7QUFDVCxtR0FBQSxRQUFRLE9BQUE7QUFDUixrR0FBQSxPQUFPLE9BQUE7QUFTWCxJQUFJLE9BQU8sR0FBRyxFQUFFLENBQUM7QUFDakIsSUFBSTtJQUNBLE9BQU8sR0FBRyxPQUFPLENBQUMsZ0JBQWdCLENBQUMsQ0FBQyxPQUFPLENBQUM7Q0FDL0M7QUFBQyxPQUFNLEtBQUssRUFBRTtJQUNYLE9BQU8sR0FBRyxPQUFPLENBQUMsaUJBQWlCLENBQUMsQ0FBQyxPQUFPLENBQUM7Q0FDaEQ7QUFJRCxJQUFJLENBQUMsTUFBTSxDQUFDLE9BQU8sRUFBRTtJQUNqQixNQUFNLENBQUMsT0FBTyxHQUFHLE1BQU0sQ0FBQyxPQUFPLENBQUM7SUFDaEMsTUFBTSxDQUFDLE9BQU8sQ0FBQyxPQUFPLEdBQUcsT0FBTyxDQUFDO0NBQ3BDO0tBQU0sSUFBSSxNQUFNLENBQUMsT0FBTyxDQUFDLE9BQU8sS0FBSyxPQUFPLEVBQUU7SUFDM0MsT0FBTyxDQUFDLEdBQUcsQ0FBQyxzRUFBc0UsQ0FBQyxDQUFDO0lBQ3BGLE1BQU0sQ0FBQyxPQUFPLEdBQUcsTUFBTSxDQUFDLE9BQU8sQ0FBQztDQUNuQztLQUFNO0lBQ0gsTUFBTSxDQUFDLE9BQU8sR0FBRyxNQUFNLENBQUMsT0FBTyxDQUFDO0NBQ25DIiwic291cmNlc0NvbnRlbnQiOlsiJ3VzZSBzdGlyY3QnO1xyXG5cclxuaW1wb3J0IHsgQXNzZXREQk9wdGlvbnMsIEFzc2V0REIsIG1hcCB9IGZyb20gJy4vbGlicy9hc3NldC1kYic7XG5pbXBvcnQge1xuICAgIGdldEZpbGVTeXN0ZW1Qcm92aWRlcixcbiAgICByZXNldEZpbGVTeXN0ZW1Qcm92aWRlcixcbiAgICBzZXRGaWxlU3lzdGVtUHJvdmlkZXIsXG59IGZyb20gJy4vbGlicy9maWxlc3lzdGVtJztcbmltcG9ydCB7IGlzU3ViUGF0aCwgbmFtZVRvSWQgfSBmcm9tICcuL2xpYnMvdXRpbHMnO1xuXHJcbi8qKlxyXG4gKiDliJvlu7rkuIDkuKrmlrDnmoTotYTmupDmlbDmja7lupNcclxuICogQHBhcmFtIG9wdGlvbnMgXHJcbiAqL1xyXG5leHBvcnQgZnVuY3Rpb24gY3JlYXRlKG9wdGlvbnM6IEFzc2V0REJPcHRpb25zKSB7XHJcbiAgICBjb25zdCBkYXRhYmFzZSA9IG5ldyBBc3NldERCKG9wdGlvbnMpO1xyXG4gICAgcmV0dXJuIGRhdGFiYXNlO1xyXG59XHJcblxyXG4vKipcclxuICog5b6q546v5q+P5LiA5Liq5pWw5o2u5bqTXHJcbiAqIEBwYXJhbSBoYW5kbGVyIFxyXG4gKi9cclxuZXhwb3J0IGZ1bmN0aW9uIGZvckVhY2goaGFuZGxlcjogRnVuY3Rpb24pIHtcclxuICAgIE9iamVjdC5rZXlzKG1hcCkuZm9yRWFjaCgobmFtZSkgPT4ge1xyXG4gICAgICAgIGhhbmRsZXIobWFwW25hbWVdKTtcclxuICAgIH0pO1xyXG59XHJcblxyXG5leHBvcnQge1xyXG4gICAgc2V0RGVmYXVsdFVzZXJEYXRhLFxyXG59IGZyb20gJy4vbGlicy9kZWZhdWx0LW1ldGEnO1xyXG5cclxuZXhwb3J0IHtcclxuICAgIEltcG9ydGVyLFxyXG59IGZyb20gJy4vbGlicy9pbXBvcnRlcic7XHJcblxyXG5leHBvcnQge1xyXG4gICAgQXNzZXQsXHJcbiAgICBWaXJ0dWFsQXNzZXQsXHJcbn0gZnJvbSAnLi9saWJzL2Fzc2V0JztcclxuXHJcbmV4cG9ydCB7XHJcbiAgICBBc3NldERCLFxyXG59IGZyb20gJy4vbGlicy9hc3NldC1kYic7XHJcblxyXG5leHBvcnQgY29uc3QgVXRpbHMgPSB7XHJcbiAgICBuYW1lVG9JZCxcclxuICAgIGlzU3ViUGF0aCxcclxufTtcclxuXHJcbmV4cG9ydCB7XG4gICAgZ2V0LFxuICAgIHF1ZXJ5QXNzZXQsXG4gICAgcXVlcnlNaXNzaW5nSW5mbyxcbiAgICBxdWVyeVVybCxcclxuICAgIHF1ZXJ5UGF0aCxcclxuICAgIHF1ZXJ5VVVJRCxcclxuICAgIHJlaW1wb3J0LFxyXG4gICAgcmVmcmVzaCxcbn0gZnJvbSAnLi9saWJzL21hbmFnZXInO1xuXG5leHBvcnQge1xuICAgIGdldEZpbGVTeXN0ZW1Qcm92aWRlcixcbiAgICByZXNldEZpbGVTeXN0ZW1Qcm92aWRlcixcbiAgICBzZXRGaWxlU3lzdGVtUHJvdmlkZXIsXG59O1xuXHJcbmxldCB2ZXJzaW9uID0gJyc7XHJcbnRyeSB7XHJcbiAgICB2ZXJzaW9uID0gcmVxdWlyZSgnLi9wYWNrYWdlLmpzb24nKS52ZXJzaW9uO1xyXG59IGNhdGNoKGVycm9yKSB7XHJcbiAgICB2ZXJzaW9uID0gcmVxdWlyZSgnLi4vcGFja2FnZS5qc29uJykudmVyc2lvbjtcclxufVxyXG5cclxuZGVjbGFyZSBjb25zdCBnbG9iYWw6IGFueTtcclxuXHJcbmlmICghZ2xvYmFsLkFzc2V0REIpIHtcclxuICAgIGdsb2JhbC5Bc3NldERCID0gbW9kdWxlLmV4cG9ydHM7XHJcbiAgICBnbG9iYWwuQXNzZXREQi52ZXJzaW9uID0gdmVyc2lvbjtcclxufSBlbHNlIGlmIChnbG9iYWwuQXNzZXREQi52ZXJzaW9uICE9PSB2ZXJzaW9uKSB7XHJcbiAgICBjb25zb2xlLmxvZyhgVHdvIGRpZmZlcmVudCB2ZXJzaW9ucyBvZiBBc3NldERCIGhhdmUgYmVlbiBsb2FkZWQsIHBsZWFzZSBjaGVjayBpdC5gKTtcclxuICAgIG1vZHVsZS5leHBvcnRzID0gZ2xvYmFsLkFzc2V0REI7XHJcbn0gZWxzZSB7XHJcbiAgICBtb2R1bGUuZXhwb3J0cyA9IGdsb2JhbC5Bc3NldERCO1xyXG59XHJcbiJdfQ==