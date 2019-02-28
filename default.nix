{ embed-version ? false
, nixpkgs ? <nixpkgs>
, ...
}@args:

(import ./release.nix (args // { inherit embed-version nixpkgs; })).jumbo
