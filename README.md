# OP_NET - Node (v1.0.0-rc.0+testnet)

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

## Important Notice

> Security audit in final review. Use releases for deployments, main branch is for development.

| Network     | Status                                                   |
|-------------|----------------------------------------------------------|
| **Mainnet** | (NOT LIVE)                                               |
| **Testnet** | Live (official testnet, will remain alive after mainnet) |

## Introduction

**OP_NET** is a Bitcoin L1 consensus layer that enables smart contracts directly on Bitcoin. It is not a sidechain, not
a bridge, and not a metaprotocol. Contracts are deployed, executed, and finalized on Bitcoin itself, with cryptographic
proofs guaranteeing that every node arrives at the exact same state.

The node runs a deterministic WebAssembly VM that processes contract calls embedded in Bitcoin transactions. State is
organized into epochs spanning five consecutive Bitcoin blocks, where Proof of Calculation ensures every participant
computes identical results and Proof of Work (SHA-1 near-collision mining) finalizes each epoch into an immutable
checkpoint. After 20+ blocks of Bitcoin PoW burial, reversing an epoch's state would cost millions of dollars per hour,
making OP_NET finality stronger than Bitcoin's standard 6-confirmation model.

Unlike indexer-based protocols such as BRC-20, Runes, or Alkanes, where different nodes can disagree on balances with no
mechanism to resolve disputes, OP_NET enforces agreement through cryptographic consensus. If two nodes produce different
checksum roots, one is provably wrong. This makes OP_NET suitable for applications that require binding state
consistency, like DEXs, escrows, and multi-party coordination, where indexer disagreement would be catastrophic.

The system is fully trustless, permissionless, and non-custodial. Contracts never hold BTC directly. There is no gas
token; Bitcoin is used natively. Contracts are written in AssemblyScript and compiled to WASM for deterministic
execution. The VM is post-quantum ready, supporting both Schnorr and ML-DSA (FIPS 204) signatures with automatic
consensus-level selection.

The OP_NET testnet is fully live and ready for usage. This is the official testnet and will continue operating after
mainnet launches.

