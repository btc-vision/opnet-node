import * as bitcoin from 'bitcoinjs-lib';
import { initEccLib, opcodes, payments, script } from 'bitcoinjs-lib';
import { toXOnly } from 'bitcoinjs-lib/src/psbt/bip371.js';
import { Taptree } from 'bitcoinjs-lib/src/types.js';
import { ECPairFactory, ECPairInterface } from 'ecpair';
import * as ecc from 'tiny-secp256k1';

initEccLib(ecc);

const network = bitcoin.networks.bitcoin; // Use bitcoin.networks.testnet for testnet

export class BitcoinHelper {
    public static ECPair = ECPairFactory(ecc);

    public static generateNewContractAddress(bytecode: Buffer, deployerPublicKey: string): string {
        const hash_lock_keypair = BitcoinHelper.ECPair.makeRandom({ network });
        const deployer = BitcoinHelper.ECPair.fromPublicKey(Buffer.from(deployerPublicKey, 'hex'), {
            network,
        });

        return this.generateContractAddressFromSalt(bytecode, deployer, hash_lock_keypair);
    }

    public static generateContractAddressFromSalt(
        bytecode: Buffer,
        deployer: ECPairInterface,
        salt: ECPairInterface,
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
        const wallet = bitcoin.payments.p2pkh({ pubkey: keyPair.publicKey });

        if (!wallet.address) {
            throw new Error('Failed to generate wallet');
        }

        return {
            address: wallet.address,
            privateKey: keyPair.toWIF(),
            publicKey: keyPair.publicKey.toString('hex'),
        };
    }

    public static getWalletAddress(keypair: ECPairInterface): string {
        const wallet = bitcoin.payments.p2pkh({ pubkey: keypair.publicKey });

        if (!wallet.address) {
            throw new Error('Failed to generate wallet');
        }

        return wallet.address;
    }

    public static generateRandomKeyPair(): ECPairInterface {
        return BitcoinHelper.ECPair.makeRandom();
    }
}
