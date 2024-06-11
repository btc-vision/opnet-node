import { TransactionData, VIn, VOut } from '@btc-vision/bsi-bitcoin-rpc';
import { DataConverter } from '@btc-vision/bsi-db';
import { Network, opcodes } from 'bitcoinjs-lib';
import { Binary } from 'mongodb';
import { IWrapInteractionTransactionDocument } from '../../../../db/interfaces/ITransactionDocument.js';
import { OPNetTransactionTypes } from '../enums/OPNetTransactionTypes.js';
import { InteractionTransaction, InteractionWitnessData } from './InteractionTransaction.js';
import { AuthorityManager } from '../../../../poa/configurations/manager/AuthorityManager.js';
import { P2PVersion } from '../../../../poa/configurations/P2PVersion.js';
import { Address, BinaryReader, BinaryWriter } from '@btc-vision/bsi-binary';
import {
    WBTC_WRAP_SELECTOR,
    WRAPPING_INDEXER_PERCENTAGE_FEE,
    WRAPPING_INDEXER_PERCENTAGE_FEE_BASE,
    WRAPPING_INVALID_AMOUNT_PENALTY,
} from '../../../../poa/wbtc/WBTCRules.js';
import { EcKeyPair } from '@btc-vision/transaction';

export interface WrapWitnessData extends InteractionWitnessData {
    readonly pubKeys: Buffer;
    readonly minimumSignatures: number;
}

const authorityManager = AuthorityManager.getAuthority(P2PVersion);

/* TODO: Potentially allow multiple contract interaction per transaction since BTC supports that? Maybe, in the future, for now let's stick with one. */
export class WrapTransaction extends InteractionTransaction {
    public static override LEGACY_INTERACTION: Buffer = Buffer.from([
        opcodes.OP_CHECKSIGVERIFY,
        opcodes.OP_CHECKSIGVERIFY,

        opcodes.OP_HASH160,
        opcodes.OP_EQUALVERIFY,

        opcodes.OP_HASH160,
        opcodes.OP_EQUALVERIFY,

        opcodes.OP_DEPTH,
        opcodes.OP_1,
        opcodes.OP_NUMEQUAL,
        opcodes.OP_IF,

        opcodes.OP_0,
        opcodes.OP_1,
        opcodes.OP_1NEGATE,

        opcodes.OP_ELSE,
        opcodes.OP_1,
        opcodes.OP_ENDIF,
    ]);

    public readonly transactionType: OPNetTransactionTypes.WrapInteraction =
        WrapTransaction.getType();

    protected readonly pubKeys: Buffer[] = [];

    #minimumSignatures: number = 0;
    #vault: string = '';

    #depositAmount: bigint = 0n;
    #depositAddress: string = '';

    #wrappingFees: bigint = 0n;

    private penalized: boolean = false;

    constructor(
        rawTransactionData: TransactionData,
        vIndexIn: number,
        blockHash: string,
        blockHeight: bigint,
        network: Network,
    ) {
        super(rawTransactionData, vIndexIn, blockHash, blockHeight, network);
    }

    public get wrappingFees(): bigint {
        return this.#wrappingFees;
    }

    public get minimumSignatures(): number {
        if (!this.#minimumSignatures) {
            throw new Error(`Minimum signatures is not set.`);
        }

        return this.#minimumSignatures;
    }

    public get depositAddress(): string {
        if (!this.#depositAddress) {
            throw new Error(`Deposit address is not set.`);
        }

        return this.#depositAddress;
    }

    public get vault(): string {
        if (!this.#vault) {
            throw new Error(`Vault is not set.`);
        }

        return this.#vault;
    }

    public get depositAmount(): bigint {
        if (!this.#depositAmount) {
            throw new Error(`Deposit amount is not set.`);
        }

        return this.#depositAmount;
    }

    protected static getType(): OPNetTransactionTypes.WrapInteraction {
        return OPNetTransactionTypes.WrapInteraction;
    }

    /**
     * Convert the transaction to a document.
     */
    public toDocument(): IWrapInteractionTransactionDocument {
        return {
            ...super.toDocument(),

            /** WBTC */
            penalized: this.penalized,
            wrappingFees: DataConverter.toDecimal128(this.wrappingFees),

            vault: this.vault,

            pubKeys: this.pubKeys.map((pubKey) => new Binary(pubKey)),
            minimumSignatures: this.minimumSignatures,

            depositAmount: DataConverter.toDecimal128(this.depositAmount),
            depositAddress: this.depositAddress,
        };
    }

    public parseTransaction(vIn: VIn[], vOuts: VOut[]): void {
        super.parseTransaction(vIn, vOuts);

        if (!authorityManager.WBTC_CONTRACT_ADDRESSES.includes(this.contractAddress)) {
            throw new Error(`Invalid contract address found in wrap transaction.`);
        }

        this.decodeWrappingTransaction();
    }

    protected getPublicKeysFromScriptData(
        scriptData: Array<number | Buffer>,
        breakWhenReachOpcode: number,
    ): Buffer | undefined {
        let contractBytecode: Buffer | undefined = undefined;

        let i: number = 0;
        do {
            if (scriptData[i] === breakWhenReachOpcode) {
                break;
            }

            const dataChunk = scriptData.shift() as Buffer | undefined;
            if (!dataChunk) {
                break;
            }

            if (Buffer.isBuffer(dataChunk)) {
                if (!contractBytecode) {
                    contractBytecode = dataChunk;
                } else {
                    contractBytecode = Buffer.concat([contractBytecode, dataChunk]);
                }
            } else {
                throw new Error(`Invalid pub keys found in wrap transaction.`);
            }
        } while (scriptData.length);

        return contractBytecode;
    }

