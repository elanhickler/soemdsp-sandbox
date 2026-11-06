@echo off
rem Runs soundemote-io, soundemote-dev and soundemote-com dev servers as-is (no copy, no build, no smoke test).
for %%I in ("%~dp0..\..") do set "ROOT=%%~fI\"
start "soundemote-io :8080" /D "%ROOT%soundemote-io" cmd /k npx vite --port 8080 --strictPort
start "soundemote-dev :8081" /D "%ROOT%soundemote-dev" cmd /k npx vite dev --port 8081 --strictPort
start "soundemote-com :8082" /D "%ROOT%soundemote-com" cmd /k npx vite dev --port 8082 --strictPort
echo Waiting for servers to start...
timeout /t 8 /nobreak >nul
start "" http://localhost:8080
start "" http://localhost:8081
start "" http://localhost:8082
