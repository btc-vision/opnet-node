#!/bin/bash

# OPNet Indexer Installation Wizard

# Color definitions
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[1;34m'
NC='\033[0m' # No Color

# Clear the screen
clear

# ASCII Art for OPNet
echo -e "${BLUE}"
echo "    _////     _///////        _///     _//_////////_/// _//////"
echo "  _//    _//  _//    _//      _/ _//   _//_//           _//    "
echo "_//        _//_//    _//      _// _//  _//_//           _//    "
echo "_//        _//_///////        _//  _// _//_//////       _//    "
echo "_//        _//_//             _//   _/ _//_//           _//    "
echo "  _//     _// _//             _//    _/ //_//           _//    "
echo "    _////     _//             _//      _//_////////     _//    "
echo "                        _/////                                 "
echo -e "${NC}"

echo -e "${GREEN}Welcome to the OPNet Indexer Installation Wizard!${NC}"
echo ""

# Present options to the user
echo "Please select an option:"
echo "1. Install & Configure all the necessary dependencies (default)"
echo "2. Install & Configure MongoDB"
echo "3. Install Node.js 21"
echo "4. Install Cargo (Rust)"
echo "5. Setup OPNet Indexer"

# Read user choice
read -p "Enter your choice [1-5]: " choice

# Default choice is 1 if empty
if [[ -z "$choice" ]]; then
    choice=1
fi

case $choice in
    1)
        echo "You have chosen to install & configure all the necessary dependencies."
        install_mongodb=true
        install_nodejs=true
        install_rust=true
        setup_indexer=true
        ;;
    2)
        echo "You have chosen to install & configure MongoDB."
        install_mongodb=true
        ;;
    3)
        echo "You have chosen to install Node.js 21."
        install_nodejs=true
        ;;
    4)
        echo "You have chosen to install Cargo (Rust)."
        install_rust=true
        ;;
    5)
        echo "You have chosen to setup the OPNet Indexer."
        setup_indexer=true
        ;;
    *)
        echo -e "${RED}Invalid choice. Exiting.${NC}"
        exit 1
        ;;
esac

# Function to check if a command exists
command_exists() {
    command -v "$1" &> /dev/null
}

