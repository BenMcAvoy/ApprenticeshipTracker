# Frontend: static build served by nginx, which also proxies /api to the backend.
# Build context is the repository root (see docker-compose.yml).
FROM node:24-slim AS build

WORKDIR /app
COPY package.json package-lock.json ./
COPY frontend/package.json frontend/
COPY backend/package.json backend/
RUN npm ci -w frontend --include-workspace-root

COPY frontend frontend
# The frontend imports the backend's router *types* and a small shared date parser.
COPY backend/src backend/src

# Same-origin by default: nginx forwards /api/* to the backend, so no CORS and it works from any host name.
ARG VITE_API_URL=/api
ENV VITE_API_URL=$VITE_API_URL
RUN npm exec -w frontend -- vite build

FROM nginx:1.29-alpine
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/frontend/dist /usr/share/nginx/html
EXPOSE 80
