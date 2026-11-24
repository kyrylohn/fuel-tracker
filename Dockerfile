# Бак: Node + вбудований SQLite (node:sqlite), без npm-залежностей
FROM node:24-alpine
ENV NODE_ENV=production DATA_DIR=/data PORT=8080 TZ=UTC
WORKDIR /app
COPY package.json ./
COPY server ./server
COPY public ./public
RUN apk add --no-cache tzdata \
 && chmod -R a+rX /app \
 && mkdir -p /data && chown node:node /data \
 && printf '#!/bin/sh\nexec node --disable-warning=ExperimentalWarning /app/server/cli.js "$@"\n' > /usr/local/bin/fuel \
 && chmod 755 /usr/local/bin/fuel
USER node
EXPOSE 8080
HEALTHCHECK --interval=60s --timeout=5s --start-period=10s CMD wget -qO- http://127.0.0.1:8080/healthz >/dev/null || exit 1
CMD ["node", "--disable-warning=ExperimentalWarning", "server/server.js"]
