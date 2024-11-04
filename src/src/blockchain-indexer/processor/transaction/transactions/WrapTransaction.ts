import { ScriptPubKey, TransactionData, VIn, VOut } from '@btc-vision/bsi-bitcoin-rpc';
import { DataConverter } from '@btc-vision/bsi-db';
import { Network, opcodes } from '@btc-vision/bitcoin';
import { Binary } from 'mongodb';
import { IWrapInteractionTransactionDocument } from '../../../../db/interfaces/ITransactionDocument.js';
import { OPNetTransactionTypes } from '../enums/OPNetTransactionTypes.js';
import { InteractionTransaction, InteractionWitnessData } from './InteractionTransaction.js';
import { AuthorityManager } from '../../../../poa/configurations/manager/AuthorityManager.js';
import { P2PVersion } from '../../../../poa/configurations/P2PVersion.js';
import {
    Address,
    AddressMap,
    AddressSet,
    BinaryReader,
    BinaryWriter,
    P2TR_MS,
} from '@btc-vision/transaction';
import {
    WBTC_WRAP_SELECTOR,
    WRAPPING_FEE_STACKING,
    WRAPPING_INDEXER_FEES,
    WRAPPING_INDEXER_PERCENTAGE_FEE,
    WRAPPING_INDEXER_PERCENTAGE_FEE_BASE,
    WRAPPING_INVALID_AMOUNT_PENALTY,
} from '../../../../poa/wbtc/WBTCRules.js';
import { TransactionOutput } from '../inputs/TransactionOutput.js';
import { OPNetConsensus } from '../../../../poa/configurations/OPNetConsensus.js';

export interface WrapWitnessData extends InteractionWitnessData {
    readonly pubKeys: Buffer;
    readonly minimumSignatures: number;
}

const authorityManager = AuthorityManager.getAuthority(P2PVersion);

