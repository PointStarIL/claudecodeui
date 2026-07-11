# CloudCLI / Claude Code UI — container image
# Built locally on the host, then referenced by the Dockhand stack as
# image: claudecodeui:local
FROM node:22-bookworm-slim

# Native module build deps (better-sqlite3, node-pty) + git for the app's git panel
RUN apt-get update && apt-get install -y --no-install-recommends \
        python3 make g++ git ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Don't pull the Electron binary (desktop build is unused in the container),
# and skip Husky git hooks during install.
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1 \
    HUSKY=0

# Copy the full source first — the postinstall hook (scripts/fix-node-pty.js)
# runs during `npm ci`, so it must be present.
COPY . .

# Install deps (compiles better-sqlite3 & node-pty native modules)
RUN npm ci

# Build client (-> dist/) and server (-> dist-server/)
RUN npm run build

# Drop dev dependencies to slim the runtime image
RUN npm prune --omit=dev

ENV NODE_ENV=production \
    SERVER_PORT=3001 \
    HOST=0.0.0.0 \
    DATABASE_PATH=/data/auth.db

EXPOSE 3001
VOLUME ["/data"]

# Compiled server entrypoint
CMD ["node", "dist-server/server/index.js"]
