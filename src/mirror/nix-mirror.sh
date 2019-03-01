#! /usr/bin/env bash

set -e

channel=${1:-nixos-unstable-small}
upstream=${2:-cache.nixos.org}

[ -z "$AWS_ACCESS_KEY_ID" ]     && echo "AWS_ACCESS_KEY_ID unset!" && exit 1
[ -z "$AWS_SECRET_ACCESS_KEY" ] && echo "AWS_SECRET_ACCESS_KEY unset!" && exit 1

bucket="aseipp-nix-cache-mirror"
endpoint="s3.wasabisys.com"

# get 'nix' into $PATH
source /etc/profile.d/nix.sh

mapfile -t channelPaths < <(curl -sL "https://nixos.org/channels/${channel}/store-paths.xz" | xz -d)
exec /nix/var/nix/profiles/default/bin/nix copy \
  --option narinfo-cache-positive-ttl 0 \
  --option narinfo-cache-negative-ttl 0 \
  --from "https://${upstream}/" \
  --to "s3://${bucket}?endpoint=${endpoint}" \
  "${channelPaths[@]}"
