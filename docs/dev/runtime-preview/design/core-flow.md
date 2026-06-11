# Runtime Preview 鏍稿績娴佺▼璁捐鑽夋

璁板綍鏃堕棿锛?026-06-10

鏈枃鍙畾涔夋湰杞€滆鏍稿績棰勮娴佺▼璺戦€氣€濈殑璁捐銆佽竟鐣屻€佹祴璇曞拰楠屾敹鏍囧噯銆傛湰鏂囦笉澶勭悊 `assets/**/*.meta` 鍐欏叆鍓綔鐢紱璇ラ棶棰樹繚鐣欏湪宸叉湁鍙嶉鏂囨。涓紝鍚庣画鍗曠嫭澶勭悊銆?
## 鐩爣

璁╃湡瀹?production preview entry 璺戦€氾細

```bat
node E:\own_space\engines\cocos-cli\dist\cli.js preview --runtime --project D:\ps_copy\p6\trunk\Project\GameClient\feature-c --host 127.0.0.1 --port 19530
```

娴忚鍣ㄦ墦寮€锛?
```text
http://127.0.0.1:19530/?scene=4c721bfe-0b6e-46c2-97f0-644adfdcba31
```

蹇呴』瀹屾垚锛?
1. server 鍚姩骞惰緭鍑?`server:listening`銆?2. CLI 榛樿 preview settings warm-up 瀹屾垚骞惰緭鍑?`preview:ready`銆?3. browser production root page 鍚姩 preview-app銆?4. current Cocos preview bootstrap 鎸夌幇鏈?import-map / loader 娴佺▼鍔犺浇鑴氭湰锛涙湰杞笉鏂板 scene script dependency preloading銆?5. scene 鍔犺浇瀹屾垚骞舵墽琛?`runSceneImmediate()`銆?6. 椤甸潰璁剧疆 `window.__RUNTIME_PREVIEW_READY`銆?7. ready 鍚庣ǔ瀹氳瀵熺獥鍙ｅ唴娌℃湁鍚屾簮璧勬簮璇锋眰澶辫触銆乸age error銆乽nhandled rejection 鎴?`console.error`銆?
## 闈炵洰鏍?
- 鏈疆涓嶅鐞?`assets/**/*.meta` 鏄惁琚?AssetDB/importer 鏀瑰啓銆?- 鏈疆涓嶄慨鏀?`preview-app` 鐨?`assets/general/import`銆乣assets/general/native` bootstrap 琛屼负銆?- 鏈疆涓嶉€氳繃纭紪鐮?feature-c UUID銆乻cene UUID 鎴栧叿浣撴姤閿?URL 淇闂銆?- 鏈疆涓嶅仛鍚姩鏃堕€掑綊鎵弿 `library`銆乣temp`銆乣assets` 鎴?generated output銆?- 鏈疆涓嶆妸鏃?editor preview server 鐨?route 瀹炵幇澶嶅埗涓烘潈濞侀€昏緫銆?
## 宸茬‘璁や簨瀹?
### preview-app general base 鏄簮鐮佷簨瀹?
褰撳墠 preview-app 鍦ㄦ祻瑙堝櫒鍚姩鏃惰缃細

```ts
option.overrideSettings.assets.importBase = 'assets/general/import';
option.overrideSettings.assets.nativeBase = 'assets/general/native';
```

澶囦唤鐨?preview-app source 涓篃瀛樺湪鍚屾牱閫昏緫銆傚洜姝ゆ湰杞繀椤绘寜璇ヨ涓鸿璁?server route銆備笉鑳藉垹闄よ繖娈碉紝涔熶笉鑳芥敼涓虹洿鎺ヤ娇鐢?`settings.assets.importBase/nativeBase`銆?
### URL namespace 涓嶇瓑浜?library 鐗╃悊鐩綍

`docs/dev/runtime-preview/facts/architecture.md` 宸茶褰曪細褰撳墠 CLI project library root 鏄?`<project>/library/cli`锛岃祫婧愭枃浠舵槸 uuid/hash bucket layout锛沞ngine runtime 鐢熸垚鐨?`/assets/<namespace>/(import|native)/<tail>` 涓紝`<namespace>` 鏄?HTTP URL namespace / bundle config 璇箟锛屼笉鏄?`library/cli` 涓嬬殑鐩綍銆?
鍥犳鏈璁″彧鎶?`<tail>` 浣滀负 library 鐩稿璺緞銆俙import` / `native` 鏄?engine 宸茬敓鎴愮殑 HTTP route segment锛屼笉鏄?physical directory锛屼篃涓嶅弬涓庢嫾鎺?disk path锛?
```text
/assets/general/import/20/<uuid>@<version>.json
=> resolve(context.projectLibraryRoot, '20/<uuid>@<version>.json')
```

