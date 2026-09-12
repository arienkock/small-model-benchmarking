# coding-bench agent image: runs pi inside a Linux sandbox.
# The ONLY host path mounted at run time is the task workspace (at /workspace).
# llama-server stays on the Windows host, reached via host.docker.internal.
FROM node:24-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        python3 curl ca-certificates \
        procps lsof psmisc iproute2 net-tools file \
    && rm -rf /var/lib/apt/lists/*
# procps: ps pgrep pkill top   psmisc: fuser killall
# iproute2: ss   net-tools: netstat   (small models rely on these to manage
# their own verification servers; node:24-slim ships none of them)

# pi coding agent (same package as on the host, pinned by npm resolution at build time)
RUN npm install -g @earendil-works/pi-coding-agent

# Sanity: python3 and node both callable; .ts type-stripping active in node 24
RUN python3 --version && node --version && node -e "console.log('ts ok:', typeof 1 as number)"

WORKDIR /workspace
