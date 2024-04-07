import { BSCTransaction, UTXOS } from '../src/bitcoin/Transaction.js';
import { BitcoinCore } from './BitcoinCore.js';

export class MineBlock extends BitcoinCore {
    constructor() {
        super();
    }

    /*protected async mineBlock(blockCount: number): Promise<void> {
        if (!this.walletAddress) throw new Error('Wallet address not set');

        const blocks = await this.bitcoinRPC.generateToAddress(
            blockCount,
            this.walletAddress,
            this.defaultWalletName,
        );

        if (!blocks) {
            throw new Error('Failed to mine block');
        }

        this.log(`Mined ${blocks.length} blocks`);

        const blockHash = blocks[0];
        this.log(`Block hash: ${blockHash}`);

        const blockData = await this.bitcoinRPC.getBlockInfoOnly(blockHash);
        if (!blockData) throw new Error('Failed to get block data');

        const txs = blockData.tx;
        if (!txs || !txs[0]) throw new Error('No transactions found in block');

        const txHash = txs[0];
        this.log(`Transaction hash: ${txHash}`);

        const params: BitcoinRawTransactionParams = {
            txId: txHash,
        };

        const txInfo = await this.bitcoinRPC.getRawTransaction<BitcoinVerbosity.NONE>(params);
        if (!txInfo) throw new Error('Failed to get transaction info');

        const utxos: UTXOS[] = [
            {
                txid: txInfo.txid,
                vout: txInfo.vout,
                value: 0,
            },
        ];

        const rndWallet = BitcoinHelper.generateRandomKeyPair();

        const idkRndTx = new BSCTransaction(
            utxos,
            {
                from: this.walletAddress,
                to: this.walletAddress,
                calldata: Buffer.from('adgfssdfadssdfasdgfsdfasdfas'),
                fee: 0,
            },
            bitcoin.networks.regtest,
        );

        await idkRndTx.signTransaction(rndWallet);

        console.log(idkRndTx);
    }*/

    protected async testTx(): Promise<void> {
        if (!this.lastTx) {
            throw new Error('No last transaction');
        }

        const firstVout = this.lastTx.vout[0];
        if (!firstVout) {
            throw new Error('No vout found');
        }

        const scriptPubKey = firstVout.scriptPubKey;
        const voutValue = firstVout.value;

        console.log(this.lastTx);

        const utxos: UTXOS = {
            txid: this.lastTx.txid,
            vout: scriptPubKey,
            value: voutValue,
        };

        const data = {
            from: this.getWalletAddress(),
            to: this.getWalletAddress(),
            calldata: Buffer.from(
                'adgfssdfadssdfasdgfsdfasdfasadgfssdfadssdfasdgfsdfasdfasadgfssdfadssdfasdgfsdfasdfasadgfssdfadssdfasdgfsdfasdfas',
            ),
            fee: 0,
        };

        const keyPair = this.getKeyPair();
        const tx: BSCTransaction = new BSCTransaction(utxos, data, keyPair, this.network);
        const txData = tx.signTransaction();

        this.log(`Transaction data: ${txData}`);

        const rawTxParams = {
            hexstring: txData,
            maxfeerate: 1000000,
        };

        await this.mineBlock(100);

        const txOut = await this.bitcoinRPC.sendRawTransaction(rawTxParams);
        console.log(txOut);
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