涓嶅厑璁告槧灏勪负锛?
```text
resolve(context.projectLibraryRoot, 'general/import/20/<uuid>@<version>.json')
resolve(context.projectLibraryRoot, 'product/import/20/<uuid>@<version>.json')
resolve(context.projectLibraryRoot, 'resources/import/20/<uuid>@<version>.json')
```

### resolver 涓嶆嫢鏈?project library 榛樿璺緞瑙勫垯

`LibraryRequestResolver` 鍙鐞嗗凡缁忎紶鍏?`RuntimePreviewContext` 鐨?root銆傚畠涓嶅厑璁歌嚜琛岃拷鍔狅細

```text
<projectRoot>/library/cli
<projectRoot>/library
```

濡傛灉 production 闇€瑕佷娇鐢?`D:\ps_copy\p6\trunk\Project\GameClient\feature-c\library\cli`锛屽垯鍚姩閾捐矾蹇呴』鍦ㄥ垱寤?`RuntimePreviewContext` 鍓嶈В鏋愬ソ锛屽苟浣滀负 `context.projectLibraryRoot` 浼犲叆銆?
extension library 鍚岀悊銆傚惎鍔ㄩ摼璺繀椤绘牴鎹?AssetDB mount 瑙ｆ瀽鍑?extension output root锛屽苟鏄惧紡浼犲叆 context锛屼緥濡傦細

```ts
extensionLibraryRoots: Array<{ name: string; root: string }>
```

`LibraryRequestResolver` 涓嶈兘鑷鎷兼帴 `<projectRoot>/library/cli-extensions/<name>`銆?
### ready 蹇呴』鎷嗗垎

| 鍚嶇О | 瑙﹀彂浣嶇疆 | 璇佹槑鍐呭 | 涓嶈瘉鏄?|
| --- | --- | --- | --- |
| `server:listening` | HTTP server listen 鎴愬姛 | socket 宸茬洃鍚?| settings銆丄ssetDB銆乻cript銆乻cene 鍙敤 |
| `preview:ready` | CLI 榛樿 settings warm-up 瀹屾垚 | 榛樿 preview settings 宸茬敓鎴?| 娴忚鍣?scene 宸插姞杞?|
| `browser scene ready` | preview-app 璁剧疆 `window.__RUNTIME_PREVIEW_READY` | scene load callback 宸叉墽琛岋紝`runSceneImmediate()` 宸插洖璋?| ready 鍚庝笉浼氬啀鍑虹幇寮傛 runtime error |

绋冲畾瑙傚療绐楀彛浠?`browser scene ready` 鍚庡紑濮嬭鏃躲€?
## Route 璁捐

### import/native library file route

閫傜敤鑼冨洿锛?
```text
/assets/<namespace>/import/<tail>
/assets/<namespace>/native/<tail>
```

鍏朵腑 `<namespace>` 鍖呮嫭 `general`銆乣resources`銆乣product`銆乪xtension bundle name 鎴栧叾浠?engine runtime 瀹為檯鐢熸垚鐨?bundle namespace銆?
`/assets/general/import/*` 涓?`/assets/general/native/*` 鏄?preview-app general asset base锛屼笉鏄?`resources` bundle 鐨勫埆鍚嶏紝涔熶笉鏄?`product` bundle 鐨勫埆鍚嶃€傞潪 `general` namespace 涔熷繀椤绘寜鍚屼竴 library file route 瑙勫垯澶勭悊锛屼笉鑳藉綊绫讳负鈥滄湰杞笉澶勭悊鈥濄€?
#### 杈撳叆

璇锋眰蹇呴』鍖归厤锛?
```text
/assets/<namespace>/import/<tail>
/assets/<namespace>/native/<tail>
```

绀轰緥锛?
```text
/assets/general/import/20/207a3957-d7e1-4fdb-8903-c63948195ada@f9941.json
/assets/general/native/8c/8c1ebdc5-5bb8-48b2-a60f-e16fd6b0a624.manifest
```

