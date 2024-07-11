export class UnwrapTargetConsolidation {
    public static calculateVaultTargetConsolidationAmount(
        requestedAmount: bigint,
        vaultMinimumAmount: bigint,
        vaultNetworkConsolidationAcceptance: bigint,
        k: number = 0.0111,
        A: bigint = 100000000n,
    ): bigint {
        // Ensure the requested amount is not less than the minimum amount
        if (requestedAmount < vaultMinimumAmount) {
            return vaultMinimumAmount;
        }

        // Calculate the exponent term
        const exponentTerm =
            (k * Number(requestedAmount - vaultMinimumAmount)) / Number(vaultMinimumAmount);

        // Calculate the exponential
        const exponentialPart = BigInt(Math.round(Number(A) * (1 - Math.exp(-exponentTerm))));

        // Calculate the target consolidation amount
        const targetAmount = vaultNetworkConsolidationAcceptance + exponentialPart;

        // Ensure the target amount is not less than the VaultNetworkConsolidationAcceptance
        return targetAmount < vaultNetworkConsolidationAcceptance
            ? vaultNetworkConsolidationAcceptance
            : targetAmount;
    }
}
