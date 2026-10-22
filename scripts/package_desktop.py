"""Package the existing Windows release and offline macOS candidate for Desktop.

Foreign Python archives are never executed or extracted on Windows. ZIP entries
preserve their Unix mode and symbolic links for macOS Archive Utility.
"""
from pathlib import Path, PurePosixPath
import hashlib
import json
import os
import posixpath
import shutil
import stat
import tarfile
import zipfile
from source_archive import write_source_archive

ROOT = Path(__file__).resolve().parent.parent
DEPS = ROOT / 'build/macos-deps'
RELEASE = ROOT / 'release'
MAC_ZIP = RELEASE / '英语班主任工作台-Mac版-0.2.0-待实机验证.zip'
TOP = 'EnglishTeacher-Mac'


def safe_name(value):
    path = PurePosixPath(value)
    if path.is_absolute() or '..' in path.parts or '\\' in value:
        raise ValueError('Unsafe archive path: ' + value)
    return path.as_posix()


class Package:
    def __init__(self, archive):
        self.archive = archive
        self.names = set()

    def add(self, relative, content, mode=0o644, symlink=False):
        name = TOP + '/' + safe_name(relative)
        if name in self.names:
            raise ValueError('Duplicate archive path: ' + name)
        self.names.add(name)
        info = zipfile.ZipInfo(name)
        info.create_system = 3
        info.compress_type = zipfile.ZIP_DEFLATED
        info.external_attr = ((stat.S_IFLNK if symlink else stat.S_IFREG) | mode) << 16
        self.archive.writestr(info, content)

    def tree(self, source, destination, predicate=lambda p: True):
        for file in sorted(source.rglob('*')):
            if file.is_file() and predicate(file):
                self.add(destination + '/' + file.relative_to(source).as_posix(), file.read_bytes())

    def runtime(self, source, arch):
        with tarfile.open(source, 'r:gz') as tar:
            for member in tar.getmembers():
                name = safe_name(member.name)
                if not name.startswith('python/') and name != 'python':
                    raise ValueError('Unexpected Python prefix: ' + name)
                relative = f'runtimes/{arch}/' + name
                if member.isdir():
                    continue
                if member.issym():
                    target = member.linkname
                    resolved = posixpath.normpath(posixpath.join(posixpath.dirname(name), target))
                    if target.startswith('/') or not resolved.startswith('python/'):
                        raise ValueError('Unsafe runtime link: ' + name)
                    self.add(relative, target.encode('utf-8'), member.mode & 0o777, symlink=True)
                elif member.isfile() or member.islnk():
                    if member.islnk():
                        safe_name(member.linkname)
                    stream = tar.extractfile(member)
                    if stream is None:
                        raise ValueError('Missing runtime member: ' + name)
                    self.add(relative, stream.read(), member.mode & 0o777)
                else:
                    raise ValueError('Unsupported tar entry: ' + name)

    def wheel(self, source, arch):
        with zipfile.ZipFile(source) as wheel:
            for info in wheel.infolist():
                if info.is_dir():
                    continue
                name = safe_name(info.filename)
                parts = name.split('/')
                if parts[0].endswith('.data'):
                    if len(parts) > 2 and parts[1] in ('purelib', 'platlib'):
                        name = '/'.join(parts[2:])
                    else:
                        raise ValueError('Unexpected wheel install scheme: ' + name)
                mode = (info.external_attr >> 16) & 0o777 or 0o644
                self.add(f'vendor/{arch}/' + name, wheel.read(info), mode)


def create_mac():
    manifest = DEPS / 'manifest.json'
    assert manifest.is_file(), 'Verified dependency manifest is required.'
    evidence = json.loads(manifest.read_text(encoding='utf-8'))
    assert evidence['status'] == 'downloaded_and_statically_verified'
    for arch in ('arm64', 'x86_64'):
        records = evidence['architectures'][arch]
        for item in [records['runtime'], *records['wheels']]:
            file = (ROOT / item['archive']).resolve()
            assert file.is_relative_to(DEPS.resolve()), 'Unexpected dependency location'
            assert hashlib.sha256(file.read_bytes()).hexdigest() == item['sha256'], file
    source_archive = RELEASE / 'mac-application-source.zip'
    write_source_archive(ROOT, source_archive)
    with zipfile.ZipFile(MAC_ZIP, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        pack = Package(archive)
        for arch in ('arm64', 'x86_64'):
            records = evidence['architectures'][arch]
            pack.runtime(ROOT / records['runtime']['archive'], arch)
            for wheel in records['wheels']:
                pack.wheel(ROOT / wheel['archive'], arch)
        pack.add('启动英语班主任.command', (ROOT/'scripts/macos/start.command').read_bytes().replace(b'\r\n', b'\n'), 0o755)
        pack.add('停止英语班主任.command', (ROOT/'scripts/macos/stop.command').read_bytes().replace(b'\r\n', b'\n'), 0o755)
        pack.add('app/mac_entry.py', (ROOT/'scripts/macos/mac_entry.py').read_bytes())
        pack.add('app/launch.py', (ROOT/'launch.py').read_bytes())
        pack.tree(ROOT/'backend', 'app/backend', lambda p:p.suffix=='.py' and '__pycache__' not in p.parts)
        pack.tree(ROOT/'frontend/dist', 'app/frontend/dist')
        pack.tree(ROOT/'release/EnglishTeacher/THIRD_PARTY_NOTICES', 'THIRD_PARTY_NOTICES')
        pack.add('第三方运行组件清单.json', manifest.read_bytes())
        pack.add('应用源码.zip', source_archive.read_bytes())
        pack.add('使用说明.md', (ROOT/'使用说明.md').read_bytes())
        pack.add('package-info.json', (ROOT/'package-info.json').read_bytes())
        pack.add('Mac先看这里.txt', (ROOT/'scripts/macos/Mac先看这里.txt').read_bytes())
        lock=ROOT/'requirements-macos.lock'
        if lock.exists():
            pack.add('requirements-macos.lock',lock.read_bytes())
    return {'path':str(MAC_ZIP),'sha256':hashlib.sha256(MAC_ZIP.read_bytes()).hexdigest(),'bytes':MAC_ZIP.stat().st_size,'mac_native_tested':False}


if __name__=='__main__':
    receipt=create_mac()
    (RELEASE/'mac-package-receipt.json').write_text(json.dumps(receipt,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps(receipt,ensure_ascii=False,indent=2))
