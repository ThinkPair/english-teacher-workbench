"""Open the preview at a fixed origin so the same local records remain available."""
from pathlib import Path
import subprocess
import sys
import time
import urllib.request
import webbrowser

URL = 'http://127.0.0.1:8768/web/'

def is_ours():
    try:
        with urllib.request.urlopen(URL, timeout=1) as response:
            return response.headers.get('X-Student-Notebook') == 'lite-0.1'
    except OSError:
        return False

if not is_ours():
    subprocess.Popen([sys.executable, str(Path(__file__).with_name('serve.py'))],
                     stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                     creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    for _ in range(30):
        if is_ours():
            break
        time.sleep(.2)
if is_ours():
    webbrowser.open(URL)
else:
    message = '体验版未能启动。请检查 8768 端口是否被其他应用使用。不要更换地址录入原档案；请先备份。'
    if sys.platform == 'win32':
        import ctypes
        ctypes.windll.user32.MessageBoxW(0, message, '学员手记', 0)
    else:
        print(message)
    sys.exit(1)
