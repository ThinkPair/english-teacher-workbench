"""macOS portable launcher. Uses bundled Python and never installs packages."""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import platform
import signal
import socket
import subprocess
import sys
import time
import urllib.request
import webbrowser

APP = Path(__file__).resolve().parent
BUNDLE = APP.parent
DATA = Path.home() / 'Library' / 'Application Support' / 'EnglishTeacherWorkspace' / 'runtime'
URL = 'http://127.0.0.1:8769'
PID_FILE = DATA / 'mac-process.json'


def healthy() -> bool:
    try:
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        with opener.open(URL + '/api/health', timeout=1) as response:
            info = json.load(response)
        return info.get('ok') is True and info.get('app') == 'english-teacher'
    except Exception:
        return False


def configure() -> None:
    if sys.platform != 'darwin':
        raise RuntimeError('此启动包只适用于 Mac；Windows 请使用 Windows 压缩包。')
    machine = platform.machine()
    if machine not in ('arm64', 'x86_64'):
        raise RuntimeError('当前芯片不在此试用包的支持范围。')
    # -I discards ambient PYTHONPATH; only our exact app and vendor paths are added.
    sys.path[:0] = [str(BUNDLE / 'vendor' / machine), str(APP)]
    os.umask(0o077)
    DATA.mkdir(parents=True, exist_ok=True, mode=0o700)
    DATA.chmod(0o700)
    os.environ['TEACHER_DATA_DIR'] = str(DATA)
    os.environ['PYTHONIOENCODING'] = 'utf-8'


def stop() -> int:
    if not PID_FILE.is_file():
        print('没有此启动包记录的后台进程。')
        return 0
    record = json.loads(PID_FILE.read_text(encoding='utf-8'))
    pid = int(record['pid'])
    if pid <= 1 or record.get('entry') != str(Path(__file__).resolve()):
        raise RuntimeError('运行记录与此文件夹不一致，未停止任何进程。请使用原文件夹中的停止按钮。')
    result = subprocess.run(['/bin/ps', '-p', str(pid), '-o', 'command='], capture_output=True, text=True)
    command = result.stdout
    if result.returncode or not command.strip():
        PID_FILE.unlink(missing_ok=True)
        print('工作台已停止。')
        return 0
    if str(Path(__file__).resolve()) not in command or '--serve' not in command:
        raise RuntimeError('进程已变化，未停止其他程序。')
    os.kill(pid, signal.SIGTERM)
    for _ in range(40):
        try:
            os.kill(pid, 0)
        except ProcessLookupError:
            PID_FILE.unlink(missing_ok=True)
            print('工作台已停止，资料已保留。')
            return 0
        time.sleep(0.25)
    print('已请求停止。若仍未退出，请通过活动监视器检查；资料仍在原位置。')
    return 1


def start() -> int:
    if healthy():
        webbrowser.open(URL)
        print('工作台已打开。')
        return 0
    with socket.socket() as probe:
        try:
            probe.bind(('127.0.0.1', 8769))
        except OSError:
            raise RuntimeError('本机 8769 端口被其他程序占用，请关闭冲突程序后重试。') from None
    # Import all native dependencies before detaching, so startup errors stay visible.
    import fitz
    from PIL import Image
    import pydantic_core
    import fastapi
    import uvicorn
    from backend.main import app
    assert app and fitz and Image and pydantic_core and fastapi and uvicorn
    log_path = DATA / 'mac-startup.log'
    with log_path.open('ab') as log:
        process = subprocess.Popen(
            [sys.executable, '-I', str(Path(__file__).resolve()), '--serve'],
            cwd=str(APP), stdin=subprocess.DEVNULL, stdout=log, stderr=subprocess.STDOUT,
            start_new_session=True,
        )
    PID_FILE.write_text(json.dumps({'pid': process.pid, 'entry': str(Path(__file__).resolve())}), encoding='utf-8')
    for _ in range(90):
        if healthy():
            webbrowser.open(URL)
            print('工作台已打开，现在可以关闭这个窗口。')
            print('教学资料保存在：' + str(DATA))
            return 0
        if process.poll() is not None:
            break
        time.sleep(0.5)
    raise RuntimeError('启动未完成，请查看 ' + str(log_path) + '。资料未被删除。')


def main() -> int:
    parser = argparse.ArgumentParser()
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument('--serve', action='store_true')
    mode.add_argument('--stop', action='store_true')
    args = parser.parse_args()
    configure()
    if args.serve:
        import launch
        sys.argv = ['launch.py', '--no-browser']
        launch.main()
        return 0
    # Serialize repeated Finder launches and stop requests, not the server lifetime.
    import fcntl
    with (DATA / 'mac-launch.lock').open('a') as lock:
        fcntl.flock(lock.fileno(), fcntl.LOCK_EX)
        try:
            if args.stop:
                return stop()
            return start()
        finally:
            fcntl.flock(lock.fileno(), fcntl.LOCK_UN)


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except Exception as exc:
        print('\n启动提示：' + str(exc), file=sys.stderr)
        raise SystemExit(1)
