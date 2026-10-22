# Mac portability review

- Date: 2026-10-04
- Scope: read-only review of backend storage/settings/media/demo, shared launcher, and Mac launch/stop wrappers. Only this QA receipt is written by the reviewer.
- Host used: Windows, Python 3.13.5. **This is not a Mac execution or acceptance receipt.**
- Result: no remaining source-level Mac blocker identified in the reviewed paths after the repeated-launch lock fix. Native runtime loading, Finder opening, permissions after extraction, browser launch, and end-to-end use still need a real Mac.

## Corrected during review

The original Mac launcher could let simultaneous Finder launches each pass the health and port checks, then replace the PID record with a second short-lived process. This could leave the first server running after the stop button cleared the dead PID. The root agent added an exclusive `fcntl.flock` around the complete start/stop operations in `scripts/macos/mac_entry.py:128-137`. The `--serve` branch returns before acquiring that lock (`123-127`), so the background server does not hold it for its lifetime. Static re-review confirmed the correction.

## Verified source behavior

| Area | Evidence | Finding |
| --- | --- | --- |
| Persistent Mac data | `scripts/macos/mac_entry.py:19,34-46` | Data is placed under `~/Library/Application Support/EnglishTeacherWorkspace/runtime`, with umask `077` and runtime directory mode `0700`. `TEACHER_DATA_DIR` is configured before importing the backend. Moving or replacing the application folder does not move this data. |
| Bundled Python imports | `scripts/macos/start.command:9-21`; `scripts/macos/mac_entry.py:37-41,98-101` | The shell selects an included architecture runtime, uses `-I`, and the entry explicitly adds the corresponding vendor directory and application directory. The child repeats the same isolated entry path. No package installation is performed by these launchers. |
| Student workspace separation | `backend/storage.py:51-68` | `demo` and `personal` use separate directories, SQLite files, and attachments. UUID-based stored filenames and `pathlib` are not tied to Windows path syntax. |
| Shared settings | `backend/storage.py:150-177` | Both workspaces deliberately use one runtime-level `settings.json`. API settings and the key are therefore shared across demo/personal, while student data is separate. |
| Mac API-key storage | `backend/storage.py:173-182` | Non-Windows writes the API key as plaintext JSON and applies file mode `0600`. This is file-permission protection, **not Keychain or at-rest encryption**. The runtime directory adds `0700` protection. No Keychain claim is supported. |
| Cross-machine keys | `backend/storage.py:156-162` | A Windows DPAPI-protected key becomes blank on Mac; it must be entered again. This is safe and does not prevent local non-AI use. |
| Public settings | `backend/storage.py:185-186`; `backend/main.py:444-458` | Settings API returns only a `has_api_key` flag, not the key. |
| Backup contents | `backend/main.py:478-499` | Application backup includes the selected workspace DB and originals. It does not add the shared API-key settings file. |
| Media and PDF fixtures | `backend/media.py:24-25,55-66`; `backend/library_media.py:18-38,51-57,146-155`; `backend/library_demo.py:10-24` | No Windows path, external OCR executable, or Windows system font is required in these paths. Fixture PDFs use PyMuPDF built-in text fonts. Runtime/native dependency compatibility remains a separate packaging check. |
| Frontend resource path | `backend/main.py:511-526` | Release layout must retain `app/frontend/dist/index.html` and `app/frontend/dist/assets` next to `app/backend`. |
| Interface font fallback | `frontend/src/styles.css:1` | Font stack ends in `system-ui,sans-serif`; missing Microsoft YaHei is not a functional blocker. Exact Mac typography still requires visual QA. |
| Stop process guard | `scripts/macos/mac_entry.py:49-75` | PID must be greater than 1, the stored entry must match this bundle, and the live command must include this entry and `--serve` before SIGTERM. Moved/replaced bundle paths may require using the original stop button or Activity Monitor; the code refuses to kill unrelated processes. |
| Loopback binding | `launch.py:75-79`; `backend/main.py:34-47` | Backend is bound to `127.0.0.1`; host/origin checks remain enabled. |

## Windows-host verification performed

1. Parsed `launch.py` and `scripts/macos/mac_entry.py` with Python's AST parser: PASS.
2. Checked Mac wrapper bytes: LF-only, no CRLF in `start.command`, `stop.command`, or `mac_entry.py`: PASS.
3. Exercised the non-Windows settings branch with a temporary non-ASCII/spaced directory and a dummy test value: plaintext roundtrip, shared demo/personal settings, API response redaction, blank key when opening a copied DPAPI record, and separate workspace paths: PASS.
4. POSIX file modes, `fcntl`, `/bin/ps`, signals, Finder behavior, native `.dylib` loading, and Safari/Chrome behavior were **not** executed on this Windows host.

## Final ZIP inspection

**PASS — static package inspection on Windows, not Mac execution.**

- Inspected artifact: `release/英语班主任工作台-Mac版-0.2.0-待实机验证.zip`.
- Size: **117,502,271 bytes**.
- SHA-256: **e3561e2f33f030cd11dc8f2401087b498ce037eaea4beb836e1204c2a6630abe**. Matches the packaging owner's expected artifact.
- ZIP CRC: all entries PASS. **5,023 unique entries**; no duplicate member names, absolute/traversal paths, or Windows path separators. Every entry carries Unix-origin metadata.
- Both `.command` launch/stop files: regular files, **0755**, LF-only, Bash shebang, UTF-8 filename flag.
- Both runtime Python executables: correct Mach-O CPU, preserved upstream **0775** executable mode. Runtime mode was inspected as actually packaged; it is not claimed to be 0755.
- **18 symbolic links**: relative targets resolve inside their own architecture runtime, with no dangling target, escape, cycle, or archive member written through a symlink parent.
- App layout: `app/backend`, `app/launch.py`, `app/mac_entry.py`, and `app/frontend/dist/index.html` plus JS/CSS assets are present. Packaged `mac_entry.py` exactly matches the reviewed source including its launch lock.
- Embedded source ZIP: CRC PASS, **50 entries**. Both the outer bundle and embedded source ZIP contain no runtime directory, backend data directory, `settings.json`, or student SQLite database/WAL/SHM files.

| Architecture | Native Mach-O files | Runtime / vendor split | Installed runtime dependencies | Dependency closure | Highest native deployment target |
| --- | ---: | --- | ---: | --- | --- |
| Apple Silicon `arm64` | 41 | 10 / 31 | 20 | PASS against packaged lock and wheel metadata | macOS 11.0.0 |
| Intel `x86_64` | 41 | 10 / 31 | 20 | PASS against packaged lock and wheel metadata | macOS 10.15.0 |

All **82** native files contain the expected architecture; runtime-native files contain only their assigned architecture. Key files checked include both Python interpreters, Pillow `_imaging`, Pydantic Core, and PyMuPDF `libmupdf.dylib`. These standalone CPython builds embed standard modules: `_ssl`, `_sqlite3`, `_ctypes`, `_socket`, and `zlib` names are present in the interpreter binaries. Missing separate standard-module `.so` files are not treated as a packaging defect; this inspection does not claim those imports were executed.

The deployment targets above are binary metadata, not an actual support test. ZIP inspection cannot establish Gatekeeper approval, Finder executable behavior after extraction, dynamic loading, browser behavior, or complete Mac acceptance. The package must retain its **待实机验证** status.
