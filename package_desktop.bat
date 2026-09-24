@echo off
setlocal
pushd "%~dp0"
call npm run package
if errorlevel 1 (
  echo Packaging failed.
) else (
  echo Ready: dist\CharacterDesktop-win32-x64\CharacterDesktop.exe
)
pause
popd
