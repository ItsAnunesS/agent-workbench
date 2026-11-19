#!/usr/bin/env python3
"""Exercise update validation with ELF metadata and matching zsync headers."""
import hashlib
import importlib.util
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
from urllib.parse import quote

spec = importlib.util.spec_from_file_location(
    "updates", Path(__file__).with_name("check-appimage-updates.py")
)
updates = importlib.util.module_from_spec(spec)
spec.loader.exec_module(updates)
UPDATE_INFORMATION = "gh-releases-zsync|ItsAnunesS|agent-workbench|latest|Agent-Workbench_*_amd64.AppImage.zsync"


class UpdateTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.directory = Path(self.temporary.name)
        self.image = self.directory / "Agent-Workbench_1.2.3_amd64.AppImage"
        shutil.copyfile(shutil.which("true"), self.image)
        metadata = self.directory / "metadata"
        metadata.write_bytes(UPDATE_INFORMATION.encode() + b"\0")
        subprocess.run(
            ["objcopy", f"--add-section=.upd_info={metadata}", str(self.image)], check=True
        )
        self.index = self.image.with_suffix(".AppImage.zsync")
        self.header = (
            f"zsync: 0.6.2\nLength: {self.image.stat().st_size}\n"
            f"URL: {quote(self.image.name)}\n"
            f"SHA-1: {hashlib.sha1(self.image.read_bytes()).hexdigest()}\n\n"
        )
        self.index.write_text(self.header)

    def test_accepts_matching_metadata_and_encoded_url(self):
        updates.check_bundle(self.directory, UPDATE_INFORMATION)

    def test_normalizes_names_and_preserves_zsync_blocks(self):
        original = self.image.with_name(self.image.name.replace("-", " ", 1))
        original_index = original.with_suffix(".AppImage.zsync")
        self.image.rename(original)
        self.index.rename(original_index)
        blocks = b"\x00\xff\n\x80"
        original_index.write_bytes(
            self.header.replace(quote(self.image.name), quote(original.name)).encode() + blocks
        )
        updates.prepare_bundle(self.directory)
        updates.check_bundle(self.directory, UPDATE_INFORMATION)
        self.assertEqual(self.index.read_bytes().split(b"\n\n", 1)[1], blocks)
        self.assertFalse(original.exists())
        self.assertFalse(original_index.exists())

    def test_collects_index_from_bundler_working_directory(self):
        original = self.image.with_name(self.image.name.replace("-", " ", 1))
        self.image.rename(original)
        working_directory = self.directory / "working"
        working_directory.mkdir()
        external_index = working_directory / f"{original.name}.zsync"
        self.index.rename(external_index)
        updates.prepare_bundle(self.directory, working_directory)
        updates.check_bundle(self.directory, UPDATE_INFORMATION)
        self.assertFalse(external_index.exists())

    def test_rejects_missing_images(self):
        self.image.unlink()
        with self.assertRaisesRegex(ValueError, "No AppImage"):
            updates.check_bundle(self.directory, UPDATE_INFORMATION)

    def test_rejects_wrong_update_source(self):
        with self.assertRaisesRegex(ValueError, "Missing update information"):
            updates.check_bundle(self.directory, UPDATE_INFORMATION.replace("latest", "beta"))

    def test_rejects_missing_index(self):
        self.index.unlink()
        with self.assertRaises(FileNotFoundError):
            updates.check_bundle(self.directory, UPDATE_INFORMATION)

    def test_rejects_changed_image(self):
        with self.image.open("ab") as stream:
            stream.write(b"changed")
        with self.assertRaisesRegex(ValueError, "checksum mismatch"):
            updates.check_bundle(self.directory, UPDATE_INFORMATION)

    def test_rejects_wrong_length_or_download_name(self):
        for header, error in [
            (self.header.replace(f"Length: {self.image.stat().st_size}", "Length: 0"), "length mismatch"),
            (self.header.replace(quote(self.image.name), "other.AppImage"), "URL does not match"),
        ]:
            with self.subTest(error=error):
                self.index.write_text(header)
                with self.assertRaisesRegex(ValueError, error):
                    updates.check_bundle(self.directory, UPDATE_INFORMATION)


if __name__ == "__main__":
    unittest.main()
