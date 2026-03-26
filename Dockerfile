FROM node:20-slim

# Install build tools for native modules (better-sqlite3, node-pty)
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files first for better layer caching
COPY package.json package-lock.json ./

# Install all dependencies (including devDependencies for build)
RUN npm ci

# Copy source
COPY . .

# Build frontend
RUN npm run build

# Remove devDependencies to reduce image size
RUN npm prune --production

# Default port
ENV SERVER_PORT=3001
EXPOSE 3001

# Data directory for SQLite database
VOLUME ["/data"]
ENV DATABASE_PATH=/data/auth.db

CMD ["node", "server/index.js"]
