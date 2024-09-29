# OP_NET Base Gas Calculation Algorithm

This document outlines the algorithm for calculating the next block's base gas price (`b_next`) for OP_NET. The
algorithm adjusts the base gas price dynamically, considering the unique constraints of OP_NET, where transaction
inclusion cannot be controlled, and blocks may be filled with transactions paying less gas, potentially leading to
transaction reversion due to block gas limits.

## Variables

- **`b_current`**: Current base gas price (in satoshi per gas unit).
- **`b_next`**: Next block's base gas price to be calculated.
- **`G_total`**: Total gas used by OP_NET transactions in the current block.
- **`G_target_block`**: Target gas usage per block for OP_NET transactions.
- **`α`**: Sensitivity factor determining the rate of adjustment (0 < α ≤ 1).
- **`β`**: EMA smoothing factor (0 < β < 1).
- **`U_current`**: Current block gas utilization ratio.
- **`U_target`**: Target block gas utilization ratio (ideally set to 1 for full utilization).
- **`Δ_max`**: Maximum allowed adjustment factor per block to prevent extreme changes.
- **`EMA_prev`**: Previous Exponential Moving Average of gas utilization.
- **`b_min`**: Minimum base gas price (e.g., equivalent to 1 satoshi per gas unit).

## Algorithm Overview

The algorithm adjusts the base gas price based on the gas utilization of OP_NET transactions in the current block, using
an Exponential Moving Average (EMA) to smooth out fluctuations and applying rate limiting to prevent extreme changes.
This approach ensures stability and fairness, accommodating the lack of control over transaction inclusion and block gas
limits.

The next base gas price `b_next` can be expressed as:

$$
b_{\mathrm{next}} = \operatorname{max} \left( b_{\mathrm{min}},\ b_{\mathrm{current}} \times \operatorname{min} \left( \operatorname{max} \left( 1 + \alpha \left( \beta \left( \frac{G_{\mathrm{total}}}{G_{\mathrm{target\_block}}} \right) + (1 - \beta) \times \mathrm{EMA}_{\mathrm{prev}} - U_{\mathrm{target}} \right),\ 1 - \Delta_{\mathrm{max}} \right),\ 1 + \Delta_{\mathrm{max}} \right) \right)
$$

## Calculation Steps

### 1. Calculate Current Gas Utilization Ratio

Compute the current block's gas utilization ratio (`U_current`) for OP_NET transactions:

$$
U_{\mathrm{current}} = \frac{G_{\mathrm{total}}}{G_{\mathrm{target\_block}}}
$$

- **`G_total`**: Sum of gas used by all OP_NET transactions (successful and reverted) in the current block.
- **`G_target_block`**: The desired gas usage per block for OP_NET transactions.

### 2. Update Exponential Moving Average (EMA) of Utilization

Update the EMA to smooth out short-term spikes in gas utilization:

$$
\mathrm{EMA}_{\mathrm{current}} = \beta \times U_{\mathrm{current}} + (1 - \beta) \times \mathrm{EMA}_{\mathrm{prev}}
$$

- **`EMA_prev`**: The EMA of gas utilization from the previous block.
- **`β`**: Smoothing factor determining the weight of recent utilization.

### 3. Compute Adjustment Factor

Calculate the adjustment factor based on the EMA of utilization:

$$
\mathrm{Adjustment} = 1 + \alpha \times (\mathrm{EMA}_{\mathrm{current}} - U_{\mathrm{target}})
$$

- **`α`**: Sensitivity factor for adjustment.
- **`U_target`**: Target utilization ratio (usually set to 1).

### 4. Apply Rate Limiting

Limit the adjustment factor to prevent extreme changes:

$$
\mathrm{Adjustment}_{\mathrm{limited}} = \operatorname{min}\left( \operatorname{max}\left( \mathrm{Adjustment},\ 1 - \Delta_{\mathrm{max}} \right),\ 1 + \Delta_{\mathrm{max}} \right)
$$

- **`Δ_max`**: Maximum allowed adjustment per block (e.g., 0.5 for ±50.0%).

### 5. Calculate Next Base Gas Price

Compute the next base gas price:

$$
b_{\mathrm{next}} = b_{\mathrm{current}} \times \mathrm{Adjustment}_{\mathrm{limited}}
$$

### 6. Ensure Minimum Base Gas Price

Ensure that `b_next` is not below the minimum base gas price:

$$
b_{\mathrm{next}} = \operatorname{max}\left( b_{\mathrm{next}},\ b_{\mathrm{min}} \right)
$$

## Parameter Selection Guidelines

### α (Sensitivity Factor)

- **Range**: $( 0 < \alpha \leq 1 )$
- **Effect**: Determines how strongly the base gas price responds to changes in utilization.
- **OP_NET Recommendation**: Start with a moderate value like 0.5.

### β (EMA Smoothing Factor)

- **Range**: $( 0 < \beta < 1 )$
- **Effect**: Controls the weighting of recent utilization versus historical data.
- **OP_NET Recommendation**: A value around 0.8 balances responsiveness and smoothing.

### Δ_max (Maximum Adjustment Factor)

- **Range**: $( 0 < \Delta_{\mathrm{max}} < 1 )$
- **Effect**: Caps the maximum change in base gas price per block.
- **OP_NET Recommendation**: A value like 0.5 limits adjustments to ±50.0%.

### b_min (Minimum Base Gas Price)

- **Purpose**: Ensures the base gas price does not drop below a practical minimum.
- **OP_NET Recommendation**: Set to the baseline equivalent of 1 satoshi per gas unit.

## Example Calculation

Assuming:

- **`b_current`**: 1 satoshi/gas unit.
- **`G_total`**: 1,200,000 gas units (from OP_NET transactions).
- **`G_target_block`**: 1,000,000 gas units.
- **`EMA_prev`**: 1.0.
- **`α`**: 0.5.
- **`β`**: 0.8.
- **`Δ_max`**: 0.125.
- **`U_target`**: 1.0.
- **`b_min`**: 1 satoshi/gas unit.

### Step-by-Step Calculation

1. **Calculate U_current**:

   $$
   U_{\mathrm{current}} = \frac{1,200,000}{1,000,000} = 1.2
   $$

2. **Update EMA_current**:

   $$
   \mathrm{EMA}_{\mathrm{current}} = 0.8 \times 1.2 + 0.2 \times 1.0 = 1.16
   $$

3. **Compute Adjustment**:

   $$
   \mathrm{Adjustment} = 1 + 0.5 \times (1.16 - 1.0) = 1 + 0.08 = 1.08
   $$

4. **Apply Rate Limiting**:

   $$
   \mathrm{Adjustment}_{\mathrm{limited}} = \operatorname{min}\left( \operatorname{max}\left( 1.08,\ 1 - 0.125 \right),\ 1 + 0.125 \right) = 1.08
   $$

5. **Calculate b_next**:

   $$
   b_{\mathrm{next}} = 1 \times 1.08 = 1.08\ \mathrm{satoshi/gas\ unit}
   $$

6. **Ensure Minimum Base Gas Price**:

   $$
   b_{\mathrm{next}} = \operatorname{max}\left( 1.08,\ 1 \right) = 1.08\ \mathrm{satoshi/gas\ unit}
   $$
