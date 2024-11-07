# OP_NET - Node

![Bitcoin](https://img.shields.io/badge/Bitcoin-000?style=for-the-badge&logo=bitcoin&logoColor=white)
![Rust](https://img.shields.io/badge/rust-%23000000.svg?style=for-the-badge&logo=rust&logoColor=white)
![AssemblyScript](https://img.shields.io/badge/assembly%20script-%23000000.svg?style=for-the-badge&logo=assemblyscript&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=for-the-badge&logo=typescript&logoColor=white)
![NodeJS](https://img.shields.io/badge/Node%20js-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)
![MongoDB](https://img.shields.io/badge/MongoDB-%234ea94b.svg?style=for-the-badge&logo=mongodb&logoColor=white)
![NPM](https://img.shields.io/badge/npm-CB3837?style=for-the-badge&logo=npm&logoColor=white)
![Gulp](https://img.shields.io/badge/GULP-%23CF4647.svg?style=for-the-badge&logo=gulp&logoColor=white)
![ESLint](https://img.shields.io/badge/ESLint-4B3263?style=for-the-badge&logo=eslint&logoColor=white)
![Swagger](https://img.shields.io/badge/-Swagger-%23Clojure?style=for-the-badge&logo=swagger&logoColor=white)

[![code style: prettier](https://img.shields.io/badge/code_style-prettier-ff69b4.svg?style=flat-square)](https://github.com/prettier/prettier)

## ⚠️ Important Notice ⚠️

This repository is currently under development and is not yet ready for production use. We are actively working on
implementing the features and functionalities outlined in this document. Please check back regularly for updates and
progress reports.

**Mainnet usage is prohibited until the official release of OP_NET. All actions taken on any
main network will be discarded on release.**

## Introduction

Welcome to the official **OP_NET Node** GitHub repository. This repository contains the source code and documentation
for the OPNet Node, an essential component of a decentralized system that leverages Taproot/SegWit/Legacy technology to
manage and execute smart contracts on the Bitcoin or any other UTXO-based blockchains.

## Table of Contents

- [Getting Started](#getting-started)
- [Features](#features)
- [Installation (Quick)](#installation-quick)
    - [Prerequisites](#prerequisites)
    - [Installation (Development)](#installation-development)
- [Repository Contents](#repository-contents)
- [Configuration](#configuration)
- [Consensus Mechanism](#consensus-mechanism)
    - [Proof of Calculation (PoC)](#proof-of-calculation-poc)
    - [Proof of Validation (PoV)](#proof-of-validation-pov)
    - [Combined PoC and PoV Layers](#combined-poc-and-pov-layers)
- [Feature Implementation Status](#feature-implementation-status)
    - [Implemented Features](#implemented-features)
    - [Features Left to Implement](#features-left-to-implement)
- [P2P and PSBT Trading](#p2p-and-psbt-trading)
    - [Overview](#overview)
    - [PSBT Trading on OPNet](#psbt-trading-on-opnet)
    - [How PSBT Trading Works](#how-psbt-trading-works)
        - [Seller Initiates Trade](#seller-initiates-trade)
        - [PSBT Creation](#psbt-creation)
        - [Buyer Participation](#buyer-participation)
        - [Transaction Completion](#transaction-completion)
    - [Security and Trustlessness](#security-and-trustlessness)
    - [Benefits of P2P and PSBT Trading on OPNet](#benefits-of-p2p-and-psbt-trading-on-opnet)
    - [Attack Vectors and Mitigations](#attack-vectors-and-mitigations)
    - [Failsafe Mechanism](#failsafe-mechanism)
- [Potential Issues](#potential-issues)
- [License](#license)

## Getting Started

To get started with the node, follow these setup instructions. OP_NET is designed to run on almost any operating
system and requires Node.js, npm, a Bitcoin node, and MongoDB.

## Features

- **Consensus Validation System**: OPNet employs a dual-layer consensus validation system integrating **Proof of
  Calculation (PoC)** and **Proof of Validation (PoV)**, enhancing error detection and defense against manipulation.

- **Data Sourcing from Bitcoin Network**: Data is sourced directly from the Bitcoin network, allowing each peer to
  independently recalculate and verify any information at any given block.

- **Permissionless Nodes (PoC)**: Nodes handle the initial layer of validation by independently recalculating data from
  the Bitcoin blockchain. This decentralized verification adds resilience without relying on trusted nodes. **Proof of
  Calculation** ensures that each node's calculations are accurate and aligned with network standards, fostering
  consistency across the decentralized network.

- **Bootstrap Nodes (PoV)**: Serving as **Proof of Validation** nodes, bootstrap nodes act as trusted verifiers. They
  perform independent recalculations and confirm results against official network entries, adding a rigorous validation
  layer. These nodes review calculations to detect potential errors or manipulations, enhancing trust without altering
  individual node data directly.

- **Independent State Determination**: Each node arrives at its own state independently based on PoC, without requiring
  a threshold of nodes to agree. PoV allows nodes to check what the canonical outputs are, which come from trusted nodes
  such as the OPNet Foundation.

- **Contract Execution**: Execution of smart contracts through the OP-VM, handling sophisticated logic and state
  changes.

- **State Management and Proofs**: Robust management of contract states, including computing and validating state
  changes using Merkle proofs.

- **Merkle Root Calculation**: Computation of state roots and transaction receipt roots for comprehensive summaries of
  contract states and transaction outcomes.

- **Recovery and Reversion**: Capabilities to revert states or initiate full rescans in the event of discrepancies or
  blockchain reorganizations.

- **Decentralized Network**: OPNet is a decentralized network that leverages the Bitcoin blockchain for security and
  immutability. Proofs and state changes are validated by a network of nodes, preparing for a future Proof of Stake (
  PoS) implementation.

## Installation (Quick)

OPNet provides an automated setup script for quick installation. To use the script, run the following command:

```bash
curl -fsSL https://autosetup.opnet.org/autoconfig.sh -o autoconfig.sh && sudo -E bash autoconfig.sh
```

### Prerequisites

- **Node.js** version 20.x or higher (we recommend using Node.js 21.x). Do not use Node.js 22.x as it is unstable and
  causes crashes.
- **npm** (Node Package Manager)
- **Bitcoin Node** (Latest version)
- **MongoDB** (Latest version)
- **Rust (cargo)**: Required to run the WASM VM.

### Installation (Development)

1. **Clone the repository**:

   ```bash
   git clone https://github.com/btc-vision/bsi-indexer.git
   ```

2. **Navigate to the repository directory**:

   ```bash
   cd bsi-indexer
   ```

3. **Install Rust**:

    - For Linux or macOS:

      ```bash
      curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
      ```

    - For Windows, download the installer from the [Rust website](https://www.rust-lang.org/tools/install).

4. **Install the necessary dependencies**:

   ```bash
   npm install
   ```

5. **Install MongoDB in a replica or sharded cluster mode**:

   Visit the [MongoDB documentation](https://docs.mongodb.com/manual/tutorial/deploy-replica-set/) for instructions.

   *Why is this needed?* To use MongoDB transactions, a replica set or sharded cluster must be enabled. This is crucial
   for the correct operation of the node, allowing rollback of transactions in case of errors. Refer to our MongoDB
   setup guide for more details.

6. **Configure your node**:

   Adjust the variables in the configuration file located in the `config/` directory to suit your needs.

7. **Start the node**:

   ```bash
   npm start
   ```

## Configuration

Before launching the node, configure the environment variables and settings according to your deployment environment.
Sample configuration files are located in the `config/` directory. Adjust settings for network endpoints, security
parameters, and operational modes as needed.

## Consensus Mechanism

OPNet utilizes a dual-layer consensus mechanism to maintain network security and data integrity.

### Proof of Calculation (PoC)

- **Role of Permissionless Nodes**: Permissionless nodes independently recalculate data from the Bitcoin network,
  ensuring each node's calculations are accurate and align with network standards.
- **Independent State Determination**: Each node arrives at its own state based solely on PoC, without needing a
  threshold of nodes to agree on a state.
- **Error Detection**: This decentralized approach adds resilience by detecting discrepancies through independent
  calculations.

### Proof of Validation (PoV)

- **Role of Bootstrap Nodes**: Bootstrap nodes act as trusted verifiers, serving as PoV nodes. They perform independent
  recalculations and validate results against official network entries.
- **Canonical Outputs**: PoV allows nodes to reference canonical outputs from trusted entities like the OPNet
  Foundation.
- **Enhanced Security**: This layer enhances error detection and defends against manipulation without altering
  individual node data.

### Combined PoC and PoV Layers

- **Integrity Assurance**: Nodes validated consistently by both untrusted recalculations and bootstrap node validations
  are deemed correct.
- **Preparation for PoS Transition**: This structure strengthens OPNet's security, establishing a trusted foundation for
  a future Proof of Stake transition.
- **Consensus Definition**: While consensus doesn't require a threshold of nodes to agree on a state, PoV provides a
  mechanism for nodes to check against canonical outputs, effectively defining an implied consensus mechanism.

## Feature Implementation Status

### Implemented Features

| Feature                                 | Description                                                                                                                                        |
|-----------------------------------------|----------------------------------------------------------------------------------------------------------------------------------------------------|
| **Network Protocol**                    | Comprehensive P2P communication, including encryption (ChaCha20-Poly1305 and X25519), security measures, and node discovery mechanisms.            |
| **Block Synchronization**               | Supports block recovery, reorganization handling, indexing, and automatic state recovery to maintain network integrity.                            |
| **VM Evaluation**                       | Manages state, computation, Merkle tree operations, and proof generation and verification within the OP-VM.                                        |
| **Consensus Validation System**         | Implements dual-layer consensus with Proof of Calculation (PoC) and Proof of Validation (PoV) to enhance error detection and prevent manipulation. |
| **Data Sourcing from Bitcoin Network**  | Directly sources data from the Bitcoin blockchain, allowing independent recalculation and verification at any block.                               |
| **Contract Execution**                  | Executes smart contracts via the OP-VM, handling complex logic and state changes.                                                                  |
| **State Management and Proofs**         | Robust state management, including computing and validating state changes using Merkle proofs.                                                     |
| **Checksum Calculation**                | Computes state roots and transaction receipt roots for comprehensive summaries of contract states and outcomes.                                    |
| **Recovery and Reversion Capabilities** | Ability to revert states or initiate full rescans in case of discrepancies or blockchain reorganizations.                                          |
| **Decentralized Network Structure**     | Operates as a decentralized network leveraging the Bitcoin blockchain for security and immutability.                                               |
| **P2P Encryption and Security**         | Utilizes advanced encryption protocols to secure P2P communications, ensuring data integrity and confidentiality across the network.               |
| **Node Discovery Mechanisms**           | Implements efficient algorithms for discovering and connecting to other nodes within the network.                                                  |
| **Auto State Recovery**                 | Automatically recovers node state after unexpected shutdowns or network issues, minimizing downtime and data loss.                                 |
| **Proof Generation and Verification**   | Generates and verifies cryptographic proofs to ensure the validity and integrity of transactions and state changes.                                |
| **Error Detection Mechanisms**          | Incorporates multiple layers of error detection to identify and mitigate discrepancies in data and computations.                                   |
| **Block Gas System**                    | Implements a gas system to manage computational resources and prevent abuse of the network by limiting resource consumption.                       |
| **Mempool Tracking (Partial)**          | Tracks and manages transactions in the mempool, ensuring efficient transaction processing and network performance.                                 |
| **Transaction Validation**              | Validates transactions against network rules and consensus mechanisms to ensure compliance and integrity.                                          |
| **Relay and Propagation Mechanisms**    | Facilitates the relay and propagation of blocks and transactions across the network, ensuring timely and efficient data distribution.              |
| **API Integration**                     | Integrates with external APIs to fetch data, validate transactions, and interact with external services and applications.                          |

### Features Left to Implement

| Feature                               | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
|---------------------------------------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| **OP_LINK Integration**               | **OP_LINK** is designed to create a fully decentralized, trustless system for bridging assets between chains. By utilizing **Auxiliary Proof of Work (AuxPoW)** and **OP_NET indexers**, it ensures that asset transfers are secure, tamper-resistant, and synchronized between the parent chain and the child chain.<br><br>In OP_LINK, when an AuxPoW block is mined and detected on the **child chain**, **OP_NET indexers** automatically trigger smart contracts on both the parent and child chains. These contracts manage the burning and minting of assets in a secure, cryptographic manner. OP_LINK ensures that the entire bridging process remains decentralized, with no reliance on centralized authorities. |
| **Multicall Simulation**              | Implement multicall simulation for batch contract calls, allowing multiple contract interactions within a single transaction. This feature will improve efficiency and reduce gas costs for users interacting with multiple contracts.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| **UTXO Support Enhancements**         | Add support for UTXO legacy SegWit, UTXO legacy, UTXO P2PK, and enable multiple transactions in one input within the transaction builder. This will expand functionality and support more complex transaction types.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| **Recode Mempool with ZeroMQ**        | Replace HTTP-based mempool communication with ZeroMQ to improve performance, efficiency, and real-time transaction propagation. ZeroMQ offers lower latency and better handling of high-throughput messaging.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| **PSBT Epoch**                        | Implement PSBT Epoch functionality to enhance transaction batching and processing efficiency.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| **P2P Multithreading**                | Implement multithreading in P2P networking to improve performance, scalability, and network throughput.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| **Generic RPC Methods**               | Develop a set of generic RPC methods for improved node interaction, management, and external application integration.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **PSBT Trading via P2P**              | Implement PSBT trading mechanisms utilizing P2P networking for decentralized exchanges, enhancing trustless token exchange capabilities.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| **State-Aware Transaction Execution** | Enhance transaction execution by incorporating state awareness, this allows the possibility to process multiple opnet transaction all at the same time.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| **Light Nodes with Peering**          | Implement light nodes that can peer with full nodes, allowing resource-constrained devices to participate in the network without full data storage. Light nodes rely on full nodes for data and transaction verification, enabling broader network participation.                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **Websocket Support**                 | Add Websocket support for real-time data streaming, enabling efficient and low-latency communication between nodes and external applications.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |

## P2P and PSBT Trading

### Overview

OPNet enhances decentralized exchange capabilities by integrating Peer-to-Peer (P2P) networking with **Partially Signed
Bitcoin Transactions (PSBT)** trading. This combination allows users to trade tokens directly on the Bitcoin network
without the need for intermediaries or centralized exchanges, fostering a truly decentralized and trustless trading
environment.

### PSBT Trading on OPNet

- **Decentralized Exchange via P2P Networking**: OPNet utilizes P2P networking to facilitate the distribution and
  exchange of PSBTs among nodes in the network. This approach enables users to find trading partners and exchange tokens
  directly, without relying on a central server or authority.

- **Partially Signed Bitcoin Transactions (PSBT)**: PSBTs allow multiple parties to collaboratively build and sign
  Bitcoin transactions. In the context of OPNet, PSBTs enable complex token exchange transactions that require inputs
  and signatures from different parties.

### How PSBT Trading Works

1. **Seller Initiates Trade**: A seller who wants to exchange their tokens for BTC creates a PSBT and broadcasts it over
   the P2P network.

2. **PSBT Creation**: The PSBT includes:

    - An instruction to the OPNet smart contract to transfer a specified amount of tokens upon successful completion.
    - A Bitcoin output specifying the amount of BTC the seller wants in exchange, directed to their Bitcoin wallet.
    - A dummy UTXO generated during the initial token deposit to prevent front-running and double-spending attacks.

3. **Buyer Participation**: Buyers on the network receive the PSBT and can choose to participate by:

    - Reviewing the PSBT to ensure the terms are acceptable.
    - Adding an input to the PSBT that fulfills the seller's BTC request.
    - Signing the PSBT to complete their part of the transaction.

4. **Transaction Completion**:

    - The fully signed PSBT is broadcasted to the network.
    - The OPNet smart contract verifies that all conditions are met, including correct outputs and gas limits.
    - Upon successful verification, tokens are transferred to the buyer, and BTC is transferred to the seller.

### Security and Trustlessness

- **Smart Contract Verification**: OPNet's smart contracts ensure that all conditions specified in the PSBT are met
  before executing the token transfer, providing a secure trading mechanism.

- **Mitigation of Attack Vectors**: By leveraging P2P networking and PSBTs, OPNet reduces risks such as front-running,
  honeypots, and transaction reversions. The system includes safeguards like dummy UTXOs, frontend simulations, and gas
  cost enforcement to prevent malicious activities.

- **No Peer Interaction Required**: PSBT trading on OPNet allows for trustless trading with no direct interaction
  between peers. All necessary information and signatures are exchanged through the P2P network.

### Benefits of P2P and PSBT Trading on OPNet

- **Decentralization**: Eliminates the need for centralized exchanges, reducing single points of failure and censorship
  risks.

- **Security**: Enhances security through cryptographic verification and smart contract enforcement.

- **Flexibility**: Allows users to trade any tokens supported by OPNet directly on the Bitcoin network.

- **User Empowerment**: Empowers users by giving them full control over their assets and trades.

### Attack Vectors and Mitigations

- **Front-running**: Mitigated by using dummy UTXOs and the nature of PSBTs, which prevent attackers from intercepting
  and executing transactions before the intended buyer.

- **Honeypots**: The frontend simulates and validates PSBTs before signing, protecting users from malicious sellers
  attempting to steal BTC.

- **Transfer Fees on Tokens**: While the system cannot control token mechanics, simulations and contract verifications
  help identify and prevent issues arising from unexpected fees.

- **Transaction Reversions**: A failsafe mechanism with checksum verification invalidates compromised PSBT listings,
  preventing exploitation.

### Failsafe Mechanism

- **Checksum Verification**: All PSBT listings include a checksum verified after each block. If the checksum does not
  match, the listing becomes invalid.

- **Frontend Reversion**: An invalid checksum causes the frontend's validation to fail, preventing users from proceeding
  with compromised transactions.

- **Gas Cost Enforcement**: Transactions are limited to a maximum of 1,000,000,000g, ensuring that excessive gas
  requirements flag a PSBT as invalid.

## Potential Issues

If you have Python 3.12 installed, you may encounter issues. Install `setuptools` before running `npm install`:

```bash
py -3 -m pip install setuptools
```

## License

View the license by clicking [here](https://github.com/btc-vision/bsi/blob/main/LICENSE.md).
