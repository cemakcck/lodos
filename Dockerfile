# One container, one origin: the API serves the built web app (WEB_DIST) next to /api and /socket.io.
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
# Tests and e2e use these; the image never runs them.
ENV MONGOMS_DISABLE_POSTINSTALL=1 PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
RUN npm ci
COPY . .
RUN npm run build -w @lodos/web && npm run build -w @lodos/api && npm prune --omit=dev

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production WEB_DIST=/app/apps/web/dist
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./
COPY --from=build /app/packages/shared ./packages/shared
COPY --from=build /app/apps/api/package.json ./apps/api/
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/api/assets ./apps/api/assets
COPY --from=build /app/apps/web/dist ./apps/web/dist
USER node
EXPOSE 4100
CMD ["node", "apps/api/dist/main.js"]
