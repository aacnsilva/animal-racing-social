FROM node:22-alpine AS build
WORKDIR /app/server
COPY server/package.json server/package-lock.json ./
RUN npm ci
COPY shared /app/shared
COPY server/ ./
RUN npm run typecheck && npm test && npm prune --omit=dev

FROM node:22-alpine
ENV NODE_ENV=production DB_DIR=/app/db SHARED_DIR=/app/shared
WORKDIR /app/server
COPY --from=build /app/server/node_modules ./node_modules
COPY --from=build /app/server/src ./src
COPY server/package.json ./
COPY db /app/db
COPY shared /app/shared
USER node
ENTRYPOINT ["node", "--disable-warning=ExperimentalWarning", "src/main.ts"]
