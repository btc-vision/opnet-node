export class UnwrapTargetConsolidation {
    public static calculateVaultTargetConsolidationAmount(
        requestedAmount: bigint,
        VaultMinimumAmount: bigint,
        VaultNetworkConsolidationAcceptance: bigint,
        k: number = 0.03,
        A: bigint = 1000000n,
    ): bigint {
        // Ensure the requested amount is not less than the minimum amount
        if (requestedAmount < VaultMinimumAmount) {
            throw new Error('Requested amount is less than VaultMinimumAmount');
        }

        // Calculate the exponent term
        const exponentTerm =
            (k * Number(requestedAmount - VaultMinimumAmount)) / Number(VaultMinimumAmount);

        // Calculate the exponential part using BigInt for the result
        const exponentialPart = BigInt(Math.round(Number(A) * (1 - Math.exp(-exponentTerm))));

        // Calculate the target consolidation amount
        const targetAmount = VaultNetworkConsolidationAcceptance + exponentialPart;

        // Ensure the target amount is not less than the VaultNetworkConsolidationAcceptance
        return targetAmount < VaultNetworkConsolidationAcceptance
            ? VaultNetworkConsolidationAcceptance
            : targetAmount;
    }
}
