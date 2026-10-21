@echo off
cd /d "%~dp0.."
node tools\serve-migration.mjs
pause
