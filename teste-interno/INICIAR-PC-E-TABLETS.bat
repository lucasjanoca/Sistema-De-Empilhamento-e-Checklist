@echo off
setlocal
cd /d "%~dp0.."
where node >nul 2>&1
if errorlevel 1 (
  echo Node.js nao encontrado. Instale o Node.js 18+ em um computador permitido.
  echo Nao foi feita nenhuma alteracao de rede.
  pause
  exit /b 1
)
set "SELENE_ALLOW_LAN=1"
echo ============================================================
echo  InfoTech - teste interno Selene (PC + tablet)
echo ============================================================
echo.
echo Iniciando leitura SOMENTE GET no computador.
echo.
echo Mantenha esta janela aberta enquanto usar nos tablets.
echo O endereco de acesso do tablet e o codigo temporario
echo aparecerao abaixo. No navegador informe:
echo   Usuario: infotech
echo   Senha: codigo temporario mostrado aqui
echo.
node teste-interno\server.js
echo.
echo O servidor encerrou. Se houve erro, confira a mensagem acima.
pause
