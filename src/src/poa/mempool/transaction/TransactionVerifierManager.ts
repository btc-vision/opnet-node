import { TransactionTypes } from './TransactionTypes.js';
import { Network, networks, Psbt, Transaction as BitcoinTransaction } from '@btc-vision/bitcoin';
import { ConfigurableDBManager, Logger } from '@btc-vision/bsi-common';
import { TransactionVerifier } from '../verificator/TransactionVerifier.js';
import { Consensus } from '../../configurations/consensus/Consensus.js';
import { BitcoinTransactionVerificatorV2 } from '../verificator/bitcoin/v2/BitcoinTransactionVerificatorV2.js';
import { IMempoolTransactionObj } from '../../../db/interfaces/IMempoolTransaction.js';
import { BitcoinRPC, TransactionData } from '@btc-vision/bitcoin-rpc';
import {
    OPNetTransactionTypes
} from '../../../blockchain-indexer/processor/transaction/enums/OPNetTransactionTypes.js';
import { Transaction } from '../../../blockchain-indexer/processor/transaction/Transaction.js';
import { BitcoinTransactionVerificatorV3 } from '../verificator/bitcoin/v2/BitcoinTransactionVerificatorV3.js';

export interface PSBTDecodedData {
    readonly hash: string;
    readonly estimatedFees: bigint;
}

export interface IKnownTransaction {
    readonly type: TransactionTypes;
    readonly version: Consensus;
}

export interface KnownPSBTObject extends IKnownTransaction {
    readonly psbt: Psbt;
    readonly data: PSBTDecodedData;
}

export interface KnownTransaction extends IKnownTransaction {
    readonly transaction: Transaction<OPNetTransactionTypes>;
}

export class TransactionVerifierManager extends Logger {
    public readonly logColor: string = '#e0e0e0';

    private verificator: TransactionVerifier<TransactionTypes | TransactionTypes[]>[] = [];

    constructor(
        protected readonly db: ConfigurableDBManager,
        protected readonly rpc: BitcoinRPC,
        protected readonly network: Network = networks.bitcoin,
    ) {
        super();

        this.verificator.push(new BitcoinTransactionVerificatorV2(this.db, this.rpc, network));
        this.verificator.push(new BitcoinTransactionVerificatorV3(this.db, this.rpc, network));
    }

    public async createRepositories(): Promise<void> {
        const promises = this.verificator.map((v) => v.createRepositories());

        await Promise.safeAll(promises);
    }

    public async onBlockChange(blockHeight: bigint): Promise<void> {
        const promises = this.verificator.map((v) => v.onBlockChangeSync(blockHeight));

        await Promise.safeAll(promises);
    }

    public async verify(
        tx: IMempoolTransactionObj,
        txData?: TransactionData,
    ): Promise<IKnownTransaction | false> {
        const psbtType: TransactionTypes = tx.data[0];

        const verificator = this.verificator.find((v) =>
            Array.isArray(v.type) ? v.type.includes(psbtType) : v.type === psbtType,
        );

        if (verificator) {
            let psbtOrTransaction: Psbt | BitcoinTransaction | undefined;
            if (tx.psbt) {
                psbtOrTransaction = this.getPSBT(tx.data);
            } else {
                psbtOrTransaction = this.getTransaction(tx.data);
            }

            if (!psbtOrTransaction) {
                return false;
            }

            console.log(psbtOrTransaction);

            return await verificator.verify(tx, psbtOrTransaction, txData);
        } else {
            throw new Error(`Unknown transaction type ${psbtType}`);
        }
    }

    private getPSBT(data: Buffer): Psbt | undefined {
        try {
            return Psbt.fromBase64(data.toString('base64'), { network: this.network });
        } catch (e) {
            console.log(e);
            this.warn(`Failed to decode PSBT. Invalid transaction data.`);
        }
    }

    private getTransaction(data: Buffer): BitcoinTransaction | undefined {
        try {
            return BitcoinTransaction.fromBuffer(data);
        } catch (e) {
            console.log(e);
            this.warn(`Failed to decode PSBT. Invalid transaction data.`);
        }
    }
}
