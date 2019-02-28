{ nix-mirror ? builtins.fetchGit ./.
, config ? {}
, system ? builtins.currentSystem
, nixpkgs ? null
, embed-version ? true
}:


let
  pkgs = import ./nix/bootstrap.nix { inherit nixpkgs config system; };

  versionBase   = pkgs.lib.fileContents ./.version;
  versionSuffix = pkgs.lib.optionalString (embed-version)
    "pre${toString nix-mirror.revCount}_${nix-mirror.shortRev}";

  version = "${versionBase}${versionSuffix}";
in

# Bring the chosen package set into scope
with pkgs;

let
  jobs = {
    cf-worker = stdenv.mkDerivation {
      name = "cf-worker";
      inherit version;
      src = [ ./src/workers ];

      buildPhase = ":";
      installPhase = ''
        mkdir -p $out/bin
        substitute ${./src/workers/main.js} $out/bin/worker.js \
          --subst-var-by GIT_VERSION '${version}'
        cp ${./src/workers/metadata.json.in} $out/worker-meta.json.in
      '';
    };

    diagnose-cache = stdenv.mkDerivation {
      name = "diagnose-cache";
      src = [ ./src/diagnostics ];

      buildPhase = ":";
      installPhase = ''
        mkdir -p $out/bin
        substitute ${./src/diagnostics/diagnose-cache.sh} $out/bin/diagnose-cache \
          --subst-var-by GIT_VERSION '${version}'
        chmod +x $out/bin/diagnose-cache
      '';
    };

  }; /* jobs */

in jobs // {
  jumbo = pkgs.buildEnv {
    name = "jumbo";
    paths = lib.mapAttrsToList (_: v: v) jobs;
    pathsToLink = [ "/" "/bin" ];
  };
}
