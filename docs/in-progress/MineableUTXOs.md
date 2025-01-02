# Mineable UTXOs: OP_NET PoW Validation Mechanism

## TL;DR:

OP_NET half PoW validation system allows what we call **"Mineable UTXOs."** These UTXOs are essentially mineable SHA-1
collision challenges, enabling miners to claim funds by finding a hash collision. This aligns incentives, rewards miners
for their work, and extends OP_NET security by creating state checkpoints each time a collision is found.

## Table of Contents

1. [Overview](#1-overview)
2. [Why This is a Game Changer](#2-why-this-is-a-game-changer)
3. [Core Concept: The Collision Puzzle](#3-core-concept-the-collision-challenge)
4. [Bitcoin Script Example](#4-bitcoin-script-example)
5. [How to Create and Spend a Mineable UTXO](#5-how-to-create-and-spend-a-mineable-utxo)
6. [Cross-Chain Mining Possibilities](#6-cross-chain-mining-possibilities)
7. [Considerations](#7-considerations)
8. [License](#8-license)

---

## 1. Overview

Mineable UTXOs introduce an approach to **OP_NET** that allows miners to enhance network security and collect gas fees
sent by users to contracts. This is done by creating a **cryptographic collision challenge** that miners can solve to
claim the fees locked in the challenge:

- We generate a mineable UTXO on Bitcoin (or other compatible chains) that requires a cryptographic SHA-1 collision.
- Excess fees go into that challenge script instead of being burned.
- Anyone can attempt to solve the collision challenge.
- If they find distinct preimages with the same hash, they can claim (spend) funds, effectively “mining” the UTXO and
  improving OP_NET security by creating checkpoints when a collision is found.

This setup incentivizes miners (and the broader community) to attempt challenge solutions, effectively returning locked
gas fees back into the network. It also creates a new type of mining accessible to the average user and can be applied
across multiple chains, unifying cross-chain incentives.

---

## 2. Why This is a Game Changer

### Miner Incentives Aligned

Miners can gather extra income by solving these collision challenges. Rather than ignoring
or resenting large fees that vanish, they have direct potential gains. Additionally, each solved challenge can act as a
checkpoint in OP_NET's security model.

### Cross-Chain Potential

The concept is easily ported to any chain with a flexible-enough scripting system or EVM-like environment. Hence,
**"cross-chain mining"** can unify multiple blockchains' fees into a single collision challenge, allowing miners or
users to claim bounties across multiple networks at once.

---

## 3. Core Concept: The Collision Challenge

A collision challenge is a script requiring two distinct preimages that hash to the same value. For example, a single
SHA-1 collision challenge checks:

1. `preimage1 != preimage2`
2. `SHA1(preimage1) == SHA1(preimage2)`

Anytime both conditions are met, the script returns true, allowing the spender to claim the funds.

> **Note**: SHA-1 collisions are possible (public examples can be found in [SHAttered PDFs](https://shattered.io/)), but
> remain difficult at smaller scales. Larger miners or pools, however, might find it lucrative to dedicate resources to
> these challenges if the locked amounts grow large.

---

## 4. Bitcoin Script Example

Below is a simplified legacy P2SH challenge script that enforces a single SHA-1 collision check. (For double-SHA1, just
apply `OP_SHA1` twice on each item.)

```bash
# Pseudocode:
OP_2DUP             # Duplicate top two items (preimage1, preimage2).
OP_EQUAL            # Compare them. If equal -> push 1, else push 0.
OP_NOT              # Flip it, so we want them to be different.
OP_VERIFY           # Fails the script if top is 0 -> must be distinct.
OP_SHA1             # Replace top of stack with SHA1(top).
OP_SWAP             # Swap the next top item.
OP_SHA1             # Replace new top with SHA1(top).
OP_EQUAL            # Must be equal => same SHA1 hash?
```

**Locking Script (Redeem Script):**

```asm
OP_2DUP
OP_EQUAL
OP_NOT
OP_VERIFY
OP_SHA1
OP_SWAP
OP_SHA1
OP_EQUAL
```

In legacy P2SH:

```
scriptPubKey = OP_HASH160 <redeemScriptHash> OP_EQUAL
redeemScript = [the challenge above, compiled to bytes]
```

Anyone spending must reveal two distinct preimages that share the same SHA-1 digest, plus the redeem script itself.

---

## 5. Cross-Chain Mining Possibilities

Although the above example is Bitcoin-specific, the concept extends to:

- **Cross-Chain Bridging**: The same challenge can exist on multiple chains, potentially letting multi-chain solvers
  race each other. For instance, you could have some aggregator watch collisions found on chain A that also apply to
  chain B, awarding multiple bounties at once.
- **“Cross-chain mining”**: The idea that a single second-preimage or partial collision might pay you from multiple
  challenge outputs across different blockchains if they all share the same challenge structure.

---

## 6. End Game Goal

The end game goal is that once, volume is large enough, miner will mine SHA256 and SHA1 collisions in parallel. This
will
create a new type of mining that is accessible to the average user and can be applied across multiple chains, unifying
cross-chain incentives. Since front running in this model is possible, miners will be the end game winners.
