#!/usr/bin/env python3
"""Reject AppImages whose embedded update source or zsync headers are invalid."""
import fnmatch
import hashlib
from pathlib import Path
import subprocess
import sys
from urllib.parse import unquote


def prepare_bundle(directory: Path, index_directory: Path | None = None) -> None:
    # GitHub rewrites spaces in asset names. Use URL-safe names before hashing.
    for image in sorted(directory.glob("*.AppImage")):
        target = image.with_name(image.name.replace(" ", "-"))
        if target == image:
            continue
        index = image.with_suffix(".AppImage.zsync")
        if not index.exists() and index_directory is not None:
            # linuxdeploy writes the index in its working directory.
            index = index_directory / index.name
        target_index = target.with_suffix(".AppImage.zsync")
        if target.exists() or target_index.exists():
            raise ValueError(f"Output already exists: {target.name}")
        header, blocks = index.read_bytes().split(b"\n\n", 1)
        lines = header.decode("utf-8").splitlines()
        lines = [
            f"{line.split(':', 1)[0]}: {target.name}"
            if line.startswith(("URL: ", "Filename: ")) else line
            for line in lines
        ]
        target_index.write_bytes("\n".join(lines).encode() + b"\n\n" + blocks)
        image.rename(target)
        index.unlink()


def check_bundle(directory: Path, update_information: str) -> None:
    images = sorted(directory.glob("*.AppImage"))
    if not images:
        raise ValueError("No AppImage was generated")
    pattern = update_information.split("|")[-1]
    for image in images:
        metadata = subprocess.run(
            ["readelf", "--string-dump=.upd_info", str(image)],
            check=True, capture_output=True, text=True,
        ).stdout
        if update_information not in metadata:
            raise ValueError(f"Missing update information in {image.name}")
        index = image.with_suffix(".AppImage.zsync")
        if not fnmatch.fnmatchcase(index.name, pattern):
            raise ValueError(f"Update pattern does not match {index.name}")
        with index.open("rb") as stream:
            header = stream.read(65536).split(b"\n\n", 1)[0].decode("utf-8")
        fields = dict(line.split(": ", 1) for line in header.splitlines() if ": " in line)
        with image.open("rb") as stream:
            digest = hashlib.file_digest(stream, "sha1").hexdigest()
        if fields.get("SHA-1") != digest:
            raise ValueError(f"zsync checksum mismatch for {image.name}")
        if fields.get("Length") != str(image.stat().st_size):
            raise ValueError(f"zsync length mismatch for {image.name}")
        if unquote(fields.get("URL", "")) != image.name:
            raise ValueError(f"zsync URL does not match {image.name}")
        print(f"Verified update metadata and zsync index: {image.name}")


if __name__ == "__main__":
    try:
        if "--prepare" in sys.argv[3:]:
            prepare_bundle(Path(sys.argv[1]), Path("src-tauri"))
        check_bundle(Path(sys.argv[1]), sys.argv[2])
    except (OSError, ValueError, subprocess.CalledProcessError) as error:
        sys.exit(f"AppImage update validation failed: {error}")
