import { TransactionData, VIn, VOut } from '@btc-vision/bsi-bitcoin-rpc';
import { Network, opcodes } from 'bitcoinjs-lib';
import { IUnwrapInteractionTransactionDocument } from '../../../../db/interfaces/ITransactionDocument.js';
import { OPNetTransactionTypes } from '../enums/OPNetTransactionTypes.js';
import { InteractionTransaction, InteractionWitnessData } from './InteractionTransaction.js';
import { AuthorityManager } from '../../../../poa/configurations/manager/AuthorityManager.js';
import { P2PVersion } from '../../../../poa/configurations/P2PVersion.js';
import { Address, BinaryReader } from '@btc-vision/bsi-binary';
import { WBTC_WRAP_SELECTOR } from '../../../../poa/wbtc/WBTCRules.js';

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

    constructor(
        rawTransactionData: TransactionData,
        vIndexIn: number,
        blockHash: string,
        blockHeight: bigint,
        network: Network,
    ) {
        super(rawTransactionData, vIndexIn, blockHash, blockHeight, network);
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
        console.log('unwrap.', this);

        return {
            ...super.toDocument(),
        };
    }

    public parseTransaction(vIn: VIn[], vOuts: VOut[]): void {
        super.parseTransaction(vIn, vOuts, UnwrapTransaction);

        if (!authorityManager.WBTC_CONTRACT_ADDRESSES.includes(this.contractAddress)) {
            throw new Error(`Invalid contract address found in wrap transaction.`);
        }
    }

    protected override verifyUnallowed(): void {}

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

        const amount: bigint = reader.readU256();
        if (amount < 0n) {
            throw new Error(`Invalid amount found in wrap transaction.`);
        }
    }
}
