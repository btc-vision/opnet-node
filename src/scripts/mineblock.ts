import { Transaction } from 'bitcoinjs-lib';
import { ECPairInterface } from 'ecpair';
import { BitcoinHelper } from '../src/bitcoin/BitcoinHelper.js';
import { BSCTransactionScriptPath } from '../src/bitcoin/BSCTransactionScriptPath.js';
import { ITransaction } from '../src/bitcoin/Transaction.js';
import { BSCSegwitTransaction } from '../src/bitcoin/TransactionP2PKH.js';
import { Vout } from '../src/blockchain-indexer/rpc/types/BitcoinRawTransaction.js';
import { BitcoinCore } from './BitcoinCore.js';

export class MineBlock extends BitcoinCore {
    private readonly oldSeed: Buffer = Buffer.from(
        'c60a9c3f4568a870fe4983ae56076a61b8bf17ebf9795841c3badb7b905f35f839438d8cc2a894f1b76c47a555e5675c942b06e34ebc627a08805187ac294e01',
        'hex',
    );

    private readonly rndSeedSelected: Buffer = this.rndSeed();
    private readonly rndPubKey: ECPairInterface = BitcoinHelper.fromSeedKeyPair(
        this.oldSeed !== null ? this.oldSeed : this.rndSeedSelected,
        this.network,
    );

    private readonly tapAddress: string =
        'bcrt1pus9guqnzv9gkz9f9r0cvadz3fxhsgj2hflauguu6rt8kkwa4zwgspus25x';

    private readonly lastTxHash: string =
        '3942375184e4a73b0c142eea9e0263f4e3c33bccba94c53d1e0acf426824744b';

    private readonly transactionIndex: number = 1;

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

        //await this.fundTaprootTransaction();
        //await this.fundScriptPathTransaction();

        await this.sendScriptPathTransaction();
    }

    protected async sendScriptPathTransaction(): Promise<void> {
        const calldata = Buffer.from(
            'adgfssdfadssdfasdgfsdfasdfasadgfssdfadssdfasdgfsdfasdfasadgfssdfadssdfasdgfsdfasdfasadgfssdfadssdfasdgfsdfasdfas',
        );

        const fundingTransaction = await this.getFundingTransaction(); //await this.sendFundsToTapWallet(calldata);
        const vout: Vout = this.getVout(fundingTransaction);

        const voutValue = vout.value * 100000000;
        const data: ITransaction = {
            txid: fundingTransaction.getId(),
            vout: vout,
            from: this.getWalletAddress(), // wallet address
            calldata: calldata,
            value: BigInt(voutValue),

            customSigner: this.rndPubKey,
        };

        const keyPair = this.getKeyPair();
        const tx: BSCTransactionScriptPath = new BSCTransactionScriptPath(
            data,
            keyPair,
            this.rndPubKey,
            this.network,
            1,
        );

        const tapAddr = tx.getScriptAddress();
        if (this.tapAddress !== tapAddr) {
            throw new Error(`Tap address mismatch! Want: ${this.tapAddress} - Got: ${tapAddr}`);
        }

        this.info(`Script address: ${tapAddr} - Tap address: ${tx.getTapAddress()}`);

        const txData = tx.signTransaction(this.getWalletAddress());
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
        const txFromBlock = await this.getFundingTransactionFromBlockHash(
            '356f30796e102a5566a926d9748359986411822677b76af2a454a2fadd0f3626',
        );

        const txHash: string = this.lastTxHash || txFromBlock.txid;

        return await this.getFundingTransactionFromHash(txHash);
    }

    private getIndex(): number {
        return this.transactionIndex;
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

    private async fundScriptPathTransaction(): Promise<Transaction> {
        throw new Error('Not implemented');
    }

    private async fundTaprootTransaction(): Promise<Transaction> {
        const fundingTransaction = await this.getFundingTransaction();
        const vout: Vout = this.getVout(fundingTransaction);

        const voutValue = vout.value * 100000000;
        const data: ITransaction = {
            txid: fundingTransaction.getId(),
            vout: vout,
            from: this.getWalletAddress(),
            value: BigInt(voutValue),
        };

        const tx: BSCSegwitTransaction = new BSCSegwitTransaction(
            data,
            this.getKeyPair(),
            this.network,
        );

        //const tapAddr = tx.getScriptAddress();
        this.log(`Funding tap address: ${this.tapAddress}`);

        const txFunding = tx.signTransaction(this.tapAddress);
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

        //throw new Error('Not implemented');
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
