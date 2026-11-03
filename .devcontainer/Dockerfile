FROM mcr.microsoft.com/devcontainers/typescript-node:1-22-bookworm

RUN apt-get update \
    && apt-get install -y --no-install-recommends git-lfs postgresql-client openssl \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*
