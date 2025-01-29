# OP_NET: Proof of Continuum (PoCtm) Proposal

## Introduction

Bitcoin's block times (~10 minutes on average) are **slow** and limited in throughput. Yet, **developers want** to build
advanced smart contracts, users will want instant token transfers, and high-throughput dApps **directly on Bitcoin's
security**. This is where this OP_NET proposal comes in.

This proposal introduces a novel approach to **fast, ephemeral transactions** on top of Bitcoin, allowing **~800ms-1sec
blocks** for internal state changes, while anchoring them in Bitcoin's security. You may see this concept like solana,
but, **it's just Bitcoin**.

1. **Ephemeral Transactions**:
    - Enable *near-instant* internal state changes **without** referencing unconfirmed Bitcoin UTXOs.
    - Avoid conflicts with on chain data by **disallowing** ephemeral usage of new BTC inputs/outputs.

2. **Sub-Blocks (Slots)**:
    - Group these ephemeral transactions in **fast intervals** ("slots"), each with a **gas limit** (100 billion gas).
    - Provide quick settlement *within* OP_NET while **awaiting** the next Bitcoin block for final anchoring.

3. **PoCtm (Proof of Continuum) & VDF (Verifiable Delay Function)**:
    - A **VDF** ensures sub-blocks *cannot be produced instantly*, so no single node can “speed-run” the ephemeral
      chain.
    - **PoCtm** is the sequential output of that VDF, anchoring sub-block progression in a *deterministic* “longest
      chain” model.

4. **Mineable UTXOs**:
    - Hold user prepaid BTC (for gas/fees) in a **puzzle** on Bitcoin via a **SHA1 collision** script.
    - Strengthen security by eventually rewarding puzzle solvers, aligning economic incentives with Bitcoin's like
      proof-of-work.

5. **Every Bitcoin Block**:
    - Confirms or finalizes the ephemeral sub-block chain since the previous block.
    - Ensures *absolute security* under the main chain's consensus, while ephemeral states see *fast* acceptance in
      seconds.

**Put simply**, OP_NET merges **fast ephemeral** usage with **Bitcoin-grade security**. Below we detail each component,
how they interact, and what they solve.

## Table of Contents

