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

    private readonly contractAddress: string =
        'bcrt1p8yjs29f87g7qau9v6rwecxhcqj447c5jvfqp9xgaa8ua40w4mzmsvnqwvx'; // rnd for now

    private readonly tapAddress: string =
        'bcrt1ppkgn63ntdfl6acm6cz3jhfsu7a4h6s7h3wp5hm6nmvrh24glmuhqlxe9zt';

    private readonly lastBlockHash: string =
        '0598638180de89dde0d7c732163036a7e17c6af1861e0e3b5fcc357026716190';

    private readonly lastTxHash: string =
        '65a15e74fe15e217ca4ba35a9734b0d93c1f92b356fedba5dcb7850bc9539cc7';

    private readonly transactionIndex: number = 0;

    private readonly calldata: Buffer = Buffer.from(
        '3593564c000000000000000000000000000000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000000a0000000000000000000000000000000000000000000000000000000006618c6a700000000000000000000000000000000000000000000000000000000000000040a00060c00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000400000000000000000000000000000000000000000000000000000000000000800000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000032000000000000000000000000000000000000000000000000000000000000003a00000000000000000000000000000000000000000000000000000000000000160000000000000000000000000857ffc55b1aa61a7ff847c82072790cae73cd883000000000000000000000000ffffffffffffffffffffffffffffffffffffffff0000000000000000000000000000000000000000000000000000000067f9f9ec0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000ef1c6e67703c7bd7107eed8303fbe6ec2554bf6b0000000000000000000000000000000000000000000000000000000067f9f9ec00000000000000000000000000000000000000000000000000000000000000e0000000000000000000000000000000000000000000000000000000000000004175d6f65b2b5919142e1569b3fb1c085efb1334448869943532eacb1807e0774c1d7718d6390c6a523ff42f527530669720c9897ce9d1e6cecdb0dc5c64830cd21b00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000681078e730fbe9500000000000000000000000000000000000000000000000000c04ece7ae4817a00000000000000000000000000000000000000000000000000000000000000a00000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000002b857ffc55b1aa61a7ff847c82072790cae73cd883000bb8c02aaa39b223fe8d0a0e5c4f27ead9083c756cc20000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000060000000000000000000000000c02aaa39b223fe8d0a0e5c4f27ead9083c756cc20000000000000000000000005b77f30623c7857c8b9340204d886da9193e8c3900000000000000000000000000000000000000000000000000000000000000640000000000000000000000000000000000000000000000000000000000000040000000000000000000000000e0498a041f814c7110d2523a6795439d26ce77bd00000000000000000000000000000000000000000000000000be627f9d80f0d2',
        'hex',
    );

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
        const fundingTransaction = await this.getFundingTransaction(); //await this.sendFundsToTapWallet(calldata);
        const vout: Vout = this.getVout(fundingTransaction);

        const contractSecret = address.fromBech32(this.contractAddress);

        const voutValue = vout.value * 100000000;
        const data: ITransactionDataContractInteraction = {
            txid: fundingTransaction.getId(),
            vout: vout,
            from: this.getWalletAddress(), // wallet address
            calldata: this.calldata,
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

        const txData = tx.signTransaction(this.contractAddress);
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
