$ErrorActionPreference = 'Stop'
Push-Location $PSScriptRoot
try {
    $pythonExe = Join-Path $PSScriptRoot '.venv/Scripts/python.exe'
    if (!(Test-Path -LiteralPath $pythonExe)) {
        $candidates = @(
            @{Name='py'; Args=@('-3.11')},
            @{Name='py'; Args=@('-3.12')},
            @{Name='python'; Args=@()},
            @{Name='python3'; Args=@()}
        )
        $created = $false
        foreach ($candidate in $candidates) {
            $command = Get-Command $candidate.Name -ErrorAction SilentlyContinue
            if (!$command) { continue }
            $prefixArgs = $candidate.Args
            & $command.Source @prefixArgs -c 'import sys; sys.exit(0 if sys.version_info >= (3,11) else 1)' 2>$null
            if ($LASTEXITCODE -ne 0) { continue }
            & $command.Source @prefixArgs -m venv .venv
            if ($LASTEXITCODE -ne 0) { throw '创建 Python 虚拟环境失败。' }
            $created = $true
            break
        }
        if (!$created) { throw '请先安装 Python 3.11 或 3.12，然后重新执行。' }
    }
    & $pythonExe -m pip install -r backend/requirements.txt -c backend/constraints.txt
    if ($LASTEXITCODE -ne 0) { throw '后端依赖安装失败。' }
    & $pythonExe -m pip check
    if ($LASTEXITCODE -ne 0) { throw '后端依赖检查失败。' }
    $npmExe = (Get-Command npm.cmd -ErrorAction Stop).Source
    & $npmExe --prefix frontend ci --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { throw '前端依赖安装失败；请检查 Node.js 22+ 和网络。' }
    Write-Output '安装完成。双击 启动美化版.cmd 即可打开。'
} finally { Pop-Location }
