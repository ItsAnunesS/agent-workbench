FROM node:22-bookworm-slim@sha256:e9f565d32859f0cbfb52125eafe8be39390f24dac302dc3cdf566e8ba3ab21ee
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates git python3 make g++ \
 && rm -rf /var/lib/apt/lists/* \
 && npm install --global @openai/codex@0.170.0 \
 && npm cache clean --force
LABEL com.agentworkbench.runtime="4"
COPY bridge.mjs /opt/workbench/bridge.mjs
ENV HOME=/home/worker CODEX_HOME=/home/worker/.codex
WORKDIR /workspace
ENTRYPOINT ["node", "/opt/workbench/bridge.mjs"]
