#!/bin/sh
set -eu
project_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
export MISE_DATA_DIR="$project_dir/.tools/mise"
export MISE_CACHE_DIR="$project_dir/.tools/cache"
export MISE_STATE_DIR="$project_dir/.tools/state"
command -v mise >/dev/null 2>&1 || { echo 'Install mise from https://mise.jdx.dev first.' >&2; exit 1; }
mkdir -p "$project_dir/.tools"
# Explicit tool requests; installation/cache/state are all inside this project.
mise install bun@1.4.4 node@24.22.1
"$project_dir/scripts/tools" bun --version
"$project_dir/scripts/tools" node --version
