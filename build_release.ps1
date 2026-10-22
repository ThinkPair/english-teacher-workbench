param([switch]$PrepareOnly)
$ErrorActionPreference = 'Stop'
$projectRoot = $PSScriptRoot
Set-Location -LiteralPath $projectRoot
$pythonExe = Join-Path $projectRoot '.venv/Scripts/python.exe'
if (-not (Test-Path -LiteralPath $pythonExe)) { throw 'Missing build environment .venv' }
if (-not (Test-Path -LiteralPath (Join-Path $projectRoot 'frontend/dist/index.html'))) { throw 'Build frontend before packaging' }
& $pythonExe -m PyInstaller --noconfirm --onedir --windowed --name EnglishTeacher --distpath build/portable-stage --workpath build/pyinstaller --add-data 'frontend/dist;frontend/dist' --collect-all pymupdf --hidden-import backend.main --hidden-import uvicorn.logging --hidden-import uvicorn.loops.auto --hidden-import uvicorn.protocols.http.auto --hidden-import uvicorn.protocols.websockets.auto --hidden-import uvicorn.lifespan.on launch.py
if ($LASTEXITCODE -ne 0) { throw 'Packaging failed' }
if ($PrepareOnly) { Write-Output 'Prepared: build/portable-stage/EnglishTeacher/EnglishTeacher.exe'; exit 0 }
& (Join-Path $projectRoot 'scripts/install_release.ps1')
