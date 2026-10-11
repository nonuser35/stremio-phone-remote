param(
    [string]$StremioPath = '',
    [int]$Port = 9100
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$streamingProxyPort = $Port + 1
$remoteServerRoot = Join-Path $projectRoot 'remote-server'
$serverEntryPoint = Join-Path $remoteServerRoot 'server.js'
$buildIndex = Join-Path $projectRoot 'build\index.html'

if (-not (Test-Path -LiteralPath $serverEntryPoint)) {
    throw "Remote server not found at: $serverEntryPoint"
}
if (-not (Test-Path -LiteralPath $buildIndex)) {
    throw "Stremio build not found. Run 'pnpm install' and 'pnpm build' in the project directory."
}

if ([string]::IsNullOrWhiteSpace($StremioPath)) {
    $knownPaths = @(
        (Join-Path $projectRoot 'stremio\stremio-shell-ng.exe'),
        (Join-Path $env:LOCALAPPDATA 'Programs\Stremio\stremio-shell-ng.exe'),
        (Join-Path $env:LOCALAPPDATA 'Programs\LNV\Stremio-5\Stremio.exe'),
        (Join-Path $env:LOCALAPPDATA 'Programs\LNV\Stremio-4\stremio.exe')
    )
    $StremioPath = $knownPaths | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
}

if ([string]::IsNullOrWhiteSpace($StremioPath) -or -not (Test-Path -LiteralPath $StremioPath)) {
    throw "Stremio Desktop was not found. Run the script again with -StremioPath 'C:\path\to\stremio.exe'."
}

$runningStremio = Get-Process -Name 'stremio-shell-ng', 'stremio' -ErrorAction SilentlyContinue
if ($runningStremio) {
    throw 'Close Stremio completely before starting remote mode.'
}

$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
$nodeExecutable = if ($nodeCommand) { $nodeCommand.Source } else { $null }

if ([string]::IsNullOrWhiteSpace($nodeExecutable)) {
    $nodeCandidates = @(
        (Join-Path $env:ProgramFiles 'nodejs\node.exe'),
        (Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe')
    )
    $nodeExecutable = $nodeCandidates |
        Where-Object { Test-Path -LiteralPath $_ } |
        Select-Object -First 1
}

if ([string]::IsNullOrWhiteSpace($nodeExecutable)) {
    $codexRuntimeRoot = Join-Path $env:USERPROFILE '.cache\codex-runtimes'
    if (Test-Path -LiteralPath $codexRuntimeRoot) {
        $nodeExecutable = Get-ChildItem -LiteralPath $codexRuntimeRoot -Filter 'node.exe' -File -Recurse -ErrorAction SilentlyContinue |
            Sort-Object LastWriteTime -Descending |
            Select-Object -ExpandProperty FullName -First 1
    }
}

if ([string]::IsNullOrWhiteSpace($nodeExecutable) -or -not (Test-Path -LiteralPath $nodeExecutable)) {
    throw 'Node.js 22 or later was not found. Install Node.js and try again.'
}

$nodeVersion = & $nodeExecutable --version
$nodeMajorVersion = [int](($nodeVersion -replace '^v', '').Split('.')[0])
if ($nodeMajorVersion -lt 22) {
    throw "Node.js 22 or later is required. Detected version: $nodeVersion"
}
if (-not (Test-Path -LiteralPath (Join-Path $remoteServerRoot 'node_modules\ws'))) {
    Write-Host 'Preparing the remote server for the first time...'
    & npm install --prefix $remoteServerRoot --omit=dev
    if ($LASTEXITCODE -ne 0) { throw 'Failed to install the remote server dependencies.' }
}

$alreadyRunning = $false
try {
    $health = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/remote/" -UseBasicParsing -TimeoutSec 1
    $alreadyRunning = $health.StatusCode -eq 200
} catch {
    $alreadyRunning = $false
}

if (-not $alreadyRunning) {
    $powerShellPath = (Get-Process -Id $PID).Path
    $escapedRoot = $projectRoot.Replace("'", "''")
    $escapedNodeExecutable = $nodeExecutable.Replace("'", "''")
    $serverCommand = "Set-Location -LiteralPath '$escapedRoot'; `$env:STREMIO_REMOTE_PORT='$Port'; `$env:STREMIO_STREAM_PROXY_PORT='$streamingProxyPort'; & '$escapedNodeExecutable' remote-server/server.js"
    Start-Process -FilePath $powerShellPath -ArgumentList @('-NoExit', '-Command', $serverCommand) -WindowStyle Normal | Out-Null

    $ready = $false
    for ($attempt = 0; $attempt -lt 20; $attempt++) {
        Start-Sleep -Milliseconds 250
        try {
            $health = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/remote/" -UseBasicParsing -TimeoutSec 1
            if ($health.StatusCode -eq 200) {
                $ready = $true
                break
            }
        } catch {
            # The process is still starting.
        }
    }
    if (-not $ready) { throw 'The remote server did not start on the configured port.' }
}

$encodedStreamingServerUrl = [Uri]::EscapeDataString("http://127.0.0.1:$streamingProxyPort")
$webUiUrl = "http://127.0.0.1:$Port/#/?loginFlow=desktop&streamingServerUrl=$encodedStreamingServerUrl"
Write-Host "Opening Stremio with the remote interface at $webUiUrl"
Start-Process -FilePath $StremioPath -ArgumentList "--webui-url=$webUiUrl" | Out-Null

Write-Host 'Ready. Use the QR code and PIN shown in the server window.'
