#!/bin/bash

# OPNet Indexer Installation Wizard

# Color definitions
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[1;34m'
BOLD='\033[1m'
NC='\033[0m' # No Color

# Variables to store auto-generated credentials
password_auto_generated=false
auto_generated_password=""

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

# Check if the script is run as root
if [ "$EUID" -ne 0 ]; then
    echo -e "${RED}Please run this script as root or with sudo.${NC}"
    exit 1
fi

# Present options to the user
echo "Please select an option:"
echo "1. Install & Configure all the necessary dependencies (default)"
echo "2. Install & Configure MongoDB"
echo "3. Install Node.js 21"
echo "4. Install Cargo (Rust)"
echo "5. Setup OPNet Indexer"
echo "6. Update OPNet Indexer"

# Read user choice
read -p "Enter your choice [1-6]: " choice

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
    6)
        echo "You have chosen to update the OPNet Indexer."
        update_indexer=true
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

# Function to wait for MongoDB service to be ready
wait_for_mongo() {
    local host=$1
    local port=$2
    local retries=30
    local wait=2

    for ((i=1; i<=retries; i++)); do
        nc -z "$host" "$port" && break
        echo -e "${YELLOW}Waiting for MongoDB at $host:$port... (${i}/${retries})${NC}"
        sleep "$wait"
    done

    if (( i > retries )); then
        echo -e "${RED}MongoDB at $host:$port is not responding. Exiting.${NC}"
        exit 1
    fi
}

