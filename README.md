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

Main is the dev branch. Use releases for production.

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
- [Converting OP20/NFT to BTC](#converting-op20nft-to-btc)
- [Potential Issues](#potential-issues)
- [License](#license)

## Getting Started

To get started with the node, follow these setup instructions. OP_NET is designed to run on almost any operating
system and requires Node.js, npm, a Bitcoin node, and MongoDB.

## Installation (Quick)

OPNet provides an automated setup script for quick installation on Ubuntu based systems. To use the script, run the
following command:

```bash
curl -fsSL https://autosetup.opnet.org/autoconfig.sh -o autoconfig.sh && sudo -E bash autoconfig.sh
```

### Prerequisites

- **Node.js** version 21.x or higher (we recommend using Node.js 22.x).
- **npm** (Node Package Manager)
- **Bitcoin Node** (Latest version)
- **MongoDB** (Latest version)
- **Rust (cargo)**: Required to run the WASM VM.

### Installation (Development)

1. **Clone the repository**:

   ```bash
   git clone https://github.com/btc-vision/opnet-node.git
   ```

2. **Navigate to the repository directory**:

   ```bash
   cd opnet-node
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

Bitcoin doesn't have a virtual machine. It doesn't have state storage. Its scripting language is intentionally limited.
So how can you possibly have real smart contracts, actual DeFi, genuine programmable money on Bitcoin itself? Not on a
sidechain, not through a bridge, but directly on Bitcoin?

The first thing to understand is why every other Bitcoin protocol faces fundamental limitations. BRC-20, Runes, and
other protocols all operate as meta-protocols that rely on indexers interpreting data. When you "own" BRC-20 tokens,
those tokens don't exist on Bitcoin; they exist in database entries maintained by indexers. Different indexers can show
different balances because there's no mechanism forcing them to agree. They're hoping everyone calculates the same
results, but hope isn't consensus. Alkanes took an interesting approach by introducing WASM smart contracts, which
represents significant technical progress for Bitcoin protocols. However, like other meta-protocols, contract execution
happens within indexers without a consensus mechanism to ensure all participants reach identical states. Each indexer
independently processes contracts, potentially arriving at different results.

OPNet is fundamentally different because it's a consensus layer, not a metaprotocol. A consensus layer provides
cryptographic proof of correct execution where every participant must arrive at exactly the same result, or their proofs
won't validate. Think about what this means: when a smart contract executes on OPNet, it's not just describing what
should happen; it's proving what did happen, with mathematical certainty that makes any other outcome impossible.

To understand how this works, you need to grasp the distinction between consensus and indexing. Consensus means that
given the same inputs, every participant reaches the same conclusion through deterministic processes, and any
disagreement can be proven wrong through cryptography. Indexing means each participant maintains their own database and
hopes others maintain theirs the same way. With consensus, if two nodes disagree about a balance, one is provably wrong.
With indexing, you just have two different opinions and no way to determine which is correct.

Bitcoin itself achieves consensus on transactions through proof-of-work. Miners compete to add blocks, nodes validate
according to identical rules, and the chain with the most accumulated work becomes truth. Ethereum extends this to smart
contracts where every node executes the same code and must reach identical results. Meta-protocols don't have this; they
have voluntary agreement, which breaks down the moment participants disagree.

OPNet implements consensus by embedding everything directly in Bitcoin's blockchain. Every OPNet transaction, whether
deploying a contract, calling a function, or making a swap, gets written to Bitcoin. This isn't metadata sitting
alongside transactions; it's the actual contract bytecode, the function parameters, the execution data, all embedded in
Bitcoin transactions that get confirmed by Bitcoin miners and become part of Bitcoin's permanent record.

How exactly does OPNet's epoch system works? Let use epoch 113 as a concrete example to explain each step of the
process.

The system divides time into epochs, where each epoch consists of five consecutive Bitcoin blocks, roughly fifty
minutes. Epoch 113 specifically covers Bitcoin blocks 565 through 569. During these five blocks, every OPNet transaction
that gets confirmed becomes part of epoch 113's state. When someone deploys a smart contract in block 566, that
deployment is part of epoch 113. When someone swaps tokens on Motoswap in block 568, that swap is part of epoch 113.
Every interaction, every state change, every event that occurs during these five blocks belongs to this epoch.

Here's where OPNet differs from simply reading transactions in order: OPNet has its own deterministic ordering rules
within each block. Transactions don't execute in the random order they appear; they get sorted first by gas price, then
by priority fees, then by transaction ID. This creates a canonical ordering that every node must follow. This matters
because in smart contracts, the order of operations can change outcomes, especially in DeFi where prices and liquidity
constantly shift.

Every OPNet node processes these transactions through WebAssembly smart contracts. The execution is completely
deterministic, meaning the same input always produces the same output. If a contract calculates a swap price, every node
calculates the exact same price. If a function updates balances, every node updates them identically. By the end of
block 569, every node has processed every transaction and arrived at exactly the same state.

When epoch 113 concludes at block 569, the network must finalize everything that occurred during those five blocks.
Every node has already reached the same state through deterministic execution, but now we need to create an immutable
checkpoint that becomes part of Bitcoin's permanent record. This checkpoint, called the checksum root, is a
cryptographic fingerprint of the entire epoch's final state: every balance, every contract's storage, every single bit
of data. If anything differs, even by a single bit, the checksum root completely changes.

The finalization process begins with mining. Miners compete to find the best SHA1 near-collision with the checksum root
from block 564, which was the last block of epoch 112. They take this previous epoch's final checksum, combine it with
their public key and a random 32-byte salt, and hash it using SHA1. They're searching for a hash that matches a target
pattern as closely as possible, counting the number of matching bits.

Finding competitive solutions requires significant computational work. A miner might generate millions of attempts,
adjusting their salt each time, looking for better and better matches. The more bits that match between their hash and
the target, the better their solution. This is similar to Bitcoin mining, but instead of counting leading zeros, we're
counting total matching bits, and instead of SHA256, we're using SHA1.

During epoch 114, which covers blocks 570 through 574, miners submit their solutions as actual Bitcoin transactions.
These submissions contain their SHA1 collision proof, their public key, the salt they used, and critically, an
attestation to the state from epoch 109. Why epoch 109? Because it ended at block 549, which is now over twenty blocks
deep in Bitcoin's history. At that depth, every honest node must agree on what that state was because Bitcoin doesn't
reorganize that deep. The deepest reorganization in Bitcoin's history was actually 53 blocks in March 2013 due to a
database bug that split the network between different versions. However, this required extraordinary circumstances
including incompatible software versions running simultaneously, something that modern Bitcoin's consensus rules and
network monitoring make effectively impossible today. Under normal operations, reorganizations beyond 6 blocks are
extraordinarily rare, and 20 blocks provides an enormous safety margin.

Since multiple miners typically submit solutions, the protocol needs a deterministic way to select exactly one winner.
The selection process uses pure mathematics with multiple tiebreakers. First, whoever achieved the most matching bits in
their SHA1 collision wins. If multiple miners achieved the same number of bits, the miner whose public key has the
smallest numerical value wins. If somehow that's still tied, the system checks how many bits the last twenty bytes of
each public key match with the target hash. Then it compares salts numerically, and finally transaction IDs. This
cascading system ensures that given the same set of submissions, every single node will identify the same winner without
any communication between them.

The winning miner's solution becomes the official checkpoint for epoch 113, embedded forever in Bitcoin's blockchain.
But here's the fascinating part: the winner doesn't receive fees from epoch 113. They receive all gas fees from epoch
116, which hasn't even happened yet. Those transactions literally don't exist when the miner is competing. They're
mining for the right to collect fees from future network activity. This prevents miners from manipulating their own
epochs for profit since they don't know which epoch's fees they'll receive, and it incentivizes keeping the network
healthy since dead networks generate no future fees.

This architecture makes forking OPNet impossible without forking Bitcoin itself. To create an alternative version of
epoch 113, you would need to rewrite Bitcoin blocks 565 through 569 to change the transactions, then rewrite blocks 570
through 574 to change the submissions, then continue rewriting every subsequent block to maintain the alternative
history. After just one day, an epoch is buried under 144 Bitcoin blocks. After a week, it's under 1,008 blocks. The
cost isn't just millions of dollars; it would require controlling the majority of Bitcoin's global hashrate for days or
weeks, something that would be immediately visible to the entire world.

This is why OPNet provides stronger finality than Bitcoin transactions themselves. A Bitcoin transaction is considered
secure after six confirmations. An OPNet epoch becomes practically irreversible after a few hours and mathematically
impossible to change after a day. The security compounds over time until changing old epochs would literally require
rewriting months of Bitcoin's history.

OPNet miners aren't validators making decisions about validity. They're witnesses competing to checkpoint deterministic
execution that has already occurred. They don't choose which transactions are valid; the consensus rules determine that.
They don't decide transaction ordering; the deterministic algorithm handles that. They compute SHA1 collisions to earn
future rewards while creating cryptographic proofs that everyone must accept.

### Proof of Calculation (PoC)

- **Role of Permissionless Nodes**: Permissionless nodes independently recalculate data from the Bitcoin network,
  ensuring each node's calculations are accurate and align with network standards.
- **Independent State Determination**: Each node arrives at its own state based solely on PoC, without needing a
  threshold of nodes to agree on a state.
- **Error Detection**: This decentralized approach adds resilience by detecting discrepancies through independent
  calculations.

### Proof of Validation (PoV)

- **Role of Bootstrap Nodes**: Bootstrap nodes act as trusted verifiers, serving as PoV nodes. They perform independent
  recalculations and validate results against official network entries. Please note that your nodes take these witnesses
  as informal.
- **Canonical Outputs**: PoV allows nodes to reference canonical outputs from trusted entities like the OPNet
  Foundation.
- **Enhanced Security**: This layer enhances error detection and defends against manipulation without altering
  individual node data.

## Potential Issues

If you have Python 3.12 installed, you may encounter issues. Install `setuptools` before running `npm install`:

```bash
py -3 -m pip install setuptools
```

## License

View the license by clicking [here](https://github.com/btc-vision/bsi/blob/main/LICENSE.md).
