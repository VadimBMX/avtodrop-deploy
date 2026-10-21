@echo off
cd /d "%~dp0.."
node tools\railway-db-pull.mjs
echo.
pause
