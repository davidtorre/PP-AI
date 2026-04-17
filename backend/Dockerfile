# ── Stage 1: build ────────────────────────────────────────────────────────────
FROM node:22-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npx tsc

# ── Stage 2: production image ─────────────────────────────────────────────────
FROM node:22-alpine

# Patch OS packages
RUN apk upgrade --no-cache

WORKDIR /app

# Production dependencies only
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Compiled output + DB schema
COPY --from=builder /app/dist ./dist
COPY src/db/schema.sql ./dist/db/schema.sql

# Runtime uploads directory owned by app user
RUN mkdir -p /app/uploads

# Run as non-root
RUN addgroup -S ppai && adduser -S ppai -G ppai
RUN chown -R ppai:ppai /app
USER ppai

ENV NODE_ENV=production
ENV PORT=3001

EXPOSE 3001
CMD ["node", "dist/server.js"]
