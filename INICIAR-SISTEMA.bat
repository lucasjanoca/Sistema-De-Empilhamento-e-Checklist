@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>&1
if errorlevel 1 (
  echo Node.js nao encontrado. Precisa do Node.js 18 ou superior.
  pause
  exit /b 1
)
powershell -NoProfile -File "%~dp0INICIAR-SISTEMA.ps1"
if errorlevel 1 (
  echo Nao foi possivel iniciar o sistema. Confira o erro acima.
  pause
)
