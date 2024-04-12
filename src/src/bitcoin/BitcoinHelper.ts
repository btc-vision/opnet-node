import * as BIP32Factory from 'bip32';
import { BIP32Interface } from 'bip32';
import * as bitcoin from 'bitcoinjs-lib';
import { address, initEccLib, opcodes, payments, script, Signer } from 'bitcoinjs-lib';
import { Network } from 'bitcoinjs-lib/src/networks.js';
import { tapTweakHash } from 'bitcoinjs-lib/src/payments/bip341.js';
import { toXOnly } from 'bitcoinjs-lib/src/psbt/bip371.js';
import { Taptree } from 'bitcoinjs-lib/src/types.js';
import { ECPairFactory, ECPairInterface } from 'ecpair';
import * as ecc from 'tiny-secp256k1';

initEccLib(ecc);

export interface TweakSettings {
    network?: Network;
    tweakHash?: Buffer;
}

export class BitcoinHelper {
    public static ECPair = ECPairFactory(ecc);
    public static BIP32 = BIP32Factory;

    public static generateNewContractAddress(
        bytecode: Buffer,
        deployerPublicKey: string,
        network: Network = bitcoin.networks.bitcoin,
    ): string {
        const hash_lock_keypair = BitcoinHelper.ECPair.makeRandom({ network });
        const deployer = BitcoinHelper.ECPair.fromPublicKey(Buffer.from(deployerPublicKey, 'hex'), {
            network,
        });

        return this.generateContractAddressFromSalt(bytecode, deployer, hash_lock_keypair, network);
    }

    public static tweakSigner(signer: Signer, opts: TweakSettings = {}): Signer {
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

        return BitcoinHelper.fromPrivateKey(Buffer.from(tweakedPrivateKey), opts.network);
    }

    public static fromSeed(
        seed: Buffer,
        network: Network = bitcoin.networks.bitcoin,
    ): BIP32Interface {
        return BitcoinHelper.BIP32.fromSeed(seed, network);
    }

    public static fromSeedKeyPair(
        seed: Buffer,
        network: Network = bitcoin.networks.bitcoin,
    ): ECPairInterface {
        const fromSeed = BitcoinHelper.BIP32.fromSeed(seed, network);
        const privKey = fromSeed.privateKey;
        if (!privKey) throw new Error('Failed to generate key pair');

        return BitcoinHelper.ECPair.fromPrivateKey(privKey, { network });
    }

    public static compileData(calldata: Buffer, pubKey: Buffer): Buffer {
        const size = Buffer.alloc(4);
        size.writeUint32LE(calldata.byteLength, 0);

        return script.compile([
            pubKey,
            opcodes.OP_CHECKSIG,

            /*opcodes.OP_NOP9,
                                  opcodes.OP_DEPTH,
                                  opcodes.OP_1,
                                  opcodes.OP_NUMEQUAL,

                                  opcodes.OP_IF,
                                  opcodes.OP_DROP,

                                  opcodes.OP_PUSHDATA1,
                                  opcodes.OP_3,
                                  Buffer.from('bsc'),

                                  opcodes.OP_PUSHDATA4,
                                  size,

                                  Buffer.from(calldata),

                                  opcodes.OP_NOP10,
                                  opcodes.OP_ENDIF,*/
        ]);
    }

    public static fromWIF(
        wif: string,
        network: Network = bitcoin.networks.bitcoin,
    ): ECPairInterface {
        return BitcoinHelper.ECPair.fromWIF(wif, network);
    }

    public static fromPrivateKey(
        privateKey: Buffer,
        network: Network = bitcoin.networks.bitcoin,
    ): ECPairInterface {
        return BitcoinHelper.ECPair.fromPrivateKey(privateKey, { network });
    }

    public static fromPublicKey(
        publicKey: Buffer,
        network: Network = bitcoin.networks.bitcoin,
    ): ECPairInterface {
        return BitcoinHelper.ECPair.fromPublicKey(publicKey, { network });
    }

