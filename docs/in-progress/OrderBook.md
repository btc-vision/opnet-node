# OP_NET Order Book Trading System

This document provides a detailed explanation of the OP_NET Order Book Trading System, covering its features,
transaction
structures, reservation mechanics, and comparisons to traditional PSBT trading and Uniswap's tick-based system. The
OP_NET order book system allows users to securely buy and sell tokens for BTC with flexible orders and anti-abuse
mechanisms.

---

## Table of Contents

1. [Introduction](#introduction)
2. [System Overview](#system-overview)
    - [Contract Approval](#contract-approval)
    - [Token Holding and Reservation Mechanism](#token-holding-and-reservation-mechanism)
3. [Transaction Types and Details](#transaction-types-and-details)
    - [Position Creation (Sell Order)](#position-creation-sell-order)
    - [Position Reservation (Buy Order)](#position-reservation-buy-order)
    - [Position Cancellation (Order Cancellation)](#position-cancellation-order-cancellation)
4. [Reservation Mechanism in Detail](#reservation-mechanism-in-detail)
5. [Comparison to Traditional PSBT Trading on Bitcoin](#comparison-to-traditional-psbt-trading-on-bitcoin)
6. [Comparison to Uniswap's Tick-Based System](#comparison-to-uniswaps-tick-based-system)
7. [Example Scenarios](#example-scenarios)

---

## 1. Introduction

The **OP_NET Order Book Trading System** provides a decentralized and flexible way for users to trade tokens for BTC.
Unlike traditional PSBT (Partially Signed Bitcoin Transaction) trades, which often require fixed amounts or complete
orders, OP_NET's approach allows users to fulfill partial orders and select specific price positions. This design makes
the OP_NET trading system similar to exchange-based order books or liquidity pools, enabling order fulfillment across
multiple price points and quantities.

---

## 2. System Overview

### Contract Approval

Before listing tokens for sale, a seller must approve the contract to spend the tokens they wish to deposit. This
authorization enables the contract to control token transfers on behalf of the seller, providing a trustless environment
for trade.

### Token Holding and Reservation Mechanism

1. **Contract as Custodian:** The contract holds all tokens listed for sale, maintaining full custody and ensuring
   transaction security.
2. **Reservation System:** When a buyer reserves tokens, the contract locks the reserved amount for that specific buyer
   for a limited period (e.g., 5 blocks). The locked tokens are exclusively available to the reserving buyer, preventing
   other users from accessing or purchasing these tokens until the reservation expires.

---

## 3. Transaction Types and Details

### Position Creation (Sell Order)

The **Position Creation** transaction is used by sellers to list tokens for sale. It includes the following parameters:

- **Target Price:** The BTC amount the seller wants per token.
- **Amount:** The number of tokens to be sold at the specified price.
- **Expiration Blocks:** The duration (in blocks) that this position will be valid.
- **BTC Receiving Address or Public Key:** The address where BTC payments will be received.

This transaction transfers the tokens to the contract, making them available for reservation by buyers. The seller can
create multiple positions with varying prices and expiration times, allowing flexibility similar to placing multiple
sell orders on an exchange.

### Position Reservation (Buy Order)

The **Position Reservation** transaction allows buyers to reserve tokens at specific price points. It includes:

- **Token Quantity:** The number of tokens the buyer wants to reserve.
- **Price Points and Slippage:** The price point(s) chosen for the reservation, with adjustable slippage (up to 100%) to
  manage partial orders or small price fluctuations.
- **Reservation Fee:** A small, non-refundable fee (e.g., 10,000 sats) that the buyer burns to secure the reservation.

Upon reservation, the contract locks the tokens, making them available only to the reserving buyer for a defined block
period. If the buyer completes the trade by sending the required BTC, the contract releases the tokens to the buyer;
otherwise, the reservation expires, releasing the tokens for other buyers.

### Position Cancellation (Order Cancellation)

If the seller wishes to cancel an active position, they send a **Position Cancellation** transaction, which includes:

- **Target Price(s):** Specifies the price points to be canceled.

Upon cancellation, any active reservations on the position are invalidated, and the seller can reclaim their tokens once
all active reservations expire (e.g., after 5 blocks). This allows the seller to manage their listings without
disrupting ongoing trades.

---

## 4. Reservation Mechanism in Detail

The reservation mechanism in OP_NET operates as follows:

1. **Reservation Locking:** When a buyer submits a reservation request, the contract locks the requested quantity of
   tokens at the specified price. These tokens are now exclusively reserved for the buyer, preventing any other user
   from purchasing them.

2. **Reservation Duration:** Each reservation is valid for a limited period (e.g., 5 blocks). If the buyer fails to
   complete the purchase within this timeframe, the reservation expires, and the tokens are released back into the
   contract's available supply.

3. **Transaction Finalization:** If the buyer confirms the trade by sending the required BTC, the contract releases the
   tokens to the buyer, marking the reservation as completed.

4. **Partial Fulfillment:** Unlike fixed-order models, buyers can partially fulfill reservations. For example, if a
   buyer reserved tokens across multiple price points but chooses to purchase only a subset, they can selectively
   fulfill part of the reservation. This flexibility mimics order-book-style trading by allowing partial order fills.

---

## 5. Comparison to Traditional PSBT Trading on Bitcoin

### Key Differences

- **Flexible Order Quantities:** Unlike traditional PSBT trades on Bitcoin, which are often rigid in quantity and
  require precise order amounts, OP_NET's system allows buyers to reserve partial amounts across different price points.
- **No Fixed BTC Total Requirement:** The system does not require a specific BTC total or fixed token amount, allowing
  users to buy in smaller increments and across price ranges, similar to fulfilling multiple smaller orders in an order
  book.
- **Order Book Functionality:** OP_NET resembles an exchange-based order book, where users can place and fulfill orders
  at different price levels, offering the flexibility that PSBT trading typically lacks.

---

## 6. Comparison to Uniswap's Tick-Based System

Uniswap v3 and v4 use a **tick-based** pricing mechanism, where liquidity is concentrated around specific price ticks,
allowing liquidity providers to set price ranges.

### Comparison Points

- **Price Positions as Ticks:** Like Uniswap, OP_NET enables users to define specific price points, effectively creating
  "ticks" in the order book. Each position acts as a price level, and buyers can reserve tokens across these levels.
- **Order Fulfillment Flexibility:** While Uniswap requires users to swap based on liquidity within tick ranges, OP_NET
  allows buyers to reserve tokens across multiple price points with slippage control. This system enables more
  controlled and precise order fulfillment, akin to selecting specific orders in a traditional exchange order book.

---

## 7. Example Scenarios

### Scenario 1: Standard Token Sale by Seller

1. **Seller's Setup:** Alice wants to sell 10 tokens at a price of 0.005 BTC each and creates a position on OP_NET.
2. **Position Listing:** The contract lists Alice's order, making it available to potential buyers.
3. **Buyer's Reservation:** Bob reserves 5 tokens, burning a reservation fee. The contract locks the reserved tokens
   specifically for Bob.
4. **Completion:** Bob completes the purchase, and the contract releases the 5 tokens from Alice's position to Bob.

### Scenario 2: Front-Running Defense

1. **Front-Running Attempt:** Alice lists tokens at 0.003 BTC each. Bob reserves tokens, but Eve attempts to front-run.
2. **Defense Mechanism:** The contract blocks Eve's transaction since the tokens are exclusively reserved for Bob.

### Scenario 3: Reservation Spam Protection

1. **Spam Attempt:** Mal attempts to reserve multiple positions without completing the trades.
2. **Spam Deterrent:** Each reservation requires a burn fee, making spam costly. Unfulfilled reservations expire,
   releasing tokens for other buyers.

### Scenario 4: Slippage Control and Reservation Integrity

1. **Slippage Control:** Bob reserves multiple price points with slippage. The contract only locks tokens positions
   matching the adjusted price.
2. **Trade Verification:** The contract verifies that the BTC amount matches the reserved tokens and releases tokens up
   to the correct amount, preventing slippage abuse.
