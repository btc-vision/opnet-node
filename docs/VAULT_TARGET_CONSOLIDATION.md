# Vault Target Consolidation Formula

In this file you will find the explainations to the formula used to calculate the `VaultTargetConsolidationAmount` in a deterministic and fair manner for all requesters. The formula ensures that the minimum value is respected and adapts based on the amount requested by the user. 

## Formula

The formula for calculating the `VaultTargetConsolidationAmount` is as follows:

$$
\text{VaultTargetConsolidationAmount} = \max\left(\text{VaultNetworkConsolidationAcceptance}, \left(\text{VaultNetworkConsolidationAcceptance} + A \times \left(1 - e^{-k \cdot \left(\frac{x - \text{VaultMinimumAmount}}{\text{VaultMinimumAmount}}\right)}\right)\right)\right)
$$

### Variables

- **VaultMinimumAmount**: This represents the minimum amount that can be consolidated in a single transaction. It is defined in satoshis and is a constant in the formula.

- **VaultNetworkConsolidationAcceptance**: This represents the minimum acceptance for joining UTXOs during an unwrap operation. If the consolidated output going back to the vault is lower than this amount, the transaction will be rejected. It ensures the network has fewer UTXOs and users must pay for the consolidation. It is also defined in satoshis and acts as a threshold in the formula.

- **x**: This is the amount requested by the user for withdrawal, represented in satoshis.

- **k**: This is a constant that determines the rate of increase in the formula. It controls how rapidly the target consolidation amount grows as the requested amount increases.

- **A**: This is an adjustment constant that controls the maximum growth in the formula. It ensures that the target consolidation amount does not grow excessively.

### Explanations

The formula ensures that the `VaultTargetConsolidationAmount` is always at least `VaultNetworkConsolidationAcceptance`.

The inner part of the formula:

$$
\text{VaultNetworkConsolidationAcceptance} + A \times \left(1 - e^{-k \cdot \left(\frac{x - \text{VaultMinimumAmount}}{\text{VaultMinimumAmount}}\right)}\right)
$$

represents an exponential-like growth function that scales based on the amount requested by the user (`x`).

Here’s a breakdown:

1. **Exponent Term**: 
    This term calculates the scaled difference between the requested amount and the minimum amount. The division by `VaultMinimumAmount` normalizes the difference, ensuring that the growth rate is relative to the minimum amount.

$$
k \cdot \left( \frac{x - \text{VaultMinimumAmount}}{\text{VaultMinimumAmount}} \right)
$$

2. **Exponential Part**: 
    This part applies the exponential function to the scaled difference. The subtraction from 1 ensures that the result starts at 0 and approaches 1 as the requested amount increases.

$$
1 - e^{-k \cdot \left(\frac{x - \text{VaultMinimumAmount}}{\text{VaultMinimumAmount}}\right)}
$$

3. **Adjustment and Addition**: 
    The exponential part is multiplied by the adjustment constant `A`, controlling the maximum impact on the target consolidation amount. This adjusted value is then added to `VaultNetworkConsolidationAcceptance`.

$$
A \times \left(1 - e^{-k \cdot \left(\frac{x - \text{VaultMinimumAmount}}{\text{VaultMinimumAmount}}\right)}\right)
$$

### Deterministic Nature

The formula is deterministic, meaning it will produce the same output for the same input values. This ensures consistency and fairness for all requesters.

### Implementation

Example implementation of the formula:

```typescript
function calculateVaultTargetConsolidationAmount(
  requestedAmount: bigint,
  VaultMinimumAmount: bigint,
  VaultNetworkConsolidationAcceptance: bigint,
  k: number,
  A: bigint
): bigint {
  // Ensure the requested amount is not less than the minimum amount
  if (requestedAmount < VaultMinimumAmount) {
    throw new Error('Requested amount is less than VaultMinimumAmount');
  }

  // Calculate the exponent term
  const exponentTerm = k * Number(requestedAmount - VaultMinimumAmount) / Number(VaultMinimumAmount);

  // Calculate the exponential part using BigInt for the result
  const exponentialPart = BigInt(Math.round(Number(A) * (1 - Math.exp(-exponentTerm))));

  // Calculate the target consolidation amount
  const targetAmount = VaultNetworkConsolidationAcceptance + exponentialPart;

  // Ensure the target amount is not less than the VaultNetworkConsolidationAcceptance
  return targetAmount < VaultNetworkConsolidationAcceptance
    ? VaultNetworkConsolidationAcceptance
    : targetAmount;
}

const vaultMinimumAmount = 200000n;
const vaultNetworkConsolidationAcceptance = 400000n; 
const requestedAmount = 1000000n;
const k = 0.03;
const A = 1000000n;

const result = calculateVaultTargetConsolidationAmount(
  requestedAmount,
  vaultMinimumAmount,
  vaultNetworkConsolidationAcceptance,
  k,
  A
);

console.log(result.toString());
```