    protected getInteractionWitnessData(
        scriptData: Array<number | Buffer>,
    ): WrapWitnessData | undefined {
        const header = this.getInteractionWitnessDataHeader(scriptData);
        if (!header) {
            return;
        }

        // ... Future implementation before this opcode
        if (scriptData.shift() !== opcodes.OP_0) {
            return;
        }

        const pubKeys: Buffer | undefined = this.getPublicKeysFromScriptData(
            scriptData,
            opcodes.OP_1,
        );

        if (!pubKeys) {
            return;
        }

        if (scriptData.shift() !== opcodes.OP_1) {
            return;
        }

        const minimumSignaturesBuf: Buffer | undefined = scriptData.shift() as Buffer | undefined;
        if (!minimumSignaturesBuf) {
            return;
        }

        const minimumSignatures: number = minimumSignaturesBuf.readUInt16LE(0);

        // ... Future implementation after this opcode
        if (scriptData.shift() !== opcodes.OP_1NEGATE) {
            return;
        }

        const calldata: Buffer | undefined = this.getDataFromWitness(scriptData);
        if (!calldata) {
            throw new Error(`No contract bytecode found in wrap transaction.`);
        }

        return {
            pubKeys,
            minimumSignatures: minimumSignatures,
            senderPubKey: header.senderPubKey,
            interactionSaltPubKey: header.interactionSaltPubKey,
            senderPubKeyHash160: header.senderPubKeyHash160,
            contractSecretHash160: header.contractSecretHash160,
            calldata,
        };
    }

    private getVaultAddress(): string {
        return EcKeyPair.generateMultiSigAddress(
            this.pubKeys,
            this.minimumSignatures,
            this.network,
        );
    }

    private decodeWrappingTransaction(): void {
        const interactionWitnessData: WrapWitnessData | undefined = this.interactionWitnessData as
            | WrapWitnessData
            | undefined;

        if (!interactionWitnessData) {
            throw new Error(`No interaction witness data found in wrap transaction.`);
        }

        if (!interactionWitnessData.pubKeys) {
            throw new Error(`No public keys found in wrap transaction.`);
        }

        const pubKeys: Buffer = this.decompressData(interactionWitnessData.pubKeys);
        if (!pubKeys) {
            throw new Error(`No public keys found in wrap transaction.`);
        }

        const minimumSignatures: number = interactionWitnessData.minimumSignatures;
        if (minimumSignatures > 255) {
            throw new Error(`Minimum signatures is greater than 255.`);
        }

        this.#minimumSignatures = minimumSignatures;

        // we have to restore the 33 bytes public keys
        let i = 0;
        while (i < pubKeys.length) {
            const regeneratedPubKey = pubKeys.subarray(i, i + 33);
            this.pubKeys.push(regeneratedPubKey);
            i += 33;
        }

        const containValidPublicKeys: boolean = authorityManager.verifyPublicKeysConstraints(
            this.pubKeys,
        );

        if (!containValidPublicKeys) {
            throw new Error(`Invalid public keys found in wrap transaction.`);
        }

        this.#vault = this.getVaultAddress();

        this.getVaultVOut();
        this.decodeCalldata();
    }

    /**
     * Decode the calldata of the transaction.
     * @private
     */
    private decodeCalldata(): void {
        const reader: BinaryReader = new BinaryReader(this.calldata);
        const selector = reader.readSelector();
        if (selector !== WBTC_WRAP_SELECTOR) {
            throw new Error(`Invalid selector found in wrap transaction ${selector}.`);
        }

        const to: Address = reader.readAddress();
        if (!to) {
            throw new Error(`Invalid address found in wrap transaction.`);
        }

        this.#depositAddress = to.toString();

        const amount: bigint = reader.readU256();
        if (amount < 0n) {
            throw new Error(`Invalid amount found in wrap transaction.`);
        }

        /** We penalize users who specify more than the deposit amount. */
        if (this.depositAmount < amount) {
            // user specified more than the deposit amount, we must penalize them
            this.#depositAmount -= WRAPPING_INVALID_AMOUNT_PENALTY;
            this.penalized = true;

            if (this.depositAmount < 0n) {
                throw new Error(`Transaction does not have to be penalized.`); // we reject the transaction
            }
        } else {
            this.#depositAmount = amount;
        }

        this.subtractWBTCWrappingFees();
    }

    /**
     * Subtract the WBTC wrapping fees from the deposit amount.
     * @private
     */
    private subtractWBTCWrappingFees(): void {
        const fees: bigint =
            (this.depositAmount * WRAPPING_INDEXER_PERCENTAGE_FEE) /
                WRAPPING_INDEXER_PERCENTAGE_FEE_BASE +
            1n; // round up.

        if (this.depositAmount < fees) {
            throw new Error(`Transaction can not handle fees. Deposit amount is too low.`);
        }

        this.#wrappingFees = fees;
        this.#depositAmount -= fees;

        // regenerate calldata.
        this.adjustCalldata();
    }

    /** Adjust the calldata to reflect the new deposit amount. */
    private adjustCalldata(): void {
        const writer: BinaryWriter = new BinaryWriter();
        writer.writeSelector(WBTC_WRAP_SELECTOR);
        writer.writeAddress(this.depositAddress);
        writer.writeU256(this.depositAmount);

        this._calldata = Buffer.from(writer.getBuffer());
        delete this.interactionWitnessData; // free up some memory.
    }

    private getVaultVOut(): void {
        const vaultVOut = this.outputs.find((vOut) => vOut.scriptPubKey.address === this.vault);
        if (!vaultVOut) {
            throw new Error(`Missing (or invalid) vault deposit in wrap transaction.`);
        }

        this.#depositAmount = BigInt(vaultVOut.value);
    }
}