@echo off
rem avtodrop deploy helper
rem avtodrop deploy helper
cd /d "%~dp0.."
set HOST=deploy@136.71.1.110
set OPT=-i "%USERPROFILE%\.ssh\gcp_avtodrop" -o StrictHostKeyChecking=accept-new -o ConnectTimeout=20 -o BatchMode=yes
echo == %date% %time% > migration\run-log.txt
if exist migration\upload.txt (
  for /f "usebackq delims=" %%f in ("migration\upload.txt") do scp %OPT% "migration\%%f" %HOST%: >> migration\run-log.txt 2>&1
  del migration\upload.txt
)
ssh %OPT% %HOST% "bash -s" < migration\cmd.sh >> migration\run-log.txt 2>&1
echo == exit %errorlevel% >> migration\run-log.txt
