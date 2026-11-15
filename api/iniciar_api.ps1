$ErrorActionPreference = 'Stop'
$taskWorkspace = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '../..')).Path
$taskPython = Join-Path $taskWorkspace 'work/api-env/Scripts/python.exe'
if (-not (Test-Path -LiteralPath $taskPython)) { $taskPython = 'python' }
& $taskPython -m uvicorn api:app --app-dir $PSScriptRoot --host 127.0.0.1 --port 8000
