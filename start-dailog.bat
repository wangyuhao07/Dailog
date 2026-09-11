@echo off
setlocal
pushd "%~dp0."
chcp 65001 >nul

set "NODE_EXE="
for /f "delims=" %%I in ('where node 2^>nul') do if not defined NODE_EXE set "NODE_EXE=%%I"
if not defined NODE_EXE if exist "%ProgramFiles%\nodejs\node.exe" set "NODE_EXE=%ProgramFiles%\nodejs\node.exe"
if not defined NODE_EXE if exist "%LocalAppData%\Programs\nodejs\node.exe" set "NODE_EXE=%LocalAppData%\Programs\nodejs\node.exe"

if defined NODE_EXE (
  "%NODE_EXE%" scripts\start-dev.mjs
  set "EXIT_CODE=%ERRORLEVEL%"
) else (
  echo 找不到 Node.js，请先安装 Node.js 22 或更高版本，并确保 node 已加入 PATH。
  set "EXIT_CODE=1"
)

if not "%EXIT_CODE%"=="0" (
  echo.
  echo Dailog 启动失败，错误码：%EXIT_CODE%
  pause
)

popd
endlocal
