"""Collect notices and source next to the portable Windows build, without user data."""
from pathlib import Path
from importlib import metadata
import json
import hashlib
import re
import shutil
import sys
import zipfile
from source_archive import write_source_archive

ROOT = Path(__file__).resolve().parent.parent
VERSION = '0.2.0'
release = ROOT / 'release' / 'EnglishTeacher'
assert release.is_dir()
notices = release / 'THIRD_PARTY_NOTICES'
notices.mkdir(exist_ok=True)
for license_file in (ROOT / 'third_party_licenses').glob('*.txt'):
    shutil.copy2(license_file, notices / license_file.name)
packages = []
for distribution in sorted(metadata.distributions(), key=lambda d: d.metadata['Name'].lower()):
    name, version = distribution.metadata['Name'], distribution.version
    packages.append({'name': name, 'version': version, 'license': distribution.metadata.get('License-Expression') or distribution.metadata.get('License', '')})
    for entry in distribution.files or []:
        if any(part.lower().startswith(('license', 'copying', 'notice')) for part in entry.parts):
            source = Path(distribution.locate_file(entry))
            if source.is_file():
                dest = notices / f'{name}-{version}' / Path(*entry.parts)
                dest.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(source, dest)
python_license = Path(sys.base_prefix) / 'LICENSE.txt'
if python_license.is_file():
    shutil.copy2(python_license, notices / 'Python-LICENSE.txt')
for name in ['react', 'react-dom', 'scheduler', 'lucide-react']:
    package = ROOT / 'frontend' / 'node_modules' / name
    info = json.loads((package / 'package.json').read_text(encoding='utf-8'))
    packages.append({'name': name, 'version': info['version'], 'license': info.get('license', '')})
    for file in package.glob('*'):
        if file.is_file() and file.name.lower().startswith(('license', 'notice', 'copying')):
            dest = notices / name / file.name
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(file, dest)
(notices / 'dependencies.json').write_text(json.dumps(packages, ensure_ascii=False, indent=2), encoding='utf-8')
(notices / 'README.txt').write_text('Bundled dependencies retain their own licenses. PyMuPDF/MuPDF is distributed under its AGPL option; see its included notices and upstream license. This private evaluation build includes application source. The three reference projects were studied for architecture; none of their application source was copied.\n', encoding='utf-8')
for file in ['使用说明.md', 'requirements-lock.txt', '交付验收.md', 'package-info.json']:
    if (ROOT / file).exists():
        shutil.copy2(ROOT / file, release / file)
write_source_archive(ROOT, release / 'application-source.zip')
print('Notices, manual, dependency versions and application source collected; user runtime excluded.')
output = ROOT / 'release' / f'英语班主任工作台-Windows-{VERSION}.zip'
with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as archive:
    for file in sorted(release.rglob('*')):
        if file.is_file() and 'runtime' not in file.relative_to(release).parts:
            archive.write(file, str(Path('EnglishTeacher') / file.relative_to(release)))
html = (release / '_internal/frontend/dist/index.html').read_text(encoding='utf-8')
receipt = {'version': VERSION, 'executable_sha256': hashlib.sha256((release / 'EnglishTeacher.exe').read_bytes()).hexdigest(), 'archive_sha256': hashlib.sha256(output.read_bytes()).hexdigest(), 'archive_bytes': output.stat().st_size, 'frontend': re.search(r'src="[^\"]*/([^\"]+\.js)"', html).group(1), 'runtime_included': False}
(ROOT / 'release/release-receipt.json').write_text(json.dumps(receipt, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps(receipt, ensure_ascii=False, indent=2))
