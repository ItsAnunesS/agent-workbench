#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
test_directory=$(mktemp -d)
Xvfb -displayfd 3 -screen 0 1440x1000x24 -nolisten tcp 3>"$test_directory/display" >"$test_directory/xvfb.log" 2>&1 &
display_process=$!
cleanup() {
  kill "$display_process" 2>/dev/null || true
  wait "$display_process" 2>/dev/null || true
  rm -rf "$test_directory"
}
trap cleanup EXIT
for attempt in {1..50}; do
  if [[ -s "$test_directory/display" ]]; then break; fi
  sleep 0.1
done
if [[ ! -s "$test_directory/display" ]]; then cat "$test_directory/xvfb.log"; exit 1; fi
export DISPLAY=":$(cat "$test_directory/display")"
export XDG_RUNTIME_DIR="$test_directory/runtime"
export XDG_DATA_HOME="$test_directory/data"
export XDG_CONFIG_HOME="$test_directory/config"
export XDG_CACHE_HOME="$test_directory/cache"
mkdir -m 700 "$XDG_RUNTIME_DIR"
cargo test --manifest-path src-tauri/Cargo.toml --locked native_browser_sessions_and_ipc_are_isolated -- --ignored --nocapture --test-threads=1
