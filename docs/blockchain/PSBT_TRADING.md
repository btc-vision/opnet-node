# PSBT Trading on OP_NET: Enhancing Trustless Token Exchange Mechanisms

## Table of Contents

- [Introduction](#introduction)
    - [What is PSBT Trading?](#what-is-psbt-trading)
- [How PSBT Trading Works on OP_NET](#how-psbt-trading-works-on-op_net)
    - [Overview](#overview)
    - [Steps Involved](#steps-involved)
        - [1. Seller Initiates the Transaction](#1-seller-initiates-the-transaction)
        - [2. Seller Creates a PSBT](#2-seller-creates-a-psbt)
        - [3. Buyer Participates in the PSBT](#3-buyer-participates-in-the-psbt)
        - [4. Transaction Completion](#4-transaction-completion)
- [Smart Contract Behavior](#smart-contract-behavior)
- [Frontend (User Interface) Behavior](#frontend-user-interface-behavior)
- [Attack Vectors and Mitigations](#attack-vectors-and-mitigations)
    - [Potential Attacks](#potential-attacks)
        - [1. Front-running](#1-front-running)
        - [2. Honeypots](#2-honeypots)
        - [3. Transfer Fees on Tokens](#3-transfer-fees-on-tokens)
        - [4. Transaction Reversions](#4-transaction-reversions)
- [Failsafe Mechanism](#failsafe-mechanism)
- [Conclusion](#conclusion)
- [Disclaimer](#disclaimer)

---

## Introduction

In the decentralized finance (DeFi) ecosystem, trustless and secure token exchanges are paramount. **OP_NET** is committed to expanding the capabilities of the Bitcoin network through innovative solutions.  
OP_NET is utilizing Wrapped Bitcoin (WBTC) to enable advanced trading functionalities. To further enhance trustless trading with no peer interaction, OP_NET is adding **Partially Signed Bitcoin Transactions (PSBT) trading** as a second method for exchanging tokens on OP_NET.

While WBTC provides extensive functionalities within OP_NET, PSBT trading is being added to enhance trustless trading with no peer interaction.
PSBT trading offers an additional method for exchanging tokens directly on the Bitcoin network, providing more options and flexibility for users.

### What is PSBT Trading?

A **Partially Signed Bitcoin Transaction (PSBT)** is a Bitcoin standard that allows multiple parties to collaboratively build and sign transactions.
By leveraging PSBTs, users can create complex transactions requiring inputs and signatures from different parties, enhancing security and flexibility.

---

## How PSBT Trading Works on OP_NET

### Overview

The PSBT trading process involves a seller who wants to exchange their tokens for BTC and a buyer who wants to acquire those tokens by providing the required BTC.
The exchange is facilitated through smart contracts and PSBTs, ensuring that both parties fulfill their obligations without the need for intermediaries or peer interaction.

### Steps Involved

#### 1. Seller Initiates the Transaction

- The seller sends a transaction to the PSBT management smart contract, depositing their tokens (e.g., 50,000 TOKENS).
- This transaction is confirmed on the blockchain, locking the seller's tokens within the contract. This transaction include a dummy UTXO which prevent front-running/double-spent attacks.

#### 2. Seller Creates a PSBT

The seller generates a PSBT containing:

- **OP_NET Interaction:** An instruction to the PSBT management contract to transfer a specified amount of tokens upon successful completion.
- **Bitcoin Output:** An output directed to the seller's Bitcoin wallet, requesting a specific amount of satoshis (the BTC equivalent for the tokens offered).
- **The dummy UTXO:** This UTXO is used to prevent front-running/double-spent attacks. It gets generated when the seller send his tokens to the PSBT management contract. 

#### 3. Buyer Participates in the PSBT

- The buyer reviews the PSBT, ensuring that the terms (amount of tokens and required BTC) are acceptable.
- The buyer adds an input to the PSBT that fulfills the seller's BTC request.
    - **Note:** The buyer cannot create additional outputs. Any excess BTC provided beyond the seller's request is effectively "burned" as transaction fees on the Bitcoin network.
- The buyer signs the PSBT, completing their part of the transaction.

#### 4. Transaction Completion

- Once the PSBT is fully signed, it is broadcasted to the network.
- The PSBT management contract verifies that:
    - The required output (BTC amount and destination) is present and matches the seller's specifications.
    - All conditions are met for the token transfer.
- Upon successful verification, the contract releases the tokens to the buyer.
- The seller receives the specified amount of BTC in their Bitcoin wallet.

---

## Smart Contract Behavior

- **Verification:** The contract checks that the PSBT includes the correct output (value and destination) as specified by the seller during the initial token transfer.
- **Reversion:** If the PSBT does not meet the specified conditions, the contract reverts the transaction, protecting the seller's tokens.
- **Gas Limitations:** To prevent abuse and gas bases exploits, the gas cost for these transactions is capped at a ratio of 1x and is not affected by base gas fluctuations. The maximum gas usable is set to 1,000,000,000g.

---

## Frontend (User Interface) Behavior

- **Simulation:** Before signing, the frontend simulates the PSBT's validity to ensure that all conditions are met and that the transaction will succeed.
- **Flagging Invalid PSBTs:** If the PSBT does not meet the necessary criteria (e.g., incorrect outputs, exceeding gas limits), the frontend flags it as invalid and prevents the user from proceeding.
- **User Protection:** By simulating and validating transactions, the frontend protects buyers from potential scams or invalid transactions.

---

## Attack Vectors and Mitigations

### Potential Attacks

1. **Front-running:** An attacker tries to intercept and execute the transaction before the intended buyer.
    - **Mitigation:** Due to the nature of PSBTs and Bitcoin's UTXO model, front-running is ineffective. If attempted, the buyer does not lose their BTC, as the transaction would not meet the required conditions.

2. **Honeypots:** Malicious sellers set up traps to steal buyers' BTC.
    - **Mitigation:** The frontend simulation ensures that the PSBT is valid and meets all conditions before the buyer signs it, protecting them from honeypots.
    - **Limitation:** A bot (that own the token in question) could trigger a switch by front-running the transaction and disabling the transfer of tokens which would result in the buyer losing their BTC. While the system can prevent most honeypots, users should exercise caution and perform due diligence.

3. **Transfer Fees on Tokens:** Tokens with built-in transfer fees could disrupt the expected outcomes.
    - **Mitigation:** While the system cannot control token mechanics, the simulation and contract verification help identify and prevent issues arising from unexpected fees.

4. **Transaction Reversions:** Transactions revert, causing buyers to lose BTC.
    - **Mitigation:** Such events are detectable and traceable. A failsafe mechanism invalidates all affected PSBT listings of a given contract, preventing further exploitation.
    - **Limitation:** The system cannot prevent all transaction reversions, but it can quickly identify and address them.
    - **Note:** This failsafe mechanism will ignore the following attack vectors: gas based reversion (out of gas), memory based reversion (out of memory), invalid output provided by the buyer or invalid sender pubkey.

---

## Failsafe Mechanism

To enhance security, a failsafe is implemented:

- **Checksum Verification:** All PSBT listings include a checksum. After each block, the system verifies the checksum.
    - If the checksum does not match, indicating potential tampering or an exploit, the listing becomes invalid.
    - This ensures that any compromised PSBTs are quickly invalidated.

- **Frontend Reversion:** An invalid checksum causes the frontend's validation to fail, preventing users from proceeding with compromised transactions.

- **Gas Cost Enforcement:** Transactions are limited to a maximum of 1,000,000,000g, regardless of base gas prices. If a PSBT requires more gas, it is flagged as invalid.

---

## Conclusion

OP_NET is dedicated to expanding the capabilities and trustless nature of token exchanges within the Bitcoin network.  
By adding PSBT trading, OP_NET enhances trustless trading with no peer interaction, providing an additional method for users to exchange tokens directly on the Bitcoin network.  
This complements the existing WBTC functionalities and aligns with OP_NET's commitment to innovation, security, and user empowerment in the DeFi ecosystem.

---

## Disclaimer

- Users should exercise caution and perform due diligence when engaging in PSBT trading or using WBTC on OP_NET.
- Always ensure that you are interacting with legitimate smart contracts and that the PSBT conditions match your expectations.
- Be aware of the inherent risks in DeFi and blockchain transactions, including potential exploits and market volatility.
- This trading mechanism is designed to mitigate most of the risks but cannot guarantee 100% safety. This is decentralized finance, and users should be aware of the risks involved.