#### 浜屽厓鍒ゆ柇瑙勫垯

1. route 涓嶅尮閰?`/assets/<namespace>/(import|native)/*`锛氫笉鐢?library file route 澶勭悊銆?2. route 鍙湁 `/assets/<namespace>/import`銆乣/assets/<namespace>/import/`銆乣/assets/<namespace>/native` 鎴?`/assets/<namespace>/native/`锛氫笉杩涘叆 library file lookup銆傝 URL 涓嶅搴斿叿浣?library 鏂囦欢锛涘鏋?engine runtime 瀹為檯璇锋眰杩欑 base URL锛岃褰?unsupported route evidence 骞跺崌绾у垎鏋愶紝涓嶈兘鎶?library root 鐩綍浣滀负鍝嶅簲銆?3. 鍙粠 WHATWG `URL.pathname` 鎴彇 raw tail锛泀uery/hash 涓嶅弬涓?tail銆?4. 瀵?raw tail 鎵ц涓€娆?`decodeURIComponent`锛沝ecode 澶辫触鍒欐嫆缁濄€?5. decoded tail 鍖呭惈 `\`銆丯UL銆佺┖ path segment銆乣.`銆乣..`銆乄indows drive letter銆乁NC prefix 鎴?absolute path锛氭嫆缁濄€?6. 鍊欓€?root 鍙厑璁?context 鏄惧紡浼犲叆鐨?root锛?   - `context.projectLibraryRoot`
   - `context.extensionLibraryRoots[].root`
   - `context.internalLibraryRoot`
7. 瀵规瘡涓潪绌?root 璁＄畻锛?
```text
rootAbs = resolve(root)
candidate = resolve(rootAbs, tail)
relative = path.relative(rootAbs, candidate)
```

8. 濡傛灉 `relative === ''`銆乣relative.startsWith('..')` 鎴?`path.isAbsolute(relative)`锛氭嫆缁濊 candidate銆?9. 瀵?`candidate` 鎵ц涓€娆?`stat()`銆?10. 濡傛灉 `candidate` 鏄幇鏈夋枃浠讹細杩斿洖璇ユ枃浠躲€?11. 濡傛灉鎵€鏈?candidate 閮戒笉鏄幇鏈夋枃浠讹細杩斿洖 404銆?
#### 绂佹琛屼负

- 绂佹鏍规嵁 UUID 鐚?bundle銆?- 绂佹鎶?`resources` 鏀瑰啓鎴?`product`銆?- 绂佹鎶?`<namespace>` 鎷艰繘 physical library path銆?- 绂佹淇敼鎵╁睍鍚嶃€?- 绂佹鏋氫妇 root 涓嬬殑鏂囦欢銆?- 绂佹閫掑綊鎵弿 root銆?- 绂佹鎸夌浉浼兼枃浠跺悕 fallback銆?- 绂佹鍥犱负 `.assets-data.json` 鎴?bundle config 娌℃湁 proof 灏辨嫆缁濊矾寰勫畨鍏ㄤ笖鐪熷疄瀛樺湪鐨?library file route 鏂囦欢銆?- 绂佹鍦?resolver 鍐呰拷鍔?`<projectRoot>/library/cli` 鎴?`<projectRoot>/library`銆?- 绂佹鍦?resolver 鍐呰拷鍔?`<projectRoot>/library/cli-extensions/<name>`銆?
#### diagnostics

`.assets-data.json`銆乣.internal-data.json`銆乪xtension metadata 鍜?`bundleConfigs` 鍙敤浜庢棩蹇楀拰璇佹嵁瑙ｉ噴锛屼笉浣滀负 library file route 杩斿洖鏂囦欢鐨勫繀瑕佹潯浠躲€?
杩欓噷涓嶆槸鈥滄牴鎹?URL 鎵弿 root鈥濄€俇RL 宸茬敱 engine runtime 鐢熸垚锛宻erver 鍙妸 URL 涓殑 `<tail>` 浣滀负宸茬粡纭畾鐨?library 鐩稿璺緞锛屽湪宸茶В鏋愬ソ鐨?root 涓婂仛涓€娆?direct file lookup銆?
鏃ュ織瀛楁搴旇嚦灏戝寘鍚細

```text
requestPath
artifactKind=import|native
tail
projectLibraryRoot
extensionLibraryRoots
internalLibraryRoot
resolvedRoot
resolvedFile
metadataUrl
metadataBundleGuess
decision=served|rejected|not-found
reason
```

`metadataBundleGuess` 鍙兘琛ㄧず璇婃柇鎺ㄦ柇锛屼緥濡?`db://assets/product/...` 鎺ㄦ柇鍑?source 浣嶄簬 `product` 鐩綍锛涗笉鑳介┍鍔?route 鏀瑰啓銆?
### 闈?general bundle route

