import { Consensus } from '../../../configurations/consensus/Consensus.js';
import {
    PartialUnwrapPSBTDecodedData,
    UnwrapConsensusVerificator,
    UnwrapPSBTDecodedData,
    VerificationVault,
} from './UnwrapConsensusVerificator.js';
import { Psbt, PsbtTxInput } from 'bitcoinjs-lib';
import { ConfigurableDBManager } from '@btc-vision/bsi-common';
import { WBTCUTXORepository } from '../../../../db/repositories/WBTCUTXORepository.js';
import { Address } from '@btc-vision/bsi-binary';
import { currentConsensusConfig } from '../../../configurations/OPNetConsensus.js';
import { UnwrapTargetConsolidation } from '../../../equoitions/UnwrapTargetConsolidation.js';

export class UnwrapVerificatorRoswell extends UnwrapConsensusVerificator<Consensus.Roswell> {
    public readonly consensus: Consensus.Roswell = Consensus.Roswell;

    #utxoRepository: WBTCUTXORepository | undefined;

    public constructor(db: ConfigurableDBManager) {
        super(db);
    }

    protected get utxoRepository(): WBTCUTXORepository {
        if (!this.#utxoRepository) throw new Error('UTXO repository not created.');

        return this.#utxoRepository;
    }

    public async createRepositories(): Promise<void> {
        if (!this.db.db) throw new Error('Database connection not established.');

        this.#utxoRepository = new WBTCUTXORepository(this.db.db);
    }

    public async verify(
        data: PartialUnwrapPSBTDecodedData,
        psbt: Psbt,
    ): Promise<UnwrapPSBTDecodedData> {
        const usedVaults = await this.getUsedVaultsFromTx(psbt);

        this.analyzeOutputs(psbt, usedVaults.vaults, data.receiver, data.amount);

        return {
            receiver: data.receiver,
            amount: data.amount,
            version: data.version,
            vaults: usedVaults.vaults,
            hashes: usedVaults.hashes,
        };
    }

    protected calculateNumSignatures(vaults: Map<Address, VerificationVault>): bigint {
        let numSignatures = 0n;

        for (let vault of vaults.values()) {
            numSignatures += BigInt(vault.minimum * vault.utxoDetails.length);
        }

        return numSignatures;
    }

    protected calculateNumEmptyWitnesses(vaults: Map<Address, VerificationVault>): bigint {
        let numSignatures = 0n;

        for (let vault of vaults.values()) {
            numSignatures +=
                BigInt(vault.publicKeys.length - vault.minimum) * BigInt(vault.utxoDetails.length);
        }

        return numSignatures;
    }

    private orderVaultsByAddress(vaults: Map<Address, VerificationVault>): VerificationVault[] {
        return Array.from(vaults.values()).sort((a, b) => a.vault.localeCompare(b.vault));
    }

    private findVaultWithMostPublicKeys(
        vaultsMap: Map<Address, VerificationVault>,
    ): VerificationVault {
        let vaults = this.orderVaultsByAddress(vaultsMap);
        let mostPublicKeys: number = 0;
        let vault: VerificationVault | undefined;

        for (let v of vaults) {
            if (v.publicKeys.length > mostPublicKeys) {
                mostPublicKeys = v.publicKeys.length;
                vault = v;
            }
        }

        if (!vault) throw new Error('No vault with public keys found.');

        return vault;
    }

    private analyzeOutputs(
        psbt: Psbt,
        usedVaults: Map<Address, VerificationVault>,
        receiver: Address,
        amount: bigint,
    ): void {
        const hasConsolidation: boolean = psbt.txOutputs.length > 2;
        const vaultWithMostPublicKeys: VerificationVault =
            this.findVaultWithMostPublicKeys(usedVaults);

        if (psbt.txOutputs.length > 3) {
            throw new Error(`Too many outputs.`);
        }

        let consolidationAmount: bigint = 0n;
        let outputAmount: bigint = 0n;
        for (let i = 0; i < psbt.txOutputs.length; i++) {
            const output = psbt.txOutputs[i];

            // Verify that the first output goes to the wbtc contract.
            if (i === 0) {
                if (output.address !== this.trustedAuthority.WBTC_SEGWIT_CONTRACT_ADDRESS) {
                    throw new Error(
                        `Invalid output address found in transaction. Was ${output.address} expected ${this.trustedAuthority.WBTC_SEGWIT_CONTRACT_ADDRESS}`,
                    );
                }

                continue;
            }

            if (i === 1) {
                if (hasConsolidation) {
                    // The second output is consolidation. It should match the vault with the most public keys.
                    if (output.address !== vaultWithMostPublicKeys.vault) {
                        throw new Error(
                            `Invalid consolidation address found in transaction. Was ${output.address} expected ${vaultWithMostPublicKeys.vault}`,
                        );
                    }

                    consolidationAmount = BigInt(output.value);
                } else {
                    // The second output is the receiver.
                    if (output.address !== receiver) {
                        throw new Error(
                            `Invalid receiver address found in transaction. Was ${output.address} expected ${receiver}`,
                        );
                    }

                    outputAmount = BigInt(output.value);
                }
            } else if (outputAmount === 0n) {
                // The third output is the receiver.
                if (output.address !== receiver) {
                    throw new Error(
                        `Invalid receiver address found in transaction. Was ${output.address} expected ${receiver}`,
                    );
                }

                outputAmount = BigInt(output.value);
            } else {
                throw new Error(`Too many outputs.`);
            }
        }

        // Verify that the total output amount matches the expected amount
        const vaultTotalHoldings: bigint = this.calculateVaultTotalHoldings(usedVaults);
        const expectedConsolidationAmount: bigint = vaultTotalHoldings - amount;

        if (hasConsolidation) {
            // Verify that the consolidation amount is correct
            if (consolidationAmount < expectedConsolidationAmount) {
                throw new Error(
                    `Invalid consolidation amount. Expected ${expectedConsolidationAmount} sat, but got ${consolidationAmount} sat.`,
                );
            }

            // Verify that the consolidation amount is above the minimum required
            if (consolidationAmount < currentConsensusConfig.VAULT_MINIMUM_AMOUNT) {
                throw new Error(
                    `Consolidation amount is below the minimum required. Expected at least ${currentConsensusConfig.VAULT_MINIMUM_AMOUNT}, but got ${consolidationAmount}`,
                );
            }
        }

        const userOwnedVaultHoldings = vaultTotalHoldings - consolidationAmount;
        const amountPlusFees: bigint =
            amount + currentConsensusConfig.UNWRAP_CONSOLIDATION_PREPAID_FEES_SAT;

        // When an UTXO is consumed, the user get UNWRAP_CONSOLIDATION_PREPAID_FEES_SAT as a refund.
        if (userOwnedVaultHoldings > amountPlusFees) {
            throw new Error(
                `Invalid amount sent back to requester. Expected ${amountPlusFees} sat, but got ${userOwnedVaultHoldings} sat.`,
            );
        }

        const maximumFeeRefund: bigint =
            this.getMaximumFeeRefund(usedVaults) +
            (hasConsolidation ? -currentConsensusConfig.UNWRAP_CONSOLIDATION_PREPAID_FEES_SAT : 0n);

        const targetConsolidation: bigint =
            UnwrapTargetConsolidation.calculateVaultTargetConsolidationAmount(
                amount,
                currentConsensusConfig.VAULT_MINIMUM_AMOUNT,
                currentConsensusConfig.VAULT_NETWORK_CONSOLIDATION_ACCEPTANCE,
            );

        const upperLimitConsolidation: bigint = targetConsolidation * 4n;

        console.log(
            'consolidation sent',
            consolidationAmount,
            'expected consolidation',
            expectedConsolidationAmount,
            'target consolidation',
            targetConsolidation,
            'upper limit consolidation',
            upperLimitConsolidation,
            'user owned',
            userOwnedVaultHoldings,
            'total',
            vaultTotalHoldings,
            'request',
            amount,
            'amount plus fee',
            amountPlusFees,
            'prepaid fee',
            currentConsensusConfig.UNWRAP_CONSOLIDATION_PREPAID_FEES_SAT,
        );

        if (consolidationAmount > upperLimitConsolidation) {
            throw new Error(
                `Consolidation amount is above the upper limit. Expected at most ${upperLimitConsolidation}, but got ${consolidationAmount}`,
            );
        }

        if (consolidationAmount < targetConsolidation) {
            throw new Error(
                `Consolidation amount is below the target. Expected at least ${targetConsolidation}, but got ${consolidationAmount}`,
            );
        }

        this.info(
            `Maximum fee refund: ${maximumFeeRefund} - target consolidation: ${targetConsolidation}`,
        );

        const refundedAmount: bigint = outputAmount - amount;
        if (refundedAmount > maximumFeeRefund) {
            throw new Error(
                `Refunded amount is above the maximum fee refund. Expected at most ${maximumFeeRefund}, but got ${refundedAmount}`,
            );
        }

        // All good!
    }

    private calculateVaultTotalHoldings(vaults: Map<Address, VerificationVault>): bigint {
        let totalHoldings: bigint = 0n;

        for (let vault of vaults.values()) {
            for (let utxo of vault.utxoDetails) {
                totalHoldings += BigInt(utxo.value);
            }
        }

        return totalHoldings;
    }

    private getMaximumFeeRefund(usedVaults: Map<Address, VerificationVault>): bigint {
        let refund: bigint = 0n;

        for (let vault of usedVaults.values()) {
            for (let utxo of vault.utxoDetails) {
                refund += currentConsensusConfig.UNWRAP_CONSOLIDATION_PREPAID_FEES_SAT;
            }
        }

        // Since we are creating one output when consolidating, we need to add the fee for that output.
        return refund;
    }

    /**
     * Pre-estimate the transaction fees for a Taproot transaction
     * @param {bigint} feeRate - The fee rate in satoshis per virtual byte
     * @param {bigint} numInputs - The number of inputs
     * @param {bigint} numOutputs - The number of outputs
     * @param {bigint} numWitnessElements - The number of witness elements (e.g., number of control blocks and witnesses)
     * @param {bigint} witnessElementSize - The average size of each witness element in bytes
     * @param {bigint} emptyWitness - The amount of empty witnesses
     * @param {bigint} [taprootControlWitnessSize=139n] - The size of the control block witness in bytes
     * @param {bigint} [taprootScriptSize=32n] - The size of the taproot script in bytes
     * @returns {bigint} - The estimated transaction fees
     */
    private preEstimateTaprootTransactionFees(
        feeRate: bigint, // satoshis per virtual byte
        numInputs: bigint,
        numOutputs: bigint,
        numWitnessElements: bigint,
        witnessElementSize: bigint,
        emptyWitness: bigint,
        taprootControlWitnessSize: bigint = 32n,
        taprootScriptSize: bigint = 139n,
    ): bigint {
        const txHeaderSize = 10n;
        const inputBaseSize = 41n;
        const outputSize = 68n;
        const taprootWitnessBaseSize = 1n; // Base witness size per input (without signatures and control blocks)

        // Base transaction size (excluding witness data)
        const baseTxSize = txHeaderSize + inputBaseSize * numInputs + outputSize * numOutputs;

        // Witness data size for Taproot
        const witnessSize =
            numInputs * taprootWitnessBaseSize +
            numWitnessElements * witnessElementSize +
            taprootControlWitnessSize * numInputs +
            taprootScriptSize * numInputs +
            emptyWitness;

        // Total weight and virtual size
        const weight = baseTxSize * 3n + (baseTxSize + witnessSize);
        const vSize = weight / 4n;

        return vSize * feeRate;
    }

    private reverseString(str: string): string {
        return str
            .split(/(?=(?:..)*$)/)
            .reverse()
            .join('');
    }

    private getAllInputHashesFromTx(tx: Psbt): string[] {
        let hashes: string[] = [];

        // Always skip the first input.
        for (let i = 1; i < tx.txInputs.length; i++) {
            const input: PsbtTxInput = tx.txInputs[i];

            if (input.hash) {
                const inputHash = this.reverseString(input.hash.toString('hex'));
                if (hashes.includes(inputHash)) {
                    throw new Error('Duplicate input hashes found in transaction.');
                }

                hashes.push(inputHash);
            }
        }

        return hashes;
    }

    private async getUsedVaultsFromTx(tx: Psbt): Promise<{vaults: Map<Address, VerificationVault>, hashes: string[]}> {
        let vaults: Map<Address, VerificationVault> = new Map();

        const hashUTXOs: string[] = this.getAllInputHashesFromTx(tx);
        if (!hashUTXOs.length) {
            throw new Error('No vaults found in transaction.');
        }

        const vaultsFromDb = await this.utxoRepository.queryVaultsFromHashes(hashUTXOs);
        if (!vaultsFromDb.length) throw new Error('No vaults found in database.');

        for (let hash of hashUTXOs) {
            const vault = vaultsFromDb.find((v) => v.utxoDetails.find((h) => h.hash === hash));
            if (!vault) throw new Error(`Vault not found for hash: ${hash}`);

            vaults.set(vault.vault, vault);
        }

        return { vaults, hashes: hashUTXOs };
    }
}
