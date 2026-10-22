"""Read-only release ZIP review; never extract, execute, or read live teacher data.

Usage: python tests/verify_ui_packages.py --windows <zip> --mac <zip>
Only the requested Markdown review is written. Runtime dependencies named
``runtimes`` or ``sqlite3`` are not confused with user-data ``runtime`` folders
or SQLite database files.
"""
from __future__ import annotations

import argparse
import hashlib
import io
import json
from pathlib import Path, PurePosixPath
import re
import sys
from datetime import datetime, timezone
import zipfile


ROOT = Path(__file__).resolve().parents[1]
REVISION = "20261005.2"
SOURCE_TREES = {
    "backend": {".py"},
    "frontend/src": {".ts", ".tsx", ".css"},
    "scripts": {".py", ".ps1", ".command", ".txt"},
    "tests": {".py", ".cjs"},
}
REQUIRED_SOURCE = {
    "frontend/src/App.tsx", "frontend/src/styles.css",
    "frontend/src/ModalFrame.tsx", "frontend/src/Materials.tsx",
    "frontend/src/Practice.tsx", "frontend/src/library.css",
    "backend/main.py", "backend/schemas.py",
    "tests/test_ui_save_contract.py", "tests/verify_ui_packages.py",
}
TEXT_SUFFIXES = {".py", ".ts", ".tsx", ".js", ".css", ".html", ".json", ".md", ".txt", ".ps1", ".command"}
KEY_PATTERN = re.compile(rb"\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{24,}\b")
PRIVATE_KEY_PATTERN = re.compile(rb"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----")