闈?`general` bundle route 鏈疆蹇呴』澶勭悊锛岃鍒欏涓嬶細

- `/assets/<bundle>/config.json`銆乣/assets/<bundle>/config.<version>.json`锛氱敱 bundle config provider 杩斿洖銆?- `/assets/<bundle>/index.js`銆乣/assets/<bundle>/index.<version>.js`锛氱敱 bundle index / script provider 杩斿洖銆?- `/assets/<bundle>/import/<tail>`锛氭寜 import/native library file route direct lookup銆?- `/assets/<bundle>/native/<tail>`锛氭寜 import/native library file route direct lookup銆?
`<bundle>` 鍙綔涓?HTTP namespace銆佹棩蹇楀瓧娈靛拰 bundle config 鍏宠仈瀛楁锛屼笉鎷艰繘 physical library path銆?
pack / redirect / nativeDep 涓嶇敱 server 鎵嬪啓杩戜技 URL銆傚彧瑕?engine runtime 鏍规嵁 bundle config 鎴?asset metadata 鍙戝嚭浜?`/assets/<namespace>/(import|native)/<tail>`锛宻erver 灏辨寜缁熶竴 library file route 鏈嶅姟銆傚鏋?feature-c E2E 瑙﹀彂 pack / redirect / nativeDep URL 涓斿け璐ワ紝璇ュけ璐ユ槸鏈疆 blocker銆?
## Script loading

