#!/usr/bin/env python3
"""Publish a verified snapshot without replacing commits pushed during its build."""
import argparse
from collections import Counter
import json
from pathlib import Path
import re
import subprocess
import tempfile
import time
import version


def git(root, *args, check=True):
    return subprocess.run(["git", *args], cwd=root, text=True, capture_output=True, check=check)


def ancestor(root, older, newer):
    return git(root, "merge-base", "--is-ancestor", older, newer, check=False).returncode == 0


def unreleased(text):
    match = re.match(r"(?ms)(.*?^## \[Unreleased\]\n)(.*?)(^## \[.*|\Z)", text)
    if not match: raise ValueError("CHANGELOG.md needs an Unreleased section")
    return match.groups()


def synchronize_changelog(current, source, released, number):
    prefix, pending, history = unreleased(current)
    _, old_pending, _ = unreleased(source)
    consumed = Counter(line for line in old_pending.splitlines() if line.strip() and not line.startswith("#"))
    remaining = []
    for line in pending.splitlines():
        if consumed[line]: consumed[line] -= 1
        else: remaining.append(line)
    # Keep new/edited entries under their headings and discard sections left empty.
    for index in range(len(remaining) - 1, -1, -1):
        if remaining[index].startswith("### "):
            end = next((i for i in range(index + 1, len(remaining)) if remaining[i].startswith("### ")), len(remaining))
            if not any(line.strip() for line in remaining[index + 1:end]): del remaining[index:end]
    section = re.search(rf"(?ms)^## \[{re.escape(number)}\][^\n]*\n.*?(?=^## \[|\Z)", released)
    if not section: raise ValueError("Verified snapshot has no release notes")
    if not re.search(rf"(?m)^## \[{re.escape(number)}\]", history):
        history = section.group().strip() + "\n\n" + history.lstrip()
    pending = "\n".join(remaining).strip()
    return prefix.rstrip() + "\n\n" + (pending + "\n\n" if pending else "") + history.rstrip() + "\n"


def publish(root, source, tag, before_push=None):
    root = Path(root).resolve()
    if not re.fullmatch(r"v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)", tag):
        raise ValueError("Expected a version tag")
    source = git(root, "rev-parse", "--verify", source + "^{commit}").stdout.strip()
    release = git(root, "rev-parse", "--verify", tag + "^{commit}").stdout.strip()
    number = tag[1:]
    package = json.loads(git(root, "show", f"{release}:package.json").stdout)
    if package["version"] != number or not ancestor(root, source, release):
        raise ValueError("The tag must identify the verified version of the source snapshot")
    changed = set(git(root, "diff", "--name-only", source, release).stdout.splitlines())
    if changed - set(version.VERSION_FILES):
        raise ValueError("The release commit may only change version metadata and release notes")
    if changed:
        with tempfile.TemporaryDirectory(prefix="workbench-version-patch-") as directory:
            snapshot = Path(directory)
            for name in version.VERSION_FILES:
                target = snapshot / name
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text(git(root, "show", f"{source}:{name}").stdout)
            previous = version.current_version(snapshot)
            if tuple(map(int, number.split("."))) <= tuple(map(int, previous.split("."))):
                raise ValueError("The verified version must be newer than the source version")
            version.write_version(number, snapshot)
            for name in version.VERSION_FILES:
                if name != "CHANGELOG.md" and (snapshot / name).read_text() != git(root, "show", f"{release}:{name}").stdout:
                    raise ValueError("The release commit may only change version metadata and release notes")
    for attempt in range(20):
        git(root, "fetch", "origin", "refs/heads/release:refs/remotes/origin/release", "--tags")
        remote = git(root, "rev-parse", "origin/release").stdout.strip()
        if not ancestor(root, source, remote):
            raise ValueError("The release branch history was rewritten; refusing to replace it")
        candidate = release
        if ancestor(root, release, remote):
            candidate = remote
        elif remote != source:
            with tempfile.TemporaryDirectory(prefix="workbench-publish-") as directory:
                tree = Path(directory) / "worktree"
                git(root, "worktree", "add", "--detach", str(tree), remote)
                try:
                    # The snapshot contains only a version patch. Keep every newer source change.
                    git(tree, "merge", "--no-ff", "--no-commit", "-s", "ours", release)
                    current = version.current_version(tree)
                    if tuple(map(int, current.split("."))) <= tuple(map(int, number.split("."))):
                        changelog = synchronize_changelog(
                            (tree / "CHANGELOG.md").read_text(),
                            git(root, "show", f"{source}:CHANGELOG.md").stdout,
                            git(root, "show", f"{release}:CHANGELOG.md").stdout,
                            number,
                        )
                        version.write_version(number, tree)
                        (tree / "CHANGELOG.md").write_text(changelog)
                    git(tree, "add", *version.VERSION_FILES)
                    git(tree, "commit", "-m", f"chore(release): v{number}")
                    candidate = git(tree, "rev-parse", "HEAD").stdout.strip()
                finally:
                    git(root, "worktree", "remove", "--force", str(tree))
        if before_push: before_push(attempt)
        result = git(root, "push", "--atomic", "origin", f"{candidate}:refs/heads/release", f"refs/tags/{tag}", check=False)
        if result.returncode == 0:
            print(f"Published {tag} snapshot; release branch retains all newer commits.")
            return candidate
        latest = git(root, "ls-remote", "origin", "refs/heads/release").stdout.split()[0]
        if latest == remote:
            raise RuntimeError("Could not push the verified version: " + result.stderr)
        print("A newer commit arrived during publication; retrying synchronization.")
        time.sleep(1)
    raise RuntimeError("Could not synchronize after 20 concurrent updates. The verified tag can be retried.")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", required=True)
    parser.add_argument("--tag", required=True)
    args = parser.parse_args()
    publish(Path.cwd(), args.source, args.tag)


if __name__ == "__main__": main()
