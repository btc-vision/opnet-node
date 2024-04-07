import * as bitcoin from 'bitcoinjs-lib';
import { BitcoinHelper } from '../src/bitcoin/BitcoinHelper.js';
import { BSCTransaction, UTXOS } from '../src/bitcoin/Transaction.js';
import { BitcoinRawTransactionParams } from '../src/blockchain-indexer/rpc/types/BitcoinRawTransaction.js';
import { BitcoinVerbosity } from '../src/blockchain-indexer/rpc/types/BitcoinVerbosity.js';
import { BitcoinCore } from './BitcoinCore.js';

export class MineBlock extends BitcoinCore {
    constructor() {
        super();
    }

    protected async mineBlock(blockCount: number): Promise<void> {
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
    }

    public async init(): Promise<void> {
        await super.init();

        await this.mineBlock(1);
    }
}

void new MineBlock().init();
