FROM lnl7/nix:2.1.2

LABEL name="Deploy CloudFlare Worker with GitHub Actions"
LABEL version="1.0"
LABEL repository="http://github.com/thoughtpolice/nix-mirror"
LABEL homepage="http://github.com/thoughtpolice/nix-mirror"
LABEL maintainer="Austin Seipp <aseipp@pobox.com>"

LABEL "com.github.actions.name"="Deploy Worker"
LABEL "com.github.actions.description"="Deploys a secure CloudFlare Worker for Nix Binary Caches"
LABEL "com.github.actions.icon"="upload-cloud"
LABEL "com.github.actions.color"="blue"

RUN nix-env -iA nixpkgs.gnutar nixpkgs.gzip nixpkgs.iana-etc nixpkgs.cacert && \
  ln -sfv $(nix-env -q --out-path --no-name iana-etc)/etc/services /etc/services && \
  ln -sfv $(nix-env -q --out-path --no-name iana-etc)/etc/protocols /etc/protocols && \
  ln -sfv $(nix-env -q --out-path --no-name nss-cacert)/etc/ssl /etc/ssl

COPY entrypoint.sh /entrypoint.sh
ENTRYPOINT [ "/entrypoint.sh" ]
CMD [ "--help" ]
