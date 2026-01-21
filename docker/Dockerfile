# Build stage
FROM node:24-bookworm-slim AS builder

WORKDIR /app

# Install build dependencies
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    curl \
    git \
    && curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y \
    && rm -rf /var/lib/apt/lists/*

ENV PATH="/root/.cargo/bin:${PATH}"

# Copy package files first for better layer caching
COPY package*.json ./

# Install all dependencies (including dev for build)
RUN npm ci

# Copy source files
COPY . .

# Build the application
RUN npm run build

# Prune dev dependencies for production
RUN npm prune --production

# Production stage
FROM node:24-bookworm-slim

WORKDIR /app

# Install runtime dependencies
RUN apt-get update && apt-get install -y \
    curl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd -r opnet && useradd -r -g opnet opnet

# Copy built application from builder
COPY --from=builder /app/build ./build
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package*.json ./

# Create directories for config, data, and plugins
RUN mkdir -p /app/config /app/data /app/plugins \
    && chown -R opnet:opnet /app

# Copy sample config as reference
COPY --from=builder /app/src/config/btc.sample.conf /app/config/btc.sample.conf

# Create symlink for config file location expected by the app
RUN mkdir -p /app/build/src/config \
    && ln -sf /app/config/btc.conf /app/build/src/config/btc.conf

# Expose ports
EXPOSE 9000  # API
EXPOSE 9805  # P2P
EXPOSE 7000  # Docs
EXPOSE 4800  # SSH

# Set production environment
ENV NODE_ENV=production

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD curl -f http://localhost:9000/api/v1/states/block/latest || exit 1

# Run as non-root user
USER opnet

# Start the application
CMD ["node", "build/index.js"]
