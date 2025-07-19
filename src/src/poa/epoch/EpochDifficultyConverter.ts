/**
 * Converts between bit difficulty (matching bits) and actual difficulty value
 * for proper share accounting in the mining pool
 */
export class EpochDifficultyConverter {
    /**
     * Convert matching bits to actual difficulty value
     * Difficulty = 2^bits
     *
     * This ensures that:
     * - 20 bits = difficulty of 1,048,576
     * - 30 bits = difficulty of 1,073,741,824
     * - 40 bits = difficulty of 1,099,511,627,776
     *
     * So a 40-bit share is worth 1,048,576x more than a 20-bit share,
     * not just 2x more
     */
    public static bitsToScaledDifficulty(bits: number): bigint {
        // For lower bits, use direct calculation
        if (bits <= 32) {
            return BigInt(Math.pow(2, bits));
        }

        return BigInt(2) ** BigInt(bits);
    }

    /**
     * Convert difficulty value back to equivalent bits
     * bits = log2(difficulty)
     */
    public static scaledDifficultyToBits(difficulty: number): number {
        if (difficulty <= 0) return 0;
        return Math.log2(difficulty);
    }

    /**
     * Convert bits to a "points" system that prevents spam
     * while still rewarding higher difficulty shares
     *
     * Uses a logarithmic scale to balance between:
     * - Not allowing spam of low difficulty shares
     * - Still incentivizing high difficulty shares
     */
    public static bitsToPoints(bits: number, minBits: number): number {
        if (bits < minBits) return 0;

        // Base points for meeting minimum difficulty
        const basePoints = 1;

        // Additional points scale logarithmically with excess bits
        // This prevents spam while still rewarding high difficulty
        const excessBits = bits - minBits;
        const bonusPoints = Math.log2(1 + excessBits) * 10;

        return basePoints + bonusPoints;
    }

    /**
     * Format difficulty for display
     */
    public static formatDifficulty(difficulty: bigint): string {
        if (difficulty < 1000n) {
            return difficulty.toString();
        } else if (difficulty < BigInt(1e6)) {
            return (difficulty / BigInt(1e3)).toString() + 'K';
        } else if (difficulty < BigInt(1e9)) {
            return (difficulty / BigInt(1e6)).toString() + 'M';
        } else if (difficulty < BigInt(1e12)) {
            return (difficulty / BigInt(1e9)).toString() + 'G';
        } else if (difficulty < BigInt(1e15)) {
            return (difficulty / BigInt(1e12)).toString() + 'T';
        } else {
            return (difficulty / BigInt(1e15)).toString() + 'P';
        }
    }
}
