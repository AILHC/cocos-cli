@echo off
setlocal

cd /d "%~dp0"
if errorlevel 1 (
    echo [cocos-cli] Failed to enter script directory.
    pause
    exit /b 1
)

where node >nul 2>nul
if errorlevel 1 (
    echo [cocos-cli] Node.js was not found. Install Node.js and try again.
    pause
    exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
    echo [cocos-cli] npm was not found. Check your Node.js installation and try again.
    pause
    exit /b 1
)

echo [cocos-cli] Installing runtime dependencies in:
echo Current directory: "%CD%"
call npm install
if errorlevel 1 (
    echo [cocos-cli] npm install failed.
    pause
    exit /b 1
)

echo [cocos-cli] Linking global cocos command to this directory.
call npm link
if errorlevel 1 (
    echo [cocos-cli] npm link failed.
    pause
    exit /b 1
)

echo [cocos-cli] Install complete. Run "cocos --help" to verify the global command.
pause
exit /b 0
