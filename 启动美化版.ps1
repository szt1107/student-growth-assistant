param([switch]$OpenBrowser)
$ErrorActionPreference = 'Stop'
$projectRoot = $PSScriptRoot
$runtimeDir = Join-Path $projectRoot 'scripts/.runtime'
$stateFile = Join-Path $runtimeDir 'beauty-processes.json'
$pythonExe = Join-Path $projectRoot '.venv/Scripts/python.exe'
$viteFile = Join-Path $projectRoot 'frontend/node_modules/vite/bin/vite.js'
if (!(Test-Path -LiteralPath $pythonExe) -or !(Test-Path -LiteralPath $viteFile)) {
    throw '请先运行 安装依赖.ps1，然后重新启动。'
}
$nodeExe = (Get-Command node.exe -ErrorAction Stop).Source
New-Item -ItemType Directory -Path $runtimeDir -Force | Out-Null

function Test-LocalPort([int]$Port) {
    $client = New-Object System.Net.Sockets.TcpClient
    try { $client.Connect('127.0.0.1', $Port); return $true }
    catch { return $false }
    finally { $client.Dispose() }
}
function Test-RecordedProcess($Entry) {
    $process = Get-Process -Id $Entry.Id -ErrorAction SilentlyContinue
    return ($process -and $process.Path -eq $Entry.Executable -and $process.StartTime.ToUniversalTime().Ticks.ToString() -eq $Entry.StartTicks)
}
if (Test-Path -LiteralPath $stateFile) {
    $entries = Get-Content -LiteralPath $stateFile -Raw -Encoding UTF8 | ConvertFrom-Json
    $valid = @($entries | Where-Object { Test-RecordedProcess $_ })
    if ($valid.Count -eq 2 -and (Test-LocalPort 8002) -and (Test-LocalPort 5175)) {
        Write-Output '美化版已运行：http://127.0.0.1:5175/'
        if ($OpenBrowser) { Start-Process 'http://127.0.0.1:5175/' }
        return
    }
    & (Join-Path $projectRoot '停止美化版.ps1')
}
foreach ($port in @(8002, 5175)) {
    if (Test-LocalPort $port) { throw "端口 $port 被占用。脚本不会停止未知服务，请先处理端口占用。" }
}
$started = @()
$savedEnvironment = @{}
foreach ($name in @('SGA_DEMO','SGA_DATABASE_PATH','VITE_API_BASE_URL')) {
    $savedEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
}
try {
    $env:SGA_DEMO = '0'
    $env:SGA_DATABASE_PATH = Join-Path $projectRoot 'backend/data/app.db'
    $env:VITE_API_BASE_URL = 'http://127.0.0.1:8002'
    $backend = Start-Process -FilePath $pythonExe -ArgumentList @('-m','uvicorn','app.main:app','--app-dir','backend','--host','127.0.0.1','--port','8002') -WorkingDirectory $projectRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $runtimeDir 'beauty-backend.stdout.log') -RedirectStandardError (Join-Path $runtimeDir 'beauty-backend.stderr.log') -PassThru
    $started += $backend
    $frontend = Start-Process -FilePath $nodeExe -ArgumentList @(('"{0}"' -f $viteFile),'--host','127.0.0.1','--port','5175','--strictPort') -WorkingDirectory (Join-Path $projectRoot 'frontend') -WindowStyle Hidden -RedirectStandardOutput (Join-Path $runtimeDir 'beauty-frontend.stdout.log') -RedirectStandardError (Join-Path $runtimeDir 'beauty-frontend.stderr.log') -PassThru
    $started += $frontend
    $deadline = (Get-Date).AddSeconds(40)
    do {
        foreach ($process in $started) {
            $process.Refresh()
            if ($process.HasExited) { throw '服务启动失败，请查看 scripts/.runtime/beauty-*.log。' }
        }
        try {
            $health = Invoke-RestMethod 'http://127.0.0.1:8002/api/health' -TimeoutSec 2
            $page = Invoke-WebRequest 'http://127.0.0.1:5175/' -UseBasicParsing -TimeoutSec 2
            $ready = $health.status -eq 'ok' -and $page.StatusCode -eq 200
        } catch { $ready = $false }
        if (!$ready) { Start-Sleep -Milliseconds 300 }
        if ((Get-Date) -gt $deadline) { throw '启动超时，请查看 scripts/.runtime/beauty-*.log。' }
    } until ($ready)
    $records = @($started | ForEach-Object { @{ Id=$_.Id; StartTicks=$_.StartTime.ToUniversalTime().Ticks.ToString(); Executable=$_.Path } })
    ConvertTo-Json -InputObject $records | Set-Content -LiteralPath $stateFile -Encoding UTF8
    Write-Output '美化版已启动：http://127.0.0.1:5175/'
    Write-Output '后端文档：http://127.0.0.1:8002/docs'
    if ($OpenBrowser) { Start-Process 'http://127.0.0.1:5175/' }
} catch {
    foreach ($process in $started) {
        $process.Refresh()
        if (!$process.HasExited) { & "$env:SystemRoot\System32\taskkill.exe" /PID $process.Id /T /F | Out-Null }
    }
    throw
} finally {
    foreach ($name in $savedEnvironment.Keys) { [Environment]::SetEnvironmentVariable($name, $savedEnvironment[$name], 'Process') }
}
