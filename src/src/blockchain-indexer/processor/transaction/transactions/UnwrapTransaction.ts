import { TransactionData, VIn, VOut } from '@btc-vision/bsi-bitcoin-rpc';
import bitcoin, { Network, opcodes } from 'bitcoinjs-lib';
import { IUnwrapInteractionTransactionDocument } from '../../../../db/interfaces/ITransactionDocument.js';
import { OPNetTransactionTypes } from '../enums/OPNetTransactionTypes.js';
import { InteractionTransaction, InteractionWitnessData } from './InteractionTransaction.js';
import { AuthorityManager } from '../../../../poa/configurations/manager/AuthorityManager.js';
import { P2PVersion } from '../../../../poa/configurations/P2PVersion.js';
import { BinaryReader } from '@btc-vision/bsi-binary';
import { WBTC_UNWRAP_SELECTOR } from '../../../../poa/wbtc/WBTCRules.js';
import { TrustedCompanies } from '../../../../poa/configurations/TrustedCompanies.js';
import { DataConverter } from '@btc-vision/bsi-db';
import { TransactionOutput } from '../inputs/TransactionOutput.js';
import {
    PartialWBTCUTXODocument,
    UsedUTXOToDelete,
} from '../../../../db/interfaces/IWBTCUTXODocument.js';
import { Binary } from 'mongodb';

const authorityManager = AuthorityManager.getAuthority(P2PVersion);

export class UnwrapTransaction extends InteractionTransaction {
    public static override LEGACY_INTERACTION: Buffer = Buffer.from([
        // This signature only match unwrap transactions. Otherwise, it's considered invalid.
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

        opcodes.OP_16,
        opcodes.OP_1NEGATE,

        opcodes.OP_ELSE,
        opcodes.OP_1,
        opcodes.OP_ENDIF,
    ]);

    public readonly transactionType: OPNetTransactionTypes.UnwrapInteraction =
        UnwrapTransaction.getType();

    protected readonly _authorizedVaultUsage: boolean = true;

    #authorizedBy: TrustedCompanies[] = [];
    #usedUTXOs: UsedUTXOToDelete[] = [];
    #consolidatedVault: PartialWBTCUTXODocument | undefined;

    #unwrapAmount: bigint = 0n;
    #requestedAmount: bigint = 0n;

    private readonly tx: bitcoin.Transaction;

    constructor(
        rawTransactionData: TransactionData,
        vIndexIn: number,
        blockHash: string,
        blockHeight: bigint,
        network: Network,
    ) {
        super(rawTransactionData, vIndexIn, blockHash, blockHeight, network);

        this.tx = bitcoin.Transaction.fromHex(rawTransactionData.hex);
    }

    public get usedUTXOs(): UsedUTXOToDelete[] {
        if (!this.#usedUTXOs.length) {
            throw new Error(`No used UTXOs found in unwrap transaction.`);
        }

        return this.#usedUTXOs;
    }

    public get authorizedBy(): TrustedCompanies[] {
        if (!this.#authorizedBy.length) {
            throw new Error(`No authorized companies found in unwrap transaction.`);
        }

        return this.#authorizedBy;
    }

    public get consolidatedVault(): PartialWBTCUTXODocument | undefined {
        return this.#consolidatedVault;
    }

    public static getInteractionWitnessData(
        scriptData: Array<number | Buffer>,
    ): InteractionWitnessData | undefined {
        const header = UnwrapTransaction.getInteractionWitnessDataHeader(scriptData);
        if (!header) {
            return;
        }

        // ... Future implementation before this opcode
        if (scriptData.shift() !== opcodes.OP_16) {
            // define an unwrap transaction
            return;
        }

        // ... Future implementation after this opcode
        if (scriptData.shift() !== opcodes.OP_1NEGATE) {
            return;
        }

        const calldata: Buffer | undefined = UnwrapTransaction.getDataFromWitness(scriptData);
        if (!calldata) {
            throw new Error(`No contract bytecode found in wrap transaction.`);
        }

        return {
            senderPubKey: header.senderPubKey,
            interactionSaltPubKey: header.interactionSaltPubKey,
            senderPubKeyHash160: header.senderPubKeyHash160,
            contractSecretHash160: header.contractSecretHash160,
            calldata,
        };
    }

    protected static getType(): OPNetTransactionTypes.UnwrapInteraction {
        return OPNetTransactionTypes.UnwrapInteraction;
    }

    /**
     * Convert the transaction to a document.
     */
    public toDocument(): IUnwrapInteractionTransactionDocument {
        return {
            ...super.toDocument(),

            authorizedBy: this.authorizedBy,
            usedUTXOs: this.usedUTXOs,
            consolidatedVault: this.consolidatedVault,
            unwrapAmount: DataConverter.toDecimal128(this.#unwrapAmount),
            requestedAmount: DataConverter.toDecimal128(this.#requestedAmount),
        };
    }

    public parseTransaction(vIn: VIn[], vOuts: VOut[]): void {
        super.parseTransaction(vIn, vOuts, UnwrapTransaction);

        if (!authorityManager.WBTC_CONTRACT_ADDRESSES.includes(this.contractAddress)) {
            throw new Error(`Invalid contract address found in wrap transaction.`);
        }

        this.decodeCalldata();
        this.parseVaults();
        this.analyzeOutput();
    }

    protected override verifyUnallowed(): void {}

    private analyzeOutput(): void {
        if (this.outputs.length > 2) {
            const consolidatedVaultOutput: TransactionOutput = this.outputs[1];

            if (!consolidatedVaultOutput.scriptPubKey.address) {
                throw new Error(`Invalid address found in unwrap transaction.`);
            }

            this.#consolidatedVault = {
                vault: consolidatedVaultOutput.scriptPubKey.address,
                hash: this.transactionId,
                value: DataConverter.toDecimal128(consolidatedVaultOutput.value),
                outputIndex: consolidatedVaultOutput.index,
                output: Binary.createFromHexString(consolidatedVaultOutput.scriptPubKey.hex),
            };
        }

        const unwrappedOutput: TransactionOutput = this.outputs[this.outputs.length - 1];
        this.#unwrapAmount = unwrappedOutput.value;

        this._callee = authorityManager.WBTC_DEPLOYER; // authorize the burn.
    }

    private parseVaults(): void {
        const authorities: TrustedCompanies[] = [];
        const usedUTXOs: UsedUTXOToDelete[] = [];

        for (const input of this.vaultInputs) {
            for (const key of input.keys) {
                const authority = key.authority;

                if (!authorities.includes(authority)) {
                    authorities.push(authority);
                }
            }

            usedUTXOs.push({
                hash: input.transaction,
                outputIndex: input.index,
            });
        }

        this.#usedUTXOs = usedUTXOs;
        this.#authorizedBy = authorities;
    }

    /**
     * Decode the calldata of the transaction.
     * @private
     */
    private decodeCalldata(): void {
        const reader: BinaryReader = new BinaryReader(this.calldata);
        const selector = reader.readSelector();
        if (selector !== WBTC_UNWRAP_SELECTOR) {
            throw new Error(`Invalid selector found in unwrap transaction ${selector}.`);
        }

        const amount: bigint = reader.readU256();
        if (amount < 0n) {
            throw new Error(`Invalid amount found in unwrap transaction.`);
        }

        this.#requestedAmount = amount;
    }
}
