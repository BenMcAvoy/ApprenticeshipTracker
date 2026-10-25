# Backend: tRPC API + SQLite + the scan agent (headless Chromium via Playwright).
# The Playwright image ships Chromium and its system libraries; keep the tag in step with the `playwright` npm version.
# Build context is the repository root (see docker-compose.yml).
FROM mcr.microsoft.com/playwright:v1.64.1-noble

WORKDIR /app
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

# Install dependencies first so they're cached until a manifest changes.
COPY package.json package-lock.json ./
COPY backend/package.json backend/
COPY frontend/package.json frontend/
RUN npm ci -w backend --include-workspace-root

COPY backend backend
RUN cd backend && npx prisma generate

WORKDIR /app/backend
COPY backend/docker-entrypoint.sh /docker-entrypoint.sh
RUN sed -i 's/\r$//' /docker-entrypoint.sh && chmod +x /docker-entrypoint.sh

ENV PORT=3000 \
    DATABASE_URL=file:/data/app.db \
    OPENAI_AUTH_FILE=/data/openai-auth.json \
    CHROMIUM_NO_SANDBOX=1 \
    OPENAI_LOGIN_LISTEN_HOST=0.0.0.0

EXPOSE 3000 1455
VOLUME /data
ENTRYPOINT ["/docker-entrypoint.sh"]
