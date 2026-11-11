# KumoDesk – Docker image (Node 22, built-in SQLite, no frontend build step)
FROM node:22-alpine

ENV NODE_ENV=production \
    PORT=3003 \
    DATA_DIR=/data

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY server ./server
COPY public ./public

RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 3003

HEALTHCHECK --interval=60s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO /dev/null http://127.0.0.1:3003/api/auth/state || exit 1

CMD ["node", "--disable-warning=ExperimentalWarning", "server/index.js"]
