#! /usr/bin/env bash

set -e

channel=${1:-nixos-unstable-small}
upstream=${2:-cache.nixos.org}

[ -z "$S3_BUCKET" ]             && echo "S3_BUCKET unset!" && exit 1
[ -z "$S3_ENDPOINT" ]           && echo "S3_ENDPOINT unset!" && exit 1
[ -z "$AWS_ACCESS_KEY_ID" ]     && echo "AWS_ACCESS_KEY_ID unset!" && exit 1
[ -z "$AWS_SECRET_ACCESS_KEY" ] && echo "AWS_SECRET_ACCESS_KEY unset!" && exit 1

# get 'nix' into $PATH
source /etc/profile.d/nix.sh

mapfile -t channelPaths < <(curl -sL "https://nixos.org/channels/${channel}/store-paths.xz" | xz -d)
exec /nix/var/nix/profiles/default/bin/nix copy \
  --option narinfo-cache-positive-ttl 0 \
  --option narinfo-cache-negative-ttl 0 \
  --from "https://${upstream}/" \
  --to "s3://${S3_BUCKET}?endpoint=${S3_ENDPOINT}" \
  "${channelPaths[@]}"
