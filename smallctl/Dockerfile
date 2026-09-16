# SmallCTL agent harness, containerised for use against our llama-server models.
#
# The harness is an OpenAI-compatible client, so the container needs no GPU and
# no model weights — it talks to llama-server over HTTP.
#
# TOOLCHAIN PARITY WITH pi. When this image is used for a harness comparison,
# the two sandboxes must offer the model the same tools, or the benchmark
# measures the image instead of the harness. pi's sandbox
# (coding-bench-agent:latest) is: node v24.21.0, python 3.11, curl, and root.
# This image matches that. Two of the three filter tasks tell the model to
# verify with `node <file>.ts`, so a missing node does not read as a failed
# task — it reads as a stalled harness.
FROM python:3.12-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
        git ca-certificates curl xz-utils openssh-client \
    && rm -rf /var/lib/apt/lists/*

# Node pinned to the exact version in pi's sandbox.
ARG NODE_VERSION=24.21.0
RUN curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-x64.tar.xz" \
      -o /tmp/node.tar.xz \
    && tar -xJf /tmp/node.tar.xz -C /usr/local --strip-components=1 \
    && rm /tmp/node.tar.xz \
    && node --version

ARG SMALLCTL_REPO=https://github.com/lowspeclabs/SmallCTL
# Pinned so a rebuild cannot silently change harness behaviour mid-benchmark.
ARG SMALLCTL_REF=1ce1cb556e9c0a2fe95a5bb5c6bb0287823f33b6

WORKDIR /opt
RUN git clone "$SMALLCTL_REPO" smallctl \
    && cd smallctl \
    && git checkout --detach "$SMALLCTL_REF" \
    && pip install --no-cache-dir -e .

# A coding agent needs a test runner in the image. Without it the model does the
# right thing -- runs pytest, then tries `pip install pytest` -- and that second
# step fails, so the run stalls with the fix applied but unverified.
RUN pip install --no-cache-dir pytest

# root, like pi's sandbox. As a non-root uid the model cannot install anything,
# which is itself a behavioural difference between the two harnesses.
RUN mkdir -p /work
WORKDIR /work

ENV SMALLCTL_PROVIDER_PROFILE=llamacpp \
    SMALLCTL_API_KEY=local-dev-key \
    SMALLCTL_CHAT_ENDPOINT=/chat/completions \
    PYTHONUNBUFFERED=1

ENTRYPOINT ["smallctl"]
CMD ["--help"]
