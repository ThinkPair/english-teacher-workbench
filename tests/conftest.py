"""Isolated API verification. All names and inputs are explicitly fictional."""

from __future__ import annotations

import base64
from collections import deque
import importlib
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest
import httpx
from fastapi.testclient import TestClient


PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

# A real PNG payload, not a claimed image whose body is HTML or sample text.
PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAABgAAAAYCAIAAABvFaqvAAAALElEQVR4nGP8//8/AzUAE1VMYRg1iBgwGtiEwWgYEQajYUQYjIYRYTD4wggAGdEDLUH5HJEAAAAASUVORK5CYII="
)


@pytest.fixture
def data_root(tmp_path, monkeypatch):
    root = tmp_path / "isolated-teacher-data"
    monkeypatch.setenv("TEACHER_DATA_DIR", str(root))
    return root


@pytest.fixture
def client(data_root, monkeypatch):
    storage = importlib.import_module("backend.storage")
    # This is the backend's documented test seam, not a bypass of API behavior.
    monkeypatch.setattr(storage, "ROOT", data_root)
    module = importlib.import_module("backend.main")
    with TestClient(module.app) as api:
        yield api


class ModelStub:
    """Local HTTP stub: useful for transport/failure tests, never model quality."""

    def __init__(self):
        self.responses = deque()
        self.requests = []
        owner = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *_args):
                pass

            def do_POST(self):
                length = int(self.headers.get("Content-Length", "0"))
                body = json.loads(self.rfile.read(length))
                owner.requests.append({"path": self.path, "body": body})
                status, payload, gate = owner.responses.popleft() if owner.responses else (
                    500, {"error": {"message": "Local test stub exhausted"}}, None
                )
                if gate is not None:
                    gate[0].set()
                    gate[1].wait(timeout=10)
                encoded = json.dumps(payload).encode("utf-8")
                self.send_response(status)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(encoded)))
                self.end_headers()
                try:
                    self.wfile.write(encoded)
                except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
                    pass

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    @property
    def base_url(self):
        return f"http://127.0.0.1:{self.server.server_port}/v1"

    def answer(self, content, gate=None):
        if not isinstance(content, str):
            content = json.dumps(content, ensure_ascii=False)
        self.responses.append((200, {
            "id": "local-test-response",
            "object": "chat.completion",
            "model": "local-stub-not-a-real-model",
            "choices": [{"index": 0, "message": {"role": "assistant", "content": content}, "finish_reason": "stop"}],
            "usage": {"prompt_tokens": 1, "completion_tokens": 1, "total_tokens": 2},
        }, gate))

    def fail(self, text):
        self.responses.append((500, {"error": {"message": text}}, None))

    def close(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=3)


@pytest.fixture
def model_stub():
    server = ModelStub()
    try:
        yield server
    finally:
        server.close()


@pytest.fixture
def live_server(data_root, tmp_path):
    """Start/stop a real process, retaining the same isolated on-disk data."""
    processes = []
    handles = []

    def start():
        with socket.socket() as probe:
            probe.bind(("127.0.0.1", 0))
            port = probe.getsockname()[1]
        log = (tmp_path / f"qa-server-{port}.log").open("wb")
        handles.append(log)
        env = os.environ.copy()
        env["TEACHER_DATA_DIR"] = str(data_root)
        process = subprocess.Popen(
            [sys.executable, "-m", "uvicorn", "backend.main:app", "--host", "127.0.0.1", "--port", str(port), "--log-level", "warning"],
            cwd=PROJECT_ROOT, env=env, stdout=log, stderr=subprocess.STDOUT,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
        processes.append(process)
        client = httpx.Client(base_url=f"http://127.0.0.1:{port}", timeout=12, trust_env=False)
        deadline = time.monotonic() + 15
        while time.monotonic() < deadline:
            if process.poll() is not None:
                client.close()
                pytest.fail(f"API process exited during startup; inspect {log.name}")
            try:
                response = client.get("/api/health")
                if response.status_code == 200:
                    return process, client
            except httpx.HTTPError:
                pass
            time.sleep(0.05)
        client.close()
        pytest.fail(f"API process did not become ready; inspect {log.name}")

    yield start
    for process in processes:
        if process.poll() is None:
            process.kill()
        process.wait(timeout=5)
    for handle in handles:
        handle.close()
