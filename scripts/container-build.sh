#!/usr/bin/env bash
set -euo pipefail
run_step() {
  local title="$1"
  shift
  local started=$SECONDS
  echo "::group::$title"
  "$@"
  echo "::endgroup::"
  printf '%s completed in %ss\n' "$title" "$((SECONDS - started))"
}
export npm_config_cache=/workspace/.build-cache/npm
if [ "${1:-}" != --dependencies-installed ]; then
  run_step "Install locked dependencies" npm ci --prefer-offline --no-audit --fund=false
fi
run_step "Frontend tests" npm run test
run_step "Release policy and publication tests" npm run test:release
run_step "Version consistency" python3 scripts/version.py check
run_step "AppImage update tests" python3 scripts/test-appimage-updates.py
# Reuse optimized dependencies without optimizing the application test harness.
# Keep debug assertions and overflow checks enabled in application tests.
run_step "Native tests with shared release dependencies" cargo test --release --manifest-path src-tauri/Cargo.toml --locked \
  --config 'profile.release.package.agent-workbench.opt-level=0' \
  --config 'profile.release.package.agent-workbench.codegen-units=256' \
  --config 'profile.release.package.agent-workbench.debug-assertions=true' \
  --config 'profile.release.package.agent-workbench.overflow-checks=true'
# Embed the standard AppImage update source for Gear Lever and AppImageUpdate.
export LDAI_UPDATE_INFORMATION='gh-releases-zsync|ItsAnunesS|agent-workbench|latest|Agent-Workbench_*_amd64.AppImage.zsync'
run_step "Type check, production build and AppImage packaging" npm run tauri -- build --bundles appimage
bundle_dir=src-tauri/target/release/bundle/appimage
python3 scripts/check-appimage-updates.py "$bundle_dir" "$LDAI_UPDATE_INFORMATION" --prepare
mkdir -p artifacts
cp "$bundle_dir"/*.AppImage "$bundle_dir"/*.AppImage.zsync artifacts/
# Hash only this build, even when artifacts contains older local versions.
(cd "$bundle_dir" && sha256sum *.AppImage *.AppImage.zsync) > artifacts/SHA256SUMS
