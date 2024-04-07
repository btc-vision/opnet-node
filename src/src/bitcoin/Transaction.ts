import { Logger } from '@btc-vision/motoswapcommon';
import * as bitcoin from 'bitcoinjs-lib';
import { initEccLib, opcodes, payments, Psbt, script, Signer } from 'bitcoinjs-lib';
import { tapTweakHash } from 'bitcoinjs-lib/src/payments/bip341.js';
import { toXOnly } from 'bitcoinjs-lib/src/psbt/bip371.js';
import { Taptree } from 'bitcoinjs-lib/src/types.js';
import { ECPairInterface } from 'ecpair';
import * as ecc from 'tiny-secp256k1';
import { BitcoinHelper } from './BitcoinHelper.js';

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
    readonly vout: number;
    readonly value: number;
}

export class BSCTransaction extends Logger {
    public readonly logColor: string = '#785def';

    private readonly salt: ECPairInterface;

    constructor(
        private readonly utxos: UTXOS[],
        private readonly data: ITransaction,
        private readonly network: bitcoin.Network = bitcoin.networks.bitcoin,
    ) {
        super();

        this.salt = BitcoinHelper.ECPair.makeRandom({ network });
    }

    private tweakSigner(signer: Signer, opts: TweakOptions = {}): Signer {
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        let privateKey: Uint8Array | undefined = signer.privateKey!;
        if (!privateKey) {
            throw new Error('Private key is required for tweaking signer!');
        }
        if (signer.publicKey[0] === 3) {
            privateKey = ecc.privateNegate(privateKey);
        }

        const tweakedPrivateKey = ecc.privateAdd(
            privateKey,
            tapTweakHash(toXOnly(signer.publicKey), opts.tweakHash),
        );
        if (!tweakedPrivateKey) {
            throw new Error('Invalid tweaked private key!');
        }

        return BitcoinHelper.ECPair.fromPrivateKey(Buffer.from(tweakedPrivateKey), {
            network: opts.network,
        });
    }

    private async getTxInfo(deployer: ECPairInterface): Promise<bitcoin.Payment> {
        const xOnly = toXOnly(this.salt.publicKey).toString('hex');
        const deployerAddress = toXOnly(deployer.publicKey);

        const hash = bitcoin.crypto.hash160(this.data.calldata);
        const hash_script_asm = `OP_HASH160 ${hash.toString('hex')} OP_EQUALVERIFY ${xOnly} OP_CHECKSIG`;

        const hash_lock_script = script.fromASM(hash_script_asm);
        const scriptTree: Taptree = [
            {
                output: hash_lock_script,
            },
            {
                output: this.getCalldata(),
            },
        ];

        return payments.p2tr({
            internalPubkey: deployerAddress,
            scriptTree,
            network: this.network,
        });
    }

    public async signTransaction(keypair: ECPairInterface): Promise<string> {
        const signer = this.tweakSigner(keypair, { network: this.network });

        const txInfo = await this.getTxInfo(keypair);
        console.log(txInfo);

        const psbt = new Psbt({ network: this.network });
        psbt.addInput({
            hash: this.utxos[0].txid,
            index: this.utxos[0].vout,
            witnessUtxo: { value: this.utxos[0].value, script: txInfo.output! },
            tapInternalKey: toXOnly(keypair.publicKey),
        });

        const dataScript = bitcoin.payments.embed({ data: [this.getCalldata()] });
        psbt.addOutput({
            script: dataScript.output!,
            value: 0,
        });

        psbt.signInput(0, signer);
        psbt.finalizeAllInputs();

        const tx = psbt.extractTransaction();
        return tx.toHex();
    }

    private getCalldata(): Buffer {
        if (!this.data.calldata) {
            throw new Error('Calldata is required');
        }

        return bitcoin.script.compile([
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
    }
}
