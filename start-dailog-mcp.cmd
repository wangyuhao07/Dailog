@echo off
setlocal
pushd "%~dp0."
>>"%TEMP%\dailog-mcp-start.log" echo [%DATE% %TIME%] start-dailog-mcp from "%~dp0."
set "ELECTRON_RUN_AS_NODE=1"
"%~dp0node_modules\electron\dist\electron.exe" "%~dp0electron\mcpNodeServer.js"
set "EXIT_CODE=%ERRORLEVEL%"
>>"%TEMP%\dailog-mcp-start.log" echo [%DATE% %TIME%] exit code %EXIT_CODE%
popd
endlocal & exit /b %EXIT_CODE%
