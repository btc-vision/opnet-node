# OP_NET - Indexer (Proof of Authority)

![Bitcoin](https://img.shields.io/badge/Bitcoin-000?style=for-the-badge&logo=bitcoin&logoColor=white)
![AssemblyScript](https://img.shields.io/badge/assembly%20script-%23000000.svg?style=for-the-badge&logo=assemblyscript&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=for-the-badge&logo=typescript&logoColor=white)
![NodeJS](https://img.shields.io/badge/Node%20js-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)
![MongoDB](https://img.shields.io/badge/MongoDB-%234ea94b.svg?style=for-the-badge&logo=mongodb&logoColor=white)
![NPM](https://img.shields.io/badge/npm-CB3837?style=for-the-badge&logo=npm&logoColor=white)
![Gulp](https://img.shields.io/badge/GULP-%23CF4647.svg?style=for-the-badge&logo=gulp&logoColor=white)
![ESLint](https://img.shields.io/badge/ESLint-4B3263?style=for-the-badge&logo=eslint&logoColor=white)
![Swagger](https://img.shields.io/badge/-Swagger-%23Clojure?style=for-the-badge&logo=swagger&logoColor=white)

[![code style: prettier](https://img.shields.io/badge/code_style-prettier-ff69b4.svg?style=flat-square)](https://github.com/prettier/prettier)

## Introduction

Welcome to the BSI-Indexer GitHub repository. This repository contains the source code and documentation for the Bitcoin
Smart Inscription (BSI) Indexer, an essential component of a decentralized system that leverages Taproot technology to
manage and execute smart contracts on the Bitcoin blockchain. The BSI-Indexer plays a critical role in maintaining the
integrity and functionality of Wrapped Bitcoin (WBTC) transactions.

## Repository Contents

- **src/**: Source code of the BSI-Indexer, including core functionality and integration modules.
- **docs/**: Comprehensive documentation, setup guides, and API specifications.
- **tests/**: Test scripts and testing frameworks to ensure the stability and reliability of the indexer.
- **examples/**: Sample code and practical examples for developers looking to integrate or build upon the BSI-Indexer.
- **scripts/**: Utility scripts for deployment, maintenance, and operational tasks.

## Features

- **Smart Inscription Execution**: Execution of smart contracts through the WASM VM, handling sophisticated logic and
  state changes.
- **State Management and Proofs**: Robust management of contract states, including computing and validating state
  changes using Merkle proofs.
- **Merkle Root Calculation**: Computation of state roots and transaction receipt roots for comprehensive summaries of
  contract states and transaction outcomes.
- **Recovery and Reversion**: Capabilities to revert states or initiate full rescans in the event of discrepancies or
  blockchain reorganizations.
- **Validator-Based Governance**: Integration with Proof of Authority (PoA) to ensure trusted and reliable network
  governance by verified validators.

## Getting Started

To get started with the indexer, follow these setup instructions:

### Prerequisites

- Node.js version 20.x or higher, we recommend using node 21.x.
- npm (Node Package Manager)
- Bitcoin Node (Latest version)
- MongoDB (Latest version)
- Rust (cargo), this is required to run the wasm vm.

### Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/btc-vision/bsi-indexer.git
   ```
2. Navigate to the repository directory:
   ```bash
   cd bsi-indexer
   ```
3. To install rust on linux or macos, you can use the following command to install rust:
   ```bash
    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
    ```
   For windows, you can download the installer from the [Rust website](https://www.rust-lang.org/tools/install).
4. Install the necessary dependencies:
   ```bash
   npm i
   ```
5. Install Mongodb in a replica or sharded cluster mode. For more information, visit
   the [MongoDB documentation](https://docs.mongodb.com/manual/tutorial/deploy-replica-set/).

   Why is this needed? In order to use mongodb transactions, we must enable a replica set or a sharded cluster. This is
   very important for the correct operation of the indexer. This allows us to rollback transactions in case of an error.

   For more information, see our mongodb setup guide.

6. Configure your indexer.
   Make sure to configure the variables to your need in the configuration file located in the `config/` directory.

7. To start the indexer:
   ```bash
   npm start
   ```

## Configuration

Before launching the indexer, configure the environment variables and settings according to your deployment environment.
Sample configuration files can be found in the `config/` directory. Adjust the settings for network endpoints, security
parameters, and operational modes as needed.

## License

View the licence by clicking [here](https://github.com/btc-vision/bsi/blob/main/LICENSE.md).
