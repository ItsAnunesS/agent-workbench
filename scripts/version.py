#!/usr/bin/env python3
"""Keep application versions aligned and prepare release notes without dependencies."""
import argparse
import datetime
import json
import pathlib
import re
import subprocess

ROOT = pathlib.Path(__file__).resolve().parents[1]
SEMVER = re.compile(r"^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$")
VERSION_FILES = ["package.json", "package-lock.json", "src-tauri/Cargo.toml", "src-tauri/Cargo.lock", "src-tauri/tauri.conf.json", "CHANGELOG.md"]


def current_version(root=ROOT):
    package = json.loads((root / "package.json").read_text())
    version = package["version"]
    lock = json.loads((root / "package-lock.json").read_text())
    native = re.search(r'(?ms)^\[package\].*?^version = "([^"]+)"', (root / "src-tauri/Cargo.toml").read_text()).group(1)
    cargo_lock = re.search(r'(?m)^name = "agent-workbench"\nversion = "([^"]+)"', (root / "src-tauri/Cargo.lock").read_text()).group(1)
    tauri = json.loads((root / "src-tauri/tauri.conf.json").read_text())["version"]
    if not SEMVER.fullmatch(version) or len({version, lock["version"], lock["packages"][""]["version"], native, cargo_lock, tauri}) != 1:
        raise ValueError("Application versions must match in package, npm lockfile, Cargo package/lock and Tauri configuration")
    return version


def next_version(version, bump):
    if not SEMVER.fullmatch(version):
        raise ValueError("Expected X.Y.Z")
    major, minor, patch = map(int, version.split("."))
    if bump == "current": return version
    if bump == "patch": return f"{major}.{minor}.{patch + 1}"
    if bump == "minor": return f"{major}.{minor + 1}.0"
    if bump == "major": return f"{major + 1}.0.0"
    raise ValueError("Unknown bump")


def prepare(bump, root=ROOT, today=None, target_version=None, generated_notes=None):
    old = current_version(root)
    version = target_version or next_version(old, bump)
    if target_version and (not SEMVER.fullmatch(version) or tuple(map(int, version.split("."))) <= tuple(map(int, old.split(".")))):
        raise ValueError("The planned release version must be newer than the current version")
    changelog_path = root / "CHANGELOG.md"
    changelog = changelog_path.read_text()
    if bump != "current" or target_version:
        marker = "## [Unreleased]\n"
        if marker not in changelog: raise ValueError("CHANGELOG.md needs an Unreleased section")
        if f"## [{version}]" in changelog: raise ValueError("Version already exists in CHANGELOG.md")
        after = changelog.split(marker, 1)[1]
        upcoming = after.split("\n## [", 1)[0].strip()
        if generated_notes:
            # semantic-release includes a version heading; the changelog already owns that heading.
            generated = re.sub(r"\A#{1,2} [^\n]+\n+", "", generated_notes.strip()).strip()
            upcoming = "\n\n".join(part for part in [upcoming, generated] if part)
        if not upcoming:
            upcoming = "### Changed\n\n- Maintenance release. See the tagged commit history for details."
        date = today or datetime.date.today().isoformat()
        remainder = after[len(after.split("\n## [", 1)[0]):]
        changelog = changelog.split(marker, 1)[0] + marker + f"\n## [{version}] - {date}\n\n{upcoming}\n" + remainder
        for name in ["package.json", "src-tauri/tauri.conf.json"]:
            value = json.loads((root / name).read_text()); value["version"] = version
            (root / name).write_text(json.dumps(value, indent=2, ensure_ascii=False) + "\n")
        lock = json.loads((root / "package-lock.json").read_text())
        lock["version"] = lock["packages"][""]["version"] = version
        (root / "package-lock.json").write_text(json.dumps(lock, indent=2, ensure_ascii=False) + "\n")
        cargo = root / "src-tauri/Cargo.toml"
        cargo.write_text(cargo.read_text().replace(f'version = "{old}"', f'version = "{version}"', 1))
        cargo_lock = root / "src-tauri/Cargo.lock"
        cargo_lock.write_text(cargo_lock.read_text().replace(f'name = "agent-workbench"\nversion = "{old}"', f'name = "agent-workbench"\nversion = "{version}"', 1))
        changelog_path.write_text(changelog)
    match = re.search(rf"(?ms)^## \[{re.escape(version)}\][^\n]*\n(.*?)(?=^## \[|\Z)", changelog)
    if not match: raise ValueError("The published version needs its own changelog section")
    notes = match.group(1).strip() + "\n"
    current_version(root)
    return version, notes


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=["check", "prepare"])
    parser.add_argument("--bump", choices=["current", "patch", "minor", "major"], default="current")
    parser.add_argument("--notes", type=pathlib.Path)
    parser.add_argument("--output", type=pathlib.Path)
    parser.add_argument("--plan", type=pathlib.Path)
    args = parser.parse_args()
    if args.command == "check":
        print(current_version()); return
    if args.plan:
        plan = json.loads(args.plan.read_text())
        if plan.get("release") is False:
            if args.output:
                with args.output.open("a") as output: output.write("release=false\n")
            print("No new commits to release"); return
        if plan.get("release") is not True: raise ValueError("Invalid release plan")
        version, notes = prepare("current", target_version=plan["version"], generated_notes=plan["notes"])
    else:
        version, notes = prepare(args.bump)
    if args.notes: args.notes.write_text(notes)
    if args.output:
        with args.output.open("a") as output: output.write(f"release=true\nversion={version}\ntag=v{version}\n")
    print(version)


if __name__ == "__main__": main()
