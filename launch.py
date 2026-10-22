"""Local desktop entry point. Bundled releases never need an installed Python."""
from __future__ import annotations

import argparse
import json
import logging
from logging.handlers import RotatingFileHandler
import os
from pathlib import Path
import socket
import sys
import threading
import time
import urllib.request
import webbrowser


def application_home() -> Path:
    return Path(sys.executable).resolve().parent if getattr(sys, "frozen", False) else Path(__file__).resolve().parent


def is_our_server(url: str) -> bool:
    try:
        # A loopback readiness check must not go through a system/VPN proxy.
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        with opener.open(url + "/api/health", timeout=1) as response:
            data = json.loads(response.read())
        return data.get("ok") is True and data.get("app") == "english-teacher"
    except Exception:
        return False


def notify_error(message: str) -> None:
    logging.getLogger("launcher").error(message)
    if sys.platform == "win32":
        import ctypes
        ctypes.windll.user32.MessageBoxW(None, message, "英语班主任 · 启动提示", 0x10)
    elif sys.stderr:
        print(message, file=sys.stderr)


def main() -> None:
    parser = argparse.ArgumentParser(description="英语班主任本地工作台")
    parser.add_argument("--port", type=int, default=8769)
    parser.add_argument("--no-browser", action="store_true")
    args = parser.parse_args()
    if not 1024 <= args.port <= 65535:
        raise SystemExit("Port must be between 1024 and 65535")
    home = application_home()
    data_dir = Path(os.environ.setdefault("TEACHER_DATA_DIR", str(home / "runtime")))
    data_dir.mkdir(parents=True, exist_ok=True)
    handler = RotatingFileHandler(data_dir / "application.log", maxBytes=2_000_000, backupCount=3, encoding="utf-8")
    handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s %(message)s"))
    logging.basicConfig(level=logging.INFO, handlers=[handler])
    url = f"http://127.0.0.1:{args.port}"
    if is_our_server(url):
        if not args.no_browser:
            webbrowser.open(url)
        return
    try:
        with socket.socket() as probe:
            probe.bind(("127.0.0.1", args.port))
    except OSError:
        notify_error(f"本地端口 {args.port} 正被其他程序使用。请关闭冲突程序后重试。学生资料不会受到影响。")
        return

    if not args.no_browser:
        def open_when_ready():
            for _ in range(90):
                if is_our_server(url):
                    webbrowser.open(url)
                    return
                time.sleep(0.5)
            notify_error("程序暂时未能启动，请查看 runtime 文件夹中的 application.log。")
        threading.Thread(target=open_when_ready, daemon=True).start()
    try:
        import uvicorn
        from backend.main import app
        uvicorn.run(app, host="127.0.0.1", port=args.port, log_config=None, access_log=False)
    except Exception:
        logging.getLogger("launcher").exception("Startup failed")
        notify_error("程序未能启动。详细信息已保存到 runtime/application.log，原有学生资料已保留。")


if __name__ == "__main__":
    main()
