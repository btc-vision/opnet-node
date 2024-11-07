# OP_NET Base Gas Calculation Algorithm

This document outlines the algorithm for calculating the next block's base gas price ($b_{\text{next}}$) for OP_NET.
The algorithm adjusts the base gas price dynamically, considering the unique constraints of OP_NET, where transaction
inclusion cannot be controlled, and blocks may be filled with transactions paying less gas, potentially leading to
transaction reversion due to block gas limits.

## Variables

- **$b_{\text{current}}$**: Current base gas price (in satoshi per gas unit).
- **$b_{\text{next}}$**: Next block's base gas price to be calculated.
- **$G_{\text{total}}$**: Total gas used by OP_NET transactions in the current block.
- **$G_{\text{targetBlock}}$**: Target gas usage per block for OP_NET transactions.
- **$\alpha$**: Sensitivity factor determining the rate of adjustment ($0 < \alpha \leq 1$).
- **$\beta$**: EMA smoothing factor ($0 < \beta < 1$).
- **$U_{\text{current}}$**: Current block gas utilization ratio.
- **$U_{\text{target}}$**: Target block gas utilization ratio (ideally set to 1 for full utilization).
- **$\text{EMA}_{\text{prev}}$**: Previous Exponential Moving Average of gas utilization.
- **$b_{\text{min}}$**: Minimum base gas price (e.g., equivalent to 1 satoshi per gas unit).

## Algorithm Overview

The algorithm adjusts the base gas price based on the gas utilization of OP_NET transactions in the current block,
using an Exponential Moving Average (EMA) to smooth out fluctuations to prevent extreme
changes. This approach ensures stability and fairness, accommodating the lack of control over transaction inclusion and
block gas limits.

The next base gas price $b_{\text{next}}$ can be expressed as:

```math
b_{\text{next}} = \max \left( 
    b_{\text{min}},\ 
    b_{\text{current}} \times \min \left( 
            1 + \alpha \left( 
                \beta \frac{G_{\text{total}}}{G_{\text{targetBlock}}} + (1 - \beta) \text{EMA}_{\text{prev}} - U_{\text{target}} 
        \right),\ 
        1 + \Delta_{\text{max}} 
    \right) 
\right)
```

## Calculation Steps

### 1. Calculate Current Gas Utilization Ratio

Compute the current block's gas utilization ratio ($U_{\text{current}}$) for OP_NET transactions:

```math
U_{\text{current}} = \frac{G_{\text{total}}}{G_{\text{targetBlock}}}
```

- **$G_{\text{total}}$**: Sum of gas used by all OP_NET transactions (successful and reverted) in the current block.
- **$G_{\text{targetBlock}}$**: This is a predefined value that represent target maximum block gas usage for OP_NET transactions.

### 2. Update Exponential Moving Average (EMA) of Utilization

Update the EMA to smooth out short-term spikes in gas utilization:

```math
\text{EMA}_{\text{current}} = \beta \times U_{\text{current}} + (1 - \beta) \times \text{EMA}_{\text{prev}}
```

- **$\text{EMA}_{\text{prev}}$**: The EMA of gas utilization from the previous block.
- **$\beta$**: Smoothing factor determining the weight of recent utilization.

### 3. Compute Adjustment Factor

Calculate the adjustment factor based on the EMA of utilization:

```math
\text{Adjustment} = 1 + \alpha \times (\text{EMA}_{\text{current}} - U_{\text{target}})
```

- **$\alpha$**: Sensitivity factor for adjustment.
- **$U_{\text{target}}$**: Target utilization ratio (usually set to 1).

### 4. Calculate Next Base Gas Price

Compute the next base gas price:

```math
b_{\text{next}} = b_{\text{current}} \times \text{Adjustment}_{\text{limited}}
```

### 5. Ensure Minimum Base Gas Price

Ensure that $b_{\text{next}}$ is not below the minimum base gas price:

```math
b_{\text{next}} = \max \left(
b_{\text{next}},\
b_{\text{min}}
\right)
```

### **Fictional scenario (fake values):**

| **Block** | **Load** | **Gas Usage** | **EMA** | **Adjustment with EMA** | **Adjustment without EMA** | **b_next with EMA** | **b_next without EMA** |
|----------|---------------------------|----------------------------|-----------------------------|--------------------------|----------------------------|---------------------|--------------------|
| 1        | 1.00                      | 1,000,000                  | 1.00                        | 1.00                     | 1.00                       | 1.00                | 1.00               |
| 2        | 0.90                      | 900,000                    | 0.9667                      | 0.98335                  | 0.95                        | 1.00                | 1.00               |
| 3        | 1.10                      | 1,100,000                  | 1.0110                      | 1.0055                   | 1.05                        | 1.01                | 1.05               |
| 4        | 1.20                      | 1,200,000                  | 1.0740                      | 1.0370                   | 1.10                        | 1.05                | 1.16               |
| 5        | 0.80                      | 800,000                    | 0.9826                      | 0.9913                   | 0.90                        | 1.04                | 1.00               |

---

## Parameter Selection Guidelines

### $\alpha$ (Sensitivity Factor)

- **Range**: $0 < \alpha \leq 1$
- **Effect**: Determines how strongly the base gas price responds to changes in utilization.
- **OP_NET Recommendation**: Start with a moderate value like 0.5.

### $\beta$ (EMA Smoothing Factor)

- **Range**: $0 < \beta < 1$
- **Effect**: Controls the weighting of recent utilization versus historical data.
- **OP_NET Recommendation**: A value around 0.8 balances responsiveness and smoothing.

### $\Delta_{\text{max}}$ (Maximum Adjustment Factor)

- **Range**: $0 < \Delta_{\text{max}} < 1$
- **Effect**: Caps the maximum change in base gas price per block.
- **OP_NET Recommendation**: A value like 0.5 limits adjustments to ±50.0%.

### $b_{\text{min}}$ (Minimum Base Gas Price)

- **Purpose**: Ensures the base gas price does not drop below a practical minimum.
- **OP_NET Recommendation**: Set to the baseline equivalent of 1 satoshi per gas unit.

## Example Calculation

Assuming:

- **$b_{\text{current}}$**: 1 satoshi/gas unit.
- **$G_{\text{total}}$**: 1,200,000 gas units (from OP_NET transactions).
- **$G_{\text{targetBlock}}$**: 1,000,000 gas units.
- **$\text{EMA}_{\text{prev}}$**: 1.0.
- **$\alpha$**: 0.5.
- **$\beta$**: 0.8.
- **$U_{\text{target}}$**: 1.0.
- **$b_{\text{min}}$**: 1 satoshi/gas unit.

### Step-by-Step Calculation

1. **Calculate $U_{\text{current}}$**:

```math
U_{\text{current}} = \frac{1,200,000}{1,000,000} = 1.2
```

2. **Update $\text{EMA}_{\text{current}}$**:

```math
\text{EMA}_{\text{current}} = 0.8 \times 1.2 + 0.2 \times 1.0 = 1.16
```

3. **Compute Adjustment**:

```math
\text{Adjustment} = 1 + 0.5 \times (1.16 - 1.0) = 1 + 0.08 = 1.08
```

4. **Calculate $b_{\text{next}}$**:

```math
b_{\text{next}} = 1 \times 1.08 = 1.08\ \text{satoshi/gas unit}
```

5. **Ensure Minimum Base Gas Price**:

```math
b_{\text{next}} = \max \left( 1.08,\ 1 \right) = 1.08\ \text{satoshi/gas unit}
```
