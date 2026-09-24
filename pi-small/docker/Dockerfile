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
        python3 python3-pip python3-venv \
        build-essential gdb pkg-config \
        curl ca-certificates git \
        procps lsof psmisc iproute2 net-tools file \
    && ln -sf /usr/bin/pip3 /usr/local/bin/pip \
    && rm -rf /var/lib/apt/lists/*
# procps: ps pgrep pkill top   psmisc: fuser killall
# iproute2: ss   net-tools: netstat
# build-essential: gcc/g++/make/libc headers for C   gdb: so a crash is
# debuggable, not just a stack trace to read
# Small models reach for these to manage the servers they start; node:24-slim
# ships none of them, and a missing `ps` reads as a broken agent, not a missing
# package.

# Debian marks its system Python "externally managed" (PEP 668), which makes a
# bare `pip install` fail with no obvious fix. This container already IS the
# sandbox boundary, so there's no reason to make a model find a venv first.
ENV PIP_BREAK_SYSTEM_PACKAGES=1

# Rust via rustup, not apt's rustc/cargo — those lag upstream by a release or
# more. Installed to a fixed, world-writable location so it's on PATH and
# usable by whatever uid the container runs as.
ENV RUSTUP_HOME=/usr/local/rustup \
    CARGO_HOME=/usr/local/cargo \
    PATH=/usr/local/cargo/bin:$PATH
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \
        | sh -s -- -y --profile minimal --default-toolchain stable \
    && chmod -R a+w "$RUSTUP_HOME" "$CARGO_HOME"

# TypeScript on top of the Node.js already in the base image: the compiler
# plus tsx so a script can be run directly without a separate build step.
RUN npm install -g typescript tsx

# pi itself. Pinned by npm resolution at build time — rebuild to move it, which
# is the point: pi updates on its own schedule, not mid-session.
RUN npm install -g @earendil-works/pi-coding-agent

RUN python3 --version && pip --version && node --version && tsc --version \
    && gcc --version && rustc --version && cargo --version && pi --version

WORKDIR /workspace
