const path = require("path");


const { ipcMain } = require("electron");
const gulpBuildPath = path.join(Editor.App.path, "editor/core/gulp-build");
const gulpBuild = require(gulpBuildPath) as any;
const bundleUtilsPath = path.join(Editor.App.path, "editor/share/bundle-utils");
let bundleUtils;
try {
    bundleUtils = require(bundleUtilsPath) as any;
} catch (err) {
    console.warn(err);
}

let n, expressIns, httpServer, a, c, d: any = !1;
function u() {
    var e = Editor.require("app://asset-db/lib/meta").get(Editor.assetdb, Editor.currentSceneUuid)
        , t = Editor.stashedScene.sceneJson;
    if (e) {
        var i = JSON.parse(t)
            , r = Editor.serialize.findRootObject(i, "cc.SceneAsset");
        r ? r.asyncLoadAssets = e.asyncLoadAssets : Editor.warn("Can not find cc.SceneAsset in stashed scene");
        var n = Editor.serialize.findRootObject(i, "cc.Scene");
        return n ? n.autoReleaseAssets = e.autoReleaseAssets : Editor.warn("Can not find cc.Scene in stashed scene"),
            JSON.stringify(i)
    }
    return t
}
let previewServer = {
    userMiddlewares: [],
    _previewPort: 7456,
    _listenByPort(e, callBack) {
        httpServer ? (httpServer.close(),
            function e(t, i, r) {
                function n() {
                    t.removeListener("error", s),
                        r(null, i)
                }
                function s(s) {
                    if (t.removeListener("listening", n),
                        "EADDRINUSE" !== s.code && "EACCES" !== s.code)
                        return r(s, undefined);
                    Editor.warn(`The current '${i}' preview port is already occupied, the port is automatically incremented`),
                        e(t, ++i, r)
                }
                t.once("error", s),
                    t.once("listening", n),
                    t.listen(i)
            }(httpServer, e, (e, i) => {
                if (e)
                    return Editor.warn(e),
                        callBack && callBack(e),
                        void 0;
                this._previewPort = i,
                    Editor.success(`preview server running at http://localhost:${i}`),
                    Editor.Ipc.sendToAll("preview-server:preview-port-changed", i),
                    callBack && callBack()
            }
            )) : callBack && callBack()
    },
    start: function (validateStashedSceneFunc, i) {
        var ffs = require("fire-fs")
            , fpath = require("fire-path")
            , os = require("os")
            , del = require("del")
            , eps = require("express")
            , httpa = require("http")
            , md = require("mobile-detect")
            , asynca = require("async");
        const compression = require("compression");
        var self = this;
        this._validateStashedScene = validateStashedSceneFunc;
        var fgbuidsPath = fpath.join(os.tmpdir(), "fireball-game-builds");
        del.sync(fpath.join(fgbuidsPath, "**/*").replace(/\\/g, "/"), {
            force: !0
        });
        (expressIns = eps()).use(compression());
        let w = fpath.join(Editor.Project.path, "preview-templates");
        ffs.existsSync(w) || (w = Editor.url("unpack://static/preview-templates"));
        expressIns.set("views", w);
        expressIns.set("view engine", "jade");
        const ejs = require("ejs");
        function S(e, t) {
            var i = e.params[1];
            if (Editor.stashedScene && Editor.currentSceneUuid && fpath.basenameNoExt(i) === Editor.currentSceneUuid)
                return t.send(u());
            void 0;
            i = fpath.join(Editor.importPath, i);
            t.sendFile(i)
        }
        expressIns.engine("html", ejs.renderFile);
        expressIns.engine("ejs", ejs.renderFile);
        expressIns.locals.basedir = expressIns.get("views");
        expressIns.use(function (req, res, next) {
            var middlewares = self.userMiddlewares;
            if (Array.isArray(middlewares) && middlewares.length > 0) {
                asynca.eachSeries(middlewares, (middlewareFunc, nextFunc) => {
                    if (!middlewareFunc)
                        return Editor.warn("Web Preview: Invalid element in userMiddlewares, please check your editor packages."),
                            nextFunc(null);
                    middlewareFunc(req, res, nextFunc)
                }, next)
            } else {
                next();
            }
        });
        expressIns.use("/build", function (e, t, i) {
            a ? a(e, t, i) : t.send("Please build your game project first!")
        });
        expressIns.use("/preview-android-instant", function (e, t, i) {
            c ? c(e, t, i) : t.send("Please build your android instant project first!")
        });
        Editor.log(`[ASWALLOW] 开启外部资源访问`);

        expressIns.get("/", function (e, t) {
            var i = e.headers["user-agent"]
                , n = new md(i)
                , s = ffs.existsSync(fpath.join(Editor.Project.path, "library", "bundle.project.js"))
                , o = -1 !== i.indexOf("MicroMessenger");
            let a = Editor.require("app://editor/share/quick-compile/check-auto-build-engine")() ? ".cache/dev/__quick_compile__.js" : "cocos2d-js-for-preview.js"
                , c = !0
                , u = !1
                , l = Editor.Profile.load("project://project.json").get("excluded-modules");
            l && (c = !l.includes("3D Physics/cannon.js"),
                u = !l.includes("3D Physics/Builtin"));
            let p = {
                title: "CocosCreator | " + Editor.Project.name,
                cocos2d: a,
                hasProjectScript: s,
                tip_sceneIsEmpty: Editor.T("PREVIEW.scene_is_empty"),
                enableDebugger: !!n.mobile() || o,
                enableCannonPhysics: c,
                enableBuiltinPhysics: u
            };
            try {
                Object.assign(p, ffs.readJsonSync(fpath.join(w, "configs/options.json")))
            } catch (e) { }
            t.render(ffs.existsSync(fpath.join(w, "index.html")) ? "index.html" : ffs.existsSync(fpath.join(w, "index.ejs")) ? "index.ejs" : "index", p)
        });
        expressIns.get("/compile", function (e, t) {
            Editor.Compiler.compileScripts(!1, (e, i) => {
                i || (e ? (t.send("Compiling script successful!"),
                    Editor.Compiler.reload()) : t.send("Compile failed!"))
            }
            )
        });
        expressIns.get("/update-db", function (e, t) {
            Editor.assetdb.submitChanges(),
                t.send("Changes submitted")
        });
        expressIns.get(["/app/engine/*", "/engine/*"], function (e, t) {
            var i = fpath.join(Editor.url("unpack://engine"), e.params[0]);
            t.sendFile(i)
        });
        expressIns.get("/engine-dev/*", function (e, t) {
            var i = fpath.join(Editor.url("unpack://engine-dev"), e.params[0]);
            t.sendFile(i)
        });
        expressIns.get("/app/editor/static/*", function (e, t) {
            var i = Editor.url("unpack://static/" + e.params[0]);
            t.sendFile(i)
        });
        expressIns.get("/app/*", function (e, t) {
            var i = Editor.url("app://" + e.params[0]);
            t.sendFile(i)
        });
        expressIns.get("/project/*", function (e, t) {
            var i = fpath.join(Editor.Project.path, e.params[0]);
            t.sendFile(i)
        });
        expressIns.get("/preview-scripts/*", function (e, t) {
            let i = Editor.ProjectCompiler.DEST_PATH;
            var r = fpath.join(i, e.params[0]);
            t.sendFile(r)
        });
        expressIns.get("/plugins/*", function (e, t) {
            var i = e.params[0];
            i = Editor.assetdb._fspath("db://" + i),
                t.sendFile(i)
        });
        expressIns.get("/assets/*/import/*", S);
        expressIns.get("/assets/*/native/*", S);
        expressIns.get("/assets/*/config.json", function (e, res) {
            // console.log(`加载bundle`);
            self.query(`${e.params[0]}/config.json`, function (err, configJson) {
                if (err)
                    return res.status(404).send({
                        error: err.message
                    });
                res.send(configJson)
            })
        });
        expressIns.get("/assets/*/index.js", function (e, t) {
            t.send("")
        });
        expressIns.get("/settings.js", function (e, t) {
            self.query("settings.js", function (e, r) {
                if (e)
                    return i(e);
                t.send(r)
            })
        });
        expressIns.get("/preview-scene.json", function (e, t) {
            self.getPreviewScene(function (e) {
                return i(e)
            }, function (e) {
                t.send(e)
            }, function (e) {
                t.sendFile(e)
            })
        });
        expressIns.get("/*", function (e, t, i) {
            return eps.static(w)(e, t, i);
        });
        expressIns.use(function (e, t, i, r) {
            console.error(e.stack),
                r(e)
        });
        expressIns.use(function (e, t, i, r) {
            t.xhr ? i.status(e.status || 500).send({
                error: e.message
            }) : r(e)
        });
        expressIns.use(function (e, t) {
            t.status(404).send({
                error: "404 Error."
            })
        });
        httpServer = httpa.createServer(expressIns);
        let projectConfig = Editor.Profile.load("project://project.json");
        this._listenByPort(projectConfig && projectConfig.get("preview-port") || this._previewPort, i);

        const func = function (e) {
            var t = 0;
            (n = require("socket.io")(e)).on("connection", function (e) {
                e.emit("connected"),
                    t += 1,
                    Editor.Ipc.sendToMainWin("preview-server:connects-changed", t),
                    e.on("disconnect", function () {
                        t -= 1,
                            Editor.Ipc.sendToMainWin("preview-server:connects-changed", t)
                    })
            })
        };
        func(httpServer);
        ipcMain.removeAllListeners("preview-server:use-new-preview-port");
        ipcMain.on("preview-server:use-new-preview-port", (e, t) => {
            this._previewPort !== t && this._listenByPort(t)
        })
    },
    query: async function (e, n, callBack) {
        if (this._validateStashedScene)
            switch (void 0 === callBack && (callBack = n,
                n = "web-desktop"),
            e) {
                case "settings.js":
                    this._validateStashedScene(async () => {
                        let e = Editor.Profile.load("project://project.json");
                        var r = await bundleUtils.queryBundleFolders();
                        let o = {
                            designWidth: Editor.stashedScene.designWidth,
                            designHeight: Editor.stashedScene.designHeight,
                            groupList: e.get("group-list"),
                            collisionMatrix: e.get("collision-matrix"),
                            platform: n,
                            scripts: Editor.ProjectCompiler.scripts,
                            hasResourcesBundle: !!r.find(e => "resources" === e.name)
                        };
                        gulpBuild.buildSettings({
                            customSettings: o,
                            launchScene: Editor.sceneList[0],
                            debug: !0,
                            preview: !0
                        }, callBack)
                    }
                    );
                    break;
                case "stashed-scene.json":
                    this._validateStashedScene(() => {
                        callBack && callBack(null, u())
                    }
                    );
                    break;
                case "main/config.json":
                case "internal/config.json":
                case "resources/config.json":
                default:
                    var bundleName = path.dirname(e)
                        , bundleSceneMap = await bundleUtils.queryBundlesWithScenes()
                        , bundles = await bundleUtils.queryBundleFolders();
                    bundles.push({
                        name: cc.AssetManager.BuiltinBundleName.MAIN,
                        url: ""
                    });
                    var bundle = bundles.find(e => e.name === bundleName);
                    if (!bundle)
                        return callBack(new Error("Bundle does not exist!"));
                    gulpBuild.buildConfig({
                        name: bundleName,
                        importBase: "web-desktop" !== n ? "" : "import",
                        nativeBase: "web-desktop" !== n ? "" : "native",
                        root: bundle.url,
                        sceneList: bundleSceneMap[bundleName] ? bundleSceneMap[bundleName].map(e => e.uuid) : [],
                        debug: !0,
                        preview: !0
                    }, callBack)
            }
    },
    getPreviewScene(e, t, i) {
        let r = Editor._projectProfile.get("start-scene");
        if ("current" !== r && r !== Editor.currentSceneUuid && Editor.assetdb.existsByUuid(r)) {
            i(Editor.assetdb._uuidToImportPathNoExt(r) + ".json")
        } else
            this.query("stashed-scene.json", (i, r) => {
                if (i)
                    return e(i);
                t(r)
            }
            )
    },
    stop: function () {
        httpServer && httpServer.close(function () {
            Editor.info("shutdown preview server"),
                httpServer = null
        })
    },
    browserReload: function () {
        d || (d = setTimeout(function () {
            n.emit("browser:reload"),
                clearTimeout(d),
                d = !1
        }, 50))
    },
    setPreviewBuildPath: function (e) {
        var t = require("express");
        a = t.static(e)
    },
    setPreviewAndroidInstantPath: function (e) {
        var t = require("express");
        Editor.log("express path is ", e),
            c = t.static(e)
    },
    _validateStashedScene: null
};
Object.defineProperty(previewServer, "previewPort", {
    get() {
        return this._previewPort
    },
    set(e) {
        this._previewPort = e;
        this._listenByPort(e)
    }
});
export default previewServer;