鏈疆涓嶅疄鐜?prerequisite script dependency preloading銆?
鍏蜂綋瑁佸喅锛?
1. 涓嶄富鍔ㄨ绠?scene 渚濊禆鍝簺 scripts銆?2. 涓嶅湪 preview server 鎴?preview-app 涓噸寤?Cocos script dependency graph銆?3. 涓嶆妸 `dependScripts` dynamic import 浣滀负 `cc.game.init()` 鎴?scene load 鐨勫墠缃畻娉曘€?4. 鑴氭湰鍔犺浇浜ょ粰 current Cocos preview bootstrap銆乮mport-map銆丼ystemJS / module loader 娴佺▼銆?5. `dependScripts`銆乣script2library`銆乣main-record`銆乣assembly-record` 鍜?`import-map` 鍙綔涓哄け璐ヨ瘖鏂瘉鎹紝涓嶄綔涓烘湰杞柊澧炲姞杞界畻娉曘€?
楠屾敹涓嶉€氳繃鈥滆剼鏈鍔犺浇鎴愬姛鈥濊瘉鏄庢纭€э紝鑰岄€氳繃 browser runtime 鐨勫疄闄呯粨鏋滆瘉鏄庯細scene ready銆乶etwork error銆乸age error銆乽nhandled rejection 鍜?`console.error`銆?
## Browser ready 璇箟

`window.__RUNTIME_PREVIEW_READY` 鍙兘鍦ㄤ互涓嬫潯浠跺叏閮ㄦ弧瓒冲悗璁剧疆锛?
1. `/settings.js` 宸插姞杞藉苟琚?preview-app 娑堣垂銆?2. engine 鍜?SystemJS required routes 宸插姞杞姐€?3. current Cocos preview bootstrap 宸茶繘鍏?scene load 闃舵銆?4. 濡傛灉 URL 鎴?settings 鎸囧畾 scene锛宻cene load 鎴愬姛銆?5. `cc.director.runSceneImmediate()` 鐨?callback 宸叉墽琛屻€?
ready payload 鑷冲皯鍖呭惈锛?
```ts
{
  scene: string;
  timestamp: number;
}
```

濡傛灉褰撳墠瀹炵幇淇濈暀 `resources` marker 瀛楁锛屼篃鍙互缁х画甯︿笂锛屼絾涓嶈兘鐢?resource marker 鏇夸唬 scene ready銆?
## 娴嬭瘯绛栫暐

### 1. Resolver contract

鏂板鎴栦慨鏀?Vitest锛岃鐩栦互涓嬩簩鍏冪敤渚嬶細

| Case | 杈撳叆 | 棰勬湡 |
| --- | --- | --- |
| general import existing file | `/assets/general/import/20/<uuid>@f9941.json` | 200 |
| general native manifest existing file | `/assets/general/native/8c/<uuid>.manifest` | 200 |
| general native bin existing file | `/assets/general/native/98/<uuid>.bin` | 200 |
| non-general import existing file | `/assets/product/import/20/<uuid>@f9941.json` | 200 |
| extension root existing file | `/assets/<extension-bundle>/import/aa/<uuid>.json` and file only exists in `context.extensionLibraryRoots[]` | 200 |
| import base without tail | `/assets/general/import/` | 涓嶈繘鍏?library file lookup锛涗笉寰楄繑鍥?root 鐩綍 |
| traversal | `/assets/general/import/../secret.json` | 400 鎴?404锛屼絾涓嶅緱璇绘枃浠?|
| encoded traversal | `/assets/general/import/%2e%2e/secret.json` | 400 鎴?404锛屼絾涓嶅緱璇绘枃浠?|
| missing file | 瀹夊叏 tail 浣嗘枃浠朵笉瀛樺湪 | 404 |
| root not passed | `context.projectLibraryRoot` 涓虹┖涓?internal 鏈懡涓?| 404 |

娴嬭瘯鏋勯€?`RuntimePreviewContext` 鏃跺繀椤绘樉寮忎紶鍏?`projectLibraryRoot` / `extensionLibraryRoots` / `internalLibraryRoot`锛屼笉鑳戒緷璧?resolver 鑷鎺ㄥ `<projectRoot>/library/cli` 鎴?`<projectRoot>/library/cli-extensions/<name>`銆?
### 2. Existing runtime-preview suite

蹇呴』閫氳繃锛?
```bat
npm run build
npm --prefix vitests test -- suites/runtime-preview
```

璇ユ祴璇曠敤浜庤瘉鏄庡皬椤圭洰鍜屽凡鏈?HTTP / browser contract 娌℃湁鍥為€€銆?
### 3. feature-c exact scene E2E

鍚姩锛?
```bat
node E:\own_space\engines\cocos-cli\dist\cli.js preview --runtime --project D:\ps_copy\p6\trunk\Project\GameClient\feature-c --host 127.0.0.1 --port 19530
```

鐩戝惉锛?
```bat
set COCOS_CLI_LISTEN_PREVIEW_URL=http://127.0.0.1:19530/?scene=4c721bfe-0b6e-46c2-97f0-644adfdcba31
set COCOS_CLI_LISTEN_READY_TIMEOUT_MS=600000
set COCOS_CLI_LISTEN_STABLE_WINDOW_MS=300000
set COCOS_CLI_LISTEN_EVIDENCE=D:\ps_copy\p6\trunk\Project\GameClient\feature-c\temp\runtime-preview-exact-scene-4c721bfe-browser-evidence.json
npm --prefix E:\own_space\engines\cocos-cli\vitests run listen:preview-url
```

濡傛灉闇€瑕侀噸鏂板惎鍔ㄥ苟鑷姩璇婃柇锛?
```bat
set COCOS_CLI_FEATURE_C_ENGINE_ROOT=D:/workspace/engines/cocos/3.8.6
set COCOS_CLI_FEATURE_C_PROJECT_ROOT=D:/ps_copy/p6/trunk/Project/GameClient/feature-c
set COCOS_CLI_FEATURE_C_SCENE=4c721bfe-0b6e-46c2-97f0-644adfdcba31
set COCOS_CLI_FEATURE_C_STARTUP_TIMEOUT_MS=600000
set COCOS_CLI_FEATURE_C_READY_TIMEOUT_MS=600000
set COCOS_CLI_FEATURE_C_STABLE_WINDOW_MS=300000
npm --prefix E:\own_space\engines\cocos-cli\vitests run diagnose:feature-c
```

## 楠屾敹鏍囧噯

### 蹇呴』閫氳繃

1. `npm run build` 閫氳繃銆?2. `npm --prefix vitests test -- suites/runtime-preview` 閫氳繃銆?3. feature-c exact scene 鍑虹幇 `window.__RUNTIME_PREVIEW_READY`銆?4. ready payload 涓?`scene` 绛変簬鐩爣 scene uuid銆?5. ready 鍓嶆病鏈?`pageerror`銆乣unhandledrejection` 鎴栧悓婧愯祫婧?404/500銆?6. ready 鍚?300s 鍐咃細
   - 鍚屾簮 `failedRequests.length === 0`
   - 鍚屾簮 `badResponses.length === 0`
   - `pageErrors.length === 0`
   - `unhandledRejections.length === 0`
