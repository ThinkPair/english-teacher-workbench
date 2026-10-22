#!/bin/bash
set -eu
umask 077
TASK_DIR="$(cd -- "$(dirname -- "$0")" && pwd -P)"
if [ "$(uname -s)" != "Darwin" ]; then
  printf '此启动包只适用于 Mac。\n'
  exit 1
fi
TASK_ARCH="$(uname -m)"
if [ "$(/usr/sbin/sysctl -n hw.optional.arm64 2>/dev/null || true)" = "1" ]; then
  TASK_ARCH="arm64"
fi
case "$TASK_ARCH" in arm64|x86_64) ;; *) printf '暂不支持此芯片。\n'; exit 1 ;; esac
TASK_PY="$TASK_DIR/runtimes/$TASK_ARCH/python/bin/python3.13"
if [ ! -x "$TASK_PY" ]; then
  printf '内置运行环境不完整。请用 Mac 的归档实用工具重新完整解压 ZIP。\n'
  read -r -p '按回车关闭。' || true
  exit 1
fi
printf '正在打开英语班主任工作台……\n'
if "$TASK_PY" -I "$TASK_DIR/app/mac_entry.py"; then
  exit 0
else
  printf '\n本包尚未通过 Mac 实机验收。请保留上方错误提示。\n'
  read -r -p '按回车关闭。' || true
  exit 1
fi
