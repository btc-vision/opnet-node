# OP_NET Public Key Integration

## Introduction

As part of our ongoing efforts to enhance the functionality and interoperability of OP_NET, we are transitioning from using address strings to using **tweaked public keys**. This significant change aims to unify accounts under a single public key, similar to Ethereum's approach, and bring about numerous benefits including improved compatibility across various Bitcoin address types.

This README provides a comprehensive guide on this transition, including detailed explanations, code examples, and the reasoning behind this change.

---

## Table of Contents

1. [Background](#background)
    - [Bitcoin Addresses and Public Keys](#bitcoin-addresses-and-public-keys)
    - [Ethereum's Account Model](#ethereums-account-model)
2. [Transition to Public Keys](#transition-to-public-keys)
    - [Unified Accounts](#unified-accounts)
    - [Compatibility with Bitcoin](#compatibility-with-bitcoin)
    - [Using Compressed Public Keys](#using-compressed-public-keys)
3. [Understanding Taproot and Tweaked Keys](#understanding-taproot-and-tweaked-keys)
    - [Taproot Tweaked Keys](#taproot-tweaked-keys)
    - [Code Example: Tweaking a Public Key](#code-example-tweaking-a-public-key)
4. [Address Representation](#address-representatioN)
    - [Using Uint8Array](#using-uint8array)
    - [Converting Tweaked Public Keys to Addresses](#converting-tweaked-public-keys-to-addresses)
    - [Code Example: Conversion Functions](#code-example-conversion-functions)
5. [Public Key Retrieval Endpoint](#public-key-retrieval-endpoint)
    - [btc_getAccount Endpoint](#btc_getaccount-endpoint)
6. [Rationale Behind the Change](#rationale-behind-the-change)
    - [Unified Account System](#unified-account-system)
    - [Forward and Backward Compatibility](#forward-and-backward-compatibility)
7. [Unlocking New Capabilities](#unlocking-new-capabilities)
    - [Resolving Wallet Compatibility Issues](#resolving-wallet-compatibility-issues)
8. [Considerations and Potential Downsides](#considerations-and-potential-downsides)
    - [Abstracting Public Keys for Users](#abstracting-public-keys-for-users)
    - [Edge Case Scenarios Where the Public Key Cannot Be Found](#edge-case-scenarios-where-the-public-key-cannot-be-found)

---

## Background

### Bitcoin Addresses and Public Keys

In Bitcoin, addresses are derived from public keys using various scripts and hashing algorithms. The primary address types include:

- **P2PK (Pay to Public Key)**: The initial Bitcoin address type where transactions are directly linked to a public key.
- **P2PKH (Pay to Public Key Hash)**: Uses a hash of the public key for addresses, enhancing security and privacy.
- **P2SH (Pay to Script Hash)**: Allows transactions to be sent to a script hash, enabling complex scripts.
- **P2WPKH (Pay to Witness Public Key Hash)**: Part of the SegWit upgrade, improving scalability and reducing fees.
- **P2TR (Pay to Taproot)**: Introduced with Taproot, enhancing privacy and scripting capabilities.

Despite the different address formats, all Bitcoin addresses ultimately originate from a public key. Bitcoin allows funds to be sent directly to a public key, and the public key itself can be considered an address.

### Ethereum's Account Model

Ethereum uses a different approach where accounts are directly associated with public keys.
An Ethereum address is derived from the public key, just like bitcoin, and all transactions and contracts are tied to this address.
At its core, Ethereum uses the same concept as Bitcoin in public key but only have one possible derivation path.

For a detailed explanation, refer to [Ethereum Accounts Explained](https://asecuritysite.com/node/js_ethereum2).

---

## Transition to Public Keys

### Unified Accounts

By adopting public keys instead of address strings, OP_NET aims to:

- **Unify accounts** under a single public key, regardless of the address type.
- **Simplify asset management**, as all tokens and contracts will be associated with the public key.
- **Enhance interoperability** across different Bitcoin address formats.

### Compatibility with Bitcoin

Using public keys aligns with Bitcoin's protocols:

- **Direct Transactions to Public Keys**: Bitcoin allows sending funds directly to a public key.
- **No Protocol Violations**: This approach adheres to Bitcoin's rules and does not introduce any incompatibilities.
- **Example Transaction**: Sending Bitcoin directly to a public key is demonstrated in [this transaction](https://mempool.opnet.org/tx/e1a9a5dfb4a82e2656bdd5917ce04d3db7e79c7b9660294fdcb9769a5ee76cca).

### Using Compressed Public Keys

OP_NET will utilize **xOnly tweaked public keys**, which are 32 bytes in length (fit in exactly one pointer).
In bitcoin, public keys are 33 bytes in length, the first byte is a prefix that indicate if the y-coordinate is even or odd.

By using the tweaked version of the original public key which is 32 bytes, we support Taproot and enhance privacy and security.

---

## Understanding Taproot and Tweaked Keys

### Taproot Tweaked Keys

With the introduction of Taproot in Bitcoin, public keys are **tweaked** to enhance privacy and flexibility:

- **Tweaking Process**: Involves combining the original public key with a hash of the key and optional data (e.g., scripts).
- **Non-revocable Keys**: Tweaked keys cannot be reversed to obtain the original key, enhancing security.
- **Formula**: The tweaked key Q is calculated as:

  $$ Q = P + H(P||c) \cdot G $$

  Where:
    - P is the original public key.
    - H is a hash function.
    - c is optional commitment data.
    - G is the generator point on the elliptic curve.

### Code Example: Tweaking a Public Key

Below is a TypeScript function to tweak a public key:

```typescript
/**
 * Tweak a public key for Taproot
 * @param {string} compressedPubKeyHex - The compressed public key hex string (33 bytes)
 * @returns {string} - The tweaked public key hex string (33 bytes)
 * @throws {Error} - If the public key cannot be tweaked
 */
function tweakPublicKey(compressedPubKeyHex: string): string {
  // Convert the compressed public key hex string to a Point on the curve
  let P = Point.fromHex(compressedPubKeyHex);

  // Ensure the point has an even y-coordinate
  if (!P.hasEvenY()) {
    // Negate the point to get an even y-coordinate
    P = P.negate();
  }

  // Get the x-coordinate (32 bytes) of the point
  const x = P.toRawBytes(true).slice(1); // Remove the prefix byte

  // Compute the tweak t = H_tapTweak(x)
  const tHash = taggedHash('TapTweak', Buffer.from(x));
  const t = utils.mod(BigInt('0x' + Buffer.from(tHash).toString('hex')), CURVE.n);

  // Compute Q = P + t*G (where G is the generator point)
  const Q = P.add(Point.BASE.multiply(t));

  // Return the tweaked public key in compressed form (hex string)
  return Q.toHex(true);
}
```

You can use the `tweakPublicKey` function to generate a tweaked public key for Taproot transactions.

```ts
import { EcKeyPair, networks } from '@btc-vision/transaction';

const compressedPubKey = '0x0222513da2b72f9f8e26a016087ee191fc60be4671cae286bd2f16261c026dcb12'; // without 0x also works
const tweakedPubKey = EcKeyPair.tweakPublicKey(compressedPubKey);
```
---

## Address Representation

### Using Uint8Array

- **Binary Representation**: Addresses in contracts will now be represented as `Uint8Array` (binary data) instead of strings.
- **Efficiency**: Binary representation is more efficient for processing and storage.
- **Consistency**: Aligns with the use of compressed public keys.

### Converting Tweaked Public Keys to Addresses

To convert a tweaked public key to a P2TR address, you can use functions from the `@btc-vision/transaction` package.

### Code Example: Conversion Functions

```typescript
import { EcKeyPair, networks } from '@btc-vision/transaction';

// For a 33-byte tweaked public key
const tweakedPubKey = '0x02cbe1fb2adf81b16ba4afbb38743f4738ccb28170d2efc35a3ca9366ce64ea451'; // without 0x also works
const p2trAddress = EcKeyPair.tweakedPubKeyToAddress(tweakedPubKey, networks.regtest);

// For a 32-byte x-only tweaked public key
const xOnlyTweakedPubKey = '0xcbe1fb2adf81b16ba4afbb38743f4738ccb28170d2efc35a3ca9366ce64ea451'; // without 0x also works
const p2trAddressXOnly = EcKeyPair.xOnlyTweakedPubKeyToAddress(xOnlyTweakedPubKey, networks.regtest);
```
**EcKeyPair.tweakedPubKeyToAddress**: Converts a 33-byte tweaked public key to a P2TR address.

**EcKeyPair.xOnlyTweakedPubKeyToAddress**: Converts a 32-byte x-only tweaked public key to a P2TR address.

---

## Public Key Retrieval Endpoint

### btc_getAccount Endpoint

OP_NET provides an endpoint `btc_getAccount` to retrieve the public key and associated addresses from various inputs.

**Parameter (one of)**:
- **Original Public Key**
- **Tweaked Public Key**
- **Address**: Can be any of the following types:
    - P2TR (Pay to Taproot)
    - P2PKH (Pay to Public Key Hash)
    - P2SH-P2WPKH (Pay to Script Hash wrapped Pay to Witness Public Key Hash)
    - P2WPKH (Pay to Witness Public Key Hash)

The endpoint returns data conforming to the following interface:

```typescript
interface PublicKeyDocument {
  readonly tweakedPublicKey: Binary; // The tweaked public key (mandatory)
  readonly publicKey?: Binary;       // The original public key (if available)
  readonly lowByte?: number;         // Optional low byte of the public key
  readonly p2tr: string;             // P2TR address derived from the tweaked public key
  readonly p2pkh?: string;           // P2PKH address (if applicable)
  readonly p2shp2wpkh?: string;      // P2SH-P2WPKH address (if applicable)
  readonly p2wpkh?: string;          // P2WPKH address (if applicable)
}
```

---

## Rationale Behind the Change

### Unified Account System

- **Single Identity**: All addresses derived from the same public key represent one account.
- **Simplified Asset Management**: Tokens and contracts are tied to the public key, not individual addresses.
- **Consistent User Experience**: Users can interact with OP_NET without worrying about address formats.

### Forward and Backward Compatibility

- **Backward Compatibility**: Supports all existing Bitcoin address types (legacy, SegWit, Taproot).
- **Forward Compatibility**: Prepared for future Bitcoin upgrades and address formats.
- **Universal Acceptance**: Users can use any Bitcoin address type to interact with OP_NET.

---

## Unlocking New Capabilities

All address types are unified under the same public key.

### Resolving Wallet Compatibility Issues

- **Ordinals and Runes**: Ownership of Bitcoin tokens like Ordinals and Runes is represented as UTXOs, leading to complexities.
- **Wallet Differences**: Different wallets handle these tokens differently, causing confusion.
    - **Xverse**: Stores Ordinals/Runes in a separate Taproot wallet.
    - **Unisat**: Stores them in the same Taproot address but disables spending of associated UTXOs.
- **OP_NET Solution**: By unifying accounts via public keys:
    - **Simplified Airdrops**: When airdropping tokens, they are credited to the user's public key, not a specific address.
    - **No Need for Wallet Import**: Users don't need to import private keys into different wallets, enhancing security.
    - **Reduced Complexity**: Developers don't have to decide which address type to target.

---

## Considerations and Potential Downsides

### Abstracting Public Keys for Users

- **User Expectations**: Users are accustomed to address strings, not public keys.
- **Solution**:
    - **OP_NET Endpoints**: Provide APIs to map addresses to public keys.
    - **User Interfaces**: Design UIs that display information in terms users understand.

### Handling Fresh Wallets Without Transactions

- **Issue**: Fresh Bitcoin wallets with no transactions have unrevealed public keys.
- **Implications**:
    - **No PubKey Found**: OP_NET transactions may fail with an error if the public key isn't revealed.
    - **Receiving OP_NET Tokens**: Users may not receive tokens sent to an address without a revealed public key.
- **Workarounds**:
    - **Sending Bitcoin**: Users can receive a small amount of Bitcoin to reveal the public key.
    - **Spending UTXOs**: For SegWit addresses, spending a UTXO reveals the public key.
    - **Using Public Key Directly**: Tokens can be sent using the public key if known.
- **Affected Scenarios**:
    - **Edge Cases**: Mostly affects users creating new wallets to receive tokens without prior Bitcoin activity.
    - **Sybil Attacks**: Could deter users attempting to game the system with multiple fresh wallets.

### Edge Case Scenarios Where the Public Key Cannot Be Found

When using public keys instead of address strings, there are certain edge cases where the public key cannot be retrieved automatically. This table outlines these scenarios, explains why the public key cannot be found, and suggests potential workarounds.

Please note that these scenarios does not affect to the user itself since the user knows the public key of his own wallet at all time.

| **Scenario** | **Description** | **Reason Public Key Cannot Be Found** | **Implications** | **Potential Workarounds** |
|--------------|-----------------|---------------------------------------|----------------------------------------------------------------|--------------------------|
| **Fresh Wallet with No Transactions** | A brand-new Bitcoin wallet that has not received or sent any transactions. | The public key is not yet recorded on the blockchain because no transactions involving the key have occurred. | OP_NET cannot retrieve the public key: "No PubKey found" error. | Receive a small amount of Bitcoin and spend it to reveal the public key on the blockchain. |
| **P2PKH Address with Only Incoming Transactions** | A wallet that has only received funds and has never spent any (no outgoing transactions). | In P2PKH, the public key is revealed only when a transaction is signed and broadcast (during spending). | OP_NET cannot retrieve the public key: "No PubKey found" error. | Make an outgoing transaction to reveal the public key. |
| **P2SH Address Without Revealed Redeem Script** | Funds stored in a P2SH address where the redeem script hasn't been used in a transaction. | The public key(s) are part of the redeem script, which isn't revealed until a spend occurs. | OP_NET cannot retrieve the public key: "No PubKey found" error. | Spend from the address to reveal the redeem script and associated public key(s). |
| **P2WPKH (SegWit) Address with Unspent UTXOs** | A SegWit address that has received funds but hasn't spent any. | Public keys in P2WPKH are revealed when spending occurs; unspent UTXOs keep the public key hidden. | OP_NET cannot retrieve the public key: "No PubKey found" error. | Spend some funds from the address to reveal the public key. |
| **Multisig Wallets (P2SH or P2WSH) Without Spending History** | Multisig wallets where no transactions have been made from the address. | Public keys are embedded in the script and are only revealed upon spending. | OP_NET cannot retrieve the public key: "No PubKey found" error. | Perform a transaction spending from the multisig address to expose the public keys. |
| **HD Wallet Addresses That Haven't Received Funds** | Addresses generated by HD wallets that haven't been used yet. | Unused addresses have no associated transactions; public keys are not on the blockchain. | OP_NET cannot retrieve the public key: "No PubKey found" error. | Use the address to receive and then spend funds to reveal the public key. |
| **Non-standard or Custom Script Addresses** | Addresses created using non-standard scripts or custom locking conditions. | Public keys may not be derivable from non-standard scripts until they are executed. | OP_NET cannot retrieve the public key: "No PubKey found" error. | Provide the public key directly if possible or avoid using non-standard scripts for OP_NET interactions. |

All these situation are most-likely to not happen since an user must have funds anyways to interact with OP_NET.
Please note that these scenarios are edge cases and may not affect the majority of users. However, it's essential to be aware of these situations and have strategies in place to handle them effectively.

If a public key is not found by OP_NET, you can use the public key directly. All users have access to their own public key, and they can provide it for transactions or interactions with OP_NET.
