#! /usr/bin/env bash

# Entrypoint that runs nix-build.

[ "$DEBUG" = "1" ] && set -x
[ "$QUIET" = "1" ] && QUIET_ARG="-Q"

set -e

# file to build (e.g. release.nix)
file="$1"

[ "$file" = "--help" ] && (cat <<EOF
Usage: $0 <FILE>
EOF
) && exit 0

[ "$file" = "" ] && echo "No .nix file to build specified!" && exit 1
[ ! -e "$file" ] && echo "File $file not exist!" && exit 1

echo "Building all attrs in $file..."
nix-build --no-link ${QUIET_ARG} "$file"

echo "Grabbing build artifact paths..."
worker=$(nix-build --no-link ${QUIET_ARG} "$file" -A "cf-worker")

echo "Copying worker artifacts..."
cp -fv "$worker/worker-meta.json.in" "$worker/bin/worker.js" "$HOME"