1. [Definitions](#definitions)
2. [Sub-Blocks (Slots)](#2-sub-blocks-slots)
3. [Ephemeral Transactions](#3-ephemeral-transactions)
4. [Mineable UTXOs](#4-mineable-utxos)
5. [Confirmation Every Bitcoin Block](#5-confirmation-every-bitcoin-block)
6. [Proposal](#proposal)

---

## Definitions: Proof of Continuum (PoCtm) & VDF

**PoCtm** (Proof of Continuum) ensures each sub-block slot is produced at a minimal *work and time (deterministic
clock)* cost:

1. **VDF**: A Verifiable Delay Function (class-group exponentiation) that must be computed *sequentially*.
2. **One Step per Sub-Block**:
    - Once a sub-block finishes (up to the gas limit), the node must compute the next VDF step to get **PoCtm\_{n+1}**
      from **PoCtm\_{n}**.
    - This prevents a malicious node from "instantly" generating many sub-blocks and rewriting ephemeral history.

**Result**: A single *longest chain* of sub-block references emerges. Each new ephemeral sub-block's PoCtm output is
easily verified, but *cannot* be skipped in real time.

--- 

## 2. Sub-Blocks (Slots)

A **sub-block** is a short-lived "slot" in OP_NET that:

1. **Accumulates ephemeral transactions** up to a *gas limit* (100 billion gas).
2. Once it fills or is closed, the node finalizes the slot and produces the next PoCtm output.
3. Multiple sub-blocks (slots) can occur between two Bitcoin blocks; collectively they form an "ephemeral chain."

### Why Sub-Blocks?

- 800ms-1sec sub-blocks allow **near-instant** internal state changes, while may fork intensively (if states conflicts),
  until the next Bitcoin block.
- They let OP_NET process transactions quickly in smaller increments, rather than waiting ~10 minutes for each Bitcoin
  block.
- They define discrete intervals for ephemeral state changes, so nodes can coordinate which transactions are included
  and in what order.

---

## 3. Ephemeral Transactions

**Ephemeral transactions** are:

1. **Purely Internal**:
    - They do not reference brand-new Bitcoin UTXOs.
    - Any attempt to load or spend a fresh BTC output is **rejected**, preventing conflict with unconfirmed BTC.

2. **Executed in Sub-Blocks**:
    - Users broadcast ephemeral transactions to OP_NET nodes, which group them into sub-blocks (slots).
    - Execution is "fast" and recognized among nodes *within seconds.*

3. **No Priority**
    - They are first-come, first-served. If the sub-block is full, the user waits for the next slot.

4. **Allows a Normal User to**:
    - Transfer OP_NET tokens or assets instantly.
    - Call OP_NET contracts for DeFi or dApp interactions.
    - Update local states, like NFT ownership, internal ledger changes, etc.

**Key**: Because they never reference new BTC UTXOs, ephemeral transactions can finalize quickly and *not* be undone by
a missing or reorged BTC transaction.

---

## 4. Mineable UTXOs

To enhance security and alignment with Bitcoin, **OP_NET** uses **Mineable UTXOs**:

1. **On-Chain Puzzle**
    - The user locks some BTC in a script that might require a **SHA1 collision** or another puzzle to spend.
    - This is the user's "prepaid gas" or deposit for OP_NET usage.

2. **Gas & Priority Fees**
    - Instead of burning fees outright, OP_NET can store them in these puzzle outputs.
    - Over time, these UTXOs accumulate, forming a bounty. If someone solves the puzzle, they claim the BTC.

3. **Why It Improves Security**
    - It aligns miners or puzzle solvers with OP_NET: The fees that would be "burned" or locked can eventually be
      claimed by anyone who finds a valid collision.
    - This bakes a *long-term incentive* into OP_NET, distributing the locked BTC as a reward for puzzle-solving.

Hence, **Mineable UTXOs** create an additional security layer and synergy with the Bitcoin chain. If a user wants
ephemeral transactions, they *prepay gas* by locking BTC in such a puzzle. The ephemeral sub-block chain references that
deposit to cover the user's gas usage.

---

## 5. Confirmation Every Bitcoin Block

Despite ephemeral sub-blocks being recognized among OP_NET nodes in near real-time:

1. **Longest Ephemeral Chain**: OP_NET nodes track ephemeral sub-blocks. If forks occur, the sub-block chain that
   accumulates more PoCtm steps is "longer."
2. **New Bitcoin Block**:
    - Once a new BTC block is mined, OP_NET finalizes the ephemeral chain for the previous block.
    - The ephemeral states from that chain are considered "confirmed."
3. **Reorg Handling**:
    - If the BTC block referencing your ephemeral chain is reorged out, OP_NET ephemeral states revert to the prior
      anchor.
    - This ensures ephemeral states never conflict with the final Bitcoin main chain.

Hence, ephemeral states are "instantly final" from a user perspective, but **absolutely final** once the next BTC block
arrives (or a dedicated anchor transaction references that sub-block's PoCtm).

---

## Proposal

**A normal user** can:

1. **Lock BTC** in a Mineable UTXO puzzle to prepay gas for OP_NET.
2. **Broadcast ephemeral transactions** that do purely internal state changes (transferring tokens, calling dApps,
   etc.). Solana-like speed and finality are achieved.
3. See those transactions included in a **sub-block** that is capped by, **100 billion gas**.
4. **PoCtm** ensures the next sub-block cannot appear instantly; a **VDF** step is required.
5. The ephemeral sub-block chain is recognized in seconds among OP_NET nodes, giving near-real-time finality for purely
   internal actions.

**What It Solves**:

- **Fast transaction needs** for OP_NET dApps.
- **No conflict** with unconfirmed BTC transactions (since ephemeral TX do *not* reference new UTXOs).
- **Security alignment** with Bitcoin (via final confirmation every BTC block and via mineable UTXOs).
- **Ensures** a single ephemeral chain—no infinite forking or speed-run sub-block creation—thanks to the PoCtm + VDF
  step.
