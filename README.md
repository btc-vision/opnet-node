;# BSI Indexer (PoA): The OPNet Indexer
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
Welcome to the BSI-Indexer GitHub repository. This repository contains the source code and documentation for the Bitcoin Smart Inscription (BSI) Indexer, an essential component of a decentralized system that leverages Taproot technology to manage and execute smart contracts on the Bitcoin blockchain. The BSI-Indexer plays a critical role in maintaining the integrity and functionality of Wrapped Bitcoin (WBTC) transactions.

## Repository Contents

- **src/**: Source code of the BSI-Indexer, including core functionality and integration modules.
- **docs/**: Comprehensive documentation, setup guides, and API specifications.
- **tests/**: Test scripts and testing frameworks to ensure the stability and reliability of the indexer.
- **examples/**: Sample code and practical examples for developers looking to integrate or build upon the BSI-Indexer.
- **scripts/**: Utility scripts for deployment, maintenance, and operational tasks.

## Features

- **Smart Inscription Execution**: Execution of smart contracts through the WASM VM, handling sophisticated logic and state changes.
- **State Management and Proofs**: Robust management of contract states, including computing and validating state changes using Merkle proofs.
- **Merkle Root Calculation**: Computation of state roots and transaction receipt roots for comprehensive summaries of contract states and transaction outcomes.
- **Recovery and Reversion**: Capabilities to revert states or initiate full rescans in the event of discrepancies or blockchain reorganizations.
- **Validator-Based Governance**: Integration with Proof of Authority (PoA) to ensure trusted and reliable network governance by verified validators.

## Getting Started

To get started with the BSI-Indexer, follow these setup instructions:

### Prerequisites

- Node.js version 20.x or higher
- npm (Node Package Manager)
- Bitcoin Node (Latest version)
- MongoDB 6.1
- Docker (optional, for container-based deployment)

### Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/btc-vision/bsi-indexer.git
   ```
2. Navigate to the repository directory:
   ```bash
   cd bsi-indexer
   ```
3. Install the necessary dependencies:
   ```bash
   npm i
   ```
4. To start the indexer:
   ```bash
   npm start
   ```

## Configuration

Before launching the indexer, configure the environment variables and settings according to your deployment environment. Sample configuration files can be found in the `config/` directory. Adjust the settings for network endpoints, security parameters, and operational modes as needed.

## License

View the licence by clicking [here](https://github.com/btc-vision/bsi/blob/main/LICENSE.md).