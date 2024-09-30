# **OP_Net EPOCH**

## Preface

In the rapidly evolving landscape of blockchain technology, ensuring the secure, efficient, and deterministic processing
of transactions is paramount. The OP_NET project aims to enhance the Bitcoin Layer 1 infrastructure by introducing smart
contracts and innovative solutions for wrapped Bitcoin (WBTC). This document provides an in-depth exploration of the
challenges associated with processing unwrap requests and presents a robust solution designed to maintain the integrity
and efficiency of the system.

## Introduction

Wrapped Bitcoin (WBTC) offers the same concept as WETH on Ethereum but for the Bitcoin ecosystem. WBTC allows OP_NET
smart contracts to hold actual Bitcoins. However, unwrapping WBTC and converting them back to native Bitcoin poses
significant challenges, particularly in ensuring that requests are processed deterministically and securely.

The primary focus of this document is to address the problem of deterministically processing unwrap requests. We will
delve into the intricacies of the issue, explore potential solutions, and present a comprehensive method to achieve
reliable and efficient unwrap transactions. This approach leverages a pending queue of PSBTs (Partially Signed Bitcoin
Transactions) to ensure that transactions are handled in a fair and systematic manner, mitigating risks and enhancing
the overall user experience.

## Problem Description

### Overview of the Unwrap Request Problem

The process of unwrapping WBTC, which involves converting Wrapped Bitcoin back into native Bitcoin, is critical for
users who wish to exit the WBTC ecosystem and reclaim their original Bitcoin assets. However, this process is not
without its challenges. The primary issue lies in ensuring that unwrap requests are processed deterministically and
securely, minimizing the risks of errors, delays, or fraudulent activities.

### Challenges in Deterministic Processing

1. **Timing and Synchronization:**
    - **Delayed Confirmations:** Transactions on the Bitcoin network can experience delays, sometimes taking hundreds of
      blocks to confirm. This variability can complicate the tracking and management of unwrap requests, leading to
      potential inconsistencies in processing.
    - **Concurrency Issues:** Multiple unwrap requests may be submitted simultaneously or within a short period,
      creating the challenge of ensuring that all requests are processed in the correct order and without conflict.

2. **UTXO Management:**
    - **Unspent Transaction Outputs (UTXOs):** The core of Bitcoin's transaction model is the UTXO system. Managing
      these UTXOs effectively is crucial for ensuring that unwrap requests are processed correctly. Determining the
      current balance and status of UTXOs can be challenging, especially if transactions are pending or delayed.
    - **Double-Spending Risks:** Ensuring that a UTXO used in an unwrap request has not been double-spent or otherwise
      compromised is essential for maintaining transaction integrity.

3. **Transaction Detection:**
    - **Indexing Challenges:** Reliably detecting and indexing transactions on the blockchain is a complex task. Missing
      or delayed transaction data can lead to discrepancies in processing unwrap requests.
    - **Network Latency:** Variability in network latency can affect the timely detection and processing of
      transactions, further complicating deterministic processing.

4. **Fee Management:**
    - **Fee Variability:** Transaction fees on the Bitcoin network can vary significantly, influencing the
      prioritization and confirmation times of transactions. Managing these fees effectively is crucial for ensuring
      timely processing of unwrap requests.
    - **Replace-by-Fee (RBF):** Transactions that support RBF can be replaced with higher-fee transactions, introducing
      additional complexity in managing and processing unwrap requests.

### Example Scenario

Consider a scenario where a user submits an unwrap request, and the transaction is created but takes an unusually long
time to confirm—say, 300 blocks. During this period, the user's WBTC balance and the status of the UTXOs involved in the
transaction must be accurately tracked. If another transaction involving the same UTXOs is submitted and processed
before the original transaction confirms, it could lead to inconsistencies and potential double-spending issues.
Ensuring that all these factors are managed deterministically is a significant challenge.

### Summary of the Problem

The key problem in processing unwrap requests lies in achieving a deterministic and secure system that can handle the
variability and complexity of the Bitcoin network. This involves managing UTXOs effectively, ensuring timely and
accurate transaction detection, and prioritizing transactions based on fees while avoiding issues such as
double-spending and delayed confirmations. Addressing these challenges is essential for maintaining the integrity and
reliability of the WBTC unwrapping process on the OP_NET platform.

In the following chapters, we will explore potential solutions to this problem, evaluate their feasibility, and present
a comprehensive approach to implementing a deterministic unwrap processing system.

## Solution Overview

### Two Approaches to Solving the Problem

To address the challenges associated with deterministically processing unwrap requests, we have explored two potential
solutions. Each approach has its merits and limitations, and this chapter will provide an overview of both, leading to
the identification of the most viable solution.

### Unviable Solution: Instant Signing

