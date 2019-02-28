#! /usr/bin/env bash

# Entrypoint that runs Cachix Push

[ "$DEBUG" = "1" ] && set -x
set -e

CF_API_ENDPOINT="https://api.cloudflare.com/client/v4"

function check_var () {
  [ -z "${!1}" ] && echo "$1 must be configured!" && exit 1
  return 0
}

check_var "S3_API_ENDPOINT"
check_var "S3_BUCKET"
check_var "CACHE_DOMAIN"
check_var "CACHE_SUBDOMAIN"

check_var "CF_EMAIL"
check_var "S3_ACCESS_KEY"
check_var "S3_SECRET_KEY"
check_var "CF_API_KEY"

metadata="$HOME/worker-meta.json"
script="$HOME/worker.js"

[ ! -f "$script" ]      && echo "Worker script $script does not exist!" && exit 1
[ ! -f "$metadata.in" ] && echo "Worker resource metadata $metadata does not exist!" && exit 1

echo -n "Checking Zone ID... "
zoneInfo=$(curl -s -X GET \
        -H "X-Auth-Email:$CF_EMAIL" -H "X-Auth-Key:$CF_API_KEY" \
        "${CF_API_ENDPOINT}/zones?name=${CACHE_DOMAIN}&status=active&order=status")
zoneExists=$(echo "$zoneInfo" | jq '.success')
[ "$zoneExists" = "false" ] && echo "ERROR: Couldn't locate zone ${CACHE_DOMAIN} with given API keys! Exiting" && exit 1
CF_ZONE=$(echo "$zoneInfo" | jq -r '.result[0].id')
echo "OK!"

echo -n "Interpolating secrets into worker metadata... "
S3_SECRET_KEY=$(echo -n "$S3_SECRET_KEY" | base64)
nix-shell --pure -p stdenv \
  --keep "S3_API_ENDPOINT" \
  --keep "S3_BUCKET" \
  --keep "CACHE_DOMAIN" \
  --keep "CACHE_SUBDOMAIN" \
  --keep "S3_ACCESS_KEY" \
  --keep "S3_SECRET_KEY" \
  --run "substitute '$metadata.in' '$metadata' --subst-var S3_API_ENDPOINT --subst-var S3_BUCKET --subst-var CACHE_DOMAIN --subst-var CACHE_SUBDOMAIN --subst-var S3_ACCESS_KEY --subst-var S3_SECRET_KEY"
echo "OK!"

echo -n "Uploading Binary Cache CloudFlare worker... "
workerInfo=$(curl -s -X PUT \
        "https://api.cloudflare.com/client/v4/zones/${CF_ZONE}/workers/script" \
        -H "X-Auth-Email:$CF_EMAIL" -H "X-Auth-Key:$CF_API_KEY" \
        -F "metadata=@${metadata};type=application/json" \
        -F "script=@${script};type=application/javsacript")
workerSuccess=$(echo "$workerInfo" | jq '.success')
[ "$workerSuccess" = "false" ] && echo "ERROR: could not upload script/metadata!" && exit 1
echo "OK!"
rm -rf "$script" "$metadata" "$metadata.in"

#domainRoute="*${CACHE_DOMAIN}/*"
echo -n "Updating/clearing route table... "
routeInfo=$(curl -s -X GET \
        -H "X-Auth-Email:$CF_EMAIL" -H "X-Auth-Key:$CF_API_KEY" \
        "${CF_API_ENDPOINT}/zones/${CF_ZONE}/workers/filters")
routeSuccess=$(echo "$routeInfo" | jq '.success')
[ "$routeSuccess" = "false" ] && echo "ERROR: Couldn't get the list of routes for the domain worker script! Exiting" && exit 1

#curl -X POST \
#        "https://api.cloudflare.com/client/v4/zones/${CF_ZONE}/workers/filters/" \
#        -H "X-Auth-Email:$CF_EMAIL" -H "X-Auth-Key:$CF_API_KEY" \
#        -H "Content-type: application/json" -d "{\"pattern\": \"*\.${CACHE_DOMAIN}.com/*\", \"enabled\": true}"
echo "OK!"
