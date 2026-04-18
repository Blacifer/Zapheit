FROM node:20-alpine AS build
WORKDIR /app

# Install pnpm via corepack (matches packageManager in package.json)
RUN corepack enable

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm build

FROM nginx:1.27-alpine
WORKDIR /usr/share/nginx/html

COPY --from=build /app/dist ./

# Nginx config: SPA routing + /health endpoint + gzip + asset caching
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf

# Runtime-config injection for enterprise/self-host deployments.
RUN apk add --no-cache gettext
COPY docker/runtime-config.template.js /etc/synthetic-hr/runtime-config.template.js
COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENV SYNTHETICHR_API_URL=""
ENV SYNTHETICHR_SUPABASE_URL=""
ENV SYNTHETICHR_SUPABASE_ANON_KEY=""
ENV SYNTHETICHR_SENTRY_DSN=""
ENV SYNTHETICHR_APP_VERSION=""
ENV SYNTHETICHR_ERROR_REPORTING_URL=""

EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://localhost/health || exit 1
ENTRYPOINT ["/entrypoint.sh"]
CMD ["nginx", "-g", "daemon off;"]

