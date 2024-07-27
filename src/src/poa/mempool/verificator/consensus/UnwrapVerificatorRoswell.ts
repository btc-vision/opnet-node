import { Consensus } from '../../../configurations/consensus/Consensus.js';
import {
    MinimumUtxoInformation,
    PartialUnwrapPSBTDecodedData,
    UnwrapConsensusVerificator,
    UnwrapPSBTDecodedData,
    VerificationVault,
} from './UnwrapConsensusVerificator.js';
import { Psbt, PsbtTxInput } from 'bitcoinjs-lib';
import { ConfigurableDBManager } from '@btc-vision/bsi-common';
import { WBTCUTXORepository } from '../../../../db/repositories/WBTCUTXORepository.js';
import { Address } from '@btc-vision/bsi-binary';
import { UnwrapTargetConsolidation } from '../../../equoitions/UnwrapTargetConsolidation.js';
import { OPNetConsensus } from '../../../configurations/OPNetConsensus.js';

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
            hash: data.hash,
            estimatedFees: data.estimatedFees,
        };
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

    private convertInputHashBufferToString(hash: Buffer): string {
        return this.reverseString(hash.toString('hex'));
    }

    private checkInputOrder(
        psbt: Psbt,
        vaults: Map<Address, VerificationVault>,
    ): MinimumUtxoInformation[] {
        let inputs: { [key: string]: { value: bigint } } = {};
        for (let vault of vaults.values()) {
            for (let tx in vault.utxoDetails) {
                let data = vault.utxoDetails[tx];

                inputs[data.hash] = { value: data.value };
            }
        }

        let order: MinimumUtxoInformation[] = [];
        for (let i = 0; i < psbt.txInputs.length; i++) {
            if (i === 0) {
                continue;
            }

            let input = psbt.txInputs[i];
            let hash = this.convertInputHashBufferToString(input.hash);
            let val = inputs[hash];

            if (!val) {
                throw new Error(`Input hash not found in vaults.`);
            }

            order.push({ hash, value: val.value });
        }

        // input order validation
        for (let i = 0; i < order.length - 1; i++) {
            // we verify if the next input is greater than the current one, if it is we throw an error
            let input = order[i];

            if (order[i + 1].value < input.value) {
                throw new Error(
                    `Inputs are not ordered correctly. Expected ${input.value} to be greater than ${order[i + 1].value}`,
                );
            }
        }

        return order; /*.sort((a: MinimumUtxoInformation, b: MinimumUtxoInformation) => {
            if (a.value === b.value) return 0;

            return a.value < b.value ? -1 : 1;
        });*/
    }

    private verifyConsolidatedInputs(
        orderedInputs: MinimumUtxoInformation[],
        targetConsolidation: bigint,
        currentConsolidationAmount: bigint,
        amount: bigint,
    ): void {
        let totalUsedSatisfyAmount = 0n;

        let isConsolidating: boolean = false;
        let consolidation: MinimumUtxoInformation[] = [];
        let amountLeft: bigint = 0n;

        let consolidationAmount = 0n;
        let upperConsolidationAcceptanceLimit = 0n;

        const minConsolidationAcceptance = OPNetConsensus.consensus.VAULTS.VAULT_MINIMUM_AMOUNT;
        const maxConsolidationUTXOs = OPNetConsensus.consensus.VAULTS.MAXIMUM_CONSOLIDATION_UTXOS;
        const prepaidFees = OPNetConsensus.consensus.VAULTS.UNWRAP_CONSOLIDATION_PREPAID_FEES_SAT;

        let refundAmount = 0n;

        for (let i = 0; i < orderedInputs.length; i++) {
            if (i !== 0) refundAmount += prepaidFees;

            let utxoAmount = orderedInputs[i].value;
            if (!isConsolidating) {
                totalUsedSatisfyAmount += utxoAmount;

                amountLeft = totalUsedSatisfyAmount - amount - refundAmount;

                if (totalUsedSatisfyAmount >= amount + refundAmount) {
                    isConsolidating = true;
                    upperConsolidationAcceptanceLimit = targetConsolidation + amountLeft;
                }
            } else if (isConsolidating) {
                consolidation.push(orderedInputs[i]);
                consolidationAmount += utxoAmount - prepaidFees;

                if (consolidation.length >= maxConsolidationUTXOs) {
                    break;
                }
            }
        }

        // consolidationAmount + amountLeft
        if (currentConsolidationAmount > upperConsolidationAcceptanceLimit) {
            throw new Error(
                `Consolidation amount exceeds the allowed limits. Expected at most ${upperConsolidationAcceptanceLimit}, but got ${consolidationAmount}`,
            );
        }

        if (consolidationAmount < minConsolidationAcceptance) {
            throw new Error('Consolidation amount is below the minimum required.');
        }

        if (consolidation.length > maxConsolidationUTXOs) {
            throw new Error('Exceeded the maximum number of consolidation UTXOs.');
        }
    }

    // TODO: Make sure this is 100% correct and vuln proof.
    private analyzeOutputs(
        psbt: Psbt,
        usedVaults: Map<Address, VerificationVault>,
        receiver: Address,
        amount: bigint,
    ): void {
        const numberOfInputs: number = psbt.txInputs.length - 1;

        const hasConsolidation: boolean = psbt.txOutputs.length > 2;
        const vaultWithMostPublicKeys: VerificationVault =
            this.findVaultWithMostPublicKeys(usedVaults);

        if (psbt.txOutputs.length > 3) {
            throw new Error(`Too many outputs.`);
        }

        const orderedInputs = this.checkInputOrder(psbt, usedVaults);

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

        const maximumFeeRefund: bigint = this.getMaximumFeeRefund(usedVaults, amount);
        const refundedAmount: bigint = outputAmount - amount;
        if (refundedAmount > maximumFeeRefund) {
            throw new Error(
                `Refunded amount is above the maximum fee refund. Expected at most ${maximumFeeRefund}, but got ${refundedAmount}`,
            );
        }

        // Verify that the total output amount matches the expected amount
        const vaultTotalHoldings: bigint = this.calculateVaultTotalHoldings(usedVaults);
        const expectedConsolidationAmount: bigint = vaultTotalHoldings - amount - maximumFeeRefund;
        if (hasConsolidation) {
            // Verify that the consolidation amount is correct
            if (consolidationAmount < expectedConsolidationAmount) {
                throw new Error(
                    `Invalid consolidation amount. Expected ${expectedConsolidationAmount} sat, but got ${consolidationAmount} sat.`,
                );
            }

            // Verify that the consolidation amount is above the minimum required
            if (consolidationAmount < 330n) {
                //OPNetConsensus.consensus.VAULTS.VAULT_MINIMUM_AMOUNT
                throw new Error(
                    `Consolidation amount is below the minimum required. Expected at least 330 sat, but got ${consolidationAmount} sat`, //${OPNetConsensus.consensus.VAULTS.VAULT_MINIMUM_AMOUNT}
                );
            }

            const targetConsolidation: bigint =
                UnwrapTargetConsolidation.calculateVaultTargetConsolidationAmount(
                    amount,
                    OPNetConsensus.consensus.VAULTS.VAULT_MINIMUM_AMOUNT,
                    OPNetConsensus.consensus.VAULTS.VAULT_NETWORK_CONSOLIDATION_ACCEPTANCE,
                );

            if (
                !(
                    targetConsolidation <
                        OPNetConsensus.consensus.VAULTS.VAULT_NETWORK_CONSOLIDATION_ACCEPTANCE &&
                    numberOfInputs === 1
                )
            ) {
                if (consolidationAmount > targetConsolidation) {
                    this.verifyConsolidatedInputs(
                        orderedInputs,
                        targetConsolidation,
                        consolidationAmount,
                        amount,
                    );
                }

                this.success(`Consolidation amount is within the expected range.`);
            }
        }

        // When an UTXO is consumed, the user get UNWRAP_CONSOLIDATION_PREPAID_FEES_SAT as a refund.
        //const userOwnedVaultHoldings = vaultTotalHoldings - consolidationAmount - maximumFeeRefund;
        /*if (userOwnedVaultHoldings > outputAmount) {
            throw new Error(
                `Invalid amount sent back to requester. Expected ${userOwnedVaultHoldings} sat, but got ${outputAmount} sat.`,
            );
        }*/

        const userOwnedVaultHoldings = vaultTotalHoldings - consolidationAmount - maximumFeeRefund;
        if (userOwnedVaultHoldings < 330n) {
            throw new Error(
                `Invalid amount sent back to requester. Expected at least 330 sat, but got ${userOwnedVaultHoldings} sat.`,
            );
        }

        if (amount + maximumFeeRefund < outputAmount) {
            throw new Error(
                `Invalid amount sent back to requester. Expected at most ${amount + maximumFeeRefund} sat, but got ${outputAmount} sat.`,
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

    private getMaximumFeeRefund(
        usedVaults: Map<Address, VerificationVault>,
        amount: bigint,
    ): bigint {
        let refund: bigint = -OPNetConsensus.consensus.VAULTS.UNWRAP_CONSOLIDATION_PREPAID_FEES_SAT;

        let totalVaults: number = 0;
        for (let vault of usedVaults.values()) {
            for (let i = 0; i < vault.utxoDetails.length; i++) {
                refund += OPNetConsensus.consensus.VAULTS.UNWRAP_CONSOLIDATION_PREPAID_FEES_SAT;
                totalVaults++;
            }
        }

        // TODO: Verify this.
        let amountLeft = this.calculateVaultTotalHoldings(usedVaults) - amount;
        if (totalVaults === 1) {
            if (
                amountLeft < OPNetConsensus.consensus.VAULTS.UNWRAP_CONSOLIDATION_PREPAID_FEES_SAT
            ) {
                refund += OPNetConsensus.consensus.VAULTS.UNWRAP_CONSOLIDATION_PREPAID_FEES_SAT;
            }
        }

        // Since we are creating one output when consolidating, we need to add the fee for that output.
        return refund;
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

    private async getUsedVaultsFromTx(tx: Psbt): Promise<{
        vaults: Map<Address, VerificationVault>;
        hashes: string[];
    }> {
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
