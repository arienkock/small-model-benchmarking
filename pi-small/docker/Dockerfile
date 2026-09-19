# pi-small agent image — pi in a Linux sandbox, same strategy as the benchmark.
#
# The small models get an unguarded bash and are not trusted with the host. This
# image is the containment: the ONLY writable host path is the workspace mounted
# at /workspace, and the plugin is mounted read-only at /opt/pi-small.
#
# llama-server and the GPU stay on the Windows host, reached through
# host.docker.internal, so nothing here needs CUDA or weights.
#
# This is deliberately a separate image from coding-bench-agent, even though the
# two are nearly identical today. The benchmark image is a measurement
# instrument: changing its toolchain silently changes what past rounds mean.
# This one is a development sandbox and should be free to gain tools.
FROM node:24-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        python3 curl ca-certificates git \
        procps lsof psmisc iproute2 net-tools file \
    && rm -rf /var/lib/apt/lists/*
# procps: ps pgrep pkill top   psmisc: fuser killall
# iproute2: ss   net-tools: netstat
# Small models reach for these to manage the servers they start; node:24-slim
# ships none of them, and a missing `ps` reads as a broken agent, not a missing
# package.

# pi itself. Pinned by npm resolution at build time — rebuild to move it, which
# is the point: pi updates on its own schedule, not mid-session.
RUN npm install -g @earendil-works/pi-coding-agent

RUN python3 --version && node --version && pi --version

WORKDIR /workspace
