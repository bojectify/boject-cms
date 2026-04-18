# syntax=docker/dockerfile:1.7

# ============================================================================
# build stage — installs all deps, generates Prisma client, builds Nuxt
# ============================================================================
FROM node:24-alpine AS build

# pnpm via corepack (shipped with Node 24)
RUN corepack enable && corepack prepare pnpm@10.30.1 --activate

WORKDIR /workspace

# Copy workspace manifest + lockfile + workspace config for dep caching
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY patches ./patches
COPY apps/cms/package.json ./apps/cms/

# Install deps for the cms workspace (includes dev — needed for nuxt build)
RUN pnpm install --frozen-lockfile --filter cms --ignore-scripts

# Copy app source
COPY apps/cms ./apps/cms

WORKDIR /workspace/apps/cms

# The build-time nuxt.config.ts validates NUXT_SESSION_PASSWORD when NODE_ENV=production.
# This placeholder lets the build complete; real runtime value comes from the container env.
ENV NUXT_SESSION_PASSWORD=build-time-placeholder-replaced-at-runtime

# Prepare Nuxt (generates .nuxt/tsconfig.json — required by Pothos generator)
RUN pnpm nuxt prepare

# Generate Prisma client + Pothos types
RUN pnpm prisma generate --schema prisma/schema

# Build Nuxt (produces .output/)
RUN pnpm nuxt build

# ============================================================================
# runtime stage — slim image with only what's needed to run
# ============================================================================
FROM node:24-alpine AS runtime

RUN corepack enable && corepack prepare pnpm@10.30.1 --activate

# bash for the entrypoint, curl for operator debugging
RUN apk add --no-cache bash curl

# Non-root user
RUN addgroup -S cms && adduser -S cms -G cms

WORKDIR /app

# Install prod deps only, preserving the workspace layout
COPY --chown=cms:cms package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY --chown=cms:cms patches ./patches
COPY --chown=cms:cms apps/cms/package.json ./apps/cms/
RUN pnpm install --frozen-lockfile --prod --filter cms --ignore-scripts

# Copy build artifacts + runtime-required source
COPY --from=build --chown=cms:cms /workspace/apps/cms/.output ./apps/cms/.output
COPY --from=build --chown=cms:cms /workspace/apps/cms/generated ./apps/cms/generated
COPY --from=build --chown=cms:cms /workspace/apps/cms/prisma ./apps/cms/prisma
COPY --from=build --chown=cms:cms /workspace/apps/cms/scripts ./apps/cms/scripts
COPY --from=build --chown=cms:cms /workspace/apps/cms/docker ./apps/cms/docker

# Storage dir + entrypoint perms
RUN chmod +x ./apps/cms/docker/entrypoint.sh \
 && mkdir -p /app/storage/images/originals /app/storage/images/transforms \
 && chown -R cms:cms /app/storage /app/apps

USER cms

WORKDIR /app/apps/cms

EXPOSE 3000

ENV NITRO_PORT=3000 \
    NODE_ENV=production \
    STORAGE_DRIVER=local \
    STORAGE_LOCAL_BASE=/app/storage

ENTRYPOINT ["./docker/entrypoint.sh"]
