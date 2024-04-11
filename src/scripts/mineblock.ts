import bitcore, { Script, Transaction } from 'bitcore-lib';
import { BSCTransaction, ITransaction } from '../src/bitcoin/Transaction.js';
import { BitcoinCore } from './BitcoinCore.js';

export class MineBlock extends BitcoinCore {
    constructor() {
        super();
    }

    protected async testTx(): Promise<void> {
        if (!this.lastTx) {
            throw new Error('No last transaction');
        }

        const firstVout = this.lastTx.vout[0];
        if (!firstVout) {
            throw new Error('No vout found');
        }

        const voutValue = firstVout.value;

        const data: ITransaction = {
            from: this.getWalletAddress(),
            to: this.getWalletAddress(),
            calldata: Buffer.from(
                'adgfssdfadssdfasdgfsdfasdfasadgfssdfadssdfasdgfsdfasdfasadgfssdfadssdfasdgfsdfasdfasadgfssdfadssdfasdgfsdfasdfas',
            ),
            value: voutValue,
            fee: 0,
        };

        const keyPair = this.getKeyPair();
        const script: Script = new bitcore.Script(firstVout.scriptPubKey.hex);

        const addr: bitcore.Address = new bitcore.Address(
            this.getWalletAddress(),
            this.networkBitcore,
        );

        const unspent: Transaction.UnspentOutput = new bitcore.Transaction.UnspentOutput({
            address: addr,
            txId: this.lastTx.txid,
            outputIndex: 0,
            script: script,
            satoshis: voutValue * 100000000,
        });

        const uxtosArr: Transaction.UnspentOutput[] = [unspent];

        const tx: BSCTransaction = new BSCTransaction(uxtosArr, data, keyPair);
        const txData = tx.signTransaction();

        this.log(`Transaction data: ${txData}`);

        const rawTxParams = {
            hexstring: txData,
            maxfeerate: 1000000,
        };

        //await this.mineBlock(100);
        this.log(`Sending raw transaction: ${rawTxParams.hexstring}`);

        const txOut = await this.bitcoinRPC.sendRawTransaction(rawTxParams);
        console.log(`Transaction out: ${txOut}`);
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
}

void new MineBlock().init();
