# OP_NET - Node (1.0.0-alpha.0)

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

<p align="center">
  <a href="https://verichains.io">
    <img src="https://img.shields.io/badge/Security%20Audit-Verichains-4C35E0?style=for-the-badge" alt="Audited by Verichains"/>
  </a>
</p>

[![code style: prettier](https://img.shields.io/badge/code_style-prettier-ff69b4.svg?style=flat-square)](https://github.com/prettier/prettier)
[![Security Audit](https://img.shields.io/badge/audit-Verichains-4C35E0?style=flat-square)](https://verichains.io)

## ⚠️ Important Notice ⚠️

> Security audit in final review. Use releases for deployments, main branch is for development.

| Network     | Status           |
|-------------|------------------|
| **Mainnet** | Alpha (NOT LIVE) |
| **Testnet** | Ready            |

## Introduction

Welcome to the official **OP\_NET Node** GitHub repository. This repository contains the source code and documentation
for the OPNet Node, an essential component of a decentralized system that leverages Taproot/SegWit/Legacy technology to
manage and execute smart contracts on the Bitcoin or any other UTXO-based blockchains.

[![X](https://img.shields.io/badge/X-000000?style=for-the-badge&logo=x&logoColor=white)](https://x.com/opnetbtc)
[![Telegram](https://img.shields.io/badge/Telegram-26A5E4?style=for-the-badge&logo=telegram&logoColor=white)](https://t.me/opnetbtc)
[![Discord](https://img.shields.io/badge/Discord-5865F2?style=for-the-badge&logo=discord&logoColor=white)](https://discord.gg/opnet)

## Table of Contents

- [Getting Started](#getting-started)
- [Installation (Quick)](#installation-quick)
    - [Prerequisites](#prerequisites)
    - [Installation (Development)](#installation-development)
- [Configuration](#configuration)
- [Consensus Mechanism](#consensus-mechanism)
    - [The Problem: Smart Contracts on Bitcoin](#the-problem-smart-contracts-on-bitcoin)
    - [The Flaw in Meta-Protocols (BRC-20, Runes)](#the-flaw-in-meta-protocols-brc-20-runes)
    - [OPNet: A True Consensus Layer](#opnet-a-true-consensus-layer)
    - [The OPNet Consensus Model: PoC + PoW](#the-opnet-consensus-model-poc--pow)
        - [Proof of Calculation (PoC): Deterministic State](#proof-of-calculation-poc-deterministic-state)
        - [Proof of Work (PoW): Epoch Finality](#proof-of-work-pow-epoch-finality)
- [Potential Issues](#potential-issues)
- [Security & Audit](#security--audit)
- [License](#license)

## Getting Started

To get started with the node, follow these setup instructions. OP\_NET is designed to run on almost any operating
system and requires Node.js, npm, a Bitcoin node, and MongoDB.

## Installation (Quick)

OPNet provides an automated setup script for quick installation on Ubuntu based systems. To use the script, run the
following command:

```bash
curl -fsSL https://autosetup.opnet.org/autoconfig.sh -o autoconfig.sh && sudo -E bash autoconfig.sh
```

### Prerequisites

- **Node.js** version 24.x or higher.
- **Bitcoin Node**: A fully synced Bitcoin Core node with RPC access.
- **MongoDB** 8.0 or higher.
- **Rust** programming language installed.

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

5. **Configure your node**:

   Adjust the variables in the configuration file located in the `config/` directory to suit your needs.

6. **Start the node**:

   ```bash
   npm start
   ```

## Configuration

Before launching the node, configure the environment variables and settings according to your deployment environment.
Sample configuration files are located in the `config/` directory. Adjust settings for network endpoints, security
parameters, and operational modes as needed.

## Consensus Mechanism

### The Problem: Smart Contracts on Bitcoin

> Bitcoin doesn't have a virtual machine. It doesn't have state storage. Its scripting language is intentionally
> limited. So how can you possibly have real smart contracts, actual DeFi, genuine programmable money on Bitcoin itself?
> Not on a sidechain, not through a bridge, but directly on Bitcoin?

### The Flaw in Meta-Protocols (BRC-20, Runes)

The first thing to understand is why every other Bitcoin protocol faces fundamental limitations. BRC-20, Runes, and
other protocols all operate as meta-protocols that rely on indexers interpreting data.

When you "own" BRC-20 tokens, those tokens don't exist on Bitcoin; they exist in database entries maintained by
indexers. Different indexers can show different balances because there's no mechanism forcing them to agree. They're
hoping everyone calculates the same results, but **hope isn't consensus**.

### OPNet: A True Consensus Layer

> **OPNet is fundamentally different because it's a consensus layer, not a metaprotocol.**

A consensus layer provides cryptographic proof of correct execution where every participant must arrive at exactly the
same result, or their proofs won't validate. Think about what this means: when a smart contract executes on OPNet, it's
not just describing what *should* happen; it's proving what *did* happen, with mathematical certainty that makes any
other outcome impossible.

To understand how this works, you need to grasp the distinction between consensus and indexing:

* **Consensus:** Given the same inputs, every participant reaches the same conclusion through deterministic processes,
  and any disagreement can be proven wrong through cryptography. With consensus, if two nodes disagree about a balance,
  one is provably wrong.
* **Indexing:** Each participant maintains their own database and hopes others maintain theirs the same way. With
  indexing, you just have two different opinions and no way to determine which is correct.

Bitcoin itself achieves consensus on transactions through proof-of-work. OPNet implements consensus by embedding
everything directly in Bitcoin's blockchain—the actual contract bytecode, function parameters, and execution data—all
embedded in Bitcoin transactions that get confirmed by Bitcoin miners.

### The OPNet Consensus Model: PoC + PoW

The system divides time into epochs, where each epoch consists of five consecutive Bitcoin blocks (roughly fifty
minutes). The consensus model is a two-part process: **Proof of Calculation (PoC)**, which *every* node performs to
build the state, and **Proof of Work (PoW)**, which *miners* perform to finalize that state.

Let's use **Epoch 113 (Blocks 565-569)** as a concrete example.

#### Proof of Calculation (PoC): Deterministic State

This is the process every OPNet node follows to independently *calculate* and verify the network's state.

1. **Epoch Window (Blocks 565-569):**

    * Every node monitors the Bitcoin blockchain. Every confirmed OPNet transaction (deploys, swaps, etc.) during these
      five blocks becomes part of epoch 113's state.

2. **Deterministic Ordering:**

    * Transactions are not executed in the random order they appear.
    * OPNet enforces a canonical ordering: sorted first by **gas price**, then by **priority fees**, then by *
      *transaction ID**.
    * This ensures every node processes transactions in the *exact* same sequence, which is critical for deterministic
      state.

3. **Deterministic Execution (WASM):**

    * Every node processes these sorted transactions through their local WebAssembly (WASM) VM.
    * The execution is 100% deterministic: the same input *always* produces the same output.
    * By the end of block 569, every honest node has processed all transactions and arrived at an *identical* state.

4. **State Checkpointing:**

    * When epoch 113 concludes, each node generates a **checksum root**.
    * This is a cryptographic fingerprint (e.g., a Merkle root) of the *entire* epoch's final state: every balance,
      every contract's storage, every single bit of data.
    * If even one bit differs between nodes, the checksum root will be completely different.

5. **Deterministic Winner Selection (During Epoch 114):**

    * After miners submit their PoW solutions (see below) during Epoch 114, every node must deterministically select the
      *one* winner.
    * This is a pure mathematical calculation every node performs independently:
        1. Winner = Most matching bits in the SHA1 collision.
        2. Tiebreaker 1: Smallest numerical public key.
        3. Tiebreaker 2: Most matching bits in the last 20 bytes of the public key.
        4. Tiebreaker 3: Smallest numerical salt.
        5. Tiebreaker 4: Smallest transaction ID.
    * This cascading system *guarantees* every node selects the same winner without communication, making the final
      state lock-in a deterministic calculation, not a subjective choice.

This PoC process makes forking OPNet impossible without forking Bitcoin itself. To change Epoch 113, an attacker would
need to rewrite Bitcoin blocks 565-569 *and* all subsequent blocks, making the state irreversible.

#### Proof of Work (PoW): Epoch Finality

This is the "mining" process that creates the immutable, final checkpoint of the state calculated via PoC.

1. **Mining (SHA1 Near-Collision):**

    * After Epoch 113 ends, miners compete to find the best SHA1 near-collision.
    * They use the *previous* epoch's (Epoch 112) final checksum as a target.
    * They hash: `SHA1(Epoch_112_Checksum + PublicKey + 32_Byte_Salt)`
    * They rapidly change the `Salt` to find a hash that has the most matching bits with the target. This is their
      proof-of-work, proving they expended computational resources to "witness" the state.

2. **Submission (During Epoch 114, Blocks 570-574):**

    * Miners submit their solutions (their proof, public key, and salt) as Bitcoin transactions during the *next*
      epoch (Epoch 114).
    * **Crucially**, their submission also includes an attestation to the state from **Epoch 109** (which ended at block
      549).
    * At 20+ blocks deep, that state is buried under so much Bitcoin PoW that it is considered irreversible, preventing
      deep reorg attacks.

3. **Reward (Delayed):**

    * The winning miner's solution (selected via the PoC rules) becomes the official, immutable checkpoint for Epoch
        113.
    * However, the winner does *not* receive fees from Epoch 113.
    * They earn the right to collect all gas fees from a *future* epoch (e.g., Epoch 116).
    * This incentivizes long-term network health (a dead network has no future fees) and prevents miners from
      manipulating an epoch they are currently mining for.

OPNet miners aren't validators making decisions about validity. They are **witnesses** competing to checkpoint the
deterministic execution that has already occurred.

## Potential Issues

If you have Python 3.12 installed, you may encounter issues. Install `setuptools` before running `npm install`:

```bash
py -3 -m pip install setuptools
```

## Security & Audit

<p>
  <a href="https://verichains.io">
    <img src="https://raw.githubusercontent.com/btc-vision/contract-logo/refs/heads/main/public-assets/verichains.png" alt="Verichains" width="100"/>
  </a>
</p>

| Component  | Status       | Auditor                             |
|------------|--------------|-------------------------------------|
| opnet-node | Final Review | [Verichains](https://verichains.io) |

### Reporting Vulnerabilities

**DO NOT** open public GitHub issues for security vulnerabilities.

Report vulnerabilities privately
via [GitHub Security Advisories](https://github.com/btc-vision/opnet-node/security/advisories/new).

See [SECURITY.md](SECURITY.md) for full details on:

- Supported versions
- Security scope
- Response timelines

## License

View the license by clicking [here](LICENSE).
