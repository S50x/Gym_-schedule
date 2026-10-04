FROM node:24-slim

ENV NODE_ENV=production
WORKDIR /app

# Install dependencies first so a code-only change reuses the cached layer.
# pnpm comes from Corepack, at the exact version package.json pins. The store is
# dropped afterwards: node_modules keeps its own copy, so it is dead weight.
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
COPY package.json pnpm-lock.yaml ./
RUN corepack enable \
  && pnpm install --frozen-lockfile --prod \
  && rm -rf "$(pnpm store path)" /root/.cache

COPY server ./server
COPY public ./public
COPY scripts ./scripts

# Data lives in Postgres (DATABASE_URL), not on this container's filesystem —
# that is what lets the app run on a host with no persistent disk.
RUN chown -R node:node /app

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/index.js"]
