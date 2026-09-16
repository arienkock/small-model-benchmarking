# SmallCTL agent harness, containerised for use against our llama-server models.
#
# The harness is an OpenAI-compatible client, so the container needs no GPU and
# no model weights — it talks to llama-server over HTTP. Point SMALLCTL_ENDPOINT
# at that server (see run.sh).
FROM python:3.12-slim

# git/grep/curl are shelled out to by smallctl's tools; ssh is used by its
# remote-diagnosis tools and is harmless to have present.
RUN apt-get update && apt-get install -y --no-install-recommends \
        git ca-certificates curl openssh-client \
    && rm -rf /var/lib/apt/lists/*

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
# step fails as non-root, so the run stalls with the fix applied but unverified.
RUN pip install --no-cache-dir pytest

# Run as a non-root user whose uid matches the host's default so files written
# into the mounted workspace stay editable outside the container.
ARG UID=1000
ARG GID=1000
RUN groupadd -g "$GID" agent 2>/dev/null || true \
    && useradd -m -u "$UID" -g "$GID" agent 2>/dev/null || true \
    && mkdir -p /work && chown "$UID:$GID" /work

USER $UID:$GID
WORKDIR /work

# Defaults; every one is overridable with -e at run time.
ENV SMALLCTL_PROVIDER_PROFILE=llamacpp \
    SMALLCTL_API_KEY=local-dev-key \
    SMALLCTL_CHAT_ENDPOINT=/chat/completions \
    PYTHONUNBUFFERED=1

ENTRYPOINT ["smallctl"]
CMD ["--help"]
