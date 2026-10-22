"""Black-box Windows launcher regression with an isolated, explicitly empty root."""
import hashlib
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import time

import httpx


def verify(executable, data_root):
    executable, data_root = Path(executable).resolve(), Path(data_root).resolve()
    assert executable.is_file()
    assert not data_root.exists(), 'Use a new isolated data directory.'
    data_root.mkdir(parents=True)
    with socket.socket() as probe:
        probe.bind(('127.0.0.1', 0))
        port = probe.getsockname()[1]
    env = os.environ.copy()
    env['TEACHER_DATA_DIR'] = str(data_root)
    env.update(HTTP_PROXY='http://127.0.0.1:9', HTTPS_PROXY='http://127.0.0.1:9', NO_PROXY='')
    command = [str(executable), '--port', str(port), '--no-browser']
    processes = []
    try:
        def spawn():
            process = subprocess.Popen(command, cwd=executable.parent, env=env,
                                       creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
            processes.append(process)
            return process
        first = spawn()
        with httpx.Client(base_url=f'http://127.0.0.1:{port}', trust_env=False, timeout=2) as client:
            deadline = time.monotonic() + 25
            while time.monotonic() < deadline:
                assert first.poll() is None, 'Candidate exited before ready.'
                try:
                    if client.get('/api/health').status_code == 200:
                        break
                except httpx.HTTPError:
                    pass
                time.sleep(0.1)
            else:
                raise AssertionError('Candidate did not become ready.')
            assert client.get('/api/health').json()['version'] == '0.2.0'
            assert client.get('/api/bootstrap', headers={'X-Workspace': 'personal'}).json()['students'] == []
            assert client.get('/').status_code == 200
            second = spawn()
            assert second.wait(timeout=8) == 0, 'Repeated launch should reuse the same server.'
            assert first.poll() is None
            assert client.get('/api/health').json()['ok'] is True
        return {'status': 'passed', 'exe_sha256': hashlib.sha256(executable.read_bytes()).hexdigest(),
                'first_start': True, 'repeat_launch_under_bad_proxy': True, 'personal_empty': True,
                'test_port': port, 'data_root': str(data_root)}
    finally:
        for process in processes:
            if process.poll() is None:
                process.terminate()
            process.wait(timeout=10)


if __name__ == '__main__':
    print(json.dumps(verify(*sys.argv[1:]), ensure_ascii=False, indent=2))
