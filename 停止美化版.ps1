$ErrorActionPreference = 'Stop'
$stateFile = Join-Path $PSScriptRoot 'scripts/.runtime/beauty-processes.json'
if (!(Test-Path -LiteralPath $stateFile)) { Write-Output '没有本启动器记录的服务。'; return }
$entries = Get-Content -LiteralPath $stateFile -Raw -Encoding UTF8 | ConvertFrom-Json
foreach ($entry in $entries) {
    $process = Get-Process -Id $entry.Id -ErrorAction SilentlyContinue
    if (!$process) { continue }
    if ($process.Path -ne $entry.Executable -or $process.StartTime.ToUniversalTime().Ticks.ToString() -ne $entry.StartTicks) {
        Write-Output "已跳过身份不匹配的进程 $($entry.Id)。"
        continue
    }
    & "$env:SystemRoot\System32\taskkill.exe" /PID $process.Id /T /F | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "无法停止已验证的进程树 $($process.Id)。" }
}
Remove-Item -LiteralPath $stateFile
Write-Output '美化版服务已停止，数据库与原项目保留。'
