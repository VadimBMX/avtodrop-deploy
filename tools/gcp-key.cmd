@echo off
rem avtodrop deploy helper
cd /d "%~dp0.."
mkdir migration 2>nul
if not exist "%USERPROFILE%\.ssh" mkdir "%USERPROFILE%\.ssh"
if not exist "%USERPROFILE%\.ssh\gcp_avtodrop" ssh-keygen -t ed25519 -N "" -C avtodrop-deploy -f "%USERPROFILE%\.ssh\gcp_avtodrop"
copy /y "%USERPROFILE%\.ssh\gcp_avtodrop.pub" migration\gcp_pubkey.txt >nul
echo OK: migration\gcp_pubkey.txt
