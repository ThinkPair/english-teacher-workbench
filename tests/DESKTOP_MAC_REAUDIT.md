# Desktop Mac delivery re-audit

- Date: 2026-10-05.
- Reviewer scope: read-only product/source/archive inspection. Wrote only this receipt and isolated checks under `build/mac-reaudit/`.
- Host: Windows. **No Mach-O executable or library was executed or loaded. No real runtime, running service, or port 8769 was touched.**
- Artifact inspected: desktop `英语班主任工作台-Mac版-0.2.0-待实机验证.zip`.
- Final checked revision: `20261005.1`.
- Final SHA-256: `fa5719859f37f31282077570991df2aed7943e3a2c2af181663b3db2fcc2f7f6`.
- Final size: 117,521,205 bytes; 5,024 archive entries.
- Result: **PASS for the static and mocked checks below; Mac native acceptance remains pending.**

## Source mismatch corrected and reverified

The embedded `应用源码.zip` in the initial desktop artifact (SHA-256 `e3561e2f33f030cd11dc8f2401087b498ce037eaea4beb836e1204c2a6630abe`, 117,502,271 bytes) had only 50 files. It omitted the Mac entry program (`scripts/macos/mac_entry.py`), both `.command` wrappers, the Mac-specific user instructions, and `requirements-macos.lock`. It also predated the current launcher fix. This was a real delivery/source mismatch, not a speculative Mac execution concern.

The root agent corrected the explicit source archive allowlist and rebuilt the release. The final desktop ZIP above was then independently reopened and verified:

- Outer and embedded source ZIP CRC both pass. The source ZIP now has **61 files** and contains the missing Mac files, the shared source builder, the packaging script, and revision `20261005.1`.
- All **14 runtime Python source files** in the outer app tree exactly match both the nested source ZIP and the current project files, including `mac_entry.py`, the proxy-independent `launch.py`, and every backend module.
- Start/stop wrappers, Mac instructions, macOS dependency lock, and the shared manual exactly match their nested source copies. Every delivered frontend build file exactly matches the final local frontend build.
- Both outer and inner inventories contain no `runtime` data directory, backend `data` directory, settings file, student SQLite/database/WAL/SHM file, PID record, or application/startup log. Paths and unique names pass again.
- Both `.command` entries are regular Unix files with **0755**, LF endings, and UTF-8 names in the final ZIP. This checks archive metadata; it does not claim Finder execution was tested.
- Repeated all runtime/wheel comparisons and native-link resolution on the final ZIP: **1,655/1,652 runtime entries**, **810 vendor files per architecture**, **82 native architecture slices**, and **62 resolved bundled dynamic-library references**, with no mismatch or extra runtime/vendor file.
- The final packaging source now adds only the runtime/wheel paths from the verified manifest, eliminating the prior wildcard route that could have included an unverified extra wheel.

## Independent static checks of the initial actual ZIP

1. ZIP CRC passes for all entries. No duplicate member names, absolute paths, traversal segments, or Windows path separators. Entries retain Unix origin metadata.
2. Both architecture vendor trees were compared byte-for-byte with the wheel archives identified by the package manifest. Each tree has 810 compared wheel files; no differences. Wheel archive SHA-256 values match the verified manifest.
3. Both runtime trees were compared byte-for-byte and mode-for-mode with their manifest-listed, SHA-256-verified upstream TAR archives: 1,655 arm64 entries and 1,652 x86_64 entries, including symlink payloads. No differences.
4. Relative symlink targets resolve to package members within the assigned runtime. The executable wrappers retain 0755 and LF line endings.
5. Parsed the actual packaged Mach-O headers and commands without loading foreign code: 82 native architecture slices match their assigned architecture. All 62 non-system dynamic-library dependencies resolve to actual ZIP members after expanding each image's `@loader_path`, `@executable_path`, and relevant executable `LC_RPATH`. No missing bundled dynamic library was found.
6. Both interpreter binaries contain the built-in initialization symbol names for `fcntl`, `_posixsubprocess`, `_ssl`, `_sqlite3`, and `_socket`. This confirms the expected symbols exist, not that their imports execute successfully on a Mac.
7. The application inserts only its assigned vendor and app paths ahead of the isolated interpreter's standard paths. The child's command uses the bundled `sys.executable`, `-I`, the exact entry path, and `--serve`; no package installation or system Python fallback is used.
8. The Mac instructions match the source's dedicated Application Support data path, shared settings across the two isolated workspaces, explicit AI calls, local selection of confirmed questions, separate student/teacher print views, and separate backup action. They correctly distinguish file permissions from Keychain encryption and explicitly retain the pending-Mac-validation status.

## Mocked launcher checks

Ran `build/mac-reaudit/check_launcher_logic.py` with Windows Python. All process operations, port operations, and browser calls were mocked. The script used and removed an isolated temporary directory under `build/mac-reaudit/`.

Seven checks passed:

- Existing healthy service opens the browser without spawning a duplicate.
- Occupied port prevents process launch.
- Child arguments and PID record preserve the exact path, including Chinese characters and spaces.
- A record belonging to another bundle is rejected before process inspection or signalling.
- A PID now belonging to an unrelated command is never signalled.
- A verified owned child receives SIGTERM and its PID record is removed after exit.
- Missing PID record is a safe no-op.

No additional P1/P2 launcher, dependency, or path defect was found in this review. The source-delivery mismatch sent to the root agent is corrected and verified in the final ZIP. That conclusion is limited to the inspected paths and checks.

## Still requires real Mac acceptance

Finder/Archive Utility behavior and permissions after extraction, quarantine/Gatekeeper prompts, native module loading, actual process signals and lifecycle, browser launch, printing, configured model connectivity, and a complete saved-data restart flow remain unexecuted. The package must remain marked **待实机验证** until those checks are performed on a real Mac.
