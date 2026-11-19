#!/usr/bin/env python3
import importlib.util
import json
import pathlib
import shutil
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("version", ROOT / "scripts/version.py")
version = importlib.util.module_from_spec(spec); spec.loader.exec_module(version)


class VersionTests(unittest.TestCase):
    def test_semver_bumps(self):
        self.assertEqual(version.next_version("0.7.9", "patch"), "0.7.10")
        self.assertEqual(version.next_version("0.7.9", "minor"), "0.8.0")
        self.assertEqual(version.next_version("0.7.9", "major"), "1.0.0")
        self.assertEqual(version.next_version("0.7.9", "current"), "0.7.9")
        with self.assertRaises(ValueError): version.next_version("../unsafe", "patch")

    def test_release_updates_all_versions_and_preserves_history(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            for name in version.VERSION_FILES:
                target = root / name; target.parent.mkdir(parents=True, exist_ok=True); shutil.copyfile(ROOT / name, target)
            previous = version.current_version(root)
            (root / "CHANGELOG.md").write_text(f"# Changelog\n\n## [Unreleased]\n\n### Added\n\n- Feature ready for release.\n\n## [{previous}] - 2026-11-18\n\n- Previous release.\n")
            prepared, notes = version.prepare("patch", root, "2026-11-18")
            self.assertEqual(version.current_version(root), prepared)
            self.assertNotEqual(previous, prepared)
            text = (root / "CHANGELOG.md").read_text()
            self.assertIn(f"## [{previous}]", text)
            self.assertIn(f"## [{prepared}] - 2026-11-18", text)
            self.assertIn("## [Unreleased]", text)
            self.assertIn("Feature ready for release.", notes)
            self.assertIn("Previous release.", text)
            self.assertEqual(version.prepare("current", root)[0], prepared)

    def test_semantic_plan_synchronizes_all_files_and_merges_generated_notes(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            for name in version.VERSION_FILES:
                target = root / name; target.parent.mkdir(parents=True, exist_ok=True); shutil.copyfile(ROOT / name, target)
            previous = version.current_version(root)
            target = version.next_version(previous, "major")
            generated = f"# [{target}](https://example.test/compare) (2026-11-19)\n\n### Features\n\n* Interactive logo\n"
            prepared, notes = version.prepare("current", root, "2026-11-19", target_version=target, generated_notes=generated)
            self.assertEqual(version.current_version(root), target)
            self.assertEqual(prepared, target)
            self.assertIn("### Features\n\n* Interactive logo", notes)
            self.assertNotIn("https://example.test/compare", notes)
            for invalid in [previous, target, "../invalid"]:
                with self.assertRaises(ValueError): version.prepare("current", root, target_version=invalid)
            self.assertEqual(version.current_version(root), target)

    def test_mismatched_lockfile_fails(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            for name in version.VERSION_FILES:
                target = root / name; target.parent.mkdir(parents=True, exist_ok=True); shutil.copyfile(ROOT / name, target)
            lock = json.loads((root / "package-lock.json").read_text()); lock["version"] = "99.0.0"
            (root / "package-lock.json").write_text(json.dumps(lock))
            with self.assertRaises(ValueError): version.current_version(root)


if __name__ == "__main__": unittest.main()
