import * as FastGlob from 'fast-glob';
import { localBuildConfigPath, CC_INTERNAL_BUNDLE_NAMES, pluginLogTitle, PREVIEW_BUNDLE_LOAD_PROTOCOL, PREVIEW_GET_MAIN_PROJ_BUNDLENAMES } from './share-const';
import * as path from "path";

import { getConfigs } from './config';
import * as fse from "fs-extra";
import { ipcMain } from "electron";
import { getCurProjectBundleInfos, getSubProjBundlePath, resolveToProjectPath } from './utils';
// const gulpBuildPath = path.join(Editor.App.path, "editor/core/gulp-build");
// const gulpBuild = require(gulpBuildPath) as any;
// const bundleUtilsPath = path.join(Editor.App.path, "editor/share/bundle-utils");
// let bundleUtils;
// try {
//     bundleUtils = require(bundleUtilsPath) as any;
// } catch (err) {
//     console.warn(err);
// }
export class PreviewServerCtrl {
    static startSvrTimeoutId: NodeJS.Timeout;
    public static get serverPort() {

        return Editor.PreviewServer.previewPort;
    }
    public static start() {
        const express = require("express");
        //增加外部assetbundles加载拦截
        let aswallowMiddlewares: any[]

        if (!Editor.PreviewServer["aswallowMiddlewares"]) {
            Editor.PreviewServer["aswallowMiddlewares"] = aswallowMiddlewares = [];
        } else {
            aswallowMiddlewares = Editor.PreviewServer["aswallowMiddlewares"];
        }
        const userMiddlewares = Editor.PreviewServer["userMiddlewares"] as any[];
        let notAswallowMiddlewares = [];
        for (let key in userMiddlewares) {
            if (!aswallowMiddlewares.includes(userMiddlewares[key])) {
                notAswallowMiddlewares.push(userMiddlewares[key]);
            }
        }
        aswallowMiddlewares.length = 0;
        const pathtoRegexp = require("path-to-regexp");

        const bundleConfigLoadRegexp: RegExp = pathtoRegexp("/*/config.json");
        const bundleIndexLoadRegexp: RegExp = pathtoRegexp("/*/index.js");

        const builtinBundleNames: string[] = CC_INTERNAL_BUNDLE_NAMES;
        const fg: typeof FastGlob = require("fast-glob");
        let subProjBundlePathMap = {};
        const { buildConfig } = getConfigs();
        const bundleLoadMiddwareFunc = async function (req, res, next) {
            const reqPath = req.path as string;
            if (reqPath.includes(PREVIEW_GET_MAIN_PROJ_BUNDLENAMES)) {
                
                buildConfig.outputPreviewServerLog && Editor.log(`${pluginLogTitle} 加载主项目bundle名数组资源`)
                const mainProjBundles = (await getCurProjectBundleInfos());
                const mainProjBundleNames = mainProjBundles.map((info) => info.name);
                res.send(mainProjBundleNames)
                return;
            }
            if (reqPath.includes(PREVIEW_BUNDLE_LOAD_PROTOCOL)) {
                
                let isIndexMatch = bundleIndexLoadRegexp.test(reqPath);
                let isConfigMatch = bundleConfigLoadRegexp.test(reqPath);


                const isMatch = isIndexMatch || isConfigMatch;
                if (isMatch) {
                    //bundle config 和 index加载
                    //其他项目bundle查询
                    const mainProjBundles = (await getCurProjectBundleInfos());
                    const mainProjBundleNames = mainProjBundles.map((info) => info.name);
                    const reqBundleName = path.basename(path.dirname(reqPath));
                    buildConfig.outputPreviewServerLog && Editor.log(`${pluginLogTitle} 加载bundle请求:${reqBundleName},path:${reqPath}`);

                    const subProjPaths = buildConfig.subProjConfig ? Object.keys(buildConfig.subProjConfig) : [];
                    if (subProjPaths.length > 0) {
                        buildConfig.outputPreviewServerLog && Editor.log(`${pluginLogTitle} 查询外部项目bundle`, subProjPaths)
                        let subProjPath: string;
                        for (let i = 0; i < subProjPaths.length; i++) {
                            subProjPath = subProjPaths[i];
                            subProjPath = resolveToProjectPath(subProjPath);
                            buildConfig.outputPreviewServerLog && Editor.log(`${pluginLogTitle} 获取子bundle路径`, subProjPath)
                            const subProjBundlePath = getSubProjBundlePath(reqBundleName, subProjPath, mainProjBundleNames);
                            if (subProjBundlePath) {
                                const pattern = isIndexMatch ? ["./**/index.*"] : ["./**/config.*"];
                                subProjBundlePathMap[reqBundleName] = subProjBundlePath;
                                buildConfig.outputPreviewServerLog && Editor.log(`${pluginLogTitle} 开始匹配文件`, subProjPath)
                                const filePaths = await fg(pattern, { cwd: subProjBundlePath, onlyFiles: true, caseSensitiveMatch: true });
                                buildConfig.outputPreviewServerLog && Editor.log(`${pluginLogTitle} 匹配文件完成`, subProjPath)
                                buildConfig.outputPreviewServerLog && Editor.log(`${pluginLogTitle} 返回文件:${path.join(subProjBundlePath, filePaths[0])}`)
                                res.sendFile(path.join(subProjBundlePath, filePaths[0]));
                                return;
                            }
                        }
                    }
                    buildConfig.outputPreviewServerLog && Editor.log(`${pluginLogTitle} 没找到跳过`);
                    next();
                } else {
                    //bundle资源重定向
                    let bundleResStrs = reqPath.split(PREVIEW_BUNDLE_LOAD_PROTOCOL)[1].split("/");
                    let bundleName = bundleResStrs[1];
                    let bundleResPath = reqPath.replace(`/${PREVIEW_BUNDLE_LOAD_PROTOCOL}/` + bundleName, "");
                    const subProjBundlePath = subProjBundlePathMap[bundleName];
                    buildConfig.outputPreviewServerLog && Editor.log(`${pluginLogTitle} 匹配资源:${bundleName},${bundleResPath},${subProjBundlePath}`);
                    if (subProjBundlePath) {
                        let resPath = path.join(subProjBundlePath, bundleResPath);
                        if (fse.existsSync(resPath)) {
                            buildConfig.outputPreviewServerLog && Editor.log(`${pluginLogTitle} 返回文件:${resPath}`)
                            res.sendFile(resPath);
                            return;
                        }
                    }
                }

                // //内置bundle加载
                // if (!builtinBundleNames.includes(reqBundleName)) {
                //     const mainProjBundles = (await getCurProjectBundleInfos());
                //     const mainProjBundleNames = mainProjBundles.map((info) => info.name);
                //     //主项目bundle查询
                //     Editor.log(`主项目的bundle`, mainProjBundleNames);
                //     if (!mainProjBundleNames.includes(reqBundleName)) {

                //         //其他项目bundle查询

                //         const { assetBundleConfig } = getConfigs();
                //         const subProjPaths = assetBundleConfig.bundleProjBuildInfoMap ? Object.keys(assetBundleConfig.bundleProjBuildInfoMap) : [];
                //         if (subProjPaths.length > 0) {
                //             Editor.log(`${pluginLogTitle} 查询外部项目bundle`, subProjPaths)
                //             for (let i = 0; i < subProjPaths.length; i++) {
                //                 const subProjBundlePath = getSubProjBundlePath(reqBundleName, subProjPaths[i], mainProjBundleNames);
                //                 if (subProjBundlePath) {
                //                     const pattern = isIndexMatch ? ["./**/index.*"] : ["./**/config.*"];
                //                     subProjBundlePathMap[reqBundleName] = subProjBundlePath;
                //                     const filePaths = await fg(pattern, { cwd: subProjBundlePath, onlyFiles: true, caseSensitiveMatch: true });
                //                     Editor.log(`${pluginLogTitle} 返回文件:${path.join(subProjBundlePath, filePaths[0])}`)
                //                     res.sendFile(path.join(subProjBundlePath, filePaths[0]));
                //                     return;
                //                 }
                //             }
                //         }
                //     }
                //     // else if (parentBundleNames.includes(reqBundleName)) {
                //     //     // Editor.log(`重写请求url，${req.path}`,req);
                //     //     req.url = req.url.replace(PREVIEW_BUNDLE_LOAD_PROTOCOL, "assets");
                //     //     if (req.url.includes("config.json")) {
                //     //         gulpBuild.buildConfig({
                //     //             name: reqBundleName,
                //     //             importBase: "web-desktop" !== n ? "" : "import",
                //     //             nativeBase: "web-desktop" !== n ? "" : "native",
                //     //             root: bundle.url,
                //     //             sceneList: bundleSceneMap[bundleName] ? bundleSceneMap[bundleName].map(e => e.uuid) : [],
                //     //             debug: !0,
                //     //             preview: !0
                //     //         }, function (err, configJson) {
                //     //             if (err)
                //     //                 return res.status(404).send({
                //     //                     error: err.message
                //     //                 });
                //     //             Editor.log(`构建config并返回`, configJson);
                //     //             res.send(configJson)
                //     //         })
                //     //     }
                //     //     Editor.log(`重写请求url，${req.path}`);
                //     // }
                // }

            }
            
            next();
        };
        aswallowMiddlewares.push(bundleLoadMiddwareFunc)
        
        aswallowMiddlewares.push(express.static(Editor.Project.path));
        Editor.PreviewServer["userMiddlewares"] = notAswallowMiddlewares.concat(aswallowMiddlewares);
        

        // Editor.log(`${pluginLogTitle} 中间件:${Editor.PreviewServer["userMiddlewares"].length}`);

        // Editor.log(`${pluginLogTitle} 重启预览服务器...`)

        // this.startSvrTimeoutId = setTimeout(() => {
        //     Editor.PreviewServer.start((i) => {


        //         Editor.stashedScene
        //             ? i()
        //             : (ipcMain.once("app:preview-server-scene-stashed", i),
        //                 Editor.Ipc.sendToWins("scene:preview-server-scene-stashed"));
        //     }, function () {
        //         Editor.log(`${pluginLogTitle} 预览服务器重启成功`);
        //     });
        // }, 500)
    }
    public static stop() {
        const userMiddlewares = Editor.PreviewServer["userMiddlewares"] as any[];
        let notAswallowMiddlewares = [];
        let aswallowMiddlewares: any[]

        if (!Editor.PreviewServer["aswallowMiddlewares"]) {
            Editor.PreviewServer["aswallowMiddlewares"] = aswallowMiddlewares = [];
        } else {
            aswallowMiddlewares = Editor.PreviewServer["aswallowMiddlewares"];
        }
        for (let key in userMiddlewares) {
            if (!aswallowMiddlewares.includes(userMiddlewares[key])) {
                notAswallowMiddlewares.push(userMiddlewares[key]);
            }
        }
        Editor.PreviewServer["userMiddlewares"] = notAswallowMiddlewares;
    }
    public static reset(){
        this.stop();
        this.start();
    }
}