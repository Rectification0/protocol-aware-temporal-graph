# tasks.md F17.2: the SOC dashboard as a static nginx image. Build context
# is frontend/:
#   docker build -t t-gnn-frontend frontend
#
# Environment-agnostic by design (F17.1): nothing deployment-specific is
# baked in at build time. At container start, docker/frontend-entrypoint.sh
# writes /config.js from API_BASE_URL / MOCK_AUTH_ENABLED, and nginx's
# template step renders docker/nginx.conf.template with API_UPSTREAM -- so
# the same image runs against any backend.

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
# --ignore-scripts: the only lifecycle script is husky's `prepare`, which
# `cd ..`s to install git hooks -- meaningless (and failing) in an image.
RUN npm ci --ignore-scripts
COPY . .
RUN npm run build

FROM nginx:1.27-alpine
# Same-origin proxy by default (F17.3): the app calls /api on its own
# origin and nginx forwards to API_UPSTREAM, so no CORS is involved.
ENV API_UPSTREAM=http://api:8000 \
    API_BASE_URL= \
    MOCK_AUTH_ENABLED=true \
    NGINX_ENTRYPOINT_LOCAL_RESOLVERS=1 \
    NGINX_ENVSUBST_FILTER=^(API_UPSTREAM|NGINX_LOCAL_RESOLVERS)$
COPY docker/nginx.conf.template /etc/nginx/templates/default.conf.template
COPY docker/frontend-entrypoint.sh /docker-entrypoint.d/40-t-gnn-runtime-config.sh
COPY --from=build /app/dist /usr/share/nginx/html
RUN chmod +x /docker-entrypoint.d/40-t-gnn-runtime-config.sh
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s --retries=3 CMD wget -qO- http://127.0.0.1/healthz || exit 1
