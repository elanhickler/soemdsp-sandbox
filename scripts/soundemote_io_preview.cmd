@echo off
rem Build the sandbox, copy it into soundemote-io, and run it at http://localhost:8080 (no git, nothing goes live).
rem Options: see the header of soundemote_io.ps1 (e.g. -SkipNativeBuild -SkipSmoke).
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0soundemote_io.ps1" -Mode preview %*
set "exitCode=%ERRORLEVEL%"
echo.
if not "%exitCode%"=="0" echo FAILED with exit code %exitCode%.
pause
exit /b %exitCode%
