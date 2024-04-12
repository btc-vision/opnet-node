import { address, Transaction } from 'bitcoinjs-lib';
import { ECPairInterface } from 'ecpair';
import { BitcoinHelper } from '../src/bitcoin/BitcoinHelper.js';
import { BSCTransactionScriptPath } from '../src/bitcoin/BSCTransactionScriptPath.js';
import { ITransaction, ITransactionDataContractInteraction } from '../src/bitcoin/Transaction.js';
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
        'bcrt1p0l7zv2lts55yf74h67mxxfapksy0lc524lamwlalajx722m07fds378u3h';

    private readonly contractAddress: string =
        'bcrt1p8yjs29f87g7qau9v6rwecxhcqj447c5jvfqp9xgaa8ua40w4mzmsvnqwvx'; // rnd for now

    private readonly lastBlockHash: string =
        '003de0dab1ab330bfb91eddb592172a64fe5a4f0d81bd3cf9c8ed97a3ef8fb39';

    private readonly lastTxHash: string =
        'f843ce568fcf58dc327b5f40f29a2b2a81953c2e6043b687089e71e5cf460050';

    private readonly transactionIndex: number = 0;

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

        await this.sendScriptPathTransaction();
    }

    protected async sendScriptPathTransaction(): Promise<void> {
        const calldata = Buffer.from(
            'adgfssdfadssdfasdgfsdfasdfasadgfssdfadssdfasdgfsdfasdfasadgfssdfadssdfasdgfsdfasdfasadgfssdfadssdfasdgfsdfasdfas',
        );

        const fundingTransaction = await this.getFundingTransaction(); //await this.sendFundsToTapWallet(calldata);
        const vout: Vout = this.getVout(fundingTransaction);

        const contractSecret = address.fromBech32(this.contractAddress);

        const voutValue = vout.value * 100000000;
        const data: ITransactionDataContractInteraction = {
            txid: fundingTransaction.getId(),
            vout: vout,
            from: this.getWalletAddress(), // wallet address
            calldata: calldata,
            value: BigInt(voutValue),

            customSigner: this.rndPubKey,
            contractSecret: contractSecret.data,
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
        const txFromBlock = await this.getFundingTransactionFromBlockHash(this.lastBlockHash);

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