The first approach involves instantly signing unwrap requests as soon as they are detected and validated. Here’s how
this method would work and the reasons why it is ultimately not viable.

1. **Instant Signing Process:**
    - **Detection and Validation:** As soon as an unwrap request is detected, it is immediately validated.
    - **Signing:** Upon successful validation, the transaction is signed by an indexer and posted on-chain.

2. **Challenges and Issues:**
    - **Transaction Confirmation Delays:** The primary issue with this approach is dealing with transaction confirmation
      delays. A transaction might take an extended period to confirm, leading to uncertainties about the current WBTC
      balance of the requester.
    - **Concurrent Requests:** If multiple unwrap requests are made close to each other in time, managing the order and
      ensuring that each request is processed correctly becomes problematic.
    - **Undetected Transactions:** There is a risk that some transactions might not be detected by indexers due to
      network latency or other issues, resulting in inconsistent processing.
    - **Double-Spending Risks:** Ensuring that a UTXO remains unspent until the transaction confirms is challenging. If
      the UTXO is used in another transaction before the original one confirms, it could lead to double-spending issues.
    - **Complexity in Tracking UTXOs:** Keeping track of UTXOs and ensuring they are still valid and unspent over a
      potentially long confirmation period adds significant complexity.

Given these challenges, the instant signing approach is not a viable solution for deterministic and secure processing of
unwrap requests. The potential for delays, missed transactions, and double-spending risks outweigh the benefits of this
method.

### Viable Solution: Pending Queue of PSBTs

The second approach, which is more robust and addresses the challenges identified with the instant signing method,
involves using a pending queue of Partially Signed Bitcoin Transactions (PSBTs). This method introduces a structured
process to ensure deterministic and secure handling of unwrap requests.

1. **Pending Queue Process:**
    - **Detection and Initial Validation:** Unwrap requests are detected and initially validated.
    - **Queueing:** Instead of immediately signing, valid transactions are placed in a pending queue of PSBTs.

2. **Advantages Over Instant Signing:**
    - **Reduced Risk of Delays:** By queueing transactions, the system can manage and track multiple unwrap requests
      more effectively, mitigating the risks associated with delayed confirmations.
    - **Orderly Processing:** Transactions can be processed in a controlled manner, ensuring that each request is
      handled sequentially and according to established rules.
    - **Enhanced Security:** The pending queue allows for additional checks and validations before finalizing
      transactions, reducing the risk of double-spending and ensuring UTXOs remain valid.
    - **Fee-Based Prioritization:** Transactions can be sorted and prioritized based on the fees provided, optimizing
      for network efficiency and ensuring timely processing.

The following chapters will delve deeper into this viable solution, detailing the processes involved in filtering and
validating requests, managing the pending queue, and generating proposals for transaction processing. By implementing
this method, we can achieve a robust and deterministic system for unwrapping WBTC on the OP_NET platform.

## Viable Solution: **Epoch**

### Detailed Explanation

The **Epoch** method offers a structured and reliable solution for processing unwrap requests. This approach addresses
the challenges identified with instant signing by introducing a queue system that ensures deterministic and secure
handling of transactions.

### Advantages Over Instant Signing

The **Epoch** method provides several key advantages over the instant signing approach:

1. **Reduced Risk of Delays:**
    - **Controlled Processing:** By placing transactions in a pending queue, the system can manage the order and timing
      of each transaction more effectively. This reduces the risk associated with delayed confirmations and ensures that
      transactions are processed in a predictable manner.
    - **Efficient Handling:** The queue system allows for better handling of network congestion and variability in
      confirmation times, ensuring a smoother user experience.

2. **Orderly Processing:**
    - **Sequential Management:** Transactions in the pending queue can be processed sequentially, according to
      established rules and priorities. This orderly approach helps prevent conflicts and race conditions, ensuring that
      each unwrap request is handled correctly.
    - **Conflict Resolution:** The queue system provides a framework for resolving potential conflicts, such as
      competing transactions for the same UTXO, in a systematic manner.

3. **Enhanced Security:**
    - **Additional Validations:** The pending queue allows for additional checks and validations before finalizing
      transactions. This enhances security by ensuring that all transactions meet the necessary criteria and reduces the
      risk of double-spending.
    - **UTXO Integrity:** By maintaining a list of potential UTXO usages, the system can ensure that UTXOs remain valid
      and unspent until the transaction is confirmed, further enhancing security.

4. **Fee-Based Prioritization:**
    - **Optimized Processing:** Transactions can be sorted and prioritized based on the fees provided, ensuring that
      those with higher fees are processed first. This optimizes network efficiency and ensures timely processing of
      high-priority transactions.
    - **Fair Resource Allocation:** Fee-based prioritization helps allocate network resources fairly, ensuring that
      users who pay higher fees receive faster processing times.

