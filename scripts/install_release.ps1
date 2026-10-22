$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$stage = Join-Path $projectRoot 'build/portable-stage/EnglishTeacher'
$destination = Join-Path $projectRoot 'release/EnglishTeacher'
$candidate = Join-Path $stage 'EnglishTeacher.exe'
$installed = Join-Path $destination 'EnglishTeacher.exe'
if (-not (Test-Path -LiteralPath $candidate)) { throw 'Build the staged release first.' }
$running = Get-CimInstance Win32_Process -Filter "Name='EnglishTeacher.exe'" | Where-Object { $_.ExecutablePath -eq $installed }
if ($running) { throw 'The installed application is running. Stop it before installing. Existing runtime remains untouched.' }
New-Item -ItemType Directory -Path $destination -Force | Out-Null
# Replace generated web assets as a unit so old hashed bundles never enter a new ZIP.
$generatedFrontend = Join-Path $destination '_internal/frontend/dist'
if (Test-Path -LiteralPath $generatedFrontend) {
    $resolvedFrontend = (Resolve-Path -LiteralPath $generatedFrontend).Path
    $expectedFrontend = [System.IO.Path]::GetFullPath($generatedFrontend)
    if ($resolvedFrontend -ne $expectedFrontend -or -not $resolvedFrontend.StartsWith($destination + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) { throw 'Unexpected generated frontend path.' }
    Remove-Item -LiteralPath $resolvedFrontend -Recurse -Force
}
# Only generated program files are copied. Never delete or overwrite the runtime.
Get-ChildItem -LiteralPath $stage | Where-Object { $_.Name -ne 'runtime' } | ForEach-Object {
    Copy-Item -LiteralPath $_.FullName -Destination $destination -Recurse -Force
}
& (Join-Path $projectRoot '.venv/Scripts/python.exe') (Join-Path $PSScriptRoot 'release_assets.py')
if ($LASTEXITCODE -ne 0) { throw 'Release assets collection failed.' }
Write-Output 'Installed program update; existing runtime preserved.'
