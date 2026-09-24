# Same userland as coding-bench/docker (node 24 + python3 + curl + process tools), minus pi:
# evidence commands must run where the agent's own commands ran.
FROM node:24-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
        python3 curl ca-certificates procps lsof psmisc iproute2 net-tools file \
    && rm -rf /var/lib/apt/lists/*
COPY run-probes.sh /usr/local/bin/run-probes.sh
WORKDIR /workspace
