#! /usr/bin/env bash

function _e {
    echo "> $@"
    eval "$@" 2>&1 | sed -e "s/^/    /"
    printf "Exit: %s\n\n\n" "$?"
}

function curl_test {
    curl -w "
time_namelookup:    %{time_namelookup}
time_connect:       %{time_connect}
time_appconnect:    %{time_appconnect}
time_pretransfer:   %{time_pretransfer}
time_redirect:      %{time_redirect}
time_starttransfer: %{time_starttransfer}
time_total:         %{time_total}
" -v -o /dev/null "$@"
}

function ix {
    url=$(cat | curl -F 'f:1=<-' ix.io 2> /dev/null)
    echo "Pasted at: $url"
}

(
    #_e ping -c1 cache.cowsay.pw
    #_e ping -4 -c1 cache.cowsay.pw
    #_e ping -6 -c1 cache.cowsay.pw
    _e dig -t A cache.cowsay.pw
    _e traceroute -4 cache.cowsay.pw
    #_e traceroute -6 cache.cowsay.pw
    _e curl_test -4 'https://cache.cowsay.pw/nix-cache-info'
    #_e curl_test -6 'https://cache.cowsay.pw/nix-cache-info'
    _e curl -I -4 'https://cache.cowsay.pw/'
    _e curl -I -4 'https://cache.cowsay.pw/'
    _e curl -I -4 'https://cache.cowsay.pw/'
    #_e curl -I -6 'https://cache.cowsay.pw/'
    #_e curl -I -6 'https://cache.cowsay.pw/'
    #_e curl -I -6 'https://cache.cowsay.pw/'
) | tee /dev/stderr | ix
