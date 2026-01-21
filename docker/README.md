# OPNet Node Docker Setup

## Quick Start

```bash
# 1. Copy and edit the config
cp config/btc.conf.example config/btc.conf
# Edit config/btc.conf with your Bitcoin RPC and MongoDB settings

# 2. Run with docker-compose
docker compose up -d

# With included MongoDB:
docker compose --profile with-mongodb up -d
```

## Configuration

Edit `config/btc.conf` before starting. Required settings:

### Bitcoin RPC
```toml
[BLOCKCHAIN]
BITCOIND_HOST = "host.docker.internal"  # or your Bitcoin node IP
BITCOIND_PORT = 9236                     # mainnet=9236, testnet=9237, signet=9240, regtest=9242
BITCOIND_USERNAME = "your_username"
BITCOIND_PASSWORD = "your_password"
```

### MongoDB
```toml
[DATABASE]
HOST = "mongodb"        # Use "mongodb" if using docker-compose with-mongodb profile
PORT = 27017
DATABASE_NAME = "BTCMainnet"

[DATABASE.AUTH]
USERNAME = "opnet"
PASSWORD = "opnet"
```

## Ports

| Port | Service | Description |
|------|---------|-------------|
| 9000 | API | REST API and WebSocket |
| 9805 | P2P | Peer-to-peer network |
| 7000 | Docs | Documentation server (if enabled) |
| 4800 | SSH | SSH access (if enabled) |

## Docker Compose Profiles

| Profile | Description |
|---------|-------------|
| (default) | OPNet node only, requires external MongoDB |
| `with-mongodb` | Includes MongoDB container |

```bash
# Default (external MongoDB)
docker compose up -d

# With bundled MongoDB
docker compose --profile with-mongodb up -d
```

## Environment Variables

Override ports via environment variables:

```bash
API_PORT=9000 P2P_PORT=9805 docker compose up -d
```

| Variable | Default | Description |
|----------|---------|-------------|
| `API_PORT` | 9000 | API/WebSocket port |
| `P2P_PORT` | 9805 | P2P network port |
| `DOCS_PORT` | 7000 | Documentation server port |
| `SSH_PORT` | 4800 | SSH port |
| `MONGO_PORT` | 27017 | MongoDB port (with-mongodb profile) |
| `MONGO_USERNAME` | opnet | MongoDB username (with-mongodb profile) |
| `MONGO_PASSWORD` | opnet | MongoDB password (with-mongodb profile) |

## Volumes

| Volume | Path | Description |
|--------|------|-------------|
| `opnet-data` | `/app/data` | Node data |
| `opnet-plugins` | `/app/plugins` | Plugin storage |
| `mongodb-data` | `/data/db` | MongoDB data (with-mongodb profile) |

## Building Locally

```bash
docker compose build
```

## Standalone Docker Run

```bash
docker run -d \
  --name opnet-node \
  -p 9000:9000 \
  -p 9805:9805 \
  --add-host=host.docker.internal:host-gateway \
  -v $(pwd)/config/btc.conf:/app/config/btc.conf:ro \
  ghcr.io/btc-vision/opnet-node:latest
```

## Logs

```bash
docker compose logs -f opnet-node
```

## Health Check

The container includes a health check that queries the API:

```bash
docker inspect --format='{{.State.Health.Status}}' opnet-node
```
