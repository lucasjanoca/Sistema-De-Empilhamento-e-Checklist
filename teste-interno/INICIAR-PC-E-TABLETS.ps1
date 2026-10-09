# A senha e solicitada de forma oculta e existe somente durante esta sessao.
$ErrorActionPreference = "Stop"
$env:SELENE_ALLOW_LAN = "1"
try {
  if (-not $env:SELENE_COD_EMP) {
    Write-Host ""
    Write-Host "Selecione a MESMA empilhadeira do sistema original da Selene."
    $choice = Read-Host "Codigo da empilhadeira [emp1]"
    if ([string]::IsNullOrWhiteSpace($choice)) { $choice = "emp1" }
    $env:SELENE_COD_EMP = $choice.Trim()
  }
  Write-Host ""
  Write-Host "Crie/digite sua senha para acesso ao teste no PC e tablet."
  Write-Host "O usuario no navegador sera: infotech"
  $secret = Read-Host "Senha escolhida (minimo 12 caracteres; digitacao oculta)" -AsSecureString
  if ($null -eq $secret) { throw "Senha nao informada." }
  $ptr = [IntPtr]::Zero
  try {
    $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret)
    $password = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
    if ([string]::IsNullOrEmpty($password) -or $password.Length -lt 12) {
      throw "Senha curta. Informe pelo menos 12 caracteres."
    }
    $env:SELENE_TEST_ACCESS_CODE = $password
  } finally {
    if ($ptr -ne [IntPtr]::Zero) {
      [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
    }
    $password = $null
    $secret.Dispose()
  }
  Write-Host ""
  Write-Host "Iniciando conexao para PC e tablets (somente leitura)."
  Write-Host "Digite no navegador a MESMA senha informada agora."
  Write-Host "A porta nao deve ser exposta na internet."
  Write-Host ""
  & node (Join-Path $PSScriptRoot "server.js")
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} catch {
  Write-Host ("ERRO: " + $_.Exception.Message)
  exit 1
} finally {
  Remove-Item Env:SELENE_TEST_ACCESS_CODE -ErrorAction SilentlyContinue
}
