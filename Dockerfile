# Build context must be the repo root: server/ imports ../crdt via relative paths.
#   docker build -t concord-server .
#   docker run -p 4001:4001 -v concord-data:/data concord-server
FROM node:20-slim AS build
WORKDIR /app
COPY crdt ./crdt
COPY server ./server
WORKDIR /app/server
RUN npm ci && npm run build && npm prune --omit=dev

FROM node:20-slim
WORKDIR /app/server
COPY --from=build /app/server/node_modules ./node_modules
COPY --from=build /app/server/dist ./dist
COPY --from=build /app/server/package.json ./package.json
ENV PORT=4001 DB_PATH=/data/concord.db
VOLUME /data
EXPOSE 4001
CMD ["node", "dist/server/src/index.js"]
