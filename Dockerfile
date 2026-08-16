FROM node:22-slim

ENV NODE_ENV=production
WORKDIR /app

# Install dependencies first so a code-only change reuses the cached layer.
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev && npm cache clean --force

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
