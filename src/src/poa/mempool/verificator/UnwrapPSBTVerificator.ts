import { PSBTVerificator } from './PSBTVerificator.js';
import bitcoin, { initEccLib, Network, networks, payments, Psbt, script } from 'bitcoinjs-lib';
import * as ecc from 'tiny-secp256k1';
import { PSBTTypes } from '../psbt/PSBTTypes.js';
import {
    InteractionTransaction,
    InteractionWitnessData,
} from '../../../blockchain-indexer/processor/transaction/transactions/InteractionTransaction.js';
import { Input } from 'bitcoinjs-lib/src/transaction.js';
import { ABICoder, Address, BinaryReader } from '@btc-vision/bsi-binary';
import { KnownPSBTObject } from '../psbt/PSBTTransactionVerifier.js';
import { Transaction } from '../../../blockchain-indexer/processor/transaction/Transaction.js';
import {
    PartialUnwrapPSBTDecodedData,
    UnwrapPSBTDecodedData,
} from './consensus/UnwrapConsensusVerificator.js';
import { UnwrapVerificatorRoswell } from './consensus/UnwrapVerificatorRoswell.js';
import { ConfigurableDBManager } from '@btc-vision/bsi-common';
import { Consensus, TransactionBuilder, TweakedTransaction } from '@btc-vision/transaction';
import { PsbtInput } from 'bip174/src/lib/interfaces.js';
import { TrustedAuthority } from '../../configurations/manager/TrustedAuthority.js';
import { AuthorityManager } from '../../configurations/manager/AuthorityManager.js';
import { currentConsensusConfig } from '../../configurations/OPNetConsensus.js';

initEccLib(ecc);

interface DecodedWitnessData {
    readonly sender: Address;
    readonly senderPubKey: Buffer;
    readonly contractSecret: Buffer;
    readonly calldata: Buffer;
}

const abiCoder: ABICoder = new ABICoder();

export class UnwrapPSBTVerificator extends PSBTVerificator<PSBTTypes.UNWRAP> {
    public static readonly UNWRAP_SELECTOR: number = Number(`0x${abiCoder.encodeSelector('burn')}`);
    public static readonly MINIMUM_UNWRAP_AMOUNT: bigint = 330n;

    public readonly type: PSBTTypes.UNWRAP = PSBTTypes.UNWRAP;

    private readonly consensusVerificator: UnwrapVerificatorRoswell;

    private readonly currentAuthority: TrustedAuthority = AuthorityManager.getCurrentAuthority();

    constructor(db: ConfigurableDBManager, network: Network = networks.bitcoin) {
        super(db, network);

        this.consensusVerificator = new UnwrapVerificatorRoswell(this.db);
    }

    public async verify(data: Psbt, version: number): Promise<KnownPSBTObject | false> {
        try {
            const decoded = await this.verifyConformity(data, version);

            return {
                type: this.type,
                psbt: data,
                data: decoded,
                version: version,
                hash: decoded.hash,
            };
        } catch (e) {
            this.warn(`PSBT failed verification checks: ${(e as Error).stack}`);
        }

        return false;
    }

    public async createRepositories(): Promise<void> {
        await this.consensusVerificator.createRepositories();
    }

    private removeUnsignedInputs(clone: Psbt): Psbt {
        let newInputs = [];
        for (const input of clone.data.inputs) {
            if (input.finalScriptWitness) {
                newInputs.push(input);
            }
        }

        clone.data.inputs = newInputs;

        return clone;
    }

