FROM node:24-alpine
WORKDIR /app
COPY package.json server.js ./
COPY src ./src
COPY public ./public
# PORT is a default: hosts like Railway pass their own PORT at runtime and the server listens on it.
ENV NODE_ENV=production DATA_DIR=/data PORT=3100
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 3100
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- "http://127.0.0.1:${PORT}/healthz" || exit 1
CMD ["node", "server.js"]
