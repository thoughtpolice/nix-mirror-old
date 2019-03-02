workflow "Build and Deploy" {
  on = "push"
  resolves = [
    "Deploy CloudFlare Worker",
  ]
}

action "Shell Lint" {
  uses = "actions/bin/shellcheck@master"
  args = ".github/actions/nix-build/entrypoint.sh .github/actions/deploy-worker/entrypoint.sh"
}

action "Docker Lint" {
  uses = "docker://replicated/dockerfilelint"
  args = [".github/actions/nix-build/Dockerfile", ".github/actions/deploy-worker/Dockerfile"]
}

action "Nix Docker Build" {
  uses = "./.github/actions/nix-build"
  needs = ["Shell Lint", "Docker Lint"]
  args = "release.nix"
}

action "Publish Filter" {
  uses = "actions/bin/filter@master"
  needs = ["Nix Docker Build"]
  args = "branch master"
}

action "Deploy CloudFlare Worker" {
  uses = "./.github/actions/deploy-worker"
  needs = ["Publish Filter"]
  env = {
    S3_API_ENDPOINT = "s3.cowsay.pw"
    S3_BUCKET       = "nix-cache"
    CACHE_DOMAIN    = "cowsay.pw"
    CACHE_SUBDOMAIN = "cache"
  }
  secrets = ["S3_ACCESS_KEY", "S3_SECRET_KEY", "CF_EMAIL", "CF_API_KEY", "CLICKHOUSE_LOGIN", "CLICKHOUSE_DATABASE"]
}
