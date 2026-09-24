@echo off
setlocal
set "ELECTRON_RUN_AS_NODE="
pushd "%~dp0"
if exist "dist\CharacterDesktop-win32-x64\CharacterDesktop.exe" (
  start "" "dist\CharacterDesktop-win32-x64\CharacterDesktop.exe" %*
  popd
  exit /b
)
if not exist "node_modules\electron\dist\electron.exe" (
  where npm >nul 2>nul
  if errorlevel 1 (
    echo Install Node.js LTS first, or use the packaged CharacterDesktop.exe.
    pause
    popd
    exit /b 1
  )
  call npm ci --no-audit --no-fund
  if errorlevel 1 (
    pause
    popd
    exit /b 1
  )
  if not exist "node_modules\electron\dist\electron.exe" (
    node "node_modules\electron\install.js"
    if errorlevel 1 (
      pause
      popd
      exit /b 1
    )
  )
)
start "" "node_modules\electron\dist\electron.exe" . %*
popd
