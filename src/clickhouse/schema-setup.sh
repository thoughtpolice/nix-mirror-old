#! /usr/bin/env bash

function clickhouse() {
  local schema="$1"
  cat "$schema" | tee /dev/stderr | curl -k 'https://localhost@localhost/' --data-binary @-
}

[ "$1" = "--up"   ] && clickhouse "nix-cache-schema.up"   && exit 0
[ "$1" = "--down" ] && clickhouse "nix-cache-schema.down" && exit 0
>&2 echo "ERROR: must pass --up or --down" && exit 1
