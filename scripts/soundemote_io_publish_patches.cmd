@echo off
rem Commit sandbox patches, copy them into soundemote-io, commit + push. GOES LIVE. Fast; no WASM build.
rem Options: see the header of soundemote_io.ps1 (e.g. -SkipNativeBuild -SkipSmoke).
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0soundemote_io.ps1" -Mode patches %*
set "exitCode=%ERRORLEVEL%"
echo.
if not "%exitCode%"=="0" echo FAILED with exit code %exitCode%.
pause
exit /b %exitCode%
