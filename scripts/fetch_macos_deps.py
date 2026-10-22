"""Fetch pinned, verified macOS runtimes/wheels without executing foreign code.

Run using the existing Windows build venv. Archives stay intact so the release
builder can transfer POSIX modes and symbolic links directly into the Mac ZIP.
"""
from __future__ import annotations

import concurrent.futures
import email
import hashlib
import importlib.metadata
import json
import os
from pathlib import Path, PurePosixPath
import posixpath
import re
import struct
import subprocess
import sys
import tarfile
import urllib.parse
import urllib.request
import zipfile

from packaging.markers import default_environment
from packaging.requirements import Requirement
from packaging.tags import mac_platforms
from packaging.utils import canonicalize_name, parse_wheel_filename
from packaging.version import Version

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "build" / "macos-deps"
TAG = "20261003"
PYTHON = "3.13.16"
RELEASE_API = f"https://api.github.com/repos/astral-sh/python-build-standalone/releases/tags/{TAG}"
USER_AGENT = "EnglishTeacher-offline-release-build/1.0"
ARCHES = {"arm64": "aarch64", "x86_64": "x86_64"}


def fetch_json(url: str) -> dict:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=60) as response:
        return json.load(response)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def download(url: str, target: Path, expected: str) -> None:
    if target.exists() and sha256(target) == expected:
        print(f"Verified cached {target.name}", flush=True)
        return
    target.parent.mkdir(parents=True, exist_ok=True)
    temp = target.with_suffix(target.suffix + ".part")
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=90) as response, temp.open("wb") as f:
        for chunk in iter(lambda: response.read(1024 * 1024), b""):
            f.write(chunk)
    if sha256(temp) != expected:
        raise RuntimeError(f"SHA256 mismatch: {target.name}")
    temp.replace(target)
    print(f"Downloaded and verified {target.name}", flush=True)


