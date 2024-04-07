import { Logger } from '@btc-vision/motoswapcommon';
import { Buff } from '@cmdcode/buff-utils';

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
    private taprootPublicKey: string | null = null;
    private witness: string | null = null;

    private tapleaf: string | null = null;

    private script: (string | Uint8Array)[] = [];

    private transaction: TxData | null = null;

    private readonly tseckey: string;
    private readonly tpubkey: string;

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

        //this.salt = BitcoinHelper.ECPair.makeRandom({ network: this.network });

        const secKey = [this.salt.privateKey.toString('hex')]; //Tap.getSecKey(this.salt.privateKey);
        const pubKey = [this.salt.publicKey.toString('hex')]; //Tap.getPubKey(this.salt.publicKey);

        this.tseckey = secKey[0];
        this.tpubkey = pubKey[0];

        this.generate();
        this.createTransaction();
    }

    private getTapleafSize(): number {
        if (!this.tapleaf) {
            throw new Error('Script must be created first.');
        }
        return this.tapleaf.length / 2;
    }

    private getCostBase(): number {
        return 200;
    }

    private getPadding(): number {
        return 333;
    }

    private getCostValue(customSatVb: number = 1, applyPadding = true) {
        if (!this.tapleaf) {
            throw new Error('Script must be created first.');
        }

        const tapleafSize = this.getTapleafSize();
        const totalVbytes = this.getCostBase() + tapleafSize / 2;

        const totalCost = totalVbytes * customSatVb;

        return applyPadding ? this.getPadding() + totalCost : totalCost;
    }

    private createTransaction(): void {
        if (this.taprootAddress === null || this.taprootPublicKey === null) {
            throw new Error('Taproot address is required');
        }

        const txId = this.utxos.txid;
        const btcValue = BigInt(this.utxos.value * 100000000);

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
                        value: cost,
                        // This is what our address looks like in script form.
                        scriptPubKey: ['OP_1', this.taprootPublicKey],
                    },
                },
            ],
            vout: [
                {
                    // We are leaving behind 1000 sats as a fee to the miners.
                    value: finalAmt,
                    // This is the new script that we are locking our funds to.
                    scriptPubKey: Address.toScriptPubKey(this.data.to), //this.taprootAddress,
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

        if (!this.taprootPublicKey) {
            throw new Error('Taproot public key is required');
        }

        const signer = Signer.taproot.sign(this.tseckey, this.transaction, 0, {
            extension: this.tapleaf,
            pubkey: this.taprootPublicKey,
            throws: true,
        });

        this.transaction.vin[0].witness = [signer, this.script, this.witness];

        const isValid = Signer.taproot.verify(this.transaction, 0, {
            pubkey: this.tpubkey,
            throws: true,
        });

        if (!isValid) {
            throw new Error('Invalid signature');
        }

        //console.log(JSON.stringify(this.transaction, null, 4));

        return Tx.encode(this.transaction).hex;
    }

    private generate(): void {
        //const xOnlySaltPubKey = toXOnly(this.salt.publicKey).toString('hex');

        this.getCalldata();

        this.tapleaf = Tap.encodeScript(this.script); //calldata.toString('hex');
        console.log('calldata ->', this.tapleaf);

        // Generate a tapkey that includes our leaf script. Also, create a merlke proof
        // (cblock) that targets our leaf and proves its inclusion in the tapkey.
        const [tpubkey, cblock] = Tap.getPubKey(this.tpubkey, { target: this.tapleaf });

        this.taprootPublicKey = tpubkey;
        this.witness = cblock;

        // A taproot address is simply the tweaked public key, encoded in bech32 format.
        this.taprootAddress = Address.p2tr.fromPubKey(tpubkey, this.getNetworkString());
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

        this.script = [
            this.tpubkey,
            'OP_CHECKSIG',
            'OP_0',
            'OP_IF',
            Buff.encode('bsc'),
            '01',
            new Uint8Array([1]),
            '02',
            'OP_0',
            this.toUint8Array(this.data.calldata),
            'OP_ENDIF',
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
