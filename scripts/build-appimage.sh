#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
docker build -t agent-workbench-builder .
docker run --rm --init \
  --user "$(id -u):$(id -g)" \
  -e HOME=/tmp/workbench-build \
  -e CARGO_HOME=/workspace/.build-cache/cargo \
  -e CARGO_TARGET_DIR=/workspace/src-tauri/target \
  -v "$PWD:/workspace" \
  agent-workbench-builder