# Function to install and configure MongoDB
install_and_configure_mongodb() {
    echo -e "${BLUE}Starting MongoDB installation...${NC}"

    # Check if MongoDB is already installed
    if command_exists mongod; then
        echo -e "${YELLOW}MongoDB is already installed.${NC}"
        read -p "Do you want to uninstall it and proceed with fresh installation? [y/N]: " uninstall_mongo
        if [[ "$uninstall_mongo" =~ ^[Yy]$ ]]; then
            echo -e "${BLUE}Uninstalling existing MongoDB installation...${NC}"
            sudo systemctl stop mongod
            sudo apt-get purge mongodb-org* -y
            sudo rm -r /var/log/mongodb
            sudo rm -r /var/lib/mongodb
        else
            echo -e "${RED}Canceled by user.${NC}"
            exit 1
        fi
    fi

    # Install gnupg and curl
    echo -e "${BLUE}Installing gnupg and curl...${NC}"
    sudo apt-get install gnupg curl -y

    # Import the MongoDB public GPG Key
    echo -e "${BLUE}Importing MongoDB public GPG Key...${NC}"
    curl -fsSL https://www.mongodb.org/static/pgp/server-7.0.asc | sudo gpg -o /usr/share/keyrings/mongodb-server-7.0.gpg --dearmor

    # Determine Ubuntu version
    ubuntu_version=$(lsb_release -rs)
    echo -e "${BLUE}Detected Ubuntu version: $ubuntu_version${NC}"

    # Add MongoDB repository based on Ubuntu version
    if [[ "$ubuntu_version" == "22.04" || "$ubuntu_version" == "23.04" || "$ubuntu_version" == "23.10" || "$ubuntu_version" == "24.04" ]]; then
        echo "deb [ arch=amd64,arm64 signed-by=/usr/share/keyrings/mongodb-server-7.0.gpg ] https://repo.mongodb.org/apt/ubuntu jammy/mongodb-org/7.0 multiverse" | sudo tee /etc/apt/sources.list.d/mongodb-org-7.0.list
    elif [[ "$ubuntu_version" == "20.04" ]]; then
        echo "deb [ arch=amd64,arm64 signed-by=/usr/share/keyrings/mongodb-server-7.0.gpg ] https://repo.mongodb.org/apt/ubuntu focal/mongodb-org/7.0 multiverse" | sudo tee /etc/apt/sources.list.d/mongodb-org-7.0.list
    elif [[ "$ubuntu_version" == "18.04" ]]; then
        echo "deb [ arch=amd64,arm64 signed-by=/usr/share/keyrings/mongodb-server-7.0.gpg ] https://repo.mongodb.org/apt/ubuntu bionic/mongodb-org/7.0 multiverse" | sudo tee /etc/apt/sources.list.d/mongodb-org-7.0.list
    else
        echo -e "${RED}Unsupported Ubuntu version. Exiting.${NC}"
        exit 1
    fi

    # Update package list
    echo -e "${BLUE}Updating package list...${NC}"
    sudo apt-get update

    # Install MongoDB
    echo -e "${BLUE}Installing MongoDB...${NC}"
    sudo apt-get install -y mongodb-org

    # Verify MongoDB installation
    if command_exists mongod; then
        echo -e "${GREEN}MongoDB installed successfully.${NC}"
    else
        echo -e "${RED}MongoDB installation failed. Exiting.${NC}"
        exit 1
    fi

    # Now configure MongoDB
    echo -e "${BLUE}Configuring MongoDB...${NC}"
    # Step 1: Create keyfile and directories
    sudo mkdir -p /etc/mongodb/keys
    sudo mkdir -p /mnt/data/configdb
    sudo mkdir -p /mnt/data/shard1
    sudo mkdir -p /mnt/data/shard2

    # Step 2: Generate keyfile
    if [ -f /etc/mongodb/keys/mongo-key ]; then
        echo -e "${YELLOW}/etc/mongodb/keys/mongo-key already exists.${NC}"
        read -p "Do you want to overwrite it? [y/N]: " overwrite_key
        if [[ "$overwrite_key" =~ ^[Yy]$ ]]; then
            sudo rm /etc/mongodb/keys/mongo-key
            sudo openssl rand -base64 756 | sudo tee /etc/mongodb/keys/mongo-key > /dev/null
        else
            echo -e "${YELLOW}Using existing keyfile.${NC}"
        fi
    else
        sudo openssl rand -base64 756 | sudo tee /etc/mongodb/keys/mongo-key > /dev/null
    fi

    # Set permissions
    sudo chown mongodb:mongodb /etc/mongodb/keys/mongo-key
    sudo chmod 400 /etc/mongodb/keys/mongo-key

    # Step 3: Create MongoDB Config Files
    # Fetch and configure mongos.conf, shard1.conf, shard2.conf, configdb.conf
    read -s -p "Enter a password for MongoDB user 'opnet': " mongodb_password
    echo ""
    read -p "Enter the amount of RAM (in GB) to allocate for each shard (or press Enter for auto-select): " shard_ram

    if [[ -z "$shard_ram" ]]; then
        # Auto-select RAM
        total_ram_kb=$(grep MemTotal /proc/meminfo | awk '{print $2}')
        total_ram_gb=$(echo "scale=2; $total_ram_kb / 1024 / 1024" | bc)
        shard_ram=$(echo "scale=0; $total_ram_gb * 0.3 / 1" | bc)
        echo -e "${BLUE}Automatically allocated $shard_ram GB of RAM per shard.${NC}"
    fi

    # Function to fetch and configure a config file
    fetch_and_configure_conf() {
        local conf_name=$1
        local conf_url="https://autosetup.opnet.org/$conf_name"
        local conf_path="/etc/mongodb/$conf_name"

        if [ -f "$conf_path" ]; then
            echo -e "${YELLOW}$conf_path already exists.${NC}"
            read -p "Do you want to overwrite it? [y/N]: " overwrite_conf
            if [[ ! "$overwrite_conf" =~ ^[Yy]$ ]]; then
                echo -e "${YELLOW}Skipping $conf_name.${NC}"
                return
            fi
        fi

        # Fetch the file
        sudo curl -fsSL "$conf_url" -o "$conf_path"

        # Replace cacheSizeGB
        sudo sed -i "s/cacheSizeGB:.*/cacheSizeGB: $shard_ram/g" "$conf_path"
    }

    # Fetch and configure mongos.conf, shard1.conf, shard2.conf, configdb.conf
    fetch_and_configure_conf mongos.conf
    fetch_and_configure_conf shard1.conf
    fetch_and_configure_conf shard2.conf
    fetch_and_configure_conf configdb.conf

    # Step 4: Create MongoDB Service Files
    fetch_and_configure_service() {
        local service_name=$1
        local service_url="https://autosetup.opnet.org/$service_name"
        local service_path="/usr/lib/systemd/system/$service_name"

        if [ -f "$service_path" ]; then
            echo -e "${YELLOW}$service_path already exists.${NC}"
            read -p "Do you want to overwrite it? [y/N]: " overwrite_service
            if [[ ! "$overwrite_service" =~ ^[Yy]$ ]]; then
                echo -e "${YELLOW}Skipping $service_name.${NC}"
                return
            fi
        fi

        # Fetch the file
        sudo curl -fsSL "$service_url" -o "$service_path"
    }

    fetch_and_configure_service mongos.service
    fetch_and_configure_service shard1.service
    fetch_and_configure_service shard2.service
    fetch_and_configure_service configdb.service

    # Reload systemd daemon
    sudo systemctl daemon-reload

    # Step 5: Start MongoDB Services
    echo -e "${BLUE}Starting MongoDB services...${NC}"
    sudo systemctl start mongos
    sudo systemctl start configdb
    sudo systemctl start shard1
    sudo systemctl start shard2

    # Verify services are running
    echo -e "${BLUE}Verifying MongoDB services...${NC}"
    for service in mongos configdb shard1 shard2; do
        sudo systemctl is-active --quiet $service
        if [ $? -ne 0 ]; then
            echo -e "${RED}Service $service failed to start.${NC}"
            exit 1
        fi
    done

    echo -e "${GREEN}MongoDB services started successfully.${NC}"

    # Step 6: Initialize the MongoDB Cluster
    echo -e "${BLUE}Initializing MongoDB Cluster...${NC}"
    # Connect to config server and initialize the cluster
    mongosh --port 25480 --host 0.0.0.0 --eval "rs.initiate({ _id: 'configdb', configsvr: true, members: [ { _id: 0, host: 'localhost:25480' }] })"

    # Create admin user
    mongosh --port 25480 --host 0.0.0.0 --eval "db.getSiblingDB('admin').createUser({ user: 'opnet', pwd: '$mongodb_password', roles: [{ role: 'root', db: 'admin' }] });"

    # Initialize shard1
    mongosh --port 25481 --host 0.0.0.0 --eval "rs.initiate({ _id: 'shard1', members: [ { _id: 0, host: 'localhost:25481' }, { _id: 1, host: 'localhost:25482' }] })"

    # Step 7: Add shards to the cluster
    mongosh --port 25485 --host 0.0.0.0 --username opnet --password "$mongodb_password" --eval "sh.addShard('shard1/localhost:25481,localhost:25482')"

    # Verify services are still running
    echo -e "${BLUE}Verifying MongoDB services after initialization...${NC}"
    for service in mongos configdb shard1 shard2; do
        sudo systemctl is-active --quiet $service
        if [ $? -ne 0 ]; then
            echo -e "${RED}Service $service failed to run after initialization.${NC}"
            exit 1
        fi
    done

    echo -e "${GREEN}MongoDB installation and configuration completed successfully.${NC}"
}