def dump(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def env(arch: str) -> dict:
    value = default_environment()
    value.update(os_name="posix", sys_platform="darwin", platform_system="Darwin",
                 platform_machine=arch, python_version="3.13", python_full_version=PYTHON,
                 implementation_name="cpython", implementation_version=PYTHON,
                 platform_python_implementation="CPython", extra="")
    return value


def runtime_requirements() -> dict[str, str]:
    """Resolve the backend-only closure from installed package metadata and lock."""
    locked = {}
    for line in (ROOT / "requirements-lock.txt").read_text(encoding="utf-8-sig").splitlines():
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        req = Requirement(line)
        locked[canonicalize_name(req.name)] = next(iter(req.specifier)).version
    pending = [Requirement(line).name for line in (ROOT / "requirements.txt").read_text().splitlines()
               if line.strip() and not line.lstrip().startswith("#")]
    resolved = {}
    environment = env("arm64")
    while pending:
        name = canonicalize_name(pending.pop())
        if name in resolved:
            continue
        dist = importlib.metadata.distribution(name)
        if dist.version != locked[name]:
            raise RuntimeError(f"Installed/lock version mismatch: {name}")
        resolved[name] = locked[name]
        for text in dist.requires or []:
            requirement = Requirement(text)
            if requirement.marker and not requirement.marker.evaluate(environment):
                continue
            dep_name = canonicalize_name(requirement.name)
            if dep_name not in locked or Version(locked[dep_name]) not in requirement.specifier:
                raise RuntimeError(f"Missing/incompatible locked requirement: {text}")
            pending.append(dep_name)
    excluded = {"pyinstaller", "pytest", "pefile", "colorama", "pywin32-ctypes"}
    if excluded & resolved.keys():
        raise RuntimeError("Unexpected Windows/build/test dependency in runtime closure")
    return dict(sorted(resolved.items()))


def safe_path(name: str) -> str:
    path = PurePosixPath(name)
    if not name or "\\" in name or path.is_absolute() or ".." in path.parts or ":" in path.parts[0]:
        raise RuntimeError(f"Unsafe archive path: {name!r}")
    return str(path)


def version_tuple(encoded: int) -> tuple[int, int, int]:
    return encoded >> 16, (encoded >> 8) & 0xFF, encoded & 0xFF


def macho(data: bytes) -> list[dict]:
    """Read CPU and deployment-target commands; never load/execute a binary."""
    if len(data) < 32:
        return []
    magic = data[:4]
    if magic in (b"\xca\xfe\xba\xbe", b"\xca\xfe\xba\xbf"):
        count = struct.unpack_from(">I", data, 4)[0]
        size = 32 if magic[-1] == 0xBF else 20
        result = []
        for i in range(count):
            off = 8 + i * size
            if size == 32:
                _, _, start, length, _, _ = struct.unpack_from(">IIQQII", data, off)
            else:
                _, _, start, length, _ = struct.unpack_from(">IIIII", data, off)
            result.extend(macho(data[start:start + length]))
        return result
    if magic not in (b"\xcf\xfa\xed\xfe", b"\xfe\xed\xfa\xcf", b"\xce\xfa\xed\xfe", b"\xfe\xed\xfa\xce"):
        return []
    endian = "<" if magic[0] in (0xCF, 0xCE) else ">"
    is64 = magic in (b"\xcf\xfa\xed\xfe", b"\xfe\xed\xfa\xcf")
    _, cpu, subtype, filetype, count, command_bytes, _ = struct.unpack_from(endian + "7I", data)
    arch = {0x01000007: "x86_64", 0x0100000C: "arm64"}.get(cpu, hex(cpu))
    offset = 32 if is64 else 28
    targets = []
    deps = []
    rpaths = []
    for _ in range(count):
        command, size = struct.unpack_from(endian + "II", data, offset)
        if size < 8 or offset + size > len(data):
            raise RuntimeError("Malformed Mach-O load command")
        if command == 0x24:  # LC_VERSION_MIN_MACOSX
            targets.append(version_tuple(struct.unpack_from(endian + "I", data, offset + 8)[0]))
        elif command == 0x32:  # LC_BUILD_VERSION
            platform, target = struct.unpack_from(endian + "II", data, offset + 8)
            if platform == 1:
                targets.append(version_tuple(target))
        elif command in (0xC, 0x18, 0x80000018, 0x1F, 0x8000001F, 0x20, 0x80000020, 0x23):
            string_offset = struct.unpack_from(endian + "I", data, offset + 8)[0]
            deps.append(data[offset + string_offset:offset + size].split(b"\0", 1)[0].decode("utf-8"))
        elif command == 0x8000001C:
            string_offset = struct.unpack_from(endian + "I", data, offset + 8)[0]
            rpaths.append(data[offset + string_offset:offset + size].split(b"\0", 1)[0].decode("utf-8"))
        offset += size
    return [{"architecture": arch, "minimum_macos": ".".join(map(str, max(targets))) if targets else None,
             "filetype": filetype, "dylib_dependencies": deps, "rpaths": rpaths}]


def inspect_tar(path: Path, arch: str) -> dict:
    entries, links, native = [], [], []
    with tarfile.open(path, "r:gz") as archive:
        members = archive.getmembers()
        names = set()
        link_paths = set()
        for item in members:
            name = safe_path(item.name)
            if name != "python" and not name.startswith("python/"):
                raise RuntimeError(f"Unexpected runtime prefix: {name}")
            if name in names:
                raise RuntimeError(f"Duplicate tar member: {name}")
            names.add(name)
            if item.issym() or item.islnk():
                if "\\" in item.linkname or PurePosixPath(item.linkname).is_absolute():
                    raise RuntimeError(f"Unsafe tar link: {name}")
                target = posixpath.normpath(posixpath.join(posixpath.dirname(name), item.linkname) if item.issym() else item.linkname)
                if target != "python" and not target.startswith("python/"):
                    raise RuntimeError(f"Tar link escapes runtime: {name} -> {target}")
                links.append({"path": name, "target": item.linkname, "resolved_target": target,
                              "type": "symlink" if item.issym() else "hardlink", "mode": oct(item.mode)})
                link_paths.add(name)
            elif not item.isfile() and not item.isdir():
                raise RuntimeError(f"Unsupported tar member type: {name}")
            entries.append({"path": name, "type": "file" if item.isfile() else "directory" if item.isdir() else "link", "mode": oct(item.mode), "size": item.size})
            if item.isfile():
                stream = archive.extractfile(item)
                prefix = stream.read(4)
                if prefix in (b"\xcf\xfa\xed\xfe", b"\xfe\xed\xfa\xcf", b"\xce\xfa\xed\xfe", b"\xfe\xed\xfa\xce", b"\xca\xfe\xba\xbe", b"\xca\xfe\xba\xbf"):
                    for info in macho(prefix + stream.read()):
                        if info["architecture"] != arch:
                            raise RuntimeError(f"Wrong runtime architecture: {name}: {info['architecture']}")
                        native.append({"path": name, **info})
        for item in entries:
            if any(str(parent) in link_paths for parent in PurePosixPath(item["path"]).parents):
                raise RuntimeError(f"Tar member traverses link: {item['path']}")
        for link in links:
            if link["resolved_target"] not in names:
                raise RuntimeError(f"Dangling runtime link: {link}")
    exe = next((x for x in entries if x["path"] == "python/bin/python3.13"), None)
    if not exe or not int(exe["mode"], 8) & 0o111:
        raise RuntimeError("Missing/executable-mode-invalid Python interpreter")
    if not native:
        raise RuntimeError("No Mach-O binaries found in runtime")
    minimum = max((tuple(map(int, x["minimum_macos"].split("."))) for x in native if x["minimum_macos"]), default=(0,))
    return {"members": entries, "links": links, "native_binaries": native,
            "minimum_macos": ".".join(map(str, minimum)), "member_count": len(entries),
            "native_binary_count": len(native), "symlink_count": sum(x["type"] == "symlink" for x in links),
            "path_safety": "pass", "architecture_validation": "pass", "interpreter_mode": exe["mode"]}


def inspect_wheel(path: Path, arch: str, resolved: dict[str, str]) -> dict:
    distribution, version, _, tags = parse_wheel_filename(path.name)
    native = []
    with zipfile.ZipFile(path) as wheel:
        names = set()
        for item in wheel.infolist():
            safe_path(item.filename)
            if item.filename in names:
                raise RuntimeError(f"Duplicate wheel member: {item.filename}")
            names.add(item.filename)
            mode = (item.external_attr >> 16) & 0xFFFF
            if mode & 0o170000 == 0o120000:
                raise RuntimeError(f"Unsupported symbolic link in wheel: {item.filename}")
            if item.is_dir():
                continue
            with wheel.open(item) as f:
                prefix = f.read(4)
                if prefix in (b"\xcf\xfa\xed\xfe", b"\xfe\xed\xfa\xcf", b"\xce\xfa\xed\xfe", b"\xfe\xed\xfa\xce", b"\xca\xfe\xba\xbe", b"\xca\xfe\xba\xbf"):
                    info = macho(prefix + f.read())
                    if arch not in {x["architecture"] for x in info}:
                        raise RuntimeError(f"Wheel binary lacks {arch}: {item.filename}")
                    native.extend({"path": item.filename, **x} for x in info if x["architecture"] == arch)
        metadata_path = next(x for x in names if x.endswith(".dist-info/METADATA"))
        metadata = email.message_from_bytes(wheel.read(metadata_path))
        dependencies = []
        for text in metadata.get_all("Requires-Dist", []):
            req = Requirement(text)
            if req.marker and not req.marker.evaluate(env(arch)):
                continue
            dependency = canonicalize_name(req.name)
            if dependency not in resolved or Version(resolved[dependency]) not in req.specifier:
                raise RuntimeError(f"Unmet wheel runtime dependency: {path.name}: {text}")
            dependencies.append(text)
    minimums = [tuple(map(int, x["minimum_macos"].split("."))) for x in native if x["minimum_macos"]]
    for tag in tags:
        match = re.match(r"macosx_(\d+)_(\d+)_", tag.platform)
        if match:
            minimums.append(tuple(map(int, match.groups())) + (0,))
    return {"name": str(distribution), "version": str(version), "filename": path.name,
            "archive": str(path.relative_to(ROOT)).replace("\\", "/"), "size_bytes": path.stat().st_size,
            "sha256": sha256(path), "wheel_tags": sorted(map(str, tags)), "runtime_dependencies": dependencies,
            "minimum_macos": ".".join(map(str, max(minimums))) if minimums else None,
            "path_safety": "pass", "native_binaries": native}


def audit_dynamic_links(arch: str, runtime: dict, wheels: list[dict]) -> dict:
    runtime_inspection = json.loads((ROOT / runtime["inspection"]).read_text(encoding="utf-8"))
    groups = [("runtime", {x["path"] for x in runtime_inspection["members"]}, runtime_inspection["native_binaries"])]
    for wheel in wheels:
        with zipfile.ZipFile(ROOT / wheel["archive"]) as archive:
            names = set(archive.namelist())
        groups.append((wheel["name"], names, wheel["native_binaries"]))
    checked, unused_absolute_rpaths = [], []
    for group, names, binaries in groups:
        for binary in binaries:
            def expand(value: str) -> str:
                value = value.replace("@loader_path", posixpath.dirname(binary["path"]))
                if group == "runtime":
                    value = value.replace("@executable_path", "python/bin")
                return posixpath.normpath(value)
            for rpath in binary["rpaths"]:
                if rpath.startswith("/") and not rpath.startswith(("/usr/lib/", "/System/Library/")):
                    unused_absolute_rpaths.append({"package": group, "path": binary["path"], "rpath": rpath})
            for dep in binary["dylib_dependencies"]:
                if dep.startswith(("/usr/lib/", "/System/Library/")):
                    continue
                if dep.startswith("@rpath/"):
                    candidates = [posixpath.join(expand(value), dep[len("@rpath/"):]) for value in binary["rpaths"]]
                    if group == "runtime":
                        candidates.append(posixpath.join("python/lib", dep[len("@rpath/"):]))
                else:
                    candidates = [expand(dep)]
                found = next((posixpath.normpath(value) for value in candidates if posixpath.normpath(value) in names), None)
                if found is None:
                    raise RuntimeError(f"Unresolved bundled dylib: {arch} {group} {binary['path']} -> {dep}")
                checked.append({"package": group, "binary": binary["path"], "dependency": dep, "resolved": found})
    return {"status": "pass", "architecture": arch, "resolved_bundled_links": checked,
            "unused_build_machine_rpaths": unused_absolute_rpaths,
            "note": "All non-system dylib dependencies resolve inside their archive; upstream Pillow retains unused build-machine rpaths."}


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    resolved = runtime_requirements()
    lock = ROOT / "requirements-macos.lock"
    lock.write_text("# Backend runtime only; exact versions from requirements-lock.txt.\n"
                    "# macOS CPython 3.13; wheels only; no Windows, build or test dependencies.\n"
                    + "".join(f"{k}=={v}\n" for k, v in resolved.items()), encoding="utf-8")
    print(f"Resolved {len(resolved)} runtime packages", flush=True)
    release = fetch_json(RELEASE_API)
    dump(OUT / "release-metadata.json", release)
    assets = {a["name"]: a for a in release["assets"]}
    sums_asset = assets["SHA256SUMS"]
    download(sums_asset["browser_download_url"], OUT / "SHA256SUMS", sums_asset["digest"].split(":", 1)[1])
    checksums = {}
    for line in (OUT / "SHA256SUMS").read_text().splitlines():
        checksum, name = line.split(None, 1)
        checksums[name.lstrip("*")] = checksum

    def fetch_runtime(arch: str) -> dict:
        filename = f"cpython-{PYTHON}+{TAG}-{ARCHES[arch]}-apple-darwin-install_only_stripped.tar.gz"
        asset = assets[filename]
        expected = checksums[filename]
        if asset["digest"] != "sha256:" + expected:
            raise RuntimeError("GitHub API and SHA256SUMS disagree")
        target = OUT / "runtimes" / filename
        download(asset["browser_download_url"], target, expected)
        inspected = inspect_tar(target, arch)
        dump(OUT / f"runtime-{arch}-inspection.json", inspected)
        return {"archive": str(target.relative_to(ROOT)).replace("\\", "/"), "filename": filename,
                "source_url": asset["browser_download_url"], "sha256": expected,
                "size_bytes": target.stat().st_size, "python_version": PYTHON,
                "minimum_macos": inspected["minimum_macos"], "interpreter_mode": inspected["interpreter_mode"],
                "symlink_count": inspected["symlink_count"], "native_binary_count": inspected["native_binary_count"],
                "inspection": str((OUT / f"runtime-{arch}-inspection.json").relative_to(ROOT)).replace("\\", "/")}

    def fetch_pypi(item: tuple[str, str]) -> tuple[str, dict]:
        name, version = item
        metadata = fetch_json(f"https://pypi.org/pypi/{name}/{version}/json")
        dump(OUT / "pypi-metadata" / f"{name}-{version}.json", metadata)
        return name, metadata

    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        runtime_futures = {arch: pool.submit(fetch_runtime, arch) for arch in ARCHES}
        pypi_metadata = dict(pool.map(fetch_pypi, resolved.items()))
        runtimes = {arch: future.result() for arch, future in runtime_futures.items()}

    def fetch_wheels(arch: str) -> list[dict]:
        destination = OUT / "wheels" / arch
        destination.mkdir(parents=True, exist_ok=True)
        command = [sys.executable, "-m", "pip", "--isolated", "download", "--disable-pip-version-check",
                   "--only-binary=:all:", "--no-deps", "--index-url", "https://pypi.org/simple",
                   "--python-version", "3.13", "--implementation", "cp", "--abi", "cp313",
                   "--dest", str(destination), "-r", str(lock)]
        for platform in mac_platforms(version=(11, 0), arch=arch):
            command.extend(["--platform", platform])
        completed = subprocess.run(command, capture_output=True, text=True, encoding="utf-8", errors="replace")
        (OUT / f"pip-download-{arch}.log").write_text(completed.stdout + completed.stderr, encoding="utf-8")
        if completed.returncode:
            raise RuntimeError(f"pip download failed for {arch}: {(completed.stdout + completed.stderr)[-6000:]}")
        inspected = []
        for wheel in sorted(destination.glob("*.whl")):
            name, version, _, _ = parse_wheel_filename(wheel.name)
            if name not in resolved or str(version) != resolved[name]:
                raise RuntimeError(f"Unexpected stale wheel: {wheel.name}")
            record = next((x for x in pypi_metadata[name]["urls"] if x["filename"] == wheel.name), None)
            if not record or record.get("yanked") or sha256(wheel) != record["digests"]["sha256"]:
                raise RuntimeError(f"PyPI wheel verification failed: {wheel.name}")
            if urllib.parse.urlparse(record["url"]).hostname != "files.pythonhosted.org":
                raise RuntimeError("Unexpected package host")
            inspected.append({**inspect_wheel(wheel, arch, resolved), "source_url": record["url"],
                              "pypi_json_url": f"https://pypi.org/pypi/{name}/{version}/json",
                              "pypi_sha256_verified": True})
        if {x["name"] for x in inspected} != set(resolved) or len(inspected) != len(resolved):
            raise RuntimeError("Wheel inventory does not equal runtime closure")
        dump(OUT / f"wheels-{arch}-manifest.json", inspected)
        print(f"Verified {len(inspected)} {arch} wheels", flush=True)
        return inspected

    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        futures = {arch: pool.submit(fetch_wheels, arch) for arch in ARCHES}
        wheels = {arch: future.result() for arch, future in futures.items()}
    manifest = {"schema_version": 1, "status": "downloaded_and_statically_verified",
                "macos_executed": False, "release_tag": TAG, "release_api": RELEASE_API,
                "release_page": f"https://github.com/astral-sh/python-build-standalone/releases/tag/{TAG}",
                "python_version": PYTHON, "runtime_package_count": len(resolved),
                "runtime_requirements": resolved, "architectures": {}}
    for arch in ARCHES:
        audit = audit_dynamic_links(arch, runtimes[arch], wheels[arch])
        dump(OUT / f"dynamic-links-{arch}-audit.json", audit)
        versions = [runtimes[arch]["minimum_macos"]] + [x["minimum_macos"] for x in wheels[arch] if x["minimum_macos"]]
        minimum = max(tuple(map(int, value.split("."))) for value in versions)
        manifest["architectures"][arch] = {"minimum_macos": ".".join(map(str, minimum)),
                "runtime": runtimes[arch], "wheels": wheels[arch], "dynamic_links": "pass",
                "dynamic_link_audit": str((OUT / f"dynamic-links-{arch}-audit.json").relative_to(ROOT)).replace("\\", "/")}
    dump(OUT / "manifest.json", manifest)
    print(json.dumps({"manifest": str(OUT / "manifest.json"), "architectures": {arch: {"minimum_macos": data["minimum_macos"], "wheel_count": len(data["wheels"])} for arch, data in manifest["architectures"].items()}}, indent=2), flush=True)


if __name__ == "__main__":
    main()
