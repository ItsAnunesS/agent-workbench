#!/usr/bin/env bash
set -euo pipefail
npm ci
npm run check
npm run test
cargo test --manifest-path src-tauri/Cargo.toml --locked
npm run tauri -- build --bundles appimage
mkdir -p artifacts
cp src-tauri/target/release/bundle/appimage/*.AppImage artifacts/
sha256sum artifacts/*.AppImage > artifacts/SHA256SUMS
