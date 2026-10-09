@echo off
setlocal DisableDelayedExpansion
cd /d "%~dp0.."
where node >nul 2>&1
if errorlevel 1 (
  echo Node.js nao encontrado. Instale Node.js 18+ se permitido.
  pause
  exit /b 1
)
where powershell >nul 2>&1
if errorlevel 1 (
  echo PowerShell nao encontrado neste computador.
  pause
  exit /b 1
)
echo ============================================================
echo  InfoTech - teste interno Selene (PC + tablet)
echo ============================================================
echo.
echo A senha de acesso ao teste sera solicitada em sigilo.
echo Escolha sempre a mesma senha se quiser mante-la em cada teste.
echo Usuario no navegador: sua matricula, informada ao iniciar.
echo.
powershell -NoProfile -File "%~dp0INICIAR-PC-E-TABLETS.ps1"
if errorlevel 1 echo O teste nao iniciou. Confira a mensagem acima.
echo.
pause