### How the Epoch System Works

The **Epoch** method is designed to handle unwrap requests in a structured and secure manner. The process involves
several key steps:

1. **Detection and Initial Validation:**
    - **Request Detection:** Unwrap requests are detected as they are submitted to the system. Each request is initially
      validated to ensure it meets basic criteria, such as transaction validity and sufficient WBTC balance.
    - **Queueing Valid Requests:** Valid requests are placed in the pending queue of PSBTs. This queue serves as a
      holding area for transactions awaiting further processing and finalization.

2. **Filtering and Sorting:**
    - **Replace-by-Fee (RBF) Transactions:** Transactions that support RBF are filtered out, as they introduce
      additional complexity and potential conflicts.
    - **Fee-Based Sorting:** The remaining transactions are sorted based on the fees provided. Higher-fee transactions
      are given priority, ensuring they are processed more quickly and efficiently.

3. **Validation and UTXO Management:**
    - **Fee Adequacy:** Each transaction is checked to ensure it has provided enough fees to be confirmed within the
      next two blocks.
    - **Balance and UTXO Checks:** The system verifies that the requester has enough WBTC and that the UTXOs used in the
      transaction are still valid and unspent.
    - **Potential UTXO List:** Valid UTXOs are added to a "potential used list," ensuring they are tracked and remain
      unspent until the transaction is finalized.

4. **Finalization and Proposal Generation:**
    - **Dropping Invalid Requests:** Transactions that do not comply with the validation rules are dropped from the
      queue. Users are notified of the status of their transactions through a UI or other means.
    - **Proposal Sorting:** Once the valid transactions are identified, they are sorted by OP_NET priority fee, ensuring
      a deterministic ordering.

## OP_NET Epoch Proposal Generation - Epoch

### Proposal Generation

The final step in the Epoch process is the generation of proposals. Proposals are collections of valid transactions that
are ready to be included in the next block.

1. **Proposal Contents:**
    - **Current Height:** The height of the blockchain at the time of proposal generation.
    - **Last Block Checksum:** A checksum of the last confirmed block, ensuring consistency and security.
    - **Transactions (Ordered):** A list of valid transactions, ordered by OP_NET priority fee. Each transaction
      includes the following information:
        - **OP_NET Fee:** The fee paid for OP_NET processing.
        - **Bitcoin Fee:** The fee paid for Bitcoin network processing.
        - **PSBT Data:** The raw data of the Partially Signed Bitcoin Transaction.
        - **Transaction Identity:** A unique identifier for the transaction.
        - **Potential Transaction Hash:** The expected hash of the transaction once it is fully signed and broadcasted.
    - **Total Bitcoin Fee:** The total fees paid for Bitcoin network processing.
    - **Total OP_NET Fee:** The total fees paid for OP_NET processing.
    - **Proposal Root Hash:** A Merkle tree root hash of all the transactions, ensuring integrity and security.
    - **Proposal OP_NET Signature:** A signature from OP_NET, verifying the authenticity and validity of the proposal.

2. **Validator Contributions:**
    - **Generating Proposals:** Proposals can be generated by any validator, not just trusted indexers. This
      decentralized approach ensures fairness and security.
    - **Frequency of Proposal Generation:** By default, OP_NET will generate proposals every minute, ensuring timely
      processing of transactions.

## Proposal Contributions

In the Epoch system, proposal contributions play a crucial role in ensuring the deterministic and secure processing of
unwrap requests. Unlike traditional systems where only trusted indexers generate proposals, Epoch allows any validator
to contribute to proposal generation, enhancing decentralization and security.

### Role of Validators and Trusted Indexers

1. **Validators:**
    - **Proposal Generation:** Any validator within the OP_NET ecosystem can generate proposals. This open contribution
      model ensures that the system remains decentralized and resilient against potential centralization risks.
    - **Validation Responsibilities:** Validators are responsible for verifying the integrity and validity of the
      transactions included in the proposals. They ensure that all transactions comply with the established rules and
      criteria.

2. **Trusted Indexers:**
    - **Specialized Validators:** Trusted indexers are validators with a proven track record of reliability and
      security. Their job is to sign and validate transactions. They also determine who's proposal will be accepted.

#### Generating Proposals Every Block

1. **Frequency of Proposal Generation:**
    - **Block-Based Intervals:** Proposals are generated with every new block. This consistent generation ensures that
      unwrap requests are processed promptly and efficiently.
    - **Consistent Processing:** Generating proposals every block provides a predictable processing rhythm, reducing the
      risk of delays and ensuring that the system remains responsive to user requests.

2. **Target Generation:**
    - **Block-Based Generation:** The system uses a block-based approach to trigger proposal generation. Validators
      generate proposals with each new block, ensuring a steady flow of proposals.
    - **Network Efficiency:** This block-based approach optimizes network efficiency by balancing the load and ensuring
      that transactions are processed in a timely manner.

