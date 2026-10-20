@echo off
rem Запуск гри для гравців у Telegram: тунель Cloudflare + бот. Закрий це вікно, щоб зупинити гру.
chcp 65001 >nul
cd /d "%~dp0"
node tools\live.mjs
pause
