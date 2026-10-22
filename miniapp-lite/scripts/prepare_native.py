"""Configure a public AppID, check native source, and package source only.

Does not upload, log in, enable IDE ports, or touch application storage.
"""
from pathlib import Path
import argparse
import hashlib
import json
import re
import shutil
import subprocess
import sys
import zipfile

ROOT = Path(__file__).resolve().parents[1]
PROJECT = ROOT / 'miniprogram'
CONFIG = PROJECT / 'project.config.json'


def native_files():
    files = [PROJECT / name for name in (
        'app.js', 'app.json', 'app.wxss', 'project.config.json', 'sitemap.json')]
    for folder in ('lib', 'pages', 'components'):
        files.extend(p for p in (PROJECT / folder).rglob('*')
                     if p.is_file() and p.suffix in ('.js', '.json', '.wxml', '.wxss'))
    # Keep the MIT attribution for bundled Tabler icons, without including
    # arbitrary notes or private files from the native source directory.
    icon_license = PROJECT / 'lib/UI_ICONS_LICENSE.txt'
    if icon_license.exists():
        files.append(icon_license)
    return sorted(set(files))


def check():
    config = json.loads(CONFIG.read_text(encoding='utf-8-sig'))
    app = json.loads((PROJECT / 'app.json').read_text(encoding='utf-8-sig'))
    if config.get('compileType') != 'miniprogram' or config.get('miniprogramRoot') != './':
        raise ValueError('工程必须指向当前原生小程序目录')
    for page in app['pages']:
        page_path = (PROJECT / page).resolve()
        if not page_path.is_relative_to(PROJECT.resolve()):
            raise ValueError('页面路径越出工程')
        for suffix in ('.js', '.json', '.wxml', '.wxss'):
            if not page_path.with_suffix(suffix).is_file():
                raise ValueError(f'页面文件缺失：{page}{suffix}')
    node = shutil.which('node')
    if not node:
        raise ValueError('找不到 Node.js，无法完成 JavaScript 语法核验')
    files = native_files()
    for file in files:
        if not file.is_file():
            raise ValueError(f'文件缺失：{file.name}')
        if file.is_symlink():
            raise ValueError('打包不接受符号链接')
        if file.suffix == '.json':
            json.loads(file.read_text(encoding='utf-8-sig'))
        if file.suffix == '.js':
            subprocess.run([node, '--check', str(file)], check=True, capture_output=True, text=True)
    appid = config.get('appid', '')
    real_appid = bool(re.fullmatch(r'wx[0-9a-fA-F]{16}', appid))
    return files, {'sourceCheck': 'passed', 'pageCount': len(app['pages']),
                   'fileCount': len(files), 'appIdConfigured': real_appid,
                   'wechatOfficialCompile': 'not_verified_by_this_script',
                   'phoneValidation': 'not_verified_by_this_script',
                   'published': False}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--appid', help='只接受 wx 开头的公开 AppID；不接受 AppSecret')
    parser.add_argument('--version', default='0.6.0', help='原生源码候选版本')
    parser.add_argument('--package', action='store_true', help='生成源码候选包，不上传')
    args = parser.parse_args()
    if not re.fullmatch(r'\d+\.\d+\.\d+', args.version):
        raise ValueError('版本须为数字组成的三段版本号')
    if args.appid:
        if not re.fullmatch(r'wx[0-9a-fA-F]{16}', args.appid):
            raise ValueError('AppID 格式应为 wx 加 16 位十六进制字符')
        config = json.loads(CONFIG.read_text(encoding='utf-8-sig'))
        config['appid'] = args.appid
        pending = CONFIG.with_suffix('.json.pending')
        pending.write_text(json.dumps(config, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        pending.replace(CONFIG)
    files, receipt = check()
    if args.package:
        output = ROOT / 'release'
        output.mkdir(exist_ok=True)
        target = output / f'学员手记-微信原生工程-{args.version}-待真机验收.zip'
        pending = target.with_suffix('.zip.pending')
        with zipfile.ZipFile(pending, 'w', zipfile.ZIP_DEFLATED) as z:
            for file in files:
                z.write(file, str(Path('miniprogram') / file.relative_to(PROJECT)))
        with zipfile.ZipFile(pending) as z:
            if z.testzip() is not None:
                raise ValueError('压缩包完整性检查失败')
        pending.replace(target)
        receipt['package'] = target.name
        receipt['version'] = args.version
        receipt['sha256'] = hashlib.sha256(target.read_bytes()).hexdigest()
        receipt['files'] = {str(f.relative_to(PROJECT)).replace('\\', '/'):
                            hashlib.sha256(f.read_bytes()).hexdigest() for f in files}
        (output / 'native-package-receipt.json').write_text(
            json.dumps(receipt, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        (output / f'native-package-receipt-{args.version}.json').write_text(
            json.dumps(receipt, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(receipt, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8')
    try:
        main()
    except (ValueError, OSError, subprocess.CalledProcessError) as error:
        print(f'检查未完成：{error}', file=sys.stderr)
        raise SystemExit(1)