    private getInOutAmounts(
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
    private estimateFee(data: Psbt, bytes: Psbt, tx: bitcoin.Transaction): bigint {
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

    private generatePSBTHash(data: Psbt): {
        tx: bitcoin.Transaction;
        hash: string;
        estimatedFees: bigint;
    } {
        const clone: Psbt = this.removeUnsignedInputs(data.clone());
        const clonedForHash: Psbt = this.removeUnsignedInputs(data.clone());
        const tx = clone.extractTransaction(true, true);

        const estimatedFees: bigint = this.estimateFee(data.clone(), clone, tx);
        if (estimatedFees < currentConsensusConfig.MINIMAL_PSBT_ACCEPTANCE_FEE_VB_PER_SAT) {
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
                let decodedData = TransactionBuilder.readScriptWitnessToWitnessStack(
                    input.finalScriptWitness,
                );

                const decoded = [
                    Buffer.alloc(decodedData.length - 2),
                    decodedData[decodedData.length - 1],
                    decodedData[decodedData.length - 2],
                ];

                // @ts-ignore
                input.finalScriptWitness = TransactionBuilder.witnessStackToScriptWitness(decoded);
            }
        }

        const txForHash = clonedForHash.extractTransaction(true, true);
        const txHash: string = txForHash.getHash(false).toString('hex');

        return { tx, hash: txHash, estimatedFees };
    }

    private async verifyConformity(data: Psbt, version: number): Promise<UnwrapPSBTDecodedData> {
        const { tx, hash: txHash, estimatedFees } = this.generatePSBTHash(data);

        const amountOfInputs = tx.ins.length;
        if (amountOfInputs < 1) {
            throw new Error(`Not enough inputs to unwrap`);
        }

        const firstInput = tx.ins[0];
        if (!firstInput) {
            throw new Error(`No inputs found`);
        }

        const decodedWitnesses = this.decodeOPNetUnwrapWitnesses(
            firstInput,
            version,
            txHash,
            estimatedFees,
        );

        // Apply consensus validation rules here.
        switch (version) {
            case Consensus.Roswell:
                return this.consensusVerificator.verify(decodedWitnesses, data);
            default:
                throw new Error(`Unsupported consensus version`);
        }
    }

    private decodeOPNetUnwrapWitnesses(
        input: Input,
        version: number,
        txHash: string,
        estimatedFees: bigint,
    ): PartialUnwrapPSBTDecodedData {
        const witness = input.witness[input.witness.length - 2];
        if (!witness) {
            throw new Error(`No witness found`);
        }

        const decodedScript = script.decompile(witness);
        if (!decodedScript) {
            throw new Error(`Failed to decode script`);
        }

        if (!Transaction.dataIncludeOPNetMagic(decodedScript)) {
            throw new Error(`Invalid OPNET magic`);
        }

        if (
            !InteractionTransaction.verifyChecksum(
                decodedScript,
                InteractionTransaction.LEGACY_INTERACTION,
            )
        ) {
            throw new Error(`Invalid checksum`);
        }

        const interactionWitnessData =
            InteractionTransaction.getInteractionWitnessData(decodedScript);
        if (!interactionWitnessData) {
            throw new Error(`Failed to decode interaction witness data`);
        }

        const decoded = this.verifyWitnessData(input.witness, interactionWitnessData);
        if (!decoded) {
            throw new Error(`Failed to decode witness data`);
        }

        const amountToUnwrap: bigint = this.decodeCalldata(decoded.calldata);
        return {
            receiver: decoded.sender,
            amount: amountToUnwrap,
            version: version,
            hash: txHash,
            estimatedFees: estimatedFees,
        };
    }

    private decodeCalldata(calldata: Buffer): bigint {
        const reader = new BinaryReader(calldata);
        const selector = reader.readSelector();

        if (selector !== UnwrapPSBTVerificator.UNWRAP_SELECTOR) {
            throw new Error(`Invalid selector`);
        }

        const amount = reader.readU256();
        if (amount < UnwrapPSBTVerificator.MINIMUM_UNWRAP_AMOUNT) {
            throw new Error(`Amount too low`);
        }

        return amount;
    }

    private verifyWitnessData(
        witnesses: Buffer[],
        interactionWitnessData: InteractionWitnessData,
    ): DecodedWitnessData {
        if (!interactionWitnessData || !witnesses || witnesses.length < 2) {
            throw new Error(`No interaction witness data found`);
        }

        const contractSecret: Buffer = witnesses[0];
        const senderPubKey: Buffer = witnesses[1];

        /** Verify witness data */
        const hashSenderPubKey = bitcoin.crypto.hash160(senderPubKey);
        if (!hashSenderPubKey.equals(interactionWitnessData.senderPubKeyHash160)) {
            throw new Error(`Sender public key hash mismatch for transaction`);
        }

        if (!senderPubKey.equals(interactionWitnessData.senderPubKey)) {
            throw new Error(
                `Sender public key mismatch for transaction. Expected ${interactionWitnessData.senderPubKey.toString(
                    'hex',
                )} but got ${senderPubKey.toString('hex')}`,
            );
        }

        const { address } = payments.p2tr({ internalPubkey: senderPubKey, network: this.network });
        if (!address) {
            throw new Error(`Failed to generate sender address for transaction`);
        }

        /** Verify contract salt */
        const hashContractSalt = bitcoin.crypto.hash160(contractSecret);
        if (!hashContractSalt.equals(interactionWitnessData.contractSecretHash160)) {
            throw new Error(
                `Contract salt hash mismatch for transaction. Expected ${interactionWitnessData.contractSecretHash160.toString(
                    'hex',
                )} but got ${hashContractSalt.toString('hex')}`,
            );
        }

        const decompressedCalldata = InteractionTransaction.decompressBuffer(
            interactionWitnessData.calldata,
        );

        if (!decompressedCalldata) {
            throw new Error(`Failed to decompress calldata`);
        }

        return {
            sender: address,
            senderPubKey: senderPubKey,
            contractSecret: contractSecret,
            calldata: decompressedCalldata.out,
        };
    }
}
