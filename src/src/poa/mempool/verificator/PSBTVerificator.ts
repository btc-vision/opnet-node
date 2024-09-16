import { ConfigurableDBManager, Logger } from '@btc-vision/bsi-common';
import { PSBTTypes } from '../psbt/PSBTTypes.js';
import bitcoin, { Network, networks, Psbt } from 'bitcoinjs-lib';
import { KnownPSBTObject } from '../psbt/PSBTTransactionVerifier.js';
import { PsbtInput } from 'bip174/src/lib/interfaces.js';
import { TransactionBuilder, TweakedTransaction } from '@btc-vision/transaction';
import { TrustedAuthority } from '../../configurations/manager/TrustedAuthority.js';
import { AuthorityManager } from '../../configurations/manager/AuthorityManager.js';
import { OPNetConsensus } from '../../configurations/OPNetConsensus.js';

export abstract class PSBTVerificator<T extends PSBTTypes> extends Logger {
    public abstract readonly type: T;

    public readonly logColor: string = '#e0e0e0';

    protected readonly currentAuthority: TrustedAuthority = AuthorityManager.getCurrentAuthority();

    protected constructor(
        protected readonly db: ConfigurableDBManager,
        protected readonly network: Network = networks.bitcoin,
    ) {
        super();
    }

    public abstract createRepositories(): void;

    public abstract verify(data: Psbt, version: number): Promise<KnownPSBTObject | false>;

    protected getInOutAmounts(
        inputs: PsbtInput[],
        tx: bitcoin.Transaction,
    ): { in: bigint; out: bigint } {
        let inputAmount = 0;
        inputs.forEach((input, idx) => {
            if (input.witnessUtxo) {
                inputAmount += input.witnessUtxo.value;
            } else {
                throw new Error(`Input ${idx} does not have a witness UTXO`);
            }
        });

        const outputAmount = tx.outs.reduce((total, o) => total + o.value, 0);

        return { in: BigInt(inputAmount), out: BigInt(outputAmount) };
    }

    /**
     * Estimate the fees for the transaction.
     * @param {Psbt} data - The PSBT data.
     * @param {Psbt} bytes - The PSBT bytes.
     * @param {bitcoin.Transaction} tx - The transaction.
     * @private
     * @returns {bigint} The estimated fee.
     */
    protected estimateFee(data: Psbt, bytes: Psbt, tx: bitcoin.Transaction): bigint {
        const amounts = this.getInOutAmounts(data.data.inputs, tx);
        const amountFee: bigint = amounts.in - amounts.out;
        if (amountFee < 0n) {
            throw new Error(`Fee are negative.`);
        }

        const vBytes = BigInt(bytes.extractTransaction().virtualSize());
        const inputCount = BigInt(data.inputCount - 1);

        // Estimate, based on consensus rules, the fees for the transaction.
        const vBytesAdditional = TweakedTransaction.preEstimateTaprootTransactionFees(
            1n,
            inputCount,
            2n,
            BigInt(this.currentAuthority.transactionMinimum * 2),
            65n,
            BigInt(
                Math.min(
                    this.currentAuthority.transactionMinimum - this.currentAuthority.minimum,
                    1,
                ),
            ) * inputCount,
        );

        const vBytesTotal = vBytes + vBytesAdditional;
        const feePerVByte = (amountFee * 10000n) / vBytesTotal;

        // round up, to avoid rounding errors, fee is on a base of 10000
        return (feePerVByte * vBytesTotal + 9999n) / 10000n;
    }

    protected generatePSBTHash(data: Psbt): {
        tx: bitcoin.Transaction;
        hash: string;
        estimatedFees: bigint;
    } {
        const clone: Psbt = this.removeUnsignedInputs(data.clone());
        const clonedForHash: Psbt = this.removeUnsignedInputs(data.clone());
        const tx = clone.extractTransaction(true, true);

        const estimatedFees: bigint = this.estimateFee(data.clone(), clone, tx);
        if (estimatedFees < OPNetConsensus.consensus.PSBT.MINIMAL_PSBT_ACCEPTANCE_FEE_VB_PER_SAT) {
            throw new Error(`Fee too low`);
        }

        // We need to decode the finalScriptWitnesses, count the witnesses and put the number of witness instead
        for (const input of clonedForHash.data.inputs) {
            if (input.partialSig) {
                input.partialSig = input.partialSig.map(() => {
                    return {
                        pubkey: Buffer.alloc(33),
                        signature: Buffer.alloc(65),
                    };
                });
            } else if (input.finalScriptWitness) {
                const decodedData = TransactionBuilder.readScriptWitnessToWitnessStack(
                    input.finalScriptWitness,
                );

                const decoded = [
                    Buffer.alloc(decodedData.length - 2),
                    decodedData[decodedData.length - 1],
                    decodedData[decodedData.length - 2],
                ];

                input.finalScriptWitness = TransactionBuilder.witnessStackToScriptWitness(decoded);
            }
        }

        const txForHash = clonedForHash.extractTransaction(true, true);
        const txHash: string = txForHash.getHash(false).toString('hex');

        return { tx, hash: txHash, estimatedFees };
    }

    private removeUnsignedInputs(clone: Psbt): Psbt {
        const newInputs = [];
        for (const input of clone.data.inputs) {
            if (input.finalScriptWitness) {
                newInputs.push(input);
            }
        }

        clone.data.inputs = newInputs;

        return clone;
    }
}
