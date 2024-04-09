import { Logger } from '@btc-vision/motoswapcommon';
import { Buff } from '@cmdcode/buff-utils';
import * as Test from '@cmdcode/crypto-utils';

import { Address, Signer, Tap, Tx, TxData } from '@cmdcode/tapscript';
import { Networks } from '@cmdcode/tapscript/dist/types/schema/types.js';
import * as bitcoin from 'bitcoinjs-lib';
import { initEccLib } from 'bitcoinjs-lib';
import { ECPairInterface } from 'ecpair';
import * as ecc from 'tiny-secp256k1';
import { ScriptPubKey } from '../blockchain-indexer/rpc/types/BitcoinRawTransaction.js';
import { Config } from '../config/Config.js';

initEccLib(ecc);

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

    //private readonly salt: ECPairInterface;

    private taprootAddress: string | null = null;
    private tpubkey: string | null = null;
    private witness: string | null = null;

    private tapleaf: string | null = null;

    private script: (string | Uint8Array)[] = [];
    private transaction: TxData | null = null;

    private readonly tseckey: string;
    private readonly pubkey: string;

    constructor(
        private readonly utxos: UTXOS,
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

        //const [tseckey] = Tap.getSecKey(seckey);
        //const [tpubkey] = Tap.getPubKey(pubkey);

        this.pubkey = pubkey.hex;
        this.tseckey = seckey.hex;

        //this.tseckey = tseckey;
        //this.tpubkey = tpubkey;

        this.generate();
        this.createTransaction();
    }

    private getTapleafSize(): bigint {
        if (!this.tapleaf) {
            throw new Error('Script must be created first.');
        }

        return BigInt(this.tapleaf.length) / 2n;
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

    private createTransaction(): void {
        if (this.taprootAddress === null || this.tpubkey === null) {
            throw new Error('Taproot address is required');
        }

        const txId = this.utxos.txid;
        const btcValue = BigInt(this.utxos.value * 100000000);

        if (btcValue <= 333n) {
            throw new Error('Insufficient funds');
        }

        const cost: bigint = BigInt(this.getCostValue());
        this.log(`This transaction will cost: ${cost}`);

        const finalAmt = btcValue - cost;
        if (finalAmt <= 0) {
            throw new Error('Insufficient funds');
        }

        this.transaction = Tx.create({
            vin: [
                {
                    // Use the txid of the funding transaction used to send the sats.
                    txid: txId,
                    // Specify the index value of the output that you are going to spend from.
                    vout: 0,

                    // Also include the value and script of that ouput.
                    prevout: {
                        // Feel free to change this if you sent a different amount.
                        value: btcValue,
                        // This is what our address looks like in script form.
                        scriptPubKey: ['OP_1', this.tpubkey],
                    },
                },
            ],
            vout: [
                {
                    // We are leaving behind 1000 sats as a fee to the miners.
                    value: finalAmt,
                    // This is the new script that we are locking our funds to.
                    scriptPubKey: Address.toScriptPubKey(this.taprootAddress), // receiver this.data.to
                },
            ],
        });
    }

    public signTransaction(): string {
        if (!this.tapleaf) {
            throw new Error('Tapleaf is required');
        }

        if (!this.witness) {
            throw new Error('Witness is required');
        }

        if (!this.salt.privateKey) {
            throw new Error('Private key is required');
        }

        if (!this.transaction) {
            throw new Error('Transaction is required');
        }

        if (!this.tpubkey) {
            throw new Error('Taproot public key is required');
        }

        const signer = Signer.taproot.sign(this.tseckey, this.transaction, 0, {
            extension: this.tapleaf,
            //pubkey: this.tpubkey,
            throws: true,
        });

        this.transaction.vin[0].witness = [signer, this.script, this.witness]; //
        console.dir(this.transaction, { depth: null, colors: true });

        const isValid = Signer.taproot.verify(this.transaction, 0, {
            pubkey: this.pubkey,
            throws: true,
        });

        if (!isValid) {
            throw new Error('Invalid signature');
        }

        return Tx.encode(this.transaction).hex;
    }

    private generate(): void {
        this.getCalldata();

        this.tapleaf = Tap.encodeScript(this.script);

        const [tpubkey, cblock] = Tap.getPubKey(this.pubkey, { target: this.tapleaf });

        this.tpubkey = tpubkey;
        this.witness = cblock;

        this.taprootAddress = Address.p2tr.fromPubKey(tpubkey, this.getNetworkString());

        this.log(
            `Encoded target taproot address: ${this.taprootAddress} on ${this.getNetworkString()}`,
        );
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

        this.script = [
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