/* TODO: Potentially allow multiple contract interaction per transaction since BTC supports that? Maybe, in the future, for now let's stick with one. */
export class WrapTransaction extends InteractionTransaction {
    public static override LEGACY_INTERACTION: Buffer = Buffer.from([
        opcodes.OP_TOALTSTACK,

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

    #wrapIndex: number = 0;
    #wrapOutput: ScriptPubKey | undefined;
    #depositTotal: bigint = 0n;
    #depositAmount: bigint = 0n;
    #depositAddress: Address | undefined;

    #wrappingFees: bigint = 0n;

    private penalized: boolean = false;
    private opnetFee: bigint = 0n;
    private stackingFee: bigint = 0n;
    private indexerFee: bigint = 0n;

    public constructor(
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

    public get wrapIndex(): number {
        return this.#wrapIndex;
    }

    public get wrapOutput(): ScriptPubKey {
        if (!this.#wrapOutput) {
            throw new Error(`Wrap output is not set.`);
        }

        return this.#wrapOutput;
    }

    public get depositTotal(): bigint {
        return this.#depositTotal;
    }

    public get publicKeys(): Binary[] {
        return this.pubKeys.map((pubKey) => new Binary(pubKey));
    }

    public get minimumSignatures(): number {
        if (!this.#minimumSignatures) {
            throw new Error(`Minimum signatures is not set.`);
        }

        return this.#minimumSignatures;
    }

    public get depositAddress(): Address {
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

    public static getPublicKeysFromScriptData(
        scriptData: Array<number | Buffer>,
        breakWhenReachOpcode: number,
    ): Buffer | undefined {
        let contractBytecode: Buffer | undefined = undefined;

        //let i: number = 0;
        do {
            // TODO: Verify this.
            if (scriptData[0] === breakWhenReachOpcode) {
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

            //i++;
        } while (scriptData.length);

        return contractBytecode;
    }

    public static getInteractionWitnessData(
        scriptData: Array<number | Buffer>,
    ): WrapWitnessData | undefined {
        const header = WrapTransaction.getInteractionWitnessDataHeader(scriptData);
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

        const calldata: Buffer | undefined = WrapTransaction.getDataFromWitness(scriptData);
        if (!calldata) {
            throw new Error(`No contract bytecode found in wrap transaction.`);
        }

        if (
            OPNetConsensus.consensus.CONTRACTS.MAXIMUM_CALLDATA_SIZE_DECOMPRESSED <
            calldata.byteLength
        ) {
            throw new Error(`OP_NET: Calldata length exceeds maximum allowed size.`);
        }

        return {
            firstByte: header.firstByte,
            pubKeys,
            minimumSignatures: minimumSignatures,
            senderPubKey: header.senderPubKey,
            interactionSaltPubKey: header.interactionSaltPubKey,
            senderPubKeyHash160: header.senderPubKeyHash160,
            contractSecretHash160: header.contractSecretHash160,
            calldata,
        };
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

            pubKeys: this.publicKeys,
            minimumSignatures: this.minimumSignatures,

            depositAmount: DataConverter.toDecimal128(this.depositAmount),
            depositAddress: this.depositAddress,
        };
    }

    public parseTransaction(vIn: VIn[], vOuts: VOut[]): void {
        super.parseTransaction(vIn, vOuts, WrapTransaction);

        if (!authorityManager.WBTC_CONTRACT_ADDRESSES.includes(this.contractAddress)) {
            throw new Error(`Invalid contract address found in wrap transaction.`);
        }

        this.decodeWrappingTransaction();
    }

    protected override verifyUnallowed(): void {}

    private getVaultAddress(): string {
        return P2TR_MS.generateMultiSigAddress(this.pubKeys, this.minimumSignatures, this.network);
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
        if (minimumSignatures > 19) {
            throw new Error(`Minimum signatures is greater than 19.`);
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

        this.#depositAddress = to;

        const amount: bigint = reader.readU256();
        if (amount < 0n) {
            throw new Error(`Invalid amount found in wrap transaction.`);
        }

        /** We penalize users who specify more than the deposit amount. */
        if (this.depositAmount < amount) {
            // user specified more than the deposit amount, we must penalize them
            this.#depositAmount -= WRAPPING_INVALID_AMOUNT_PENALTY;
            this.penalized = true;

            if (this.#depositAmount < 0n) {
                throw new Error(`Not enough.`); // we reject the transaction
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

        this.calculateFees();

        // regenerate calldata.
        this.adjustCalldata();
    }

    /** Adjust the calldata to reflect the new deposit amount. */
    private adjustCalldata(): void {
        const indexerFees = this.giveFeesToIndexer();

        const writer: BinaryWriter = new BinaryWriter();
        writer.writeSelector(WBTC_WRAP_SELECTOR);
        writer.writeAddress(this.depositAddress);
        writer.writeU256(this.depositAmount);
        writer.writeAddressValueTupleMap(indexerFees);
        writer.writeU256(this.stackingFee);

        this._calldata = Buffer.from(writer.getBuffer());

        delete this.interactionWitnessData; // free up some memory.

        this._msgSender = authorityManager.WBTC_DEPLOYER; // authorize the mint.
    }

    private calculateFees(): void {
        this.indexerFee = (this.#wrappingFees * WRAPPING_INDEXER_FEES) / 100n;
        this.stackingFee = (this.#wrappingFees * WRAPPING_FEE_STACKING) / 100n;

        this.opnetFee = (this.#wrappingFees * 10n) / 100n;
        const dust: bigint =
            this.#wrappingFees - (this.indexerFee + this.stackingFee + this.opnetFee);

        this.opnetFee += dust;
    }

    private giveFeesToIndexer(): AddressMap<bigint> {
        const fees: AddressMap<bigint> = new AddressMap<bigint>();

        const indexerWallets: AddressSet = new AddressSet();
        for (const validator of this.pubKeys) {
            const address: Address | undefined = authorityManager.getWalletFromPublicKey(validator);

            if (!address) throw new Error(`Invalid fee recipient found in wrap transaction.`);
            if (!indexerWallets.has(address)) indexerWallets.add(address);
        }

        const initial: bigint = this.indexerFee * 100n;
        const split: bigint = initial / BigInt(indexerWallets.size);
        const each: bigint = split / 100n;
        const dust: bigint = this.indexerFee - each * BigInt(indexerWallets.size); //(initial - (split / 100n) * BigInt(indexerWallets.size)) / 100n;

        for (const wallet of indexerWallets) {
            fees.set(wallet, split / 100n);
        }

        const opnetWallet = authorityManager.opnetFeeWallet();
        if (!opnetWallet) throw new Error(`Invalid fee recipient found in wrap transaction.`);
        const currentOpnetFee = fees.get(opnetWallet) || 0n;
        fees.set(opnetWallet, currentOpnetFee + this.opnetFee + dust);

        const totalFees = Array.from(fees.values()).reduce((acc, fee) => acc + fee, 0n);
        if (totalFees !== this.#wrappingFees - this.stackingFee) {
            throw new Error(
                `Invalid fee distribution found in wrap transaction. ${totalFees} !== ${this.#wrappingFees - this.stackingFee}`,
            );
        }

        return fees;
    }

    private getVaultVOut(): void {
        const vaultVOut: TransactionOutput | undefined = this.outputs.find(
            (vOut) => vOut.scriptPubKey.address === this.vault,
        );
        if (!vaultVOut) {
            throw new Error(`Missing (or invalid) vault deposit in wrap transaction.`);
        }

        if (vaultVOut.scriptPubKey.address !== this.vault) {
            throw new Error(`Invalid vault address found in wrap transaction.`);
        }

        this.#wrapIndex = vaultVOut.index;
        this.#wrapOutput = vaultVOut.scriptPubKey;

        this.#depositTotal = vaultVOut.value;
        this.#depositAmount = this.#depositTotal;
    }
}