## Authority and Consensus Rules

The Epoch system incorporates a robust set of authority and consensus rules to ensure the orderly and secure selection
of proposals for inclusion in the blockchain. These rules define the roles and responsibilities of validators and
trusted indexers, as well as the process for selecting the best proposals.

### Validator Selection Process

1. **Consensus Rules:**
    - **Height-Based Selection:** The system selects the next trusted validator based on the blockchain height, ensuring
      a predictable and transparent selection process.

2. **Example Rule:**
    ```ts
    const validators = [...];
    const nextValidator = validators[height % validators.length];
    ```
    - **Height Modulo:** The height modulo operation selects the next validator in a round-robin fashion, ensuring that
      each validator has an equal opportunity to contribute.

### Future Plans for PoS Integration

1. **Transition to Proof-of-Stake (PoS):**
    - **Enhanced Security:** The system plans to transition to a Proof-of-Stake (PoS) model in the future. PoS offers
      enhanced security by requiring validators to hold and stake a certain amount of cryptocurrency, aligning their
      interests with the network’s success.
    - **Reduced Energy Consumption:** PoS is more energy-efficient than traditional Proof-of-Work (PoW) models, reducing
      the environmental impact of the network.

2. **PoS Implementation:**
    - **Gradual Transition:** The transition to PoS will be gradual, ensuring that the network remains stable and secure
      throughout the process.
    - **Stake-Based Selection:** In a PoS model, validators are selected based on the amount of cryptocurrency they
      stake, incentivizing good behavior and network participation.

## Proposal Submission and UTXO Management

Once a validator has selected the proposal they believe best suits the chain, this proposal will be broadcast to the
entire network as the next proposal to process. The integrity and security of this process are maintained through
several steps:

### Proposal Submission

1. **Broadcasting the Proposal:**
    - **Network Broadcast:** The selected proposal is broadcast to the entire network, allowing all nodes to receive and
      process it.
    - **Trusted Indexer Signature:** The proposal submission request includes the signature of the trusted indexer that
      selected it. This signature ensures that the proposal is authentic and has been vetted by a reliable party.

2. **Signature Verification:**
    - **Hash Matching:** The network verifies that the proposal hash matches the signature of the trusted indexer. If
      there is a mismatch, the proposal is dropped to prevent tampering or errors.

3. **Block Inclusion:**
    - **Adding to Block Header:** Once a block is mined, the proposal hash is added to the block header and the final
      checksum. This inclusion ensures that the proposal is permanently recorded, providing a traceable and verifiable
      record of the transaction batch.

### Processing a Proposal

When a proposal is processed, several critical actions are performed to ensure the integrity and reliability of the
unwrap transactions:

1. **Freezing UTXOs:**
    - **Temporary Allocation:** The UTXOs utilized in the proposal are frozen for 2 blocks. This temporary allocation
      means that these UTXOs are reserved for the unwrap transactions and cannot be used for any other transactions
      during this period.

2. **Unfreezing UTXOs:**
    - **Releasing Unused UTXOs:** After processing a block, OP_NET will unfreeze all UTXOs older than 2 blocks that have
      not been used in any confirmed transactions. This step ensures that newer requests can access these UTXOs,
      optimizing the use of available resources.

### Handling PSBT Requests

Every time a user submits a PSBT request, OP_NET performs additional filtering to ensure the efficient and secure use of
UTXOs:

1. **Filtering Frozen UTXOs:**
    - **Excluding Frozen UTXOs:** OP_NET filters out any UTXOs that are currently frozen, ensuring that only available
      UTXOs are considered for new transactions.
    - **Potential Transaction Utilization:** If no UTXOs are available, OP_NET will include the potential transactions
      contained in the last proposal into the list of usable UTXOs. This inclusion ensures that all possible resources
      are utilized effectively.

### Validator Rewards and Proposal Limits

To incentivize validators and maintain the efficiency of the system, several rules and rewards are established:

1. **Validator Rewards:**
    - **Contribution Reward:** The validator who proposed the selected proposal will be rewarded for their contribution
      to the network in WBTC. The reward is calculated as:
      5000 sat * Transaction Count
      This formula incentivizes validators to include as many valid transactions as possible in their proposals,
      enhancing network throughput and efficiency.

2. **Proposal Transaction Limits:**
    - **Maximum Transaction Limit:** The maximum number of transactions that a proposal may contain is set to 150. This
      limit ensures that proposals remain manageable and can be processed efficiently.
    - **Automatic Rejection:** If a proposal includes more than 150 transactions, it is automatically and instantly
      rejected. This rule prevents overloaded proposals and maintains the system’s performance.
