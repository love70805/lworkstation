$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$frontendRoot = Join-Path $projectRoot "frontend"
$url = "http://127.0.0.1:5173/workspace"
$frontendPort = 5173
$erpInboxPort = 8790
$bundledNode = "C:\Users\a1823\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
$nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
$node = if ($nodeCommand) { $nodeCommand.Source } else { $null }
if (-not $node -and (Test-Path $bundledNode)) { $node = $bundledNode }
$vite = Get-ChildItem (Join-Path $frontendRoot "node_modules\.pnpm\vite@*\node_modules\vite\bin\vite.js") -ErrorAction SilentlyContinue | Select-Object -First 1

if (-not $node -or -not $vite) {
    Write-Error "Shopeers startup failed: bundled Node.js or Vite was not found."
    exit 1
}

$frontendListening = Get-NetTCPConnection -State Listen -LocalPort $frontendPort -ErrorAction SilentlyContinue
if (-not $frontendListening) {
    Start-Process -FilePath $node -ArgumentList $vite.FullName, "--host", "127.0.0.1", "--port", "$frontendPort" -WorkingDirectory $frontendRoot -WindowStyle Hidden
}

$erpInboxListening = Get-NetTCPConnection -State Listen -LocalPort $erpInboxPort -ErrorAction SilentlyContinue
if (-not $erpInboxListening) {
    Start-Process -FilePath $node -ArgumentList (Join-Path $projectRoot "tools\erp-inbox-server.mjs") -WorkingDirectory $projectRoot -WindowStyle Hidden
}

$deadline = (Get-Date).AddSeconds(30)
do {
    Start-Sleep -Milliseconds 500
    $frontendListening = Get-NetTCPConnection -State Listen -LocalPort $frontendPort -ErrorAction SilentlyContinue
    $erpInboxListening = Get-NetTCPConnection -State Listen -LocalPort $erpInboxPort -ErrorAction SilentlyContinue
} until (($frontendListening -and $erpInboxListening) -or (Get-Date) -ge $deadline)

if (-not $frontendListening -or -not $erpInboxListening) {
    Write-Error "Shopeers startup timed out."
    exit 1
}

$chromeCandidates = @(
    "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
    "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
)
$chrome = $chromeCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1

if ($chrome) {
    Start-Process -FilePath $chrome -ArgumentList $url
} else {
    Start-Process $url
}
