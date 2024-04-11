import { Transaction } from 'bitcoinjs-lib';
import { BSCTransaction, ITransaction } from '../src/bitcoin/Transaction.js';
import { BSCSegwitTransaction } from '../src/bitcoin/TransactionP2PKH.js';
import { Vout } from '../src/blockchain-indexer/rpc/types/BitcoinRawTransaction.js';
import { BitcoinCore } from './BitcoinCore.js';

export class MineBlock extends BitcoinCore {
    constructor() {
        super();
    }

    public async init(): Promise<void> {
        await super.init();

        await this.setWallet({
            walletAddress: 'bcrt1qfqsr3m7vjxheghcvw4ks0fryqxfq8qzjf8fxes',
            publicKey: '020373626d317ae8788ce3280b491068610d840c23ecb64c14075bbb9f670af52c',
            privateKey: 'cRCiYAgCBrU7hSaJBRuPqKVYXQqM5CKXbMfWHb25X4FDAWJ8Ai92',
        });

        await this.testTx();
    }

    protected async testTx(): Promise<void> {
        if (!this.lastTx) {
            throw new Error('No last transaction');
        }

        const fundingTransaction: Transaction = await this.getFundingTransactionFromHash(
            'db862b8e3708f86ff9204abd39f200d72c905207ba1048eab1e0ebc9a45aff9f',
        );

        const firstVout = fundingTransaction.outs[0];
        if (!firstVout) {
            throw new Error('No vout found');
        }

        const vout: Vout = {
            value: firstVout.value / 100000000,
            n: 0,
            scriptPubKey: {
                hex: firstVout.script.toString('hex'),
            },
        };

        const voutValue = vout.value * 100000000;
        const data: ITransaction = {
            txid: fundingTransaction.getId(),
            vout: vout,
            from: this.getWalletAddress(),
            to: this.getWalletAddress(),
            calldata: Buffer.from(
                'adgfssdfadssdfasdgfsdfasdfasadgfssdfadssdfasdgfsdfasdfasadgfssdfadssdfasdgfsdfasdfasadgfssdfadssdfasdgfsdfasdfas',
            ),
            value: BigInt(voutValue),
        };

        const keyPair = this.getKeyPair();
        const tx: BSCTransaction = new BSCTransaction(data, keyPair, this.network);
        const txData = tx.signTransaction();

        if (!txData) {
            throw new Error('Could not sign transaction');
        }

        this.log(`Transaction data: ${txData}`);

        const rawTxParams = {
            hexstring: txData,
            maxfeerate: 1000000,
        };

        this.log(`Sending raw transaction: ${rawTxParams.hexstring}`);

        const txOut = await this.bitcoinRPC.sendRawTransaction(rawTxParams);
        console.log(`Transaction out: ${txOut}`);
    }

    private async sendFundsToTapWallet(): Promise<Transaction> {
        if (!this.lastTx) {
            throw new Error('No last transaction');
        }

        const firstVout = this.lastTx.vout[0];
        if (!firstVout) {
            throw new Error('No vout found');
        }

        const tapAddr: string = BSCTransaction.generateTapAddress(this.getKeyPair(), this.network);
        this.log(`Funding tap address: ${tapAddr}`);

        const voutValue = firstVout.value;
        const data: ITransaction = {
            txid: this.lastTx.txid,
            vout: firstVout,
            from: this.getWalletAddress(),
            to: tapAddr,
            value: BigInt(voutValue * 100000000),
        };

        const tx: BSCSegwitTransaction = new BSCSegwitTransaction(
            data,
            this.getKeyPair(),
            this.network,
        );

        const txFunding = tx.signTransaction();
        if (!txFunding) {
            throw new Error('Could not sign transaction');
        }

        this.log(`Funding Transaction data: ${txFunding}`);

        const rawTxParams = {
            hexstring: txFunding,
            maxfeerate: 1000000,
        };

        const txOut = await this.bitcoinRPC.sendRawTransaction(rawTxParams);
        if (!txOut) {
            throw new Error('Failed to send transaction');
        }

        this.success(`Funding Transaction out: ${txOut}`);

        return tx.getTransaction();
    }

    private async getFundingTransactionFromHash(txHash: string): Promise<Transaction> {
        const txDetail = await this.getTransactionFromHash(txHash);

        if (!txDetail) {
            throw new Error('Failed to get transaction detail');
        }

        return Transaction.fromHex(txDetail.hex);
    }
}

void new MineBlock().init();