# Function to install Node.js 21
install_nodejs() {
    echo -e "${BLUE}Starting Node.js 21 installation...${NC}"

    if command_exists node; then
        node_version=$(node -v)
        echo -e "${YELLOW}Node.js is already installed (Version: $node_version).${NC}"
        read -p "Do you want to uninstall it and proceed with fresh installation? [y/N]: " uninstall_node
        if [[ "$uninstall_node" =~ ^[Yy]$ ]]; then
            echo -e "${BLUE}Uninstalling existing Node.js installation...${NC}"
            sudo apt-get remove -y nodejs
        else
            echo -e "${RED}Canceled by user.${NC}"
            exit 1
        fi
    fi

    # Install Node.js 21
    echo -e "${BLUE}Installing Node.js 21...${NC}"
    curl -fsSL https://deb.nodesource.com/setup_21.x -o nodesource_setup.sh
    sudo -E bash nodesource_setup.sh
    sudo apt-get install -y nodejs

    # Verify installation
    if command_exists node; then
        node_version=$(node -v)
        echo -e "${GREEN}Node.js $node_version installed successfully.${NC}"
    else
        echo -e "${RED}Node.js installation failed. Exiting.${NC}"
        exit 1
    fi
}

# Function to install Cargo (Rust)
install_rust() {
    echo -e "${BLUE}Starting Rust installation...${NC}"

    if command_exists cargo; then
        rust_version=$(rustc --version)
        echo -e "${YELLOW}Rust is already installed ($rust_version).${NC}"
        read -p "Do you want to uninstall it and proceed with fresh installation? [y/N]: " uninstall_rust
        if [[ "$uninstall_rust" =~ ^[Yy]$ ]]; then
            echo -e "${BLUE}Uninstalling existing Rust installation...${NC}"
            rustup self uninstall -y
        else
            echo -e "${RED}Canceled by user.${NC}"
            exit 1
        fi
    fi

    # Install Rust
    echo -e "${BLUE}Installing Rust...${NC}"
    curl https://sh.rustup.rs -sSf | sh -s -- -y

    # Add Cargo to PATH
    source $HOME/.cargo/env

    # Verify installation
    if command_exists cargo; then
        rust_version=$(rustc --version)
        echo -e "${GREEN}Rust $rust_version installed successfully.${NC}"
    else
        echo -e "${RED}Rust installation failed. Exiting.${NC}"
        exit 1
    fi
}

