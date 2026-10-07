# PetraPMS cloud image (PostgreSQL). Build from the repository root:  docker build -f docker/Dockerfile -t petrapms .
FROM node:22-bookworm-slim AS build
RUN corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile && node scripts/build.mjs

FROM node:22-bookworm-slim
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0 PETRA_MODE=cloud DATABASE_PROVIDER=postgres PETRA_DATA_DIR=/data
WORKDIR /app
COPY --from=build /repo/apps/web/.next/standalone/ ./
RUN mkdir -p /data && chown -R node:node /data /app
USER node
VOLUME ["/data"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s CMD node -e "fetch('http://127.0.0.1:3000/api/status').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
WORKDIR /app/apps/web
CMD ["node", "server.js"]
