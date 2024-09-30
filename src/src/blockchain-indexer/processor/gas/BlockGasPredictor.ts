export interface CalculatedBlockGas {
    readonly bNext: bigint;
    readonly ema: bigint;
}

export class BlockGasPredictor {
    public static readonly decimalPrecision: number = 8; // precision in sat
    public static readonly scalingFactor: bigint = BigInt(10 ** BlockGasPredictor.decimalPrecision);

    private readonly one: bigint = BlockGasPredictor.scalingFactor; // Represents 1 * 10^decimalPrecision

    // Configuration Parameters
    private readonly gasTarget: bigint; // Target gas (scaled)
    private readonly bMin: bigint; // Minimum base gas (scaled)
    private readonly smoothingFactor: bigint; // Smoothing factor for EMA (scaled)

    private readonly alpha1: bigint; // Adjustment factor when G_t > G_targetBlock (scaled)
    private readonly alpha2: bigint; // Adjustment factor when G_t <= G_targetBlock (scaled)
    //private readonly deltaMax: bigint; // Maximum adjustment rate per block (scaled)
    private readonly uTarget: bigint; // Target utilization ratio (scaled)

    private currentB: bigint; // Current base gas price (scaled)

    public constructor(
        bMin: number,
        currentB: bigint,
        gasTarget: bigint,
        smoothTarget: bigint,
        smoothingFactor: number,
        alpha1: number,
        alpha2: number,
        //deltaMax: number,
        uTarget: number,
    ) {
        this.bMin = BlockGasPredictor.toBase(bMin);
        this.gasTarget = gasTarget + smoothTarget;
        this.smoothingFactor = BlockGasPredictor.toBase(smoothingFactor);

        this.alpha1 = BlockGasPredictor.toBase(alpha1);
        this.alpha2 = BlockGasPredictor.toBase(alpha2);
        //this.deltaMax = this.toBase(deltaMax);
        this.uTarget = BlockGasPredictor.toBase(uTarget);

        // Ensure currentB is scaled; if not provided, default to bMin
        this.currentB = currentB !== undefined && currentB > 0n ? currentB : this.bMin;
    }

    // Calculates the current utilization ratio (U_current)
    public calculateUCurrent(usedBlockGas: bigint): bigint {
        // U_current = (G_t * scalingFactor) / G_targetBlock
        return this.divideBigInt(usedBlockGas * BlockGasPredictor.scalingFactor, this.gasTarget);
    }

    // Calculates the next base gas price
    public calculateNextBaseGas(usedBlockGas: bigint, prevEMA: bigint): CalculatedBlockGas {
        if (prevEMA === 0n) {
            prevEMA = this.uTarget;
        }

        // Step 1: Calculate U_current
        const uCurrent = this.calculateUCurrent(usedBlockGas) / BlockGasPredictor.scalingFactor;
        if (uCurrent === 0n) {
            return { bNext: this.currentB, ema: prevEMA };
        }

        // Step 2: Update EMA
        const emaScaled = this.calculateEMA(uCurrent, prevEMA);

        // Step 3: Determine condition
        const alpha = usedBlockGas > this.gasTarget ? this.alpha1 : this.alpha2;

        // Determine the sign based on whether ema is above or below the target
        const sign = emaScaled > this.uTarget ? 1n : -1n;

        // Step 4: Calculate Adjustment
        const adjustment = this.calculateAdjustment(emaScaled, alpha, sign);

        // Step 5: Apply Rate Limiting
        // const adjustmentLimited = this.applyRateLimiting(adjustment, sign);

        // Step 6: Calculate bNext
        this.currentB = this.calculateBNext(adjustment);

        return { bNext: this.currentB, ema: emaScaled };
    }

    // Converts a number to a scaled bigint
    public static toBase(value: number): bigint {
        return BigInt(Math.round(value * Number(BlockGasPredictor.scalingFactor)));
    }

    public static toBaseBigInt(value: bigint): bigint {
        return value * BlockGasPredictor.scalingFactor;
    }

    // Applies rate limiting to the adjustment factor
    //private applyRateLimiting(adjustment: bigint, sign: bigint): bigint {
    //    return this.min(this.max(adjustment, this.one - this.deltaMax), this.one + this.deltaMax);
    //}

    /*private min(a: bigint, b: bigint): bigint {
        return a < b ? a : b;
    }*/

    private max(a: bigint, b: bigint): bigint {
        return a > b ? a : b;
    }

    // Multiplies two scaled bigints and maintains scaling
    private multiplyBigInt(a: bigint, b: bigint): bigint {
        // (a * b) / scalingFactor to maintain scaling
        return (a * b) / BlockGasPredictor.scalingFactor; //(a * b + this.scalingFactor / 2n) / this.scalingFactor; // Added rounding
    }

    // Divides two bigints with scaling to maintain precision
    private divideBigInt(a: bigint, b: bigint): bigint {
        if (b === 0n) {
            throw new Error('Division by zero');
        }

        // (a * scalingFactor) / b to maintain scaling
        return (a * BlockGasPredictor.scalingFactor) / b; //(a * this.scalingFactor + b / 2n) / b; // Added rounding
    }

    // Calculates the Adjustment factor based on EMA and alpha
    private calculateAdjustment(emaScaled: bigint, alphaScaled: bigint, sign: bigint): bigint {
        const diff = emaScaled > this.uTarget ? emaScaled - this.uTarget : this.uTarget - emaScaled;

        // adjustment = 1 + alpha * (diff / scalingFactor) * sign
        // To maintain scaling, calculate (alpha * diff) / scalingFactor
        const adjustmentChange = (alphaScaled * diff) / BlockGasPredictor.scalingFactor;

        return sign === 1n ? this.one + adjustmentChange : this.one - adjustmentChange;
    }

    // Calculates the next Base Gas Price (bNext)
    private calculateBNext(adjustmentScaled: bigint): bigint {
        // b_next = max((b_current * adjustmentLimited) / scalingFactor, b_min)
        const multiplied = this.multiplyBigInt(this.currentB, adjustmentScaled);

        return this.max(multiplied, this.bMin);
    }

    // Calculates the Exponential Moving Average (EMA)
    private calculateEMA(uCurrentScaled: bigint, previousEMAScaled: bigint): bigint {
        // EMA_t = alpha_EMA * U_current + (1 - alpha_EMA) * EMA_prev
        const alphaPart = this.multiplyBigInt(this.smoothingFactor, uCurrentScaled);

        // (1 - alpha_EMA) * EMA_prev
        const oneMinusAlphaScaled = this.one - this.smoothingFactor;
        const emaPart = this.multiplyBigInt(oneMinusAlphaScaled, previousEMAScaled);

        return alphaPart + emaPart; // Already scaled
    }
}
