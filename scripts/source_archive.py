"""Build the application source archive from an explicit, data-free allowlist."""
from pathlib import Path
import zipfile

BASE_FILES = (
    'README.md', '交付验收.md', 'launch.py', 'requirements.txt',
    'requirements-lock.txt', 'requirements-macos.lock', 'build_release.ps1',
    'package-info.json',
    'API_CONTRACT.md', 'V02_CONTRACT.md', '使用说明.md', 'AGENTS.md', '.gitignore',
    'frontend/package.json', 'frontend/package-lock.json', 'frontend/index.html',
    'frontend/tsconfig.json', 'frontend/tsconfig.app.json',
    'frontend/tsconfig.node.json', 'frontend/vite.config.ts',
)


def write_source_archive(root: Path, destination: Path) -> None:
    files = {root / relative for relative in BASE_FILES}
    files.update((root / 'third_party_licenses').glob('*.txt'))
    for folder, extensions in (
        ('backend', {'.py'}),
        ('frontend/src', {'.ts', '.tsx', '.css'}),
        ('scripts', {'.py', '.ps1', '.command', '.txt'}),
        ('tests', {'.py', '.cjs'}),
    ):
        files.update(p for p in (root / folder).rglob('*')
                     if p.is_file() and p.suffix in extensions
                     and not {'__pycache__', '.run-data'} & set(p.parts))
    destination.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(destination, 'w', zipfile.ZIP_DEFLATED) as archive:
        for file in sorted(files):
            if file.is_file():
                archive.write(file, 'source/' + file.relative_to(root).as_posix())
