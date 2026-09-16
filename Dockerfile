# Build: compile TypeScript, copy static pages, then drop dev dependencies.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY scripts ./scripts
COPY src ./src
RUN npm run build && npm prune --omit=dev

# Run: production image with only the compiled output and runtime deps.
FROM node:22-alpine
ENV NODE_ENV=production \
    ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    STORY_DIR=/app/stories \
    DATABASE_PATH=/app/data/zturn.sqlite \
    LOG_LEVEL=info
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/out ./out
COPY package.json ./
RUN mkdir -p /app/stories /app/data && chown -R node:node /app
USER node
EXPOSE 3000
VOLUME ["/app/stories", "/app/data"]
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
    CMD wget -qO- http://127.0.0.1:3000/health || exit 1
CMD ["node", "--disable-warning=ExperimentalWarning", "out/index.js"]