    public static generateContractAddressFromSalt(
        bytecode: Buffer,
        deployer: ECPairInterface,
        salt: ECPairInterface,
        network: Network = bitcoin.networks.bitcoin,
    ): string {
        const xOnly = toXOnly(salt.publicKey).toString('hex');
        const deployerAddress = toXOnly(deployer.publicKey);

        const p2pk_script = bitcoin.script.compile([
            deployerAddress,
            opcodes.OP_CHECKSIG,

            opcodes.OP_FALSE,
            opcodes.OP_IF,
            opcodes.OP_PUSHDATA1,
            Buffer.from('bsc'),
            opcodes.OP_PUSHDATA1,
            Buffer.from([0]),
            opcodes.OP_PUSHDATA1,
            Buffer.from(bytecode),
            opcodes.OP_ENDIF,
        ]);

        const hash = bitcoin.crypto.hash160(bytecode);
        const hash_script_asm = `OP_HASH160 ${hash.toString('hex')} OP_EQUALVERIFY ${xOnly} OP_CHECKSIG`;

        const hash_lock_script = script.fromASM(hash_script_asm);
        const scriptTree: Taptree = [
            {
                output: hash_lock_script,
            },
            {
                output: p2pk_script,
            },
        ];

        const script_p2tr = payments.p2tr({
            internalPubkey: deployerAddress,
            scriptTree,
            network,
        });

        if (!script_p2tr.address) {
            throw new Error('Failed to generate contract address');
        }

        return script_p2tr.address;
    }

    public static generateWallet(): { address: string; privateKey: string; publicKey: string } {
        const keyPair = BitcoinHelper.ECPair.makeRandom();
        const wallet = this.getP2WPKHAddress(keyPair);

        if (!wallet) {
            throw new Error('Failed to generate wallet');
        }

        return {
            address: wallet,
            privateKey: keyPair.toWIF(),
            publicKey: keyPair.publicKey.toString('hex'),
        };
    }

    public static getTaprootAddress(
        keyPair: ECPairInterface,
        network: Network = bitcoin.networks.bitcoin,
    ): string {
        const myXOnlyPubkey = keyPair.publicKey.slice(1, 33);
        /*const commitHash = bitcoin.crypto.taggedHash('TapTweak', myXOnlyPubkey);
        const tweakResult = ecc.xOnlyPointAddTweak(myXOnlyPubkey, commitHash);
        if (tweakResult === null) throw new Error('Invalid Tweak');
        const { xOnlyPubkey: tweaked } = tweakResult;*/

        const output = Buffer.concat([
            // witness v1, PUSH_DATA 32 bytes
            Buffer.from([0x51, 0x20]),
            // x-only pubkey (remove 1 byte y parity)
            myXOnlyPubkey,
        ]);

        console.log(keyPair.publicKey.length);

        return address.fromOutputScript(output, network);
    }

    public static getLegacyAddress(
        keyPair: ECPairInterface,
        network: Network = bitcoin.networks.bitcoin,
    ): string {
        const wallet = bitcoin.payments.p2pkh({ pubkey: keyPair.publicKey, network: network });

        if (!wallet.address) {
            throw new Error('Failed to generate wallet');
        }

        return wallet.address;
    }

    public static getP2WPKHAddress(
        keyPair: ECPairInterface,
        network: Network = bitcoin.networks.bitcoin,
    ): string {
        const res = bitcoin.payments.p2wpkh({ pubkey: keyPair.publicKey, network: network });

        if (!res.address) {
            throw new Error('Failed to generate wallet');
        }

        return res.address;
    }

    public static generateRandomKeyPair(
        network: Network = bitcoin.networks.bitcoin,
    ): ECPairInterface {
        return BitcoinHelper.ECPair.makeRandom({
            network: network,
        });
    }
}
