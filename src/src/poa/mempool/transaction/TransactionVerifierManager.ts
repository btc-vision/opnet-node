import { TransactionTypes } from './TransactionTypes.js';
import { Network, networks, Psbt, Transaction } from '@btc-vision/bitcoin';
import { ConfigurableDBManager, Logger } from '@btc-vision/bsi-common';
import { TransactionVerifier } from '../verificator/TransactionVerifier.js';
import { Consensus } from '../../configurations/consensus/Consensus.js';
import { BitcoinTransactionVerificatorV2 } from '../verificator/bitcoin/v2/BitcoinTransactionVerificatorV2.js';

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
    readonly transaction: Transaction;
}

export class TransactionVerifierManager extends Logger {
    public readonly logColor: string = '#e0e0e0';

    private verificator: TransactionVerifier<TransactionTypes>[] = [];

    constructor(
        protected readonly db: ConfigurableDBManager,
        protected readonly network: Network = networks.bitcoin,
    ) {
        super();

        this.verificator.push(new BitcoinTransactionVerificatorV2(this.db, network));
    }

    public async createRepositories(): Promise<void> {
        const promises = this.verificator.map((v) => v.createRepositories());

        await Promise.safeAll(promises);
    }

    public async verify(data: Buffer, isPsbt: boolean): Promise<IKnownTransaction | false> {
        const psbtType: TransactionTypes = data[0];

        const verificator = this.verificator.find((v) => v.type === psbtType);
        if (verificator) {
            let psbtOrTransaction: Psbt | Transaction | undefined;
            if (isPsbt) {
                psbtOrTransaction = this.getPSBT(data);
            } else {
                psbtOrTransaction = this.getTransaction(data);
            }

            if (!psbtOrTransaction) {
                return false;
            }

            return await verificator.verify(psbtOrTransaction);
        } else {
            throw new Error('Unknown PSBT type');
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

    private getTransaction(data: Buffer): Transaction | undefined {
        try {
            return Transaction.fromBuffer(data);
        } catch (e) {
            console.log(e);
            this.warn(`Failed to decode PSBT. Invalid transaction data.`);
        }
    }
}