def sha256_bytes(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


class Review:
    def __init__(self, platform: str, path: Path):
        self.platform, self.path = platform, path
        self.checks: list[dict] = []
        self.assets: list[dict] = []
        self.source_counts: dict[str, int] = {}
        self.archive_hash = ""
        self.archive_bytes = 0
        self.entries = 0

    def check(self, name: str, passed: bool, detail: str = "") -> None:
        self.checks.append({"name": name, "passed": bool(passed), "detail": detail})

    @property
    def passed(self) -> bool:
        return bool(self.checks) and all(item["passed"] for item in self.checks)


def archive_structure(archive: zipfile.ZipFile, result: Review, label: str) -> set[str]:
    members = [item.filename for item in archive.infolist() if not item.is_dir()]
    names = set(members)
    unsafe = [name for name in members if "\\" in name or PurePosixPath(name).is_absolute()
              or ".." in PurePosixPath(name).parts or re.match(r"^[A-Za-z]:", name)]
    result.check(label + " paths", not unsafe and len(names) == len(members),
                 "No unsafe or duplicate members" if not unsafe and len(names) == len(members)
                 else f"Unsafe: {unsafe}; duplicate count: {len(members) - len(names)}")
    bad = archive.testzip()
    result.check(label + " CRC", bad is None, "All entries decompressed and passed CRC" if bad is None else bad)
    return names


def sensitive_paths(names: set[str]) -> list[str]:
    blocked = []
    for name in sorted(names):
        path = PurePosixPath(name.lower())
        parts, leaf = path.parts, path.name
        forbidden_directory = bool({"runtime", ".run-data", "user-data", "student-data"} & set(parts))
        forbidden_directory |= any(parts[index:index + 2] == ("backend", "data") for index in range(len(parts) - 1))
        database = bool(re.search(r"\.(?:db|sqlite|sqlite3)(?:-(?:wal|shm|journal))?$", leaf))
        private_file = leaf in {"settings.json", "credentials.json", "secrets.json", "api_key.json", "api_keys.json", "api_key.txt", "api-key.txt", "private_key.pem"}
        private_file |= leaf == ".env" or leaf.startswith(".env.")
        if forbidden_directory or database or private_file:
            blocked.append(name)
    return blocked


def check_sensitive(archive: zipfile.ZipFile, names: set[str], result: Review, label: str) -> None:
    blocked = sensitive_paths(names)
    result.check(label + " private-data files", not blocked,
                 "No user runtime, settings, databases, environment or credential files" if not blocked else "; ".join(blocked))
    candidates = []
    for name in sorted(names):
        lowered = name.lower()
        parts = PurePosixPath(lowered).parts
        # Dependency distributions and intentional test fixtures are not evidence
        # of a teacher's live credentials. Their file paths are still checked.
        if any(part in {"runtimes", "vendor", "third_party_notices", "third_party_licenses", "tests"} for part in parts):
            continue
        if PurePosixPath(lowered).suffix not in TEXT_SUFFIXES:
            continue
        info = archive.getinfo(name)
        if info.file_size > 10 * 1024 * 1024:
            continue
        content = archive.read(info)
        if KEY_PATTERN.search(content) or PRIVATE_KEY_PATTERN.search(content):
            candidates.append(name)
    result.check(label + " credential-pattern scan", not candidates,
                 "No plausible sk-* credential or private-key header in application text" if not candidates else "Review required (values withheld): " + "; ".join(candidates))


def compare_tree(archive: zipfile.ZipFile, names: set[str], prefix: str,
                 local: Path, result: Review, label: str, record_assets: bool = False) -> None:
    expected = {file.relative_to(local).as_posix(): file for file in local.rglob("*") if file.is_file()}
    present = {name[len(prefix):] for name in names if name.startswith(prefix)}
    missing, extra = sorted(expected.keys() - present), sorted(present - expected.keys())
    result.check(label + " file set", bool(expected) and not missing and not extra,
                 f"{len(expected)} current files; missing={missing}; extra={extra}")
    mismatches = []
    for relative in sorted(expected.keys() & present):
        local_content, packaged_content = expected[relative].read_bytes(), archive.read(prefix + relative)
        if local_content != packaged_content:
            mismatches.append(relative)
        if record_assets:
            result.assets.append({"file": relative, "bytes": len(packaged_content), "sha256": sha256_bytes(packaged_content), "matches": local_content == packaged_content})
    result.check(label + " byte equality", not missing and not mismatches,
                 "All packaged bytes equal current workspace files" if not missing and not mismatches else f"Missing={missing}; changed={mismatches}")


def check_source(content: bytes, result: Review, revision: str) -> None:
    with zipfile.ZipFile(io.BytesIO(content)) as source:
        names = archive_structure(source, result, "Embedded source")
        check_sensitive(source, names, result, "Embedded source")
        missing_required = sorted("source/" + file for file in REQUIRED_SOURCE if "source/" + file not in names)
        result.check("Embedded source required UI/backend/tests", not missing_required,
                     "ModalFrame, UI modules, atomic-save backend and verifier present" if not missing_required else "; ".join(missing_required))
        for directory, extensions in SOURCE_TREES.items():
            expected = {"source/" + file.relative_to(ROOT).as_posix(): file
                        for file in (ROOT / directory).rglob("*")
                        if file.is_file() and file.suffix in extensions
                        and not {"__pycache__", ".run-data"} & set(file.parts)}
            prefix = "source/" + directory + "/"
            present = {name for name in names if name.startswith(prefix)}
            missing, extra = sorted(expected.keys() - present), sorted(present - expected.keys())
            changed = sorted(name for name in expected.keys() & present if source.read(name) != expected[name].read_bytes())
            result.source_counts[directory] = len(expected)
            result.check("Embedded source " + directory, bool(expected) and not missing and not extra and not changed,
                         f"{len(expected)} files; missing={missing}; extra={extra}; changed={changed}")
        metadata = json.loads(source.read("source/package-info.json"))
        result.check("Embedded source revision", metadata.get("package_revision") == revision,
                     str(metadata.get("package_revision")))


def inspect(platform: str, path: Path, revision: str) -> Review:
    result = Review(platform, path)
    try:
        if not path.is_file():
            result.check("Package exists", False, str(path))
            return result
        result.archive_bytes, result.archive_hash = path.stat().st_size, sha256_file(path)
        with zipfile.ZipFile(path) as archive:
            names = archive_structure(archive, result, "Package")
            result.entries = len(names)
            top = "EnglishTeacher" if platform == "Windows" else "EnglishTeacher-Mac"
            result.check("Package root", all(name.startswith(top + "/") for name in names), top)
            metadata_bytes = archive.read(top + "/package-info.json")
            metadata = json.loads(metadata_bytes)
            result.check("Package revision", metadata.get("package_revision") == revision, str(metadata.get("package_revision")))
            result.check("Package metadata byte equality", metadata_bytes == (ROOT / "package-info.json").read_bytes(), "Compared with current package-info.json")
            check_sensitive(archive, names, result, "Package")
            frontend_prefix = top + ("/_internal/frontend/dist/" if platform == "Windows" else "/app/frontend/dist/")
            compare_tree(archive, names, frontend_prefix, ROOT / "frontend/dist", result, "Frontend dist", True)
            source_member = top + ("/application-source.zip" if platform == "Windows" else "/应用源码.zip")
            check_source(archive.read(source_member), result, revision)
            if platform == "Mac":
                expected_backend = {"app/backend/" + file.relative_to(ROOT / "backend").as_posix(): file
                                    for file in (ROOT / "backend").rglob("*.py") if "__pycache__" not in file.parts}
                mismatch = [name for name, file in expected_backend.items()
                            if top + "/" + name not in names or archive.read(top + "/" + name) != file.read_bytes()]
                result.check("Mac runnable backend byte equality", not mismatch, f"{len(expected_backend)} Python files checked; mismatches={mismatch}")
                result.check("Mac native validation claim", metadata.get("mac_native_tested") is False,
                             "Remains explicitly unverified on a real Mac")
            else:
                executable = ROOT / "release/EnglishTeacher/EnglishTeacher.exe"
                result.check("Windows executable byte equality", executable.is_file() and archive.read(top + "/EnglishTeacher.exe") == executable.read_bytes(),
                             "Compared with the current release executable; no executable launched")
    except Exception as exc:
        result.check("Inspection completed", False, f"{type(exc).__name__}: {exc}")
    return result


def render_report(reviews: list[Review], revision: str) -> str:
    passed = all(result.passed for result in reviews)
    lines = ["# 双平台 UI 安装包独立完整性复核", "",
             f"结论：{'PASS' if passed else 'FAIL'}；预期 package_revision：`{revision}`。",
             f"复核时间（UTC）：{datetime.now(timezone.utc).isoformat(timespec='seconds')}", "",
             "此检查直接读取 ZIP 与嵌套源码，不解压、不启动程序、不调用 AI、不读取正式学生资料。", ""]
    for result in reviews:
        lines += [f"## {result.platform}：{'PASS' if result.passed else 'FAIL'}", "",
                  f"- 文件：`{result.path}`", f"- 大小：{result.archive_bytes:,} 字节；文件条目：{result.entries:,}",
                  f"- SHA-256：`{result.archive_hash}`", "",
                  "| 检查 | 结果 | 证据 |", "|---|---|---|"]
        for check in result.checks:
            detail = check["detail"].replace("|", "\\|").replace("\n", " ")
            lines.append(f"| {check['name']} | {'PASS' if check['passed'] else 'FAIL'} | {detail} |")
        lines += ["", "前端资产逐字节比较：", "", "| 文件 | 字节 | SHA-256 | 与当前一致 |", "|---|---:|---|---|"]
        for asset in result.assets:
            lines.append(f"| `{asset['file']}` | {asset['bytes']} | `{asset['sha256']}` | {'是' if asset['matches'] else '否'} |")
        lines.append("")
    lines += ["## 检查边界", "",
              "- `runtime/` 用户目录、settings.json、SQLite 数据库、环境配置和凭据文件均按归档路径检查；Mac 的 `runtimes/` Python 运行组件及 sqlite 动态库属于合法依赖。",
              "- 应用文本另扫描常见 sk-* 密钥格式及私钥头；不输出匹配值。第三方依赖与测试夹具不做密钥模式推断，但仍检查敏感文件路径。此扫描不证明任意未知格式秘密绝不可能存在。",
              "- 内嵌源码逐字节比较当前 backend、frontend/src、scripts、tests；前端检查同时要求文件集合相同，避免残留旧 bundle。",
              "- Windows 可执行文件只与当前 release 成品比较，本检查不重新证明二进制编译过程；Mac 仍为待实机验证包。", ""]
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--windows", type=Path, default=ROOT / "release/英语班主任工作台-Windows-0.2.0.zip")
    parser.add_argument("--mac", type=Path, default=ROOT / "release/英语班主任工作台-Mac版-0.2.0-待实机验证.zip")
    parser.add_argument("--revision", default=REVISION)
    parser.add_argument("--report", type=Path, default=ROOT / "tests/UI_PACKAGE_REVIEW.md")
    args = parser.parse_args()
    reviews = [inspect("Windows", args.windows.resolve(), args.revision), inspect("Mac", args.mac.resolve(), args.revision)]
    args.report.write_text(render_report(reviews, args.revision), encoding="utf-8")
    print(json.dumps({"passed": all(item.passed for item in reviews), "revision": args.revision,
                      "report": str(args.report.resolve()),
                      "packages": [{"platform": item.platform, "passed": item.passed, "sha256": item.archive_hash,
                                    "checks": len(item.checks), "failures": [check for check in item.checks if not check["passed"]]}
                                   for item in reviews]}, ensure_ascii=False, indent=2))
    return 0 if all(item.passed for item in reviews) else 1


if __name__ == "__main__":
    sys.exit(main())
