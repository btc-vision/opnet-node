import { PSBTVerificator } from './PSBTVerificator.js';
import bitcoin, { initEccLib, Network, networks, payments, Psbt, script } from 'bitcoinjs-lib';
import * as ecc from 'tiny-secp256k1';
import { PSBTTypes } from '../psbt/PSBTTypes.js';
import { InteractionWitnessData } from '../../../blockchain-indexer/processor/transaction/transactions/InteractionTransaction.js';
import { Input } from 'bitcoinjs-lib/src/transaction.js';
import { ABICoder, Address, BinaryReader } from '@btc-vision/transaction';
import { KnownPSBTObject } from '../psbt/PSBTTransactionVerifier.js';
import { Transaction } from '../../../blockchain-indexer/processor/transaction/Transaction.js';
import {
    PartialUnwrapPSBTDecodedData,
    UnwrapPSBTDecodedData,
} from './consensus/UnwrapConsensusVerificator.js';
import { UnwrapVerificatorRoswell } from './consensus/UnwrapVerificatorRoswell.js';
import { ConfigurableDBManager } from '@btc-vision/bsi-common';
import { Consensus } from '@btc-vision/transaction';
import { UnwrapTransaction } from '../../../blockchain-indexer/processor/transaction/transactions/UnwrapTransaction.js';

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
            };
        } catch (e) {
            this.warn(`PSBT failed verification checks: ${(e as Error).stack}`);
        }

        return false;
    }

    public createRepositories(): void {
        this.consensusVerificator.createRepositories();
    }

    private async verifyConformity(data: Psbt, version: Consensus): Promise<UnwrapPSBTDecodedData> {
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
            !UnwrapTransaction.verifyChecksum(decodedScript, UnwrapTransaction.LEGACY_INTERACTION)
        ) {
            throw new Error(`Invalid checksum`);
        }

        const interactionWitnessData = UnwrapTransaction.getInteractionWitnessData(decodedScript);
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

        const decompressedCalldata = UnwrapTransaction.decompressBuffer(
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
