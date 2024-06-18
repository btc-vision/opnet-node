export class UnwrapTargetConsolidation {
    public static calculateVaultTargetConsolidationAmount(
        requestedAmount: bigint,
        vaultMinimumAmount: bigint,
        vaultNetworkConsolidationAcceptance: bigint,
        k: number = 0.03,
        A: bigint = 100000000n,
    ): bigint {
        // Ensure the requested amount is not less than the minimum amount
        if (requestedAmount < vaultMinimumAmount) {
            throw new Error('Requested amount is less than VAULT_MINIMUM_AMOUNT.');
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