# Function to setup OPNet Indexer
setup_opnet_indexer() {
    echo -e "${BLUE}Setting up OPNet Indexer...${NC}"

    # Clone the repository
    if [ -d "$HOME/bsi-indexer" ]; then
        echo -e "${YELLOW}Repository already cloned at $HOME/bsi-indexer.${NC}"
        read -p "Do you want to remove it and clone again? [y/N]: " clone_again
        if [[ "$clone_again" =~ ^[Yy]$ ]]; then
            rm -rf "$HOME/bsi-indexer"
        else
            echo -e "${YELLOW}Using existing repository.${NC}"
        fi
    fi

    if [ ! -d "$HOME/bsi-indexer" ]; then
        echo -e "${BLUE}Cloning the OPNet Indexer repository...${NC}"
        git clone https://github.com/btc-vision/bsi-indexer.git "$HOME/bsi-indexer"
        git checkout features/recode-sync-task
    fi

    # Install global dependencies
    echo -e "${BLUE}Installing global npm dependencies...${NC}"
    sudo npm install -g gulp

    # Install project dependencies
    echo -e "${BLUE}Installing project npm dependencies...${NC}"
    cd "$HOME/bsi-indexer" || exit 1
    npm install

    # Configure the indexer config file
    config_file="$HOME/bsi-indexer/build/config/btc.conf"

    if [ -f "$config_file" ]; then
        echo -e "${YELLOW}Configuration file already exists at $config_file.${NC}"
        read -p "Do you want to overwrite it? [y/N]: " overwrite_config
        if [[ ! "$overwrite_config" =~ ^[Yy]$ ]]; then
            echo -e "${YELLOW}Using existing configuration file.${NC}"
            return
        fi
    fi

    echo -e "${BLUE}Configuring the OPNet Indexer...${NC}"

    read -p "Enter CHAIN_ID (0 for Bitcoin, 1 for Fractal): " CHAIN_ID
    read -p "Enter NETWORK (regtest, testnet, mainnet): " NETWORK

    # Initialize variables
    PUBKEY_ADDRESS=""
    SCRIPT_ADDRESS=""
    SECRET_KEY=""
    EXT_PUBLIC_KEY=""
    EXT_SECRET_KEY=""
    HRP=""
    NETWORK_MAGIC=""

    # Set default configurations based on known networks
    if [[ "$CHAIN_ID" == "0" || "$CHAIN_ID" == "1" ]]; then
        if [[ "$NETWORK" == "mainnet" ]]; then
            PUBKEY_ADDRESS="0x00"
            SCRIPT_ADDRESS="0x05"
            SECRET_KEY="0x80"
            EXT_PUBLIC_KEY="0x0488b21e"
            EXT_SECRET_KEY="0x0488ade4"
            HRP="bc"
        elif [[ "$NETWORK" == "testnet" ]]; then
            PUBKEY_ADDRESS="0x6f"
            SCRIPT_ADDRESS="0xc4"
            SECRET_KEY="0xef"
            EXT_PUBLIC_KEY="0x043587cf"
            EXT_SECRET_KEY="0x04358394"
            HRP="tb"
        elif [[ "$NETWORK" == "regtest" ]]; then
            PUBKEY_ADDRESS="0x6f"
            SCRIPT_ADDRESS="0xc4"
            SECRET_KEY="0xef"
            EXT_PUBLIC_KEY="0x043587cf"
            EXT_SECRET_KEY="0x04358394"
            HRP="bcrt"
        else
            echo -e "${YELLOW}Unknown NETWORK. Please provide the configurations manually.${NC}"
            # Prompt for manual input
            read -p "NETWORK_MAGIC (e.g., [232, 173, 163, 200]): " NETWORK_MAGIC
            echo "[BASE58]"
            read -p "PUBKEY_ADDRESS: " PUBKEY_ADDRESS
            read -p "SCRIPT_ADDRESS: " SCRIPT_ADDRESS
            read -p "SECRET_KEY: " SECRET_KEY
            read -p "EXT_PUBLIC_KEY: " EXT_PUBLIC_KEY
            read -p "EXT_SECRET_KEY: " EXT_SECRET_KEY
            echo "[BECH32]"
            read -p "HRP: " HRP
        fi
    else
        echo -e "${YELLOW}Custom CHAIN_ID detected. Please provide NETWORK_MAGIC (e.g., [232, 173, 163, 200]):${NC}"
        read -p "NETWORK_MAGIC: " NETWORK_MAGIC
        echo "[BASE58]"
        read -p "PUBKEY_ADDRESS: " PUBKEY_ADDRESS
        read -p "SCRIPT_ADDRESS: " SCRIPT_ADDRESS
        read -p "SECRET_KEY: " SECRET_KEY
        read -p "EXT_PUBLIC_KEY: " EXT_PUBLIC_KEY
        read -p "EXT_SECRET_KEY: " EXT_SECRET_KEY
        echo "[BECH32]"
        read -p "HRP: " HRP
    fi

    read -p "Disable UTXO indexing? (y/N): " disable_utxo_indexing
    if [[ "$disable_utxo_indexing" =~ ^[Yy]$ ]]; then
        DISABLE_UTXO_INDEXING=true
    else
        DISABLE_UTXO_INDEXING=false
    fi

    echo -e "${YELLOW}Only ARCHIVE mode is supported at this time.${NC}"
    MODE="ARCHIVE"

    # Configure BLOCKCHAIN settings
    echo -e "${BLUE}Please provide your Bitcoin node RPC settings:${NC}"
    read -p "BITCOIND_HOST [localhost]: " BITCOIND_HOST
    BITCOIND_HOST=${BITCOIND_HOST:-localhost}
    read -p "BITCOIND_PORT [8001]: " BITCOIND_PORT
    BITCOIND_PORT=${BITCOIND_PORT:-8001}
    read -p "BITCOIND_USERNAME: " BITCOIND_USERNAME
    read -s -p "BITCOIND_PASSWORD: " BITCOIND_PASSWORD
    echo ""

    # Configure DATABASE settings
    echo -e "${BLUE}Configuring database settings...${NC}"
    DATABASE_HOST=""
    DATABASE_PORT=25480
    DATABASE_NAME="BTC"
    DATABASE_USERNAME="opnet"
    DATABASE_PASSWORD="$mongodb_password"

    # Generate the configuration file
    cat <<EOF > "$config_file"
DEBUG_LEVEL = 4
DEV_MODE = false

[BITCOIN]
CHAIN_ID = $CHAIN_ID
NETWORK = "$NETWORK"
NETWORK_MAGIC = $NETWORK_MAGIC

[BASE58]
PUBKEY_ADDRESS = "$PUBKEY_ADDRESS"
SCRIPT_ADDRESS = "$SCRIPT_ADDRESS"
SECRET_KEY = "$SECRET_KEY"
EXT_PUBLIC_KEY = "$EXT_PUBLIC_KEY"
EXT_SECRET_KEY = "$EXT_SECRET_KEY"

[BECH32]
HRP = "$HRP"

[INDEXER]
ENABLED = true
BLOCK_UPDATE_METHOD = "RPC"
STORAGE_TYPE = "MONGODB"

DISABLE_UTXO_INDEXING = $DISABLE_UTXO_INDEXING

[OP_NET]
MODE = "$MODE"

[BLOCKCHAIN]
BITCOIND_HOST = "$BITCOIND_HOST"
BITCOIND_PORT = $BITCOIND_PORT
BITCOIND_USERNAME = "$BITCOIND_USERNAME"
BITCOIND_PASSWORD = "$BITCOIND_PASSWORD"

[DATABASE]
HOST = "$DATABASE_HOST"
PORT = $DATABASE_PORT
DATABASE_NAME = "$DATABASE_NAME"

[DATABASE.AUTH]
USERNAME = "$DATABASE_USERNAME"
PASSWORD = "$DATABASE_PASSWORD"
EOF

    echo -e "${GREEN}Configuration file saved at $config_file.${NC}"

    # Build the project
    echo -e "${BLUE}Building the project...${NC}"
    npm run build

    if [ $? -eq 0 ]; then
        echo -e "${GREEN}Project built successfully.${NC}"
        echo -e "${GREEN}To start the OPNet Indexer, run the following command in the project directory:${NC}"
        echo -e "${YELLOW}npm start${NC}"
    else
        echo -e "${RED}Project build failed.${NC}"
        exit 1
    fi
}

# Proceed with the installations based on user's choice
if [ "$install_mongodb" = true ]; then
    install_and_configure_mongodb
fi

if [ "$install_nodejs" = true ]; then
    install_nodejs
fi

if [ "$install_rust" = true ]; then
    install_rust
fi

if [ "$setup_indexer" = true ]; then
    setup_opnet_indexer
fi

echo -e "${GREEN}Installation completed successfully!${NC}"