7. ready 鍚?300s 鍐呮病鏈?`console.error`銆?8. server log 涓病鏈夛細
   - `settings:generation:error`
   - `route:error`
   - `UnhandledPromiseRejection`
   - `RuntimePreviewRequestBodyTooLarge`
9. 涔嬪墠宸茬煡鐨?native 璇锋眰涓嶅啀 404锛?   - `/assets/general/native/8c/8c1ebdc5-5bb8-48b2-a60f-e16fd6b0a624.manifest`
   - `/assets/general/native/98/9804400a-5e5d-4dc7-a564-33ef97537007.bin`

### 鍙互鏆備笉闃绘柇锛屼絾蹇呴』璁板綍

浠ヤ笅鎯呭喌濡傛灉鍑虹幇锛屼笉鐩存帴鍒ゆ湰杞け璐ワ紝浣嗗繀椤诲湪 evidence 鍜屾枃妗ｄ腑璁板綍鍘熷洜锛?
- 闈炲悓婧愮涓夋柟璇锋眰澶辫触銆?- `console.warn`銆?
鏈疆榛樿涓嶆斁琛?console / error 璇婃柇銆傝嫢蹇呴』鏀捐鏌愭潯璇婃柇锛屽繀椤诲湪 evidence 涓褰曚负 `acceptedDiagnostics[]`锛屾瘡鏉″寘鍚?`pattern`銆乣reason`銆乣source` 鍜屽悗缁鐞嗚褰曘€傝祫婧?route銆乻cene ready銆佸悓婧?404/500銆乣pageerror`銆乣unhandledrejection` 鍜?`console.error` 涓嶈繘鍏?accepted diagnostics銆?
### 蹇呴』鍒ゅけ璐?
- 娌℃湁 `browser scene ready`銆?- ready 鍓嶆垨 ready 鍚庡嚭鐜?`pageerror`銆乣unhandledrejection` 鎴?`console.error`銆?- ready 鍚庝粛鍑虹幇鍚屾簮璧勬簮 404/500銆?- route 閫氳繃纭紪鐮?UUID 鎴?scene 鐗瑰垽鎵嶉€氳繃銆?- resolver 渚濊禆 `<projectRoot>/library/cli` 鎴?`<projectRoot>/library` 杩欑鍐呴儴鎺ㄥ璺緞銆?- resolver 渚濊禆 `<projectRoot>/library/cli-extensions/<name>` 杩欑鍐呴儴鎺ㄥ璺緞銆?
## 瀹炴柦椤哄簭

1. 鍥哄寲 resolver contract test锛屽厛璁╁綋鍓嶅疄鐜版毚闇插け璐ャ€?2. 淇敼 `resolve-library-request.ts` 鐨?import/native library file route锛岀粺涓€鏀寔 `general` 涓庨潪 `general` namespace锛屽彧浣跨敤 context 鏄惧紡 root銆?3. 澧炲姞 route diagnostics 鏃ュ織銆?4. 鍚姩閾捐矾瑙ｆ瀽骞朵紶鍏?`extensionLibraryRoots`銆?5. 璺?`npm run build` 鍜?runtime-preview suite銆?6. 璺?feature-c exact scene E2E銆?7. 鎶?evidence 鎽樿鍥炲啓鍒?`docs/dev/runtime-preview/acceptance/feedback-20260609.md` 鎴栨柊鐨勯獙鏀惰褰曘€?
## 褰撳墠寰呯‘璁ら」

1. root 鏌ユ壘椤哄簭銆傚綋鍓嶆帹鑽愶細project first銆乪xtension roots second銆乮nternal third銆?2. ready 鍚庣ǔ瀹氳瀵熺獥鍙ｆ槸鍚︾淮鎸?300s銆傚畠涓嶆槸鑴氭湰鍔犺浇璇佹槑锛屽彧鏄?runtime 绋冲畾鎬ц瀵熴€?