[![X](https://img.shields.io/badge/X-000000?style=for-the-badge&logo=x&logoColor=white)](https://x.com/opnetbtc)
[![Telegram](https://img.shields.io/badge/Telegram-26A5E4?style=for-the-badge&logo=telegram&logoColor=white)](https://t.me/opnetbtc)
[![Discord](https://img.shields.io/badge/Discord-5865F2?style=for-the-badge&logo=discord&logoColor=white)](https://discord.gg/opnet)

## Table of Contents

- [Getting Started](#getting-started)
- [Installation (Quick)](#installation-quick)
    - [Prerequisites](#prerequisites)
    - [Installation (Development)](#installation-development)
- [Configuration](#configuration)
- [Testnet Bitcoin Node Setup](#testnet-bitcoin-node-setup)
- [Consensus Mechanism](#consensus-mechanism)
    - [The Problem: Smart Contracts on Bitcoin](#the-problem-smart-contracts-on-bitcoin)
    - [The Flaw in Meta-Protocols (BRC-20, Runes)](#the-flaw-in-meta-protocols-brc-20-runes)
    - [OP_NET: A True Consensus Layer](#opnet-a-true-consensus-layer)
    - [The OP_NET Consensus Model: PoC + PoW](#the-opnet-consensus-model-poc--pow)
        - [Proof of Calculation (PoC): Deterministic State](#proof-of-calculation-poc-deterministic-state)
        - [Proof of Work (PoW): Epoch Finality](#proof-of-work-pow-epoch-finality)
- [Quantum Resistance & Dual Addressing](#quantum-resistance--dual-addressing)
- [Potential Issues](#potential-issues)
- [Security & Audit](#security--audit)
- [License](#license)

## Getting Started

To get started with the node, follow these setup instructions. OP\_NET is designed to run on almost any operating
system and requires Node.js, npm, a Bitcoin node, and MongoDB.

## Installation (Quick)

OP_NET provides an automated setup script for quick installation on Ubuntu based systems. To use the script, run the
following command:

```bash
curl -fsSL https://autosetup.opnet.org/autoconfig.sh -o autoconfig.sh && sudo -E bash autoconfig.sh
```

### Prerequisites

- **Node.js** version 25.x or higher. (v24.x supported)
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

   Copy and rename the sample configuration file for testnet:

   ```bash
   cp config/btc-testnet.sample.conf config/btc.conf
   ```

   Then adjust the variables in `config/btc.conf` to suit your needs.

6. **Start the node**:

   ```bash
   npm start
   ```

## Testnet Bitcoin Node Setup

OP_NET testnet requires a custom Bitcoin Core build. Clone and build it
from [btc-vision/bitcoin-core-opnet-testnet](https://github.com/btc-vision/bitcoin-core-opnet-testnet).

**Install dependencies:**

```bash
sudo apt-get install build-essential cmake pkgconf python3 libevent-dev libboost-dev libsqlite3-dev libcapnp-dev capnproto systemtap-sdt-dev libzmq3-dev
```

**Clone and build:**

```bash
git clone https://github.com/btc-vision/bitcoin-core-opnet-testnet.git
cd bitcoin-core-opnet-testnet
cmake -B build -DBUILD_TESTING=OFF -DBUILD_BENCH=OFF -DWITH_BDB=OFF -DENABLE_WALLET=ON -DENABLE_IPC=OFF && cmake --build build -j$(nproc)
```

**Create your Bitcoin configuration file** (e.g. `bitcoin-testnet.conf`):

```conf
rpcuser=yourrpc
rpcpassword=yourpass
opnet-testnet=1

server=1
daemon=0

prune=0

datadir=/path/to/your/datadir
txindex=1

acceptnonstdtxn=1
printtoconsole=1
allowignoredconf=1

maxmempool=1000
minrelaytxfee=0.000002
blockmintxfee=0.000002
mempoolexpiry=672
maxmempool=4096

maxconnections=256

[opnet-testnet]
rpcport=11000
rpcbind=0.0.0.0

addnode=bootstrap.testnet.opnet.org

rpcworkqueue=128
rpcthreads=128
rpctimeout=15
rpcservertimeout=15
```

**Run the node:**

```bash
./build/bin/bitcoind --conf=/path/to/your/conf
```

Once the Bitcoin testnet node is fully synced, proceed to configure and start the OP_NET node.

## Configuration

Before launching the node, configure the environment variables and settings according to your deployment environment.
A sample testnet configuration file is provided at `config/btc-testnet.sample.conf`. Rename it to `btc.conf` and adjust
settings for network endpoints, security parameters, and operational modes as needed.

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

### OP_NET: A True Consensus Layer

> **OP_NET is fundamentally different because it's a consensus layer, not a metaprotocol.**

A consensus layer provides cryptographic proof of correct execution where every participant must arrive at exactly the
same result, or their proofs won't validate. Think about what this means: when a smart contract executes on OP_NET, it's
not just describing what *should* happen; it's proving what *did* happen, with mathematical certainty that makes any
other outcome impossible.

To understand how this works, you need to grasp the distinction between consensus and indexing:

* **Consensus:** Given the same inputs, every participant reaches the same conclusion through deterministic processes,
  and any disagreement can be proven wrong through cryptography. With consensus, if two nodes disagree about a balance,
  one is provably wrong.
* **Indexing:** Each participant maintains their own database and hopes others maintain theirs the same way. With
  indexing, you just have two different opinions and no way to determine which is correct.

Bitcoin itself achieves consensus on transactions through proof-of-work. OP_NET implements consensus by embedding
everything directly in Bitcoin's blockchain—the actual contract bytecode, function parameters, and execution data—all
embedded in Bitcoin transactions that get confirmed by Bitcoin miners.

### The OP_NET Consensus Model: PoC + PoW

The system divides time into epochs, where each epoch consists of five consecutive Bitcoin blocks (roughly fifty
minutes). The consensus model is a two-part process: **Proof of Calculation (PoC)**, which *every* node performs to
build the state, and **Proof of Work (PoW)**, which *miners* perform to finalize that state.

Let's use **Epoch 113 (Blocks 565-569)** as a concrete example.

#### Proof of Calculation (PoC): Deterministic State

This is the process every OP_NET node follows to independently *calculate* and verify the network's state.

1. **Epoch Window (Blocks 565-569):**

    * Every node monitors the Bitcoin blockchain. Every confirmed OP_NET transaction (deploys, swaps, etc.) during these
      five blocks becomes part of epoch 113's state.

2. **Deterministic Ordering:**

    * Transactions are not executed in the random order they appear.
    * OP_NET enforces a canonical ordering: sorted first by **gas price**, then by **priority fees**, then by *
      *transaction ID**.
    * This ensures every node processes transactions in the *exact* same sequence, which is critical for deterministic
      state.

3. **Deterministic Execution (WASM):**

    * Every node processes these sorted transactions through their local WebAssembly (WASM) VM.
    * The execution is 100% deterministic: the same input *always* produces the same output.
    * By the end of block 569, every honest node has processed all transactions and arrived at an *identical* state.

4. **State Checkpointing:**

    * When epoch 113 concludes, each node generates an **epoch root** (a Merkle root of the entire epoch's final state)
      and a **target checksum** derived from that state.
    * These cryptographic fingerprints cover every balance, every contract's storage, every single bit of data.
    * If even one bit differs between nodes, the epoch root and checksum will be completely different.

5. **Proposer Selection:**

    * After miners submit their PoW solutions (see below), every node must deterministically select the epoch proposer.
    * The miner whose solution achieves the highest difficulty (most matching leading bits between their SHA-1 solution
      and the target hash) wins the epoch.
    * Because the validation algorithm is purely mathematical and every node has the same inputs, every node
      independently arrives at the same proposer without communication.

This PoC process makes forking OP_NET impossible without forking Bitcoin itself. To change Epoch 113, an attacker would
need to rewrite Bitcoin blocks 565-569 *and* all subsequent blocks, making the state irreversible.

#### Proof of Work (PoW): Epoch Finality

This is the "mining" process that creates the immutable, final checkpoint of the state calculated via PoC.

1. **Mining (SHA1 Near-Collision):**

    * After Epoch 113 ends, miners compete to find the best SHA1 near-collision.
    * They use the epoch's `targetChecksum` (derived from the state) and `targetHash` as the difficulty reference.
    * They compute a 32-byte preimage via byte-by-byte XOR:
      ```
      preimage[i] = targetChecksum[i] XOR mldsaPublicKey[i] XOR salt[i]   (for i in 0..31)
      ```
    * They then hash: `SHA1(preimage)` to produce a 20-byte solution.
    * They rapidly change the `salt` to find a solution that has the most matching **leading bits** with the
      `targetHash`. This is their proof-of-work, proving they expended computational resources to "witness" the state.

2. **Submission (During Epoch N+2):**

    * Miners submit their solutions (solution hash, ML-DSA public key, salt, and a Schnorr signature proving authorship)
      as Bitcoin transactions during a future epoch (typically `epochNumber + 2`).
    * Submissions include `ChallengeVerification` data containing the epoch hash, epoch Merkle root, target hash, target
      checksum, block range, and Merkle proofs, allowing any node to independently verify the solution.

3. **Proposer Selection:**

    * The miner whose solution achieves the highest difficulty (most matching leading bits against the target hash)
      becomes the epoch proposer.
    * The winning miner's solution becomes the official, immutable checkpoint for the epoch.

OP_NET miners aren't validators making decisions about validity. They are **witnesses** competing to checkpoint the
deterministic execution that has already occurred.

## Quantum Resistance & Dual Addressing

OP_NET is built to survive the post-quantum transition without requiring a hard fork or mass migration. The VM natively
supports both Schnorr (secp256k1) and ML-DSA (FIPS 204, formerly CRYSTALS-Dilithium) signatures, with the consensus
layer managing which algorithms are accepted at any given time.

### Automatic Signature Selection

Smart contracts do not need to choose a signature algorithm manually. The `Blockchain.verifySignature()` call delegates
to the consensus layer, which automatically selects the appropriate algorithm based on the current network phase:

* **Phase 1 (Current):** Both Schnorr and ML-DSA signatures are accepted. The consensus flag
  `UNSAFE_QUANTUM_SIGNATURES_ALLOWED` is set to `true`.
* **Phase 2 (Warning):** Schnorr signatures are still accepted but trigger deprecation warnings, encouraging migration.
* **Phase 3 (Quantum-Safe Only):** The flag is set to `false`. Only ML-DSA signatures are valid. Schnorr submissions are
  rejected at the consensus level.

This means every contract deployed today is already quantum-ready. When the network transitions to Phase 3, contracts
continue working without any code changes because the signature selection happens beneath them.

### Dual-Key Address Structure

Every OP_NET address carries two cryptographic identities:

| Component                      | Size     | Purpose                                                                          |
|--------------------------------|----------|----------------------------------------------------------------------------------|
| **Tweaked Schnorr public key** | 32 bytes | Taproot/P2TR compatibility, external Bitcoin identity (`bc1p...`)                |
| **ML-DSA public key hash**     | 32 bytes | SHA-256 of the full ML-DSA public key, used to key contract balances and storage |

The full ML-DSA public key (1,312 bytes for ML-DSA-44) is stored on-chain and loaded automatically when a contract
accesses `Address.mldsaPublicKey`. The `ExtendedAddress` type exposes both keys, allowing contracts to reference either
identity as needed.

Contract balances and internal state are keyed by ML-DSA public key hashes, while users are known externally by their
Bitcoin addresses. The two are linked when a user first sends a transaction to the network, proving ownership of both
keys simultaneously. This is why operations like airdrops use a claim pattern rather than a direct transfer loop: the
contract cannot credit tokens to a Bitcoin address until the owner has linked it to their ML-DSA identity.

### P2MR Addresses (BIP-360)

P2MR (Pay-to-ML-DSA-Root) is a new Bitcoin address type for quantum-resistant transactions. P2MR addresses coexist with
P2TR (Taproot) and P2WPKH (SegWit) addresses and are generated by wallets that support ML-DSA signatures, such as
OP_WALLET. Key derivation follows the BIP-360 path (`m/360'/...`) using a quantum-resistant variant of BIP-32 where
HMAC-SHA512 produces key material fed into ML-DSA key generation rather than ECDSA.

### Epoch Mining and ML-DSA

The epoch mining algorithm itself uses the miner's ML-DSA public key in the preimage calculation (
`targetChecksum XOR mldsaPublicKey XOR salt`), meaning the PoW process is inherently tied to the quantum-resistant
identity of the miner, not a classical key.

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
