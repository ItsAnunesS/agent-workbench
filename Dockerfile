FROM node:22-bookworm-slim AS node
FROM rust:1-bookworm
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -s /usr/local/lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
 && ln -s /usr/local/lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx \
 && apt-get update && apt-get install -y --no-install-recommends \
    libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev \
    patchelf file xdg-utils ca-certificates python3 xvfb \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /workspace
ENV APPIMAGE_EXTRACT_AND_RUN=1
RUN rustup component add rustfmt
CMD ["bash", "scripts/container-build.sh"]
