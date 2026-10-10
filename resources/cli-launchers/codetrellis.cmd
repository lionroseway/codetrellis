@echo off
rem codetrellis: the CLI the CodeTrellis app carries, run on the app's own
rem binary in Node mode. The app adds this folder to the PATH; see
rem src/backend/services/cli-install.ts.
setlocal
set ELECTRON_RUN_AS_NODE=1
"%~dp0..\..\..\CodeTrellis.exe" "%~dp0app.cjs" %*
exit /b %ERRORLEVEL%
