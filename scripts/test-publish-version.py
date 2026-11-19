#!/usr/bin/env python3
import importlib.util
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
from unittest.mock import patch
import version

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("publish_version", ROOT / "scripts/publish-version.py")
publication = importlib.util.module_from_spec(spec)
spec.loader.exec_module(publication)


class PublicationTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="workbench-publication-test-")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.remote = self.root / "remote.git"
        self.work = self.root / "build"
        self.work.mkdir()
        self.git(self.root, "init", "--bare", str(self.remote))
        self.git(self.root, "--git-dir", str(self.remote), "symbolic-ref", "HEAD", "refs/heads/release")
        self.git(self.work, "init", "-b", "release")
        self.identity(self.work)
        self.git(self.work, "remote", "add", "origin", str(self.remote))
        for name in version.VERSION_FILES:
            target = self.work / name
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(ROOT / name, target)
        self.previous = version.current_version(self.work)
        (self.work / "CHANGELOG.md").write_text(f"# Changelog\n\n## [Unreleased]\n\n### Added\n\n- Snapshot feature.\n\n## [{self.previous}] - 2026-11-18\n\n- Previous release.\n")
        (self.work / "app.txt").write_text("verified snapshot")
        self.commit(self.work, "feat: snapshot feature")
        self.source = self.git(self.work, "rev-parse", "HEAD")
        self.git(self.work, "push", "origin", "release")
        self.number, _ = version.prepare("minor", self.work)
        self.tag = "v" + self.number
        self.commit(self.work, f"chore(release): v{self.number}")
        self.built = self.git(self.work, "rev-parse", "HEAD")
        self.git(self.work, "tag", "-a", self.tag, "-m", self.tag)

    def git(self, root, *args):
        return subprocess.run(["git", *args], cwd=root, text=True, capture_output=True, check=True).stdout.strip()

    def identity(self, root):
        self.git(root, "config", "user.name", "Release fixture")
        self.git(root, "config", "user.email", "release@example.test")

    def commit(self, root, message):
        self.git(root, "add", ".")
        self.git(root, "commit", "-m", message)

    def clone(self):
        path = self.root / "developer"
        self.git(self.root, "clone", str(self.remote), str(path))
        self.identity(path)
        return path

    def test_publishes_the_verified_snapshot_without_branch_advancement(self):
        publication.publish(self.work, self.source, self.tag)
        self.assertEqual(self.git(self.work, "ls-remote", "origin", "refs/heads/release").split()[0], self.built)
        self.assertEqual(self.git(self.work, "rev-parse", self.tag + "^{}"), self.built)

    def test_preserves_new_commits_dependencies_and_notes_and_retries_a_push_race(self):
        developer = self.clone()
        (developer / "app.txt").write_text("newer feature")
        package = json.loads((developer / "package.json").read_text())
        package["dependencies"]["fixture-extra"] = "1.0.0"
        (developer / "package.json").write_text(json.dumps(package))
        notes = developer / "CHANGELOG.md"
        notes.write_text(notes.read_text().replace("### Added\n", "### Added\n\n- Upcoming feature.\n"))
        self.commit(developer, "feat: newer feature")
        self.git(developer, "push", "origin", "release")
        first_new_commit = self.git(developer, "rev-parse", "HEAD")

        def race(attempt):
            if attempt: return
            (developer / "app.txt").write_text("newer feature plus push race")
            notes.write_text(notes.read_text().replace("### Added\n", "### Added\n\n- Follow-up fix.\n"))
            self.commit(developer, "fix: concurrent follow-up")
            self.git(developer, "push", "origin", "release")

        with patch.object(publication.time, "sleep"):
            publication.publish(self.work, self.source, self.tag, before_push=race)
        self.git(developer, "pull", "--ff-only")
        self.assertEqual((developer / "app.txt").read_text(), "newer feature plus push race")
        self.assertEqual(json.loads((developer / "package.json").read_text())["dependencies"]["fixture-extra"], "1.0.0")
        self.assertEqual(version.current_version(developer), self.number)
        _, pending, _ = publication.unreleased(notes.read_text())
        self.assertIn("Upcoming feature.", pending)
        self.assertIn("Follow-up fix.", pending)
        self.assertNotIn("Snapshot feature.", pending)
        self.assertEqual(notes.read_text().count("Snapshot feature."), 1)
        self.assertEqual(self.git(developer, "show", f"{self.tag}:app.txt"), "verified snapshot")
        self.assertTrue(publication.ancestor(developer, first_new_commit, "HEAD"))
        self.assertTrue(publication.ancestor(developer, self.tag, "HEAD"))
        count = self.git(developer, "rev-list", "--count", "HEAD")
        publication.publish(self.work, self.source, self.tag)
        self.git(developer, "pull", "--ff-only")
        self.assertEqual(self.git(developer, "rev-list", "--count", "HEAD"), count)
        # The next queued release starts from the synchronized version and keeps future notes.
        next_number, next_notes = version.prepare("patch", developer)
        self.assertNotEqual(next_number, self.number)
        self.assertIn("Upcoming feature.", next_notes)
        self.assertNotIn("Snapshot feature.", next_notes)

    def test_refuses_a_tag_containing_unverified_source_edits(self):
        self.git(self.work, "tag", "-d", self.tag)
        (self.work / "app.txt").write_text("not built")
        self.commit(self.work, "fix: unverified edit")
        self.git(self.work, "tag", self.tag)
        with self.assertRaisesRegex(ValueError, "only change version metadata"):
            publication.publish(self.work, self.source, self.tag)
        self.assertEqual(self.git(self.work, "ls-remote", "origin", "refs/heads/release").split()[0], self.source)

    def test_refuses_non_version_changes_inside_dependency_manifests(self):
        self.git(self.work, "tag", "-d", self.tag)
        package = json.loads((self.work / "package.json").read_text())
        package["dependencies"]["unverified-dependency"] = "1.0.0"
        (self.work / "package.json").write_text(json.dumps(package, indent=2) + "\n")
        self.commit(self.work, "fix: unverified dependency change")
        self.git(self.work, "tag", self.tag)
        with self.assertRaisesRegex(ValueError, "only change version metadata"):
            publication.publish(self.work, self.source, self.tag)
        self.assertEqual(self.git(self.work, "ls-remote", "origin", "refs/heads/release").split()[0], self.source)

    def test_changelog_keeps_edited_entries_and_removes_empty_released_headings(self):
        source = "# Changelog\n\n## [Unreleased]\n\n### Added\n\n- Old.\n\n### Fixed\n\n- Existing.\n\n## [1.0.0]\n\nHistory.\n"
        current = source.replace("- Existing.", "- Edited existing.")
        released = "# Changelog\n\n## [Unreleased]\n\n## [1.1.0]\n\n- Old.\n- Existing.\n"
        result = publication.synchronize_changelog(current, source, released, "1.1.0")
        _, pending, _ = publication.unreleased(result)
        self.assertNotIn("### Added", pending)
        self.assertIn("### Fixed\n\n- Edited existing.", pending)
        self.assertIn("History.", result)


if __name__ == "__main__": unittest.main()
