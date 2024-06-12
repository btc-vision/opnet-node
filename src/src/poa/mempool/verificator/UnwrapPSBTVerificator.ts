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
import { KnownPSBTObject, PSBTDecodedData } from '../psbt/PSBTTransactionVerifier.js';
import { Transaction } from '../../../blockchain-indexer/processor/transaction/Transaction.js';

initEccLib(ecc);

interface DecodedWitnessData {
    readonly sender: Address;
    readonly senderPubKey: Buffer;
    readonly contractSecret: Buffer;
    readonly calldata: Buffer;
}

export interface UnwrapPSBTDecodedData extends PSBTDecodedData {
    readonly receiver: Address;
    readonly amount: bigint;
}

const abiCoder: ABICoder = new ABICoder();

export class UnwrapPSBTVerificator extends PSBTVerificator<PSBTTypes.UNWRAP> {
    public static readonly UNWRAP_SELECTOR: number = Number(`0x${abiCoder.encodeSelector('burn')}`);
    public static readonly MINIMUM_UNWRAP_AMOUNT: bigint = 330n;
    public readonly type = PSBTTypes.UNWRAP;

    constructor(protected readonly network: Network = networks.bitcoin) {
        super(network);
    }

    public async verify(data: Psbt): Promise<KnownPSBTObject | false> {
        try {
            const decoded = await this.verifyConformity(data);

            return {
                type: this.type,
                psbt: data,
                data: decoded,
            };
        } catch (e) {
            this.warn(`PSBT failed verification checks: ${(e as Error).stack}`);
        }

        return false;
    }

    private async verifyConformity(data: Psbt): Promise<UnwrapPSBTDecodedData> {
        const clone = data.clone();

        let newInputs = [];
        for (const input of clone.data.inputs) {
            if (!input.partialSig) {
                newInputs.push(input);
            }

            newInputs.push({
                ...input,
                partialSig: [],
                finalScriptWitness: [],
            });
        }

        // @ts-ignore - Get rid of unsigned inputs for verification. TODO: Add a feature in bitcoinjs-lib to ignore unsigned inputs.
        clone.data.inputs = newInputs;

        const tx = clone.extractTransaction(true, true);
        const firstInput = tx.ins[0];
        if (!firstInput) {
            throw new Error(`No inputs found`);
        }

        return this.decodeOPNetUnwrapWitnesses(firstInput);
    }

    private decodeOPNetUnwrapWitnesses(input: Input): UnwrapPSBTDecodedData {
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
