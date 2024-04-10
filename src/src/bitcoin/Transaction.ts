import { Logger } from '@btc-vision/motoswapcommon';
import { Buff } from '@cmdcode/buff-utils';
import * as Test from '@cmdcode/crypto-utils';
import { Networks } from '@cmdcode/tapscript/dist/types/schema/types.js';
import * as bitcoin from 'bitcoinjs-lib';
import { initEccLib } from 'bitcoinjs-lib';

import * as BitCore2 from 'bitcore-lib';

import { ECPairInterface } from 'ecpair';
import * as ecc from 'tiny-secp256k1';
import { ScriptPubKey } from '../blockchain-indexer/rpc/types/BitcoinRawTransaction.js';
import { Config } from '../config/Config.js';

initEccLib(ecc);

// @ts-ignore
const BitCore = BitCore2.default;

export interface ITransaction {
    readonly from: string;
    readonly to: string;

    readonly calldata: Buffer;
    readonly fee: number;
}

interface TweakOptions {
    readonly network?: bitcoin.Network;
    readonly tweakHash?: Buffer;
}

export interface UTXOS {
    readonly txid: string;
    readonly vout: ScriptPubKey;
    readonly value: number;
}

export class BSCTransaction extends Logger {
    public readonly logColor: string = '#785def';
    private readonly tseckey: string;
    private readonly pubkey: string;
    private readonly transaction: BitCore2.Transaction = new BitCore.Transaction();

    constructor(
        private readonly utxos: BitCore2.Transaction.UnspentOutput[],
        private readonly data: ITransaction,
        private readonly salt: ECPairInterface,
        private readonly network: bitcoin.Network = bitcoin.networks.bitcoin,
    ) {
        super();

        if (!this.salt.privateKey) {
            throw new Error('Private key is required');
        }

        const seckey = Test.keys.get_seckey(this.salt.privateKey);
        const pubkey = Test.keys.get_pubkey(seckey, true); //toXOnly(this.salt.publicKey).toString('hex');

        this.pubkey = pubkey.hex;
        this.tseckey = seckey.hex;

        this.buildTransaction();
    }

    public signTransaction(): string {
        return this.transaction.sign(this.tseckey).serialize();
    }

    private buildTransaction(): void {
        const value = this.getCostValue() + 1000n;

        this.transaction.from(this.utxos);
        this.transaction.to(this.data.to, 330);
        this.transaction.change(this.data.from);
        this.transaction.fee(Number(value));
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

    private getNetworkString(): Networks {
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
    }

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
