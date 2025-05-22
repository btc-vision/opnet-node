## Developer Announcement: Breaking Changes & Significant Updates

### **Breaking Changes & Protocol Enhancements**

We're rolling out significant upgrades to both `op-vm` and `opnet`. These updates bring crucial improvements, new
functionalities, and important security enhancements.

#### **Breaking Changes**:

* `op-vm` has been upgraded to Wasmer **6** (previously Wasmer 5). This upgrade introduces improved WebAssembly runtime
  stability, performance optimizations, and additional WebAssembly feature support. Please ensure compatibility with
  your WebAssembly modules.

#### **Enhanced WebAssembly Feature Support**:

The following WebAssembly features are now enabled by default in the runtime:

* `sign-extension`
* `mutable-globals`
* `nontrapping-f2i`
* `bulk-memory`
* `simd`
* `reference-types`
* `multi-value`

Make sure your WebAssembly modules are recompiled and tested to align with these updates.

#### **Complete Redesign of Gas Metering**:

We've implemented an entirely redesigned gas metering system with robust enhancements:

* **Enhanced Gas Accounting**: More precise and accurate gas consumption measurement.
* **Memory Metering**: Improved accuracy for memory usage accounting.
* **Bulk Memory Operations Metering**: Enhanced precision for bulk operations, ensuring fair resource usage.
* **Table Metering**: Newly introduced table operations metering.
* **Security**: Disabled non-deterministic WebAssembly features to maintain execution predictability and safety.

See [PR 119](https://github.com/btc-vision/op-vm/pull/119)

#### **Experimental features**:

The recent update to op-vm introduces experimental support for zk-SNARKs using groth16 proofs. zk-SNARKs (Zero-Knowledge
Succinct Non-Interactive Arguments of Knowledge) allow for the verification of computations without
revealing the underlying data, enabling confidential transactions and smart contracts.

* **Experimental Feature:** Currently, zk-SNARK support is in the experimental phase and not available on any network.
  This feature is intended to be a foundation for future developments in privacy-preserving smart contracts and
  transactions. This feature won't be available before a while. The verification of zk-SNARK proofs, allowing for
  confidential transactions and computations without revealing underlying data. This is a crucial step towards enabling
  private smart contracts.

### **Protocol Enhancements in `opnet` v1.5.0**:

* **Improved UTXO Management**: Enhanced tracking and management of Unspent Transaction Outputs (UTXOs).
* **Support for OP\_RETURN**: Native support for embedding data using OP\_RETURN scripts.
* **Custom Script Execution**: Enable custom scripts via transaction output flags to enhance simulation capabilities.

### **Regtest Resync**:

The Regtest environment is being resynced to reflect all the latest breaking changes and security patches introduced in
the latest `op-vm`. Developers must synchronize their local development environments accordingly.

### **Updated Dependencies**:

* **btc-runtime**: Updated to version `@btc-vision/btc-runtime@1.6.2`
* **opnet**: Updated to version `opnet@1.5.0`
* **@btc-vision/transaction**: Updated to version `@btc-vision/transaction@1.5.0`
* **@btc-vision/op-vm**: Updated to version `@btc-vision/op-vm@0.4.0` (not published yet)
* **@btc-vision/unit-test-framework**: Updated to version `@btc-vision/unit-test-framework@0.0.31` (not published yet)

### **Example Transaction Outputs with New Features**:

```typescript
const txOutputs: StrippedTransactionOutput[] = [
    // First two output are reserved.
    // P2TR Output Example
    {
        index: 2,
        value: 10_000n,
        to: senderAddress.p2tr(network),
        scriptPubKey: undefined,
        flags: TransactionOutputFlags.hasTo,
    },

    // Custom P2PK Output Example
    {
        index: 3,
        value: 1_000n,
        to: undefined,
        scriptPubKey: Buffer.from(
            script.compile([senderAddress.toUncompressedBuffer(), opcodes.OP_CHECKSIGVERIFY]),
        ),
        flags: TransactionOutputFlags.hasScriptPubKey,
    },

    // OP_RETURN Data Embedding Example
    {
        index: 4,
        value: 0n,
        to: undefined,
        scriptPubKey: Buffer.from(
            script.compile([opcodes.OP_RETURN, Buffer.from('Hello world', 'utf-8')]),
        ),
        flags: TransactionOutputFlags.OP_RETURN | TransactionOutputFlags.hasScriptPubKey,
    },
];
```

### **Action Required**:

All developers are encouraged to update their environments and thoroughly test their applications against these new
changes. Review and adapt your WebAssembly modules to the updated runtime environment and verify transactions using the
enhanced simulation capabilities.
