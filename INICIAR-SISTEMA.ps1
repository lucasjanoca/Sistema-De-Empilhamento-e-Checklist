# Iniciador do sistema de consulta oficial para validação inicial no PC.
# Nao ativa gravação corporativa; essa exige adaptador autorizado separado.
$ErrorActionPreference='Stop'
Set-Location $PSScriptRoot
try {
  Write-Host 'InfoTech / Sistema de Empilhadores - Inicializacao'
  $emp = Read-Host 'Codigo da empilhadeira do sistema original [emp1]'
  if ([string]::IsNullOrWhiteSpace($emp)) { $emp='emp1' }
  if ($emp -notmatch '^emp[0-9]{1,3}$') { throw 'Informe uma empilhadeira valida: emp1, emp2 etc.' }
  $matricula=Read-Host 'Sua matricula'
  if ($matricula -notmatch '^[0-9]{4,12}$') { throw 'Matricula invalida.' }
  $env:SELENE_COD_EMP=$emp
  $env:SELENE_TEST_USERNAME=$matricula
  $env:SELENE_ALLOW_LAN='0'
  $env:SELENE_OFFICIAL_WRITES='0'
  Write-Host 'Abrindo sistema em http://127.0.0.1:8765/empilhadores/'
  Write-Host 'A consulta oficial sera disponibilizada se a rede permitir.'
  Write-Host 'Movimentacoes reais permanecem indisponiveis ate a integracao oficial de escrita.'
  Start-Process -FilePath 'node' -ArgumentList 'teste-interno/server.js' -WorkingDirectory $PSScriptRoot
  Start-Sleep -Seconds 2
  Start-Process 'http://127.0.0.1:8765/empilhadores/'
} catch {
  Write-Host ('ERRO: '+$_.Exception.Message)
  exit 1
} finally {
  Remove-Item Env:SELENE_TEST_USERNAME -ErrorAction SilentlyContinue
}