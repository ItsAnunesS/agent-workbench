#!/usr/bin/env bash
set -euo pipefail
npm ci
npm run check
npm run test
npm run test:release
python3 scripts/version.py check
python3 scripts/test-appimage-updates.py
cargo test --manifest-path src-tauri/Cargo.toml --locked
# Embed the standard AppImage update source for Gear Lever and AppImageUpdate.
export LDAI_UPDATE_INFORMATION='gh-releases-zsync|ItsAnunesS|agent-workbench|latest|Agent-Workbench_*_amd64.AppImage.zsync'
npm run tauri -- build --bundles appimage
bundle_dir=src-tauri/target/release/bundle/appimage
python3 scripts/check-appimage-updates.py "$bundle_dir" "$LDAI_UPDATE_INFORMATION" --prepare
mkdir -p artifacts
cp "$bundle_dir"/*.AppImage "$bundle_dir"/*.AppImage.zsync artifacts/
# Hash only this build, even when artifacts contains older local versions.
(cd "$bundle_dir" && sha256sum *.AppImage *.AppImage.zsync) > artifacts/SHA256SUMS
