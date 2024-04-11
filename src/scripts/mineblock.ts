import { BIP32Interface } from 'bip32';
import { Transaction } from 'bitcoinjs-lib';
import { BitcoinHelper } from '../src/bitcoin/BitcoinHelper.js';
import { BSCTransaction, ITransaction } from '../src/bitcoin/Transaction.js';
import { BSCSegwitTransaction } from '../src/bitcoin/TransactionP2PKH.js';
import { Vout } from '../src/blockchain-indexer/rpc/types/BitcoinRawTransaction.js';
import { BitcoinCore } from './BitcoinCore.js';

export class MineBlock extends BitcoinCore {
    private readonly rndSeedSelected: Buffer = this.rndSeed();
    private readonly rndPubKey: BIP32Interface = BitcoinHelper.fromSeed(
        Buffer.from(
            'c60a9c3f4568a870fe4983ae56076a61b8bf17ebf9795841c3badb7b905f35f839438d8cc2a894f1b76c47a555e5675c942b06e34ebc627a08805187ac294e01',
            'hex',
        ),
    );

    constructor() {
        super();

        console.log(this.rndSeedSelected.toString('hex'));
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

        const calldata = Buffer.from(
            'adgfssdfadssdfasdgfsdfasdfasadgfssdfadssdfasdgfsdfasdfasadgfssdfadssdfasdgfsdfasdfasadgfssdfadssdfasdgfsdfasdfas',
        );

        const fundingTransaction = await this.getFundingTransaction(); //await this.sendFundsToTapWallet(calldata);
        const vout: Vout = this.getVout(fundingTransaction);

        const tapAddr: string = BSCTransaction.generateTapAddress(
            this.getKeyPair(),
            calldata,
            this.rndPubKey,
            this.network,
        );

        const voutValue = vout.value * 100000000;
        const data: ITransaction = {
            txid: fundingTransaction.getId(),
            vout: vout,
            from: this.getWalletAddress(),
            to: tapAddr,
            calldata: calldata,
            value: BigInt(voutValue),
        };

        const keyPair = this.getKeyPair();
        const tx: BSCTransaction = new BSCTransaction(data, keyPair, this.rndPubKey, this.network);
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

    private rndSeed(): Buffer {
        const buf = crypto.getRandomValues(new Uint8Array(64));

        return Buffer.from(buf);
    }

    private async getFundingTransaction(): Promise<Transaction> {
        /*const txFromBlock = await this.getFundingTransactionFromBlockHash(
            '13fd40e6c4d00d55174b138e89fcdb4329e3cfe7424aa3a782f1c5da69a3ea0b',
        );*/

        return await this.getFundingTransactionFromHash(
            'f08371c9adedab435d434d0dc0060fc1ad4a249ad93774d30183e7f142cd7b16',
        );
    }

    private getIndex(): number {
        return 0;
    }

    private getVout(fundingTransaction: Transaction): Vout {
        const firstVout = fundingTransaction.outs[this.getIndex()];
        if (!firstVout) {
            throw new Error('No vout found');
        }

        return {
            value: firstVout.value / 100000000,
            n: this.getIndex(),
            scriptPubKey: {
                hex: firstVout.script.toString('hex'),
            },
        };
    }

    private async sendFundsToTapWallet(calldata: Buffer): Promise<Transaction> {
        if (!this.lastTx) {
            throw new Error('No last transaction');
        }

        const fundingTransaction = await this.getFundingTransaction();
        const vout: Vout = this.getVout(fundingTransaction);

        const tapAddr: string = BSCTransaction.generateTapAddress(
            this.getKeyPair(),
            calldata,
            this.rndPubKey,
            this.network,
        );

        this.log(`Funding tap address: ${tapAddr}`);

        const voutValue = vout.value * 100000000;
        const data: ITransaction = {
            txid: fundingTransaction.getId(),
            vout: vout,
            from: this.getWalletAddress(),
            to: tapAddr,
            value: BigInt(voutValue),
        };

        const tx: BSCSegwitTransaction = new BSCSegwitTransaction(
            data,
            this.getKeyPair(),
            this.rndPubKey,
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
