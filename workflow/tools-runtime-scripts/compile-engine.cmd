@echo off
setlocal

cd /d "%~dp0"
if errorlevel 1 (
    echo [cocos-engine] Failed to enter script directory.
    pause
    exit /b 1
)

where node >nul 2>nul
if errorlevel 1 (
    echo [cocos-engine] Node.js was not found. Install Node.js and try again.
    pause
    exit /b 1
)

node -e "const fs=require('fs');const p='package.json';if(!fs.existsSync(p)){console.error('[cocos-engine] package.json was not found. Put this script in a Cocos project root.');process.exit(2);}let pkg;try{pkg=JSON.parse(fs.readFileSync(p,'utf8'));}catch(e){console.error('[cocos-engine] Failed to parse package.json: '+e.message);process.exit(3);}if(!pkg.creator||typeof pkg.creator.version!=='string'||!pkg.creator.version){console.error('[cocos-engine] package.json does not contain creator.version. Put this script in a Cocos project root.');process.exit(4);}"
set VALIDATION_EXIT_CODE=%ERRORLEVEL%
if not "%VALIDATION_EXIT_CODE%"=="0" (
    pause
    exit /b %VALIDATION_EXIT_CODE%
)

where cocos >nul 2>nul
if errorlevel 1 (
    echo [cocos-engine] Global "cocos" command was not found.
    echo [cocos-engine] Run install-cocos-cli.cmd from the published tools/cocos-cli directory first.
    pause
    exit /b 1
)

echo [cocos-engine] Rebuilding engine cache for:
echo Current directory: "%CD%"
set "COCOS_CLI_COMPILE_PROJECT=%CD%"
cmd /d /s /c "cocos compile-engine --project "%%COCOS_CLI_COMPILE_PROJECT%%""
set COMPILE_EXIT_CODE=%ERRORLEVEL%
if not "%COMPILE_EXIT_CODE%"=="0" (
    echo [cocos-engine] Engine compilation exited with code %COMPILE_EXIT_CODE%.
    pause
    exit /b %COMPILE_EXIT_CODE%
)

echo [cocos-engine] Engine cache rebuild completed.
pause
exit /b 0
