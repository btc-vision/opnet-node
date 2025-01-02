# Breaking Change Notice

## 🚨 Runtime 1.3.2 🚨

We are happy to introduce a **new address format** that is based on **public keys**! This upgrade is a **breaking change
**, so please read carefully and start upgrading your projects.

### Table of Contents

1. [Breaking Change Notice](#breaking-change-notice)
2. [⚠️ Breaking Changes](#breaking-changes)
3. [📦 Libraries to Upgrade](#libraries-to-upgrade)
4. [🗑️ Deprecated Library](#deprecated-library)
5. [🚨 Unit Testing Framework Update](#unit-testing-framework-update)
6. [📉 Major Gas Cost Reduction](#major-gas-cost-reduction)
7. [🆕 New Methods & Classes](#new-methods--classes)
8. [📚 Some Detailed Documentation](#some-detailed-documentation)
    - [Key Concepts of the New Address Format](#key-concepts-of-the-new-address-format)
    - [Address Usage Examples](#address-usage-examples)
9. [Automatic Conversion to Hex in String Interpolation](#automatic-conversion-to-hex-in-string-interpolation)
10. [Special Address: `dead`](#special-address-dead)
11. [🔄 Address Comparisons](#address-comparisons)
    - [Correct Way to Compare Addresses](#correct-way-to-compare-addresses)
    - [Managing Multiple Addresses with `AddressSet`](#managing-multiple-addresses-with-addressset)
    - [Mapping Addresses with `AddressMap`](#mapping-addresses-with-addressmap)
12. [New Address Type for OP_NET Contracts](#new-address-type-for-opnet-contracts)
13. [Recommended Usage for `Address`](#recommended-usage-for-address)
    - [Why You Should Avoid `.fromString()`](#why-you-should-avoid-fromstring)
14. [Important Note: Address Representation as Tweaked Compressed Public Keys](#important-note-address-representation-as-tweaked-compressed-public-keys)
15. [Using Optimized Memory Maps](#using-optimized-memory-maps)
    - [AddressMemoryMap Usage](#addressmemorymap-usage)
    - [MultiAddressMemoryMap Usage](#multiaddressmemorymap-usage)
    - [Uint8ArrayMerger Usage](#uint8arraymerger-usage)
16. [Comparison and Equality of Addresses](#comparison-and-equality-of-addresses)
17. [📅 Regtest Update Timeline](#regtest-update-timeline)

---

### Breaking Changes

⚠️ WARNING ⚠️

- **Address Format Change**: OP_NET is migrating from string-based addresses to **public key-based addresses** using
  `Uint8Array`. This change introduces unified accounts based on the same public key. The new address format enables
  improved security, performance, and significant reductions in gas costs.

  **Action Required**: To comply with this update, you **must upgrade** your libraries and modify how addresses are
  managed in your system.

---

### Libraries to Upgrade

To continue working with OP_NET, you **must upgrade** the following libraries:

- **@btc-vision/btc-runtime**: Version `1.3.2` or higher
- **@btc-vision/transaction**: Version `1.0.114` or higher

Please note that these updates are **mandatory** for the new address system to function properly.

---

### Deprecated Library

The following library has been **merged** and is now deprecated:

- **@btc-vision/bsi-binary**: This library has been merged with `@btc-vision/transaction` and will be **deleted in one
  week**.

---

### Unit Testing Framework Update

To comply with the new address changes, you **must switch** to the new unit testing framework:

[OPNet Unit Test Framework](https://github.com/btc-vision/opnet-unit-test)

Review the migration changes to understand the new system:
[Migration Pull Request](https://github.com/btc-vision/opnet-unit-test/pull/8/files)

---

### Major Gas Cost Reduction

This upgrade delivers a **significant reduction in gas costs**. For example:

- **Transfer** gas costs were reduced from **673,985,327g** to **349,930,040g**   a savings of **324,055,287g**!

This will result in more efficient transactions and reduced operational costs.

---

### New Methods & Classes

Several new methods and classes have been added to `@btc-vision/transaction`. These are the most important ones for you
to review:

- [EcKeyPair Class](https://transaction.opnet.org/classes/EcKeyPair.html)
- [Address Class](https://transaction.opnet.org/classes/Address.html)
- [AddressMap Class](https://transaction.opnet.org/classes/AddressMap.html)
- [AddressSet Class](https://transaction.opnet.org/classes/AddressSet.html)

---

## Some Detailed Documentation...

### Key Concepts of the New Address Format

- **Public Key-based Addresses**: The new format uses `Uint8Array` to represent addresses, derived from public keys.
- **Unified Accounts**: The same public key can be used for multiple accounts, unifying account management.
- **Validation**: You can validate addresses based on network (mainnet, testnet, etc.).
- **Comparison**: Use methods like `equals`, `isBiggerThan`, and `isSmallerThan` for comparisons, rather than direct
  operators.

### Address Usage Examples

1. **Creating an Address from a Public Key**:
   ```typescript
   const pubKey = '0x04678afdb0fe5548271967f1a67130b7105cd6a828e03909a67962e0ea1f61deb649f6bc3f4cef38c4f35504e51ec112de5c384df7ba0b8d578a4c702b6bf11d5f';
   const address = Address.fromString(pubKey);
   console.log('Address:', address.toHex());
   ```

2. **Validating an Address**:
   ```typescript
   import { networks } from 'bitcoinjs-lib'; // Ensure you're using the correct network

   const isValid = address.isValid(networks.bitcoin);
   console.log('Is Valid:', isValid);
   ```

3. **Retrieving Address in Different Formats**:
    - **P2WPKH**:
      ```typescript
      const p2wpkhAddress = address.p2wpkh(networks.bitcoin);
      console.log('P2WPKH Address:', p2wpkhAddress);
      ```

    - **P2PKH**:
      ```typescript
      const p2pkhAddress = address.p2pkh(networks.bitcoin);
      console.log('P2PKH Address:', p2pkhAddress);
      ```

    - **P2TR** (Taproot):
      ```typescript
      const p2trAddress = address.p2tr(networks.bitcoin);
      console.log('P2TR Address:', p2trAddress);
      ```

---

### Automatic Conversion to Hex in String Interpolation

When an `Address` object is included within a string using template literals, it will automatically convert itself to a
hex string. This makes it easy to display the address in its hex format without explicitly calling any conversion
methods. This will always be the tweaked and compressed hex address format.

For example:

```javascript
console.log(`MyAddress: ${address}`);
```

This will output:

```
MyAddress: 0x284ae4acdb32a99ba3ebfa66a91ddb41a7b7a1d2fef415399922cd8a04485c02
```

The address is automatically formatted as a hexadecimal string prefixed with `0x` for readability and consistency across
your outputs.

### Special Address: `dead`

The `dead()` method returns a special predefined address that represents the **Bitcoin Genesis Block public key**, which
is **unspendable** and permanently **locked in Bitcoin**. This public key is associated with the very first block of the
Bitcoin blockchain and cannot be used for any transactions.

This "dead" address is (uncompressed pubkey):

```
0x04678afdb0fe5548271967f1a67130b7105cd6a828e03909a67962e0ea1f61deb649f6bc3f4cef38c4f35504e51ec112de5c384df7ba0b8d578a4c702b6bf11d5f
```

Since this public key is linked to the Genesis Block, it is **unspendable** in Bitcoin and serves as a symbolic
placeholder, often used in testing or as a default for scenarios where an operational address isn't available.

#### Example Usage:

```typescript
const deadAddress = Address.dead();
console.log(`Dead Address (Genesis Block): ${deadAddress}`);
```

This will output the unspendable Genesis Block public key (compressed & tweaked):

```
Dead Address (Genesis Block): 0x284ae4acdb32a99ba3ebfa66a91ddb41a7b7a1d2fef415399922cd8a04485c02
```

### 🔄 Address Comparisons

#### Correct Way to Compare Addresses

1. **Equality Check**:
   Use the `equals` method to compare two addresses:
   ```typescript
   if (addressA.equals(addressB)) {
       console.log('Addresses are equal');
   }
   ```

2. **Relational Comparisons**:
   For comparing addresses (greater or smaller):

    - **Greater Than**:
      ```typescript
      if (addressA.isBiggerThan(addressB)) {
          console.log('Address A is bigger than Address B');
      }
      ```

    - **Smaller Than**:
      ```typescript
      if (addressA.isSmallerThan(addressB)) {
          console.log('Address A is smaller than Address B');
      }
      ```

#### Managing Multiple Addresses with `AddressSet`

1. **Adding an Address to `AddressSet`**:
   ```typescript
   const addressSet = new AddressSet();
   const address = Address.fromString(pubKey);
   addressSet.add(address);
   ```

2. **Checking if an Address Exists**:
   ```typescript
   if (addressSet.contains(address)) {
       console.log('Address exists in the set');
   }
   ```

3. **Removing an Address**:
   ```typescript
   addressSet.remove(address);
   console.log('Address removed');
   ```

#### Mapping Addresses with `AddressMap`

1. **Setting an Address-Value Pair**:
   ```typescript
   const addressMap = new AddressMap<number>();
   addressMap.set(address, 100);  // Maps address to a balance of 100
   ```

2. **Retrieving Value for an Address**:
   ```typescript
   const balance = addressMap.get(address);
   console.log('Balance for address:', balance);
   ```

3. **Checking if an Address Exists in Map**:
   ```typescript
   if (addressMap.has(address)) {
       console.log('Address found in map');
   }
   ```

---

## New Address Type for OP_NET Contracts

The OP_NET runtime for contracts now supports **public key-based addresses** represented as `Uint8Array`. This section
covers advanced usage of the new `Address` type in contracts, explains how to use the optimized memory maps (
`MultiAddressMemoryMap`, `AddressMemoryMap`, and `Uint8ArrayMerger`), and highlights the available features such as
string interpolation and special addresses (e.g., the "dead" address).

---

## Key Features of the New Address Type

1. **Public Key-based Address Representation**: Addresses are now based on `Uint8Array` and provide better memory and
   processing efficiency when compared to string-based addresses.

2. **Special Dead Address**: The `Address.dead()` method returns an unspendable address, derived from the Bitcoin
   Genesis Block public key. This is useful for marking invalid addresses or using it as a placeholder.

3. **Automatic String Conversion**: When used in a template string (e.g., `MyAddress: ${address}`), the address is
   automatically converted to its **Bech32m** or **Hex** format for easy display.

4. **Advanced Comparison Operators**: The new `Address` type provides rich comparison operators (`==`, `!=`, `<`, `>`,
   `<=`, `>=`), allowing you to efficiently compare addresses.

---

### Recommended Usage for `Address`

To optimize the performance of your contracts, it is **strongly recommended** to use the `Address` constructor directly
with a byte array, rather than relying on the `.fromString()` method. The `.fromString()` method incurs additional
overhead by converting a hexadecimal string to a `Uint8Array`, which can negatively impact performance, especially in
high-frequency scenarios.

#### Example of Optimized Usage:

```typescript
const address = new Address([
    40, 74, 228, 172, 219, 50, 169, 155, 163, 235, 250, 102, 169, 29, 219, 65, 167, 183,
    161, 210, 254, 244, 21, 57, 153, 34, 205, 138, 4, 72, 92, 2,
]);
```

#### Why You Should Avoid `.fromString()`

The `.fromString()` method performs a **hexadecimal string to byte conversion**, which introduces unnecessary overhead.
For example:

```typescript
const address = Address.fromString('0x284ae4acdb32a99ba3ebfa66a91ddb41a7b7a1d2fef415399922cd8a04485c02');
```

This method, while useful in certain contexts, should be **avoided** in performance-critical parts of your code or when
initializing addresses frequently, as it can slow down execution. Instead, precompute the byte array representation of
the public key and directly use it with the `Address` constructor for maximum efficiency.

### Important Note: Address Representation as Tweaked Compressed Public Keys

In OP_NET, **addresses are represented as tweaked, compressed public keys**. This format is essential for compatibility
with OP_NET contracts and ensures that addresses are correctly generated and validated for taproot-based transactions.

#### Key Details:

- **Tweaked Public Key**: The public key is **tweaked** during address generation, typically using a Taproot mechanism.
- **Compressed Format**: Only the compressed part of the public key is used. Compressed public keys usually have 33
  bytes, with the first byte being `02` or `03` depending on the key's parity (whether it's even or odd). However, for
  addresses in OP_NET contracts are:
    - The result is a **32-byte** address, which represent the **tweaked compressed public key**.

#### Example:

A compressed public key in standard format:

```
033c16c1ac8d578f275782b00d4b3f9987807ee6918c87a2d91bb657be50f5da67
```

In OP_NET, this key would be represented as:

```
924f69b135468e490f6ffa203535a2386a712732c05a0314f9e44e7973ca2ca4
```

This **32-byte version** is used in OP_NET contracts.

---

### Example of Tweaked Compressed Key Usage in OP_NET:

```typescript
const address = new Address([
    198, 4, 127, 148, 65, 237, 125, 109, 48, 69, 64, 110, 149, 192, 124, 216, 90, 82, 40, 179,
    148, 58, 84, 67, 111, 46, 209, 145, 223, 157, 229, 144
]);
```

This is a **tweaked compressed public key** without the initial `02` or `03` prefix byte. **Using this representation is
critical** for ensuring compatibility with OP_NET's address system.

#### Why the Tweaked Format?

- **Security and Efficiency**: The tweaking process (often done via Taproot in Bitcoin) improves security and allows for
  optimization in transaction signing and validation.
- **Reduced Data Size**: By removing the first byte (`02` or `03`), the size of the address is reduced to 32 bytes,
  which fit in exactly one pointer.
- **Support for P2TR**: This format is essential for supporting Taproot addresses (P2TR).

---

### Why Use `MultiAddressMemoryMap`, `AddressMemoryMap`, and `Uint8ArrayMerger`?

Classic `Map` implementations can lead to incorrect behavior when comparing `Uint8Array` keys. Each time a new buffer is
created, even if it holds the same data, the classic map will treat it as a different key due to object identity.
Therefore, you should always use **memory map implementations** such as `MultiAddressMemoryMap`, `AddressMemoryMap`, and
`Uint8ArrayMerger` to manage address-based mappings.

These specialized maps handle the addresses correctly by hashing and comparing the contents of the arrays, rather than
their object identities.

---

### Address Type: Advanced Features & Usage in Contracts

### 1. **Basic Address Usage**

```typescript
const pubKey = '0xc6047f9441ed7d6d3045406e95c07cd85a5228b3943a54436f2ed191df9de590';
const address = Address.fromString(pubKey);
console.log(`Address: ${address}`);  // Automatically outputs Bech32m or Hex format
```

### 2. **String Interpolation with Addresses**

When using an `Address` object inside a template string, it will automatically convert to its Bech32m or Hex
representation. This allows easy debugging or display of addresses in log messages:

```typescript
console.log(`MyAddress: ${address}`);
// Output: MyAddress: bc1q...
```

### 3. **Special Dead Address**

The `Address.dead()` method returns a special, predefined "dead" address, derived from the unspendable public key of the
Bitcoin Genesis Block.

```typescript
const deadAddress = Address.dead();
console.log(`Dead Address: ${deadAddress}`);  // Outputs: bc1q...
```

This address can be used for scenarios where an invalid or non-existent address is required.

---

## Using Optimized Memory Maps

### 1. **AddressMemoryMap Usage**

Use `AddressMemoryMap` to map a single `Address` to a memory slot in blockchain storage.

```typescript
const addressMap = new AddressMemoryMap<u256>(0, new u256(0));

// Setting a value for an address
addressMap.set(address, new u256(100));

// Retrieving the value for an address
const balance = addressMap.get(address);
console.log(`Balance: ${balance.toString()}`);
```

### 2. **MultiAddressMemoryMap Usage**

If you need to map multiple addresses to multiple values, use `MultiAddressMemoryMap`. It allows nesting of maps where a
main key can map to a sub-key, and then to a value.

```typescript
const multiMap = new MultiAddressMemoryMap<Uint8Array, Uint8Array, u256>(0, new u256(0));

// Setting values for two nested addresses
multiMap.setUpperKey(parentAddress, childAddress, new u256(100));

// Retrieving the value for the child address
const value = multiMap.get(parentAddress).get(childAddress);
console.log(`Nested value: ${value.toString()}`);
```

### 3. **Uint8ArrayMerger Usage**

`Uint8ArrayMerger` can be used for efficiently merging `Uint8Array` keys (e.g., public keys) and storing them in
blockchain storage.

```typescript
const merger = new Uint8ArrayMerger<u256>(parentAddress.buffer, 0, new u256(0));

// Setting a value
merger.set(childAddress.buffer, new u256(50));

// Getting a value
const value = merger.get(childAddress.buffer);
console.log(`Merged Value: ${value.toString()}`);
```

---

## Comparison and Equality of Addresses

When comparing addresses, it's essential to use the built-in comparison operators instead of relying on direct buffer
comparisons, which could lead to incorrect results.

### 1. **Equality Check**

```typescript
if (address.equals(anotherAddress)) {
    console.log('Addresses are equal');
}
```

### 2. **Comparison Operators**

You can also compare addresses using the overloaded `<`, `>`, `<=`, `>=` operators:

```typescript
if (address < anotherAddress) {
    console.log('Address A is smaller than Address B');
}

if (address > anotherAddress) {
    console.log('Address A is larger than Address B');
}
```

---

### 📅 Regtest Update Timeline

This is an **early notice**, and the upgrade is **not yet available on regtest**. Expect the full regtest update in
about 2 days.

Additionally:

- **Motoswap contracts** will be deployed on-chain after the update.
- A **wallet upgrade** will be required, but it has **not yet** been deployed.