# Function to check MongoDB service status and attempt to correct errors
check_and_fix_mongo_service() {
    local service_name=$1

    # Check if the service is active
    if ! sudo systemctl is-active --quiet "$service_name"; then
        echo -e "${RED}$service_name service is not running.${NC}"
        echo -e "${BLUE}Attempting to restart $service_name...${NC}"
        sudo systemctl restart "$service_name"
        sleep 5
        if ! sudo systemctl is-active --quiet "$service_name"; then
            echo -e "${RED}Failed to restart $service_name. Please check the service status for more details.${NC}"
            exit 1
        else
            echo -e "${GREEN}$service_name restarted successfully.${NC}"
        fi
    fi

    # Check for errors in the service status
    service_status=$(sudo systemctl status "$service_name" --no-pager)

    if echo "$service_status" | grep -q "Failed to start"; then
        echo -e "${RED}Detected 'Failed to start' error in $service_name.${NC}"
        echo -e "${BLUE}Attempting to fix common issues...${NC}"

        # Check for keyfile permission issues
        if echo "$service_status" | grep -q "permissions on the keyfile are too open"; then
            echo -e "${YELLOW}Keyfile permissions are too open. Fixing permissions...${NC}"
            sudo chown mongodb:mongodb /etc/mongodb/keys/mongo-key
            sudo chmod 400 /etc/mongodb/keys/mongo-key
        fi

        # Restart the service after attempting fixes
        echo -e "${BLUE}Restarting $service_name...${NC}"
        sudo systemctl restart "$service_name"
        sleep 5
        if ! sudo systemctl is-active --quiet "$service_name"; then
            echo -e "${RED}Failed to restart $service_name after fixes. Please check the service status for more details.${NC}"
            exit 1
        else
            echo -e "${GREEN}$service_name restarted successfully after fixes.${NC}"
        fi
    fi

    echo -e "${GREEN}$service_name is running properly.${NC}"
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

            # Stop MongoDB services if running
            for service in mongod mongos shard1 shard2 configdb; do
                if systemctl is-active --quiet "$service"; then
                    echo -e "${BLUE}Stopping $service service...${NC}"
                    sudo systemctl stop "$service"
                fi
            done

            sudo apt-get purge mongodb-org* -y
            sudo rm -rf /var/log/mongodb
            sudo rm -rf /var/lib/mongodb
            sudo rm -rf /etc/mongodb
        else
            echo -e "${RED}Canceled by user.${NC}"
            exit 1
        fi
    fi

    # Install netcat for port checking
    if ! command_exists nc; then
        echo -e "${BLUE}Installing netcat for port checking...${NC}"
        sudo apt-get install netcat -y
    fi

    # Install gnupg and curl
    echo -e "${BLUE}Installing gnupg and curl...${NC}"
    sudo apt-get install gnupg curl -y

    # Check if OpenSSL is installed
    if ! command_exists openssl; then
        echo -e "${BLUE}OpenSSL is not installed. Installing OpenSSL...${NC}"
        sudo apt-get install openssl -y
    fi

    # Check if MongoDB public GPG Key is already in the system
    if [ -f /usr/share/keyrings/mongodb-server-7.0.gpg ]; then
        echo -e "${YELLOW}MongoDB public GPG key already exists.${NC}"
    else
        # Import the MongoDB public GPG Key
        echo -e "${BLUE}Importing MongoDB public GPG Key...${NC}"
        curl -fsSL https://www.mongodb.org/static/pgp/server-7.0.asc | sudo gpg -o /usr/share/keyrings/mongodb-server-7.0.gpg --dearmor
    fi

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

    # Check if /mnt/data/ exists
    if [ -d "/mnt/data" ]; then
        echo -e "${YELLOW}/mnt/data/ directory already exists.${NC}"
        read -p "Do you want to purge it and reinstall? [y/N]: " purge_data
        if [[ "$purge_data" =~ ^[Yy]$ ]]; then
            echo -e "${BLUE}Purging /mnt/data/...${NC}"
            sudo rm -rf /mnt/data
            sudo mkdir -p /mnt/data/configdb
            sudo mkdir -p /mnt/data/shard1
            sudo mkdir -p /mnt/data/shard2
        else
            echo -e "${YELLOW}Keeping existing data in /mnt/data/.${NC}"
            # Ensure required subdirectories exist
            [ -d "/mnt/data/configdb" ] || sudo mkdir -p /mnt/data/configdb
            [ -d "/mnt/data/shard1" ] || sudo mkdir -p /mnt/data/shard1
            [ -d "/mnt/data/shard2" ] || sudo mkdir -p /mnt/data/shard2
        fi
    else
        sudo mkdir -p /mnt/data/configdb
        sudo mkdir -p /mnt/data/shard1
        sudo mkdir -p /mnt/data/shard2
    fi

    sudo mkdir -p /etc/mongodb
    sudo mkdir -p /etc/mongodb/keys

    # Step 2: Generate keyfile
    if [ -f /etc/mongodb/keys/mongo-key ]; then
        echo -e "${YELLOW}/etc/mongodb/keys/mongo-key already exists.${NC}"
        read -p "Do you want to overwrite it? [y/N]: " overwrite_key
        if [[ "$overwrite_key" =~ ^[Yy]$ ]]; then
            sudo rm /etc/mongodb/keys/mongo-key
            sudo openssl rand -base64 756 > /etc/mongodb/keys/mongo-key
        else
            echo -e "${YELLOW}Using existing keyfile.${NC}"
        fi
    else
        sudo openssl rand -base64 756 > /etc/mongodb/keys/mongo-key
    fi

    # Set permissions
    sudo chown mongodb:mongodb /etc/mongodb/keys/mongo-key
    sudo chmod 400 /etc/mongodb/keys/mongo-key

    # Step 3: Create MongoDB Config Files

    # Prompt for custom database username
    read -p "Enter MongoDB admin username [opnet]: " mongodb_admin_username
    mongodb_admin_username=${mongodb_admin_username:-opnet}

    # Prompt for password for the custom username
    read -s -p "Enter a password for MongoDB user '$mongodb_admin_username' (leave empty to generate a random password): " mongodb_password
    echo ""

    if [[ -z "$mongodb_password" ]]; then
        # Generate a random password
        mongodb_password=$(openssl rand -base64 16)
        echo -e "${BLUE}A random password has been generated for MongoDB user '$mongodb_admin_username'.${NC}"
        password_auto_generated=true
        auto_generated_password="$mongodb_password"
    fi

    read -p "Enter the amount of RAM (in GB) to allocate for each shard (or press Enter for auto-select): " shard_ram

    if [[ -z "$shard_ram" ]]; then
        # Auto-select RAM
        total_ram_kb=$(grep MemTotal /proc/meminfo | awk '{print $2}')
        total_ram_gb=$(echo "scale=2; $total_ram_kb / 1024 / 1024" | bc)
        shard_ram=$(echo "scale=0; $total_ram_gb * 0.3 / 1" | bc)
        echo -e "${BLUE}Automatically allocated $shard_ram GB of RAM per shard.${NC}"
    fi

    # Ask the user if they wish to expose MongoDB to the internet
    echo -e "${BLUE}Do you wish to expose MongoDB to the internet?${NC}"
    read -p "Type 'yes' to expose, or 'no' to bind to localhost only [no]: " expose_mongodb
    expose_mongodb=${expose_mongodb:-no}

    if [[ "$expose_mongodb" == "yes" ]]; then
        bind_ip="0.0.0.0"
    else
        bind_ip="127.0.0.1"
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

        # Replace bindIp
        sudo sed -i "s/bindIp:.*/bindIp: $bind_ip/g" "$conf_path"
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
    sudo systemctl start configdb
    sudo systemctl start shard1
    sudo systemctl start shard2

    # Verify services are running and attempt to fix if not
    echo -e "${BLUE}Verifying and fixing MongoDB services...${NC}"
    for service in configdb shard1 shard2; do
        check_and_fix_mongo_service "$service"
    done

    echo -e "${GREEN}MongoDB services are running properly.${NC}"

    # Wait for MongoDB services to be ready
    wait_for_mongo "localhost" 25480
    wait_for_mongo "localhost" 25481

    # Step 6: Initialize the MongoDB Cluster
    echo -e "${BLUE}Initializing MongoDB Cluster...${NC}"

    # Function to run MongoDB commands with retries
    run_mongo_command() {
        local mongo_command=$1
        local host=$2
        local port=$3
        local auth_args=$4
        local retries=10
        local wait=5

        for ((i=1; i<=retries; i++)); do
            mongosh --host "$host" --port "$port" $auth_args --eval "$mongo_command" && break
            echo -e "${YELLOW}Retrying MongoDB command... (${i}/${retries})${NC}"
            sleep "$wait"
        done

        if (( i > retries )); then
            echo -e "${RED}Failed to run MongoDB command after multiple attempts. Exiting.${NC}"
            exit 1
        fi
    }

    # Initialize config server
    echo -e "${BLUE}Initializing config server...${NC}"
    run_mongo_command "rs.initiate({ _id: 'configdb', configsvr: true, members: [ { _id: 0, host: 'localhost:25480' }] })" "localhost" 25480 ""

    # Create admin user
    echo -e "${BLUE}Creating admin user...${NC}"
    run_mongo_command "db.getSiblingDB('admin').createUser({ user: '$mongodb_admin_username', pwd: '$mongodb_password', roles: [{ role: 'root', db: 'admin' }] });" "localhost" 25480 ""

    echo -e "${BLUE}Starting MongoS...${NC}"

    # Start mongos
    sudo systemctl start mongos

    # Verify mongos is running and attempt to fix if not
    check_and_fix_mongo_service mongos

    # Wait for mongos to be ready
    wait_for_mongo "localhost" 25485

    # Initialize shard1
    echo -e "${BLUE}Initializing shard1...${NC}"
    run_mongo_command "rs.initiate({ _id: 'shard1', members: [ { _id: 0, host: 'localhost:25481' }, { _id: 1, host: 'localhost:25482' }] })" "localhost" 25481 ""

    # Step 7: Add shards to the cluster
    echo -e "${BLUE}Adding shards to the cluster...${NC}"
    run_mongo_command "sh.addShard('shard1/localhost:25481,localhost:25482')" "localhost" 25485 "--username $mongodb_admin_username --password '$mongodb_password'"

    # Verify services are still running
    echo -e "${BLUE}Verifying MongoDB services after initialization...${NC}"
    for service in mongos configdb shard1 shard2; do
        check_and_fix_mongo_service "$service"
    done

    echo -e "${GREEN}MongoDB installation and configuration completed successfully.${NC}"

    # Inform the user to keep the password safe
    echo -e "${YELLOW}Please make sure to save the MongoDB admin username and password securely.${NC}"
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

# Function to handle build/bin directory backup and restoration
handle_bin_directory() {
    local action="$1"           # "install" or "update"
    local indexer_dir="$2"
    local bin_dir="$indexer_dir/build/bin"
    local backup_bin_dir="$HOME/bin_backup_${action}"

    if [ -d "$bin_dir" ]; then
        echo -e "${RED}${BOLD}WARNING:${NC}"
        echo -e "${RED}The directory ${YELLOW}$bin_dir${RED} contains important information about the current peer you are running.${NC}"
        echo -e "${RED}If you discard this directory, your indexer wallet and identity will be ${BOLD}LOST.${NC}"
        echo -e "${RED}It is crucial to preserve this directory during the ${action} process.${NC}"
        echo ""
        read -p "Do you understand and wish to proceed with the ${action}, preserving your wallet and identity? [y/N]: " proceed_choice
        if [[ "$proceed_choice" != "y" && "$proceed_choice" != "Y" ]]; then
            echo -e "${YELLOW}${action^} canceled by user.${NC}"
            exit 1
        fi

        # Backup the build/bin directory
        cp -r "$bin_dir" "$backup_bin_dir"
        echo -e "${GREEN}Your build/bin directory has been backed up to $backup_bin_dir.${NC}"
    fi

    # Return the path to the backup directory
    echo "$backup_bin_dir"
}

# Function to restore build/bin directory after cloning
restore_bin_directory() {
    local backup_bin_dir="$1"
    local indexer_dir="$2"
    local bin_dir="$indexer_dir/build/bin"

    if [ -d "$backup_bin_dir" ]; then
        mkdir -p "$indexer_dir/build"
        mv "$backup_bin_dir" "$bin_dir"
        echo -e "${GREEN}Your build/bin directory has been restored.${NC}"
    fi
}

# Function to clone and build the OPNet Indexer
clone_and_build_indexer() {
    local indexer_dir="$1"

    # Clone the repository
    echo -e "${BLUE}Cloning the OPNet Indexer repository...${NC}"
    git clone git@github.com:btc-vision/bsi-indexer.git "$indexer_dir"
    cd "$indexer_dir" || exit 1
    git checkout features/recode-sync-task

    # Install npm dependencies
    echo -e "${BLUE}Installing npm dependencies...${NC}"
    npm install

    # Build the project and capture output
    echo -e "${BLUE}Building the project...${NC}"
    build_output=$(npm run build 2>&1)

    # Check for build errors
    if echo "$build_output" | grep -q "errored after"; then
        echo -e "${RED}Build failed with errors.${NC}"
        echo -e "${YELLOW}Build output:${NC}"
        echo "$build_output"
        exit 1
    else
        echo -e "${GREEN}Project built successfully.${NC}"
    fi
}

# Function to setup OPNet Indexer
setup_opnet_indexer() {
    echo -e "${BLUE}Setting up OPNet Indexer...${NC}"

    INDEXER_DIR="$HOME/bsi-indexer"
    CONFIG_FILE="$INDEXER_DIR/build/config/btc.conf"

    if [ -d "$INDEXER_DIR" ]; then
        echo -e "${YELLOW}OPNet Indexer directory already exists.${NC}"

        # Handle build/bin directory backup
        backup_bin_dir=$(handle_bin_directory "install" "$INDEXER_DIR")

        read -p "Do you want to remove the existing directory and proceed with a fresh installation? [y/N]: " reinstall_choice
        if [[ "$reinstall_choice" == "y" || "$reinstall_choice" == "Y" ]]; then
            rm -rf "$INDEXER_DIR"
            echo -e "${BLUE}Old OPNet Indexer directory removed.${NC}"
        else
            echo -e "${RED}Installation canceled by user.${NC}"
            exit 1
        fi
    fi

    # Clone and build the indexer
    clone_and_build_indexer "$INDEXER_DIR"

    # Restore build/bin directory if it was backed up
    restore_bin_directory "$backup_bin_dir" "$INDEXER_DIR"

    if [ -f "$CONFIG_FILE" ]; then
        echo -e "${YELLOW}Configuration file already exists at $CONFIG_FILE.${NC}"
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
    read -p "Enter MongoDB username [opnet]: " DATABASE_USERNAME
    DATABASE_USERNAME=${DATABASE_USERNAME:-opnet}

    # Check if $mongodb_password is set; if not, prompt the user
    if [ -z "$mongodb_password" ]; then
        echo -e "${YELLOW}MongoDB password is not set.${NC}"
        read -s -p "Please enter the MongoDB password for user '$DATABASE_USERNAME': " mongodb_password
        echo ""
    fi
    DATABASE_PASSWORD="$mongodb_password"

    DATABASE_HOST=""
    DATABASE_PORT=25480
    DATABASE_NAME="BTC"

    # Generate the configuration file
    cat <<EOF > "$CONFIG_FILE"
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

    echo -e "${GREEN}Configuration file saved at $CONFIG_FILE.${NC}"

    echo -e "${GREEN}To start the OPNet Indexer, run the following command in the project directory:${NC}"
    echo -e "${YELLOW}npm start${NC}"
}

# Function to update OPNet Indexer
update_opnet_indexer() {
    echo -e "${BLUE}Updating OPNet Indexer...${NC}"

    INDEXER_DIR="$HOME/bsi-indexer"
    CONFIG_FILE="$INDEXER_DIR/build/config/btc.conf"
    BACKUP_CONFIG_FILE="$HOME/btc.conf.backup"

    # Check if the indexer directory exists
    if [ ! -d "$INDEXER_DIR" ]; then
        echo -e "${RED}OPNet Indexer is not installed in $INDEXER_DIR.${NC}"
        echo -e "${YELLOW}Please run the setup first.${NC}"
        exit 1
    fi

    # Get local version from package.json
    if [ -f "$INDEXER_DIR/package.json" ]; then
        local_version=$(grep '"version":' "$INDEXER_DIR/package.json" | head -1 | awk -F '"' '{print $4}')
        echo -e "${BLUE}Local OPNet Indexer version: $local_version${NC}"
    else
        echo -e "${RED}Cannot find package.json in $INDEXER_DIR.${NC}"
        exit 1
    fi

    # Get latest version from GitHub
    echo -e "${BLUE}Fetching latest version from GitHub...${NC}"
    latest_version=$(curl -s https://raw.githubusercontent.com/btc-vision/bsi-indexer/features/recode-sync-task/package.json | grep '"version":' | head -1 | awk -F '"' '{print $4}')
    if [ -z "$latest_version" ]; then
        echo -e "${RED}Failed to fetch latest version from GitHub.${NC}"
        exit 1
    fi
    echo -e "${BLUE}Latest OPNet Indexer version on GitHub: $latest_version${NC}"

    # Compare versions
    if [ "$local_version" == "$latest_version" ]; then
        echo -e "${GREEN}You already have the latest version of the OPNet Indexer.${NC}"
    else
        echo -e "${YELLOW}Your local version ($local_version) is outdated.${NC}"
        read -p "Do you wish to upgrade to version $latest_version? [y/N]: " upgrade_choice
        if [[ "$upgrade_choice" == "y" || "$upgrade_choice" == "Y" ]]; then

            # Handle build/bin directory backup
            backup_bin_dir=$(handle_bin_directory "update" "$INDEXER_DIR")

            # Backup configuration file
            if [ -f "$CONFIG_FILE" ]; then
                cp "$CONFIG_FILE" "$BACKUP_CONFIG_FILE"
                echo -e "${GREEN}Your configuration file has been backed up to $BACKUP_CONFIG_FILE.${NC}"
            else
                echo -e "${YELLOW}No configuration file found to backup.${NC}"
            fi

            # Remove old repository
            rm -rf "$INDEXER_DIR"
            echo -e "${BLUE}Old OPNet Indexer repository has been removed.${NC}"

            # Clone and build the indexer
            clone_and_build_indexer "$INDEXER_DIR"

            # Restore configuration file
            if [ -f "$BACKUP_CONFIG_FILE" ]; then
                mkdir -p "$INDEXER_DIR/build/config"
                mv "$BACKUP_CONFIG_FILE" "$CONFIG_FILE"
                echo -e "${GREEN}Your configuration file has been restored.${NC}"
            fi

            # Restore build/bin directory
            restore_bin_directory "$backup_bin_dir" "$INDEXER_DIR"

            echo -e "${GREEN}OPNet Indexer has been updated to version $latest_version.${NC}"
            echo -e "${YELLOW}Please review your configuration file for any new settings that may be required.${NC}"
            echo -e "${GREEN}To start the OPNet Indexer, run the following command in the project directory:${NC}"
            echo -e "${YELLOW}npm start${NC}"
        else
            echo -e "${YELLOW}Upgrade canceled by user.${NC}"
        fi
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

if [ "$update_indexer" = true ]; then
    update_opnet_indexer
fi

# At the end of the script, if the password was auto-generated, offer to display it
if [ "$password_auto_generated" = true ]; then
    echo ""
    echo -e "${YELLOW}Note:${NC} You chose to generate a random password for MongoDB user '$mongodb_admin_username'."
    read -p "Would you like to view the auto-generated MongoDB password now? [y/N]: " show_password
    if [[ "$show_password" == "y" || "$show_password" == "Y" ]]; then
        echo -e "${GREEN}Your MongoDB password is:${NC} ${auto_generated_password}"
        echo -e "${YELLOW}Please copy and store it securely.${NC}"
    else
        echo -e "${YELLOW}You can retrieve the password from the log file or reset it if necessary.${NC}"
    fi
fi

echo -e "${GREEN}Installation completed successfully!${NC}"
