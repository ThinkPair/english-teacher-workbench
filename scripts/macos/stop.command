#!/bin/bash
set -eu
umask 077
TASK_DIR="$(cd -- "$(dirname -- "$0")" && pwd -P)"
if [ "$(uname -s)" != "Darwin" ]; then printf '此启动包只适用于 Mac。\n'; exit 1; fi
TASK_ARCH="$(uname -m)"
if [ "$(/usr/sbin/sysctl -n hw.optional.arm64 2>/dev/null || true)" = "1" ]; then TASK_ARCH="arm64"; fi
case "$TASK_ARCH" in arm64|x86_64) ;; *) printf '暂不支持此芯片。\n'; exit 1 ;; esac
TASK_PY="$TASK_DIR/runtimes/$TASK_ARCH/python/bin/python3.13"
if "$TASK_PY" -I "$TASK_DIR/app/mac_entry.py" --stop; then exit 0; fi
read -r -p '按回车关闭。' || true
exit 1
