import { Logger } from '@btc-vision/motoswapcommon';
import { Buff } from '@cmdcode/buff-utils';
import * as Test from '@cmdcode/crypto-utils';
import { initEccLib } from 'bitcoinjs-lib';

import bitcore, { Transaction } from 'bitcore-lib';

import { ECPairInterface } from 'ecpair';
import * as ecc from 'tiny-secp256k1';

initEccLib(ecc);

export interface ITransaction {
    readonly from: string;
    readonly to: string;

    readonly calldata: Buffer;
    readonly value: number;
    readonly fee: number;
}

export class BSCTransaction extends Logger {
    public readonly logColor: string = '#785def';
    private readonly tseckey: string;
    private readonly pubkey: string;
    private readonly transaction: Transaction = new bitcore.Transaction();

    constructor(
        private readonly utxos: Transaction.UnspentOutput[],
        private readonly data: ITransaction,
        private readonly salt: ECPairInterface,
        //private readonly network: bitcoin.Network = bitcoin.networks.bitcoin,
    ) {
        super();

        if (!this.salt.privateKey) {
            throw new Error('Private key is required');
        }

        const seckey = Test.keys.get_seckey(this.salt.privateKey);
        const pubkey = Test.keys.get_pubkey(seckey, true);

        this.pubkey = pubkey.hex;
        this.tseckey = seckey.hex;

        this.buildTransaction();
    }

    public signTransaction(): string {
        this.transaction.sign(this.tseckey);
        const verified = this.transaction.verify();

        if (verified !== true) {
            this.error(`Transaction verification failed: ${verified}`);
        } else {
            this.log(`Transaction verified.`);
        }

        return this.transaction.serialize({
            disableDustOutputs: true,
        });
    }

    private buildTransaction(): void {
        if (!this.utxos[0].address) {
            throw new Error('Address is required');
        }

        //const value = this.getCostValue() + 1000n;
        this.transaction.from(this.utxos);

        this.transaction.to(this.data.to, bitcore.Transaction.DUST_AMOUNT);
        this.transaction.change(this.utxos[0].address);
        //this.transaction.addData(this.data.calldata);

        console.log('fee', this.transaction.getFee(), this.transaction.outputs);
        //this.transaction.fee(Number(value));
    }

    private getTapleafSize(): bigint {
        if (!this.data.calldata) {
            throw new Error('Script must be created first.');
        }

        return BigInt(this.data.calldata.byteLength) / 2n;
    }

    private getCostBase(): bigint {
        return 200n;
    }

    private getPadding(): bigint {
        return 333n;
    }

    private getCostValue(customSatVb: bigint = 1n, applyPadding = true): bigint {
        const tapleafSize = this.getTapleafSize();
        const totalVbytes = this.getCostBase() + tapleafSize / 2n;

        const totalCost = totalVbytes * customSatVb;

        return applyPadding ? this.getPadding() + totalCost : totalCost;
    }

    /*private getNetworkString(): Networks {
        switch (Config.BLOCKCHAIN.BITCOIND_NETWORK.toLowerCase()) {
            case 'regtest':
                return 'regtest';
            case 'testnet':
                return 'testnet';
            case 'mainnet':
                return 'main';
            case 'signet':
                return 'signet';
            default:
                throw new Error('Invalid network');
        }
    }*/

    private toUint8Array(buffer: Buffer): Uint8Array {
        const array = new Uint8Array(buffer.byteLength);

        for (let i = 0; i < buffer.byteLength; i++) {
            array[i] = buffer[i];
        }

        return array;
    }

    private getCalldata(): void {
        if (!this.data.calldata) {
            throw new Error('Calldata is required');
        }

        const marker = Buff.encode('ord');
        const mimetype = Buff.encode('image/png');
        const imgdata = new Uint8Array([1]);

        const script = [
            this.pubkey,
            'OP_CHECKSIG',
            'OP_0',
            'OP_IF',
            marker,
            '01',
            mimetype,
            'OP_0',
            imgdata,
            'OP_ENDIF',
            /*'OP_0',
            'OP_IF',
            Buff.encode('bsc'),
            '01',
            new Uint8Array([1]),
            '02',
            'OP_0',
            this.toUint8Array(this.data.calldata),
            'OP_ENDIF',*/
        ];

        /*const test = bitcoin.script.compile([
            opcodes.OP_FALSE,
            opcodes.OP_IF,
            opcodes.OP_PUSHDATA1,
            Buffer.from('bsc'),
            opcodes.OP_PUSHDATA1,
            Buffer.from([1]),
            opcodes.OP_PUSHDATA1,
            Buffer.from(this.data.calldata),
            opcodes.OP_ENDIF,
        ]);

        console.log(test.toString('hex'));*/
    }
}